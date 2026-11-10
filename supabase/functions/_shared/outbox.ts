// Envoi des messages sortants sous gouvernance : interdit | validation (file d'approbation) | autonome.
import { audit, db, errMsg } from "./core.ts";
import { AI_DISCLOSURE, isFirstOutbound, type Prospect, sendEmail, sendWhatsApp } from "./channels.ts";

export type CommMode = "interdite" | "validation" | "autonome";

export async function commMode(): Promise<CommMode> {
  const { data } = await db().from("ai_governance").select("communication_externe, actif").eq("id", 1).maybeSingle();
  if (!data || data.actif === false) return "interdite";
  return (data.communication_externe as CommMode) ?? "validation";
}

export type DeliverInput = {
  prospect: Prospect & { relances_sans_reponse?: number };
  canal: "whatsapp" | "email"; objet?: string | null; contenu: string;
  agentId?: string | null; agentLabel: string; taskId?: string | null;
};
export type DeliverResult = { statut: string; detail: string; message_id?: number; approval_id?: string; consigne?: string };

export async function deliverMessage(i: DeliverInput): Promise<DeliverResult> {
  const mode = await commMode();
  if (mode === "interdite") {
    throw new Error("Communication externe interdite par la gouvernance (ou entreprise en pause) : aucun message ne peut partir.");
  }
  if (i.prospect.opt_out) throw new Error("Prospect désinscrit : envoi interdit");
  if (!hasChannelPermission(i.prospect, i.canal)) {
    throw new Error(`Envoi ${i.canal} bloqué : consentement ou preuve d'autorisation absent(e).`);
  }
  let contenu = i.contenu.trim().slice(0, 4000);
  if (!contenu) throw new Error("Message vide");
  if (await isFirstOutbound(i.prospect.id)) contenu = `${contenu}\n\n${AI_DISCLOSURE}`;
  const meta = { objet: i.objet ?? null, agent_id: i.agentId ?? null };

  if (mode === "validation") {
    const { data: m, error } = await db().from("ai_messages").insert({
      prospect_id: i.prospect.id, canal: i.canal, sens: "sortant", auteur: "agent", contenu, statut: "a_valider", meta,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const { data: ap } = await db().from("ai_approvals").insert({
      type: "message", prospect_id: i.prospect.id, agent_id: i.agentId ?? null,
      motif: `Message ${i.canal} à ${i.prospect.entreprise}`,
      payload: { message_id: m.id, canal: i.canal, objet: i.objet ?? null, apercu: contenu.slice(0, 600) },
    }).select("id").single();
    return {
      statut: "a_valider", detail: "En attente de validation du président", message_id: m.id, approval_id: ap?.id,
      consigne: "Message soumis à validation : ne le renvoie pas, passe au prospect suivant ou termine.",
    };
  }
  return await sendNow(i.prospect, i.canal, i.objet ?? null, contenu, meta, i.agentLabel);
}

async function sendNow(p: Prospect & { relances_sans_reponse?: number }, canal: "whatsapp" | "email", objet: string | null,
  contenu: string, meta: Record<string, unknown>, agentLabel: string, existingId?: number): Promise<DeliverResult> {
  const res = canal === "whatsapp"
    ? await sendWhatsApp(p, contenu)
    : await sendEmail(p, objet || "SANIX AFRICA — votre gestion simplifiée", contenu);
  const fullMeta = { ...meta, detail: res.detail, template: res.template ?? false };
  let id = existingId;
  if (existingId) {
    // Un échec de configuration laisse le message en file (« a_envoyer ») pour un prochain essai.
    const statut = res.ok ? res.statut : (res.statut === "a_envoyer" ? "a_envoyer" : "echec");
    await db().from("ai_messages").update({ statut, external_id: res.external_id ?? null, meta: fullMeta }).eq("id", existingId);
    if (res.ok) await db().from("ai_prospects").update({ last_outbound_at: new Date().toISOString() }).eq("id", p.id);
  } else {
    const { data } = await db().from("ai_messages").insert({
      prospect_id: p.id, canal, sens: "sortant", auteur: "agent", contenu,
      statut: res.statut, external_id: res.external_id ?? null, meta: fullMeta,
    }).select("id").single();
    id = data?.id;
  }
  if (res.ok) {
    await db().from("ai_prospects").update({ relances_sans_reponse: (Number(p.relances_sans_reponse) || 0) + 1 }).eq("id", p.id);
  }
  await audit({ agent: agentLabel, action: "message_sortant", prospect_id: p.id, ok: res.ok, payload: { canal, statut: res.statut, detail: res.detail } });
  return { statut: res.statut, detail: res.detail, message_id: id };
}

/** Envoie les messages approuvés par le président (ou mis en file faute de configuration). */
export async function flushOutbox(limit = 20): Promise<{ envoyes: number; en_file: number }> {
  const mode = await commMode();
  if (mode === "interdite") return { envoyes: 0, en_file: 0 };
  const { data: rows } = await db().from("ai_messages").select("id, prospect_id, canal, contenu, meta")
    .eq("sens", "sortant").eq("statut", "a_envoyer").order("created_at").limit(limit);
  let envoyes = 0, en_file = 0;
  for (const m of rows ?? []) {
    try {
      const { data: p } = await db().from("ai_prospects").select("*").eq("id", m.prospect_id).maybeSingle();
      if (!p || p.opt_out) {
        await db().from("ai_messages").update({ statut: "echec", meta: { ...(m.meta ?? {}), detail: "Prospect désinscrit ou introuvable" } }).eq("id", m.id);
        continue;
      }
      const r = await sendNow(p, m.canal, (m.meta as { objet?: string })?.objet ?? null, m.contenu, (m.meta ?? {}) as Record<string, unknown>, "outbox", m.id);
      if (r.statut === "a_envoyer") en_file++; else envoyes++;
    } catch (e) {
      await audit({ agent: "outbox", action: "flush_erreur", ok: false, payload: { id: m.id, e: errMsg(e) } });
    }
  }
  return { envoyes, en_file };
}


function hasChannelPermission(
  p: DeliverInput["prospect"],
  canal: "whatsapp" | "email",
): boolean {
  if (canal === "whatsapp" && p.last_inbound_at) {
    const age = Date.now() - Date.parse(p.last_inbound_at);
    if (Number.isFinite(age) && age >= 0 && age < 24 * 60 * 60 * 1000) return true;
  }
  const raw = p.consentement?.[canal];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const consent = raw as Record<string, unknown>;
  const preuve = typeof consent.preuve === "string" ? consent.preuve.trim() : "";
  const at = typeof consent.at === "string" ? Date.parse(consent.at) : NaN;
  return preuve.length > 0 && Number.isFinite(at) && at <= Date.now();
}
