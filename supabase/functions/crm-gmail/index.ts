// SANIX CRM — envoi d'e-mails par le Gmail de l'entreprise et suivi des réponses.
//  GET  (retour de Google après « Connecter Gmail »)       : authentifié par le paramètre `state` signé — déployer avec --no-verify-jwt
//  POST status | connect_url | send | disconnect           : JWT opérateur (connect_url et disconnect : direction / admin)
//  POST sync                                               : JWT opérateur OU x-cron-secret (planificateur, toutes les 15 minutes)
// Secrets Edge requis : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. Facultatifs : APP_URL (adresse du CRM) et GMAIL_TOKEN_KEY (32 octets en base64) ;
// sans GMAIL_TOKEN_KEY, la clé de chiffrement du jeton Gmail est dérivée (SHA-256) du secret serveur SUPABASE_SERVICE_ROLE_KEY : rien à saisir.
// Si ce secret serveur change, le jeton stocké devient illisible : il suffit de reconnecter Gmail.
import { cors, cronSecret, db, env, errMsg, HttpError, json, requireOperator, safeEqual } from "../_shared/core.ts";
import { connectUrl, disconnect, GmailError, handleCallback, sendMail, syncReplies, type Deps, type MailRow, type Store } from "../_shared/gmail.ts";

const store: Store = {
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
const TOKEN_KEY = await tokenKey();
const deps: Deps = { fetch: (u, i) => fetch(u, i), now: () => new Date(), env: (n) => n === "GMAIL_TOKEN_KEY" ? TOKEN_KEY : (Deno.env.get(n) ?? ""), store };

function fail(req: Request, e: unknown): Response {
  if (e instanceof HttpError || e instanceof GmailError) return json(req, { error: e.message }, e.status);
  console.error("crm-gmail", errMsg(e));
  return json(req, { error: "Erreur interne" }, 500);
}
const need = (n: string) => { if (!deps.env(n)) throw new HttpError(503, `Configuration incomplète : secret « ${n} » absent (voir supabase/GMAIL.md)`); };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });

  // Retour de Google (navigateur redirigé) : on renvoie vers le CRM avec le résultat dans l'adresse.
  if (req.method === "GET") {
    const dest = await handleCallback(deps, new URL(req.url).searchParams);
    return new Response(null, { status: 302, headers: { Location: dest, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
  if (req.method !== "POST") return json(req, { error: "Méthode non autorisée" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "sync" && req.headers.get("x-cron-secret")) {
      if (!safeEqual(req.headers.get("x-cron-secret") ?? "", await cronSecret())) throw new HttpError(401, "Non autorisé");
      return json(req, { ok: true, ...(await syncReplies(deps)) });
    }

    const op = await requireOperator(req);
    const direction = op.role === "direction" || op.role === "admin";

    if (action === "status") {
      const { data } = await db().from("crm_mail_account").select("email, status, last_error, connected_at").eq("id", 1).maybeSingle();
      return json(req, { connecte: !!data && data.status === "connecte", email: data?.email ?? null, erreur: data?.last_error ?? null, peut_connecter: direction });
    }
    if (action === "connect_url") {
      if (!direction) throw new HttpError(403, "Réservé à la direction");
      need("GOOGLE_CLIENT_ID"); need("GOOGLE_CLIENT_SECRET"); need("GMAIL_TOKEN_KEY");
      return json(req, { url: await connectUrl(deps, op.user_id) });
    }
    if (action === "disconnect") {
      if (!direction) throw new HttpError(403, "Réservé à la direction");
      await disconnect(deps);
      return json(req, { ok: true });
    }
    if (action === "sync") return json(req, { ok: true, ...(await syncReplies(deps)) });
    if (action === "send") {
      need("GOOGLE_CLIENT_ID"); need("GOOGLE_CLIENT_SECRET"); need("GMAIL_TOKEN_KEY");
      const r = await sendMail(deps, op, {
        client_rid: typeof body.client_rid === "string" ? body.client_rid.slice(0, 80) : null, to: String(body.to ?? ""), subject: String(body.subject ?? ""),
        body: String(body.body ?? ""), from_name: typeof body.from_name === "string" ? body.from_name : undefined, relance_jours: Number(body.relance_jours) || undefined,
      });
      return json(req, { ok: true, ...r });
    }
    throw new HttpError(400, "Action inconnue");
  } catch (e) { return fail(req, e); }
});
