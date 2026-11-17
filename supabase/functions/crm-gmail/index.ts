// SANIX CRM — envoi d'e-mails par le Gmail de l'entreprise et suivi des réponses.
//  GET  (retour de Google après « Connecter Gmail »)       : authentifié par le paramètre `state` signé — déployer avec --no-verify-jwt
//  POST status | connect_url | send | disconnect           : JWT opérateur (connect_url et disconnect : direction / admin)
//  POST sync                                               : JWT opérateur OU x-cron-secret (planificateur, toutes les 15 minutes)
// Secrets Edge requis : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. Facultatifs : APP_URL (adresse du CRM) et GMAIL_TOKEN_KEY (32 octets en base64) ;
// sans GMAIL_TOKEN_KEY, la clé de chiffrement du jeton Gmail est dérivée (SHA-256) du secret serveur SUPABASE_SERVICE_ROLE_KEY : rien à saisir.
// Si ce secret serveur change, le jeton stocké devient illisible : il suffit de reconnecter Gmail.
import { cors, cronSecret, db, errMsg, HttpError, json, requireOperator, safeEqual } from "../_shared/core.ts";
import { connectUrl, disconnect, GmailError, handleCallback, sendMail, syncReplies, type Deps } from "../_shared/gmail.ts";
import { gmailDeps } from "../_shared/gmail_store.ts";

const deps: Deps = await gmailDeps();

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
