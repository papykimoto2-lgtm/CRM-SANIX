// Stockage et dépendances de l'envoi Gmail (accès base de données + secrets), partagés par la fonction crm-gmail et par l'envoi des rapports (ai-company).
import { db } from "./core.ts";
import { estDesinscription, GmailError, type Deps, type MailRow, type Store } from "./gmail.ts";

export const store: Store = {
  async getAccount() {
    const { data } = await db().from("crm_mail_account").select("email, token_enc, status, scopes").eq("id", 1).maybeSingle();
    return data ?? null;
  },
  async saveAccount(a) {
    const { error } = await db().from("crm_mail_account").upsert({ id: 1, email: a.email, token_enc: a.token_enc, scopes: a.scopes, connected_by: a.connected_by, status: "connecte", last_error: null, connected_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    if (error) throw new GmailError(500, "Enregistrement impossible : " + error.message);
  },
  async markAccountError(msg) {
    await db().from("crm_mail_account").update({ status: msg ? "erreur" : "connecte", last_error: msg, updated_at: new Date().toISOString() }).eq("id", 1);
  },
  async deleteAccount() { await db().from("crm_mail_account").delete().eq("id", 1); },
  async insertMail(m: MailRow) {
    const { data, error } = await db().from("crm_mails").insert(m).select("id").single();
    if (error) throw new GmailError(500, "Journal des e-mails indisponible : " + error.message);
    return data.id as string;
  },
  async pendingMails(sinceIso, limit) {
    const { data } = await db().from("crm_mails").select("*").eq("status", "envoye").not("gmail_thread_id", "is", null).gte("sent_at", sinceIso).order("last_checked_at", { ascending: true, nullsFirst: true }).limit(limit);
    return (data ?? []) as MailRow[];
  },
  async updateMail(id, patch) { await db().from("crm_mails").update(patch).eq("id", id); },
  async countSentSince(sinceIso) {
    const { count } = await db().from("crm_mails").select("id", { count: "exact", head: true }).neq("status", "echec").gte("sent_at", sinceIso);
    return count ?? 0;
  },
  async countSentBy(sentBy, sinceIso) {
    const { count } = await db().from("crm_mails").select("id", { count: "exact", head: true }).eq("sent_by", sentBy).neq("status", "echec").gte("sent_at", sinceIso);
    return count ?? 0;
  },
  async recentDuplicate(toEmail, subject, sinceIso) {
    const { count } = await db().from("crm_mails").select("id", { count: "exact", head: true }).eq("to_email", toEmail).eq("subject", subject).neq("status", "echec").gte("sent_at", sinceIso);
    return (count ?? 0) > 0;
  },
  async recentBounce(toEmail, sinceIso) {
    const { count } = await db().from("crm_mails").select("id", { count: "exact", head: true }).eq("to_email", toEmail).eq("status", "echec").ilike("error", "%distribu%").gte("sent_at", sinceIso);
    return (count ?? 0) > 0;
  },
  async saveReplies(mailId, replies) {
    if (!replies.length) return;
    const { error } = await db().from("crm_mail_replies").upsert(replies.map((r) => ({ mail_id: mailId, ...r })), { onConflict: "gmail_message_id", ignoreDuplicates: true });
    if (error) throw new GmailError(500, "Réponses non enregistrées : " + error.message);
  },
  async repliedWithoutText(sinceIso, checkedBeforeIso, limit) {
    const { data } = await db().from("crm_mails").select("*, crm_mail_replies(id)").eq("status", "repondu").not("gmail_thread_id", "is", null).gte("sent_at", sinceIso).order("sent_at", { ascending: false }).limit(200);
    return (data ?? []).filter((m: any) => !(m.crm_mail_replies ?? []).length && (!m.last_checked_at || m.last_checked_at < checkedBeforeIso)).slice(0, limit).map(({ crm_mail_replies: _r, ...m }: any) => m) as MailRow[];
  },
  async onProspectReply(m, textes) {
    // Prospect côté agents : retrouvé par la clé stable du CRM, à défaut par l'adresse e-mail.
    const q = db().from("ai_prospects").select("id, opt_out, relances_sans_reponse, stage");
    const { data } = m.client_rid ? await q.eq("crm_rid", m.client_rid).limit(1) : await q.ilike("email", m.to_email.replace(/[\\%_]/g, "\\$&")).limit(1);
    const p = data?.[0]; if (!p) return;
    const quand = m.replied_at ?? new Date().toISOString();
    await db().from("ai_prospects").update({ last_inbound_at: quand, relances_sans_reponse: 0, email_statut: "verifiee", email_verifie_at: quand, email_verif_detail: "Le prospect a répondu depuis cette adresse", ...(p.stage === "premier_contact" ? { stage: "conversation" } : {}) }).eq("id", p.id);   // une réponse arrête les relances ; aucune étape ultérieure n'est rétrogradée
    if (textes && !p.opt_out && textes.some((t) => estDesinscription(t))) {
      await db().from("ai_prospects").update({ opt_out: true, opt_out_at: new Date().toISOString() }).eq("id", p.id);
      await db().from("ai_actions").insert({ agent: "gmail", action: "desinscription_stop", prospect_id: p.id, ok: true, payload: { canal: "email" } });
      if (m.client_rid) await store.addInteraction(m.client_rid, { date: new Date().toISOString(), type: "Désinscription (STOP)", note: "Le prospect demande de ne plus être contacté : plus aucun message automatique", ico: "🚫", source: "gmail" }).catch(() => {});
    }
  },
  async adressesAVerifier(limite) {
    const { data } = await db().from("ai_prospects").select("email").eq("email_statut", "inconnu").neq("email", "").not("email", "is", null).limit(limite);
    return [...new Set((data ?? []).map((r: { email: string }) => String(r.email).trim()).filter(Boolean))];
  },
  async adresseStatut(email) {
    const { data } = await db().from("ai_prospects").select("email_statut").ilike("email", email.replace(/[\\%_]/g, "\\$&")).limit(1);
    return String(data?.[0]?.email_statut ?? "inconnu");
  },
  async marquerAdresse(email, statut, detail) {
    const q = db().from("ai_prospects").update({ email_statut: statut, email_verifie_at: new Date().toISOString(), email_verif_detail: detail.slice(0, 300) }).ilike("email", email.replace(/[\\%_]/g, "\\$&"));
    await (statut === "invalide" ? q : q.neq("email_statut", "verifiee"));
  },
  async onBounce(m) {
    await store.marquerAdresse!(m.to_email, "invalide", "Retour « non distribué » de Gmail").catch(() => {});
    const q = db().from("ai_prospects").select("id");
    const { data } = m.client_rid ? await q.eq("crm_rid", m.client_rid).limit(1) : await q.ilike("email", m.to_email.replace(/[\\%_]/g, "\\$&")).limit(1);
    const p = data?.[0]; if (!p) return;
    const { data: annulees } = await db().from("ai_followups").update({ statut: "annulee" }).eq("prospect_id", p.id).eq("statut", "planifiee").select("id");
    if (annulees?.length) await db().from("ai_actions").insert({ agent: "gmail", action: "relances_annulees_adresse_invalide", prospect_id: p.id, ok: true, payload: { relances: annulees.length } });
  },
  async syncProspectOutbound(clientRid, email, at) {
    // Le rattachement stable est obligatoire : aucune recherche approximative par e-mail.
    if (!clientRid) return;
    const { data, error } = await db().from("ai_prospects").select("id,stage").eq("crm_rid", clientRid).limit(2);
    if (error || !data || data.length !== 1) return;
    const p = data[0];
    await db().from("ai_prospects").update({ last_outbound_at: at, ...(["identifie", "enregistre", "qualifie"].includes(p.stage) ? { stage: "premier_contact" } : {}) }).eq("id", p.id);
  },
  async addInteraction(clientRid, interaction) {");
      const r = await db().from("ai_prospects").select("id,stage").ilike("email", safe).limit(2);
      rows = r.data ?? [];
    }
    if (rows.length !== 1) return; // ambigu ou non lié : aucune fiche n'est modifiée par approximation
    const p = rows[0];
    await db().from("ai_prospects").update({ last_outbound_at: at, ...(["identifie", "enregistre", "qualifie"].includes(p.stage) ? { stage: "premier_contact" } : {}) }).eq("id", p.id);
  },
  async addInteraction(clientRid, interaction) {
    // Jamais de création de fiche : on n'écrit que sur une fiche cliente qui existe déjà.
    const { data } = await db().from("crm_records").select("rid").eq("entity", "clients").eq("rid", clientRid).is("deleted_at", null).maybeSingle();
    if (!data) return;
    await db().rpc("crm_put", { p_entity: "clients", p_rid: clientRid, p_patch: { interactions: [interaction] }, p_origin: "ia", p_actor: "gmail", p_protect: false, p_base: null, p_client_ts: null, p_natural: false });
  },
};
async function tokenKey(): Promise<string> {
  const explicit = Deno.env.get("GMAIL_TOKEN_KEY"); if (explicit) return explicit;
  const base = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""; if (!base) return "";
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base + ":crm-gmail-token-key")));
  let bin = ""; for (const b of h) bin += String.fromCharCode(b);
  return btoa(bin);
}
let _deps: Deps | null = null;
/** Dépendances de l'API Gmail (clé de chiffrement du jeton dérivée une seule fois). */
export async function gmailDeps(): Promise<Deps> {
  if (!_deps) { const key = await tokenKey(); _deps = { fetch: (u, i) => fetch(u, i), now: () => new Date(), env: (n) => n === "GMAIL_TOKEN_KEY" ? key : (Deno.env.get(n) ?? ""), store }; }
  return _deps;
}

