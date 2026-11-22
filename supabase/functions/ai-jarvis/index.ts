// JARVIS — assistant conversationnel de la Salle de contrôle (JWT opérateur « direction »).
// Corps : { message, history?, context } → { reply, actions }. Modèle économique (Haiku), budget IA appliqué par callClaude.
import { audit, cors, db, errMsg, HttpError, json, requireOperator } from "../_shared/core.ts";
import { BudgetError, callClaude, LlmKeyMissingError, ProviderBillingError, ProviderConfigurationError, TransientLlmError } from "../_shared/llm.ts";
import { buildContext, cleanHistory, JARVIS_FORMAT, knownIds, parseReply, SYSTEM } from "../_shared/company/jarvis.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Méthode non autorisée" }, 405);
  try {
    const op = await requireOperator(req);
    if (op.role === "commercial") throw new HttpError(403, "Réservé à la direction");
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (message.length < 1) throw new HttpError(400, "Message vide");
    if (message.length > 1500) throw new HttpError(400, "Message trop long");
    const history = cleanHistory(body.history);
    const user = `CONTEXTE EN DIRECT\n${buildContext(body.context)}\n\nDEMANDE DU PRÉSIDENT : ${message}`;
    const messages = [...history, { role: "user" as const, content: user }];
    const { message: out } = await callClaude({
      label: "jarvis", system: SYSTEM, messages, model: "claude-haiku-5-5", effort: "low", maxTokens: 700,
      format: JARVIS_FORMAT as unknown as Record<string, unknown>,
    });
    const text = out.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const r = parseReply(text, knownIds(body.context));
    await audit({ agent: "jarvis", action: "jarvis_reponse", ok: true, payload: { par: op.user_id, nb_actions: r.actions.length } });
    return json(req, r, 200);
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.message }, e.status);
    if (e instanceof BudgetError) return json(req, { error: "Budget IA atteint : " + e.message, code: "budget" }, 429);
    if (e instanceof LlmKeyMissingError || e instanceof ProviderBillingError || e instanceof ProviderConfigurationError) return json(req, { error: e.message, code: "config" }, 503);
    if (e instanceof TransientLlmError) return json(req, { error: "Service IA momentanément indisponible", code: "transient" }, 503);
    await audit({ agent: "jarvis", action: "jarvis_erreur", ok: false, payload: { e: errMsg(e) } }).catch(() => {});
    return json(req, { error: "Erreur Jarvis" }, 500);
  }
});
