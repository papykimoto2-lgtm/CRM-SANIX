// SANIX CRM — WhatsApp Business (API officielle Meta) : envoi de modèles approuvés et de réponses depuis le CRM.
//  POST status | send_template | send_text : JWT opérateur (Verify JWT désactivé : l'authentification est faite ici).
// Les accusés (remis / lu) et les réponses des prospects arrivent par la fonction `whatsapp-webhook` (signature HMAC de Meta).
// Secrets Edge : WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID (communs avec les agents IA) ; facultatif : WHATSAPP_GRAPH_VERSION.
import { cors, errMsg, HttpError, json, requireOperator } from "../_shared/core.ts";
import { etat, sendTemplate, sendText, WaError } from "../_shared/wacrm.ts";
import { deps } from "../_shared/wacrm_store.ts";


function fail(req: Request, e: unknown): Response {
  if (e instanceof HttpError || e instanceof WaError) return json(req, { error: e.message }, e.status);
  console.error("crm-whatsapp", errMsg(e));
  return json(req, { error: "Erreur interne" }, 500);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Méthode non autorisée" }, 405);
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const op = await requireOperator(req);
    if (action === "status") return json(req, etat(deps));
    if (action === "send_template") {
      const r = await sendTemplate(deps, op, {
        client_rid: typeof body.client_rid === "string" ? body.client_rid.slice(0, 80) : null, to: String(body.to ?? ""), template: String(body.template ?? ""),
        lang: typeof body.lang === "string" ? body.lang : "fr", params: Array.isArray(body.params) ? body.params : [], preview: String(body.preview ?? ""), consent: body.consent === true,
      });
      return json(req, { ok: true, ...r });
    }
    if (action === "send_text") {
      const r = await sendText(deps, op, { client_rid: typeof body.client_rid === "string" ? body.client_rid.slice(0, 80) : null, to: String(body.to ?? ""), text: String(body.text ?? "") });
      return json(req, { ok: true, ...r });
    }
    throw new HttpError(400, "Action inconnue");
  } catch (e) { return fail(req, e); }
});
