// WhatsApp du président — entrée : un message reçu du numéro enregistré (ai_president_whatsapp) devient une instruction au directeur général IA.
// L'authenticité vient de la signature HMAC Meta vérifiée par whatsapp-webhook ; seul CE numéro est reconnu, tout autre numéro suit le circuit prospects.
import { audit, clip, db, errMsg, neutralize } from "../core.ts";
import { sendWhatsAppText } from "../channels.ts";
import { createInstructionTask, runTask } from "./engine.ts";
import { runBudgetMs } from "./tick.ts";
import { canonNumero, flushPresidentWhatsApp } from "./president_wa_out.ts";

export type WaInbound = { id: string; from: string; timestamp: string; type: string; text?: { body: string }; button?: { text: string }; interactive?: any };

const MAX_PAR_HEURE = 30;

/** Texte lisible d'un message entrant, ou null (audio, image…). */
export function texteEntrant(m: WaInbound): string | null {
  const t = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
  return typeof t === "string" && t.trim() ? t.trim().slice(0, 4000) : null;
}

/** Retourne une fonction de traitement si le message vient du président, sinon null (le webhook poursuit alors le circuit prospects). */
export async function presidentInbound(m: WaInbound): Promise<(() => Promise<void>) | null> {
  const phone = String(m.from ?? "").replace(/\D/g, "");
  if (!phone) return null;
  const { data: w } = await db().from("ai_president_whatsapp").select("numero, actif, user_id").eq("id", 1).maybeSingle();
  if (!w?.actif || canonNumero(String(w.numero)) !== canonNumero(phone)) return null;
  return () => traiter(m, phone, w.user_id as string | null);
}

async function repondre(phone: string, texte: string): Promise<void> {
  const r = await sendWhatsAppText(phone, texte);
  if (!r.ok) await audit({ agent: "president_whatsapp", action: "reponse_echec", ok: false, payload: { detail: r.detail } });
}

async function traiter(m: WaInbound, phone: string, userId: string | null): Promise<void> {
  try {
    const ts = new Date(Number(m.timestamp) * 1000);
    // La fenêtre de 24 h s'ouvre à ce message ; les réponses en attente hors fenêtre repartent.
    await db().from("ai_president_whatsapp").update({ last_inbound_at: (Number.isFinite(+ts) ? ts : new Date()).toISOString() }).eq("id", 1);
    await db().from("ai_executive_messages").update({ wa_statut: "en_attente" }).eq("auteur", "directeur").eq("wa_statut", "hors_fenetre")
      .gte("created_at", new Date(Date.now() - 3 * 86400e3).toISOString());

    const texte = texteEntrant(m);
    if (!texte) { await repondre(phone, "Je ne lis que les messages texte pour le moment. Écrivez-moi votre instruction."); return; }

    // Doublon (Meta réessaie) : le wamid est unique.
    const { error: dup } = await db().from("ai_executive_messages").insert({ user_id: userId, auteur: "president", contenu: texte, canal: "whatsapp", wamid: m.id });
    if (dup) { if (dup.code !== "23505") await audit({ agent: "president_whatsapp", action: "journal_echec", ok: false, payload: { e: dup.message } }); return; }

    const { count } = await db().from("ai_executive_messages").select("id", { count: "exact", head: true })
      .eq("auteur", "president").eq("canal", "whatsapp").gte("created_at", new Date(Date.now() - 3600e3).toISOString());
    if ((count ?? 0) > MAX_PAR_HEURE) { await repondre(phone, "Trop de messages en peu de temps : je réponds au prochain dans l'heure."); return; }

    const { data: b, error: be } = await db().rpc("ai_budget_check", { p_agent: null });
    if (be || !b) { await repondre(phone, "Contrôle du budget IA indisponible : réessayez dans quelques minutes."); return; }
    if (b.ok === false) {
      const msg = `⚠️ Je ne peux pas traiter cette instruction : ${b.raison}. Ajustez les budgets ou réactivez l'entreprise dans Gouvernance, puis renvoyez votre instruction.`;
      await db().from("ai_executive_messages").insert({ auteur: "directeur", contenu: msg });
      await flushPresidentWhatsApp();
      return;
    }

    const r = await createInstructionTask(texte, userId as string);
    if ("erreur" in r) { await repondre(phone, `Instruction non prise en compte : ${r.erreur}`); return; }
    await db().from("ai_executive_messages").update({ task_id: r.task_id }).eq("wamid", m.id);
    await audit({ agent: "president", action: "instruction_whatsapp", task_id: r.task_id, payload: { apercu: clip(neutralize(texte), 200) } });
    await repondre(phone, "Reçu. Je traite votre instruction et je vous réponds ici.");

    await runTask(r.task_id, { deadline: Date.now() + runBudgetMs() });
    await flushPresidentWhatsApp();                            // filet : réponses du directeur mises en file pendant la mission
  } catch (e) {
    await audit({ agent: "president_whatsapp", action: "traitement_erreur", ok: false, payload: { e: errMsg(e) } });
    try { await repondre(phone, "Une erreur est survenue pendant le traitement de votre instruction. Elle est journalisée ; réessayez ou utilisez le bureau exécutif."); } catch { /* ignoré */ }
  }
}
