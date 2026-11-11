// Appel Claude centralisé : budget, coût, journal, erreurs transitoires.
// Tous les agents (commerciaux v1, collaborateurs de l'entreprise virtuelle, rapports) passent ici :
// un seul endroit applique le budget IA quotidien / mensuel / par agent.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { audit, db, errMsg } from "./core.ts";

export type ModelId = "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-haiku-5-5";
export type Effort = "low" | "medium" | "high" | "max";

/** $ / million de tokens (entrée, sortie, lecture cache, écriture cache 5 min) — estimation pour le budget. */
const PRICES: Record<ModelId, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};
const WEB_SEARCH_USD = 0.01;

export type UsageLike = {
  input_tokens?: number | null; output_tokens?: number | null;
  cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null; web_search_requests?: number | null;
};

export function costUsd(model: string, u: UsageLike): number {
  const p = PRICES[model as ModelId] ?? PRICES["claude-opus-5-5"];
  const ws = u.server_tool_use?.web_search_requests ?? u.web_search_requests ?? 0;
  return ((u.input_tokens ?? 0) * p.in + (u.output_tokens ?? 0) * p.out +
    (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) / 1e6 +
    (ws ?? 0) * WEB_SEARCH_USD;
}

/** Budget (jour / mois / agent) ou pause de gouvernance : l'appel n'est pas lancé. */
export class BudgetError extends Error {}
/** Panne passagère du fournisseur (réseau, 429, 5xx) : la mission est reprise plus tard, sans faute de l'agent. */
export class TransientLlmError extends Error {}
/** Secret ANTHROPIC_API_KEY absent des fonctions Edge : configuration à compléter, jamais une faute de l'agent (mission reportée, essai rendu). */
export class LlmKeyMissingError extends TransientLlmError {}

let _client: Anthropic | null = null;
export const llmKeyPresent = (): boolean => !!Deno.env.get("ANTHROPIC_API_KEY");
function client(): Anthropic {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new LlmKeyMissingError("ANTHROPIC_API_KEY absente des secrets Edge Functions");
  _client ??= new Anthropic({ apiKey, timeout: 140_000, maxRetries: 1 });
  return _client;
}

let _model: { v: ModelId; op: ModelId | null; at: number } | null = null;
async function governanceModels(): Promise<{ v: ModelId; op: ModelId | null }> {
  if (_model && Date.now() - _model.at < 60_000) return _model;
  const { data } = await db().from("ai_governance").select("*").eq("id", 1).maybeSingle();   // « * » : tolère un schéma sans la colonne modele_operationnel
  _model = { v: (data?.modele as ModelId) ?? "claude-opus-5-5", op: (data?.modele_operationnel as ModelId | null) ?? null, at: Date.now() };
  return _model;
}
export async function governanceModel(): Promise<ModelId> { return (await governanceModels()).v; }
/** Modèle d'un agent : les agents d'exécution (niveau ≥ 4 dans l'organigramme) peuvent tourner sur un modèle moins cher
 *  (réglage de gouvernance `modele_operationnel`) ; la direction (niveaux 1 à 3) garde le modèle principal. Sans réglage, tout le monde garde le modèle principal. */
export async function modelForLevel(niveau?: number | null): Promise<ModelId> {
  const m = await governanceModels();
  return niveau != null && niveau >= 4 && m.op ? m.op : m.v;
}
export function resetModelCache(): void { _model = null; }

export type CallOpts = {
  /** Étiquette d'audit (ex. « sales_assistant », « agent:hunter », « rapport »). */
  label: string;
  agentId?: string | null; taskId?: string | null; prospectId?: string | null; missionId?: string | null;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools?: Anthropic.Beta.BetaToolUnion[];
  effort?: Effort;
  maxTokens?: number;
  model?: ModelId;
  /** Niveau de l'agent dans l'organigramme : choisit le modèle (principal ou opérationnel). */
  niveau?: number | null;
  /** Schéma JSON : sortie structurée garantie (pas d'outils dans ce cas). */
  format?: Record<string, unknown>;
};
export type CallResult = { message: Anthropic.Beta.BetaMessage; cost: number };

export async function callClaude(o: CallOpts): Promise<CallResult> {
  const { data: b } = await db().rpc("ai_budget_check", { p_agent: o.agentId ?? null });
  if (b && b.ok === false) throw new BudgetError(String(b.raison ?? "Budget IA atteint"));

  const model = o.model ?? await modelForLevel(o.niveau);
  const params: Record<string, unknown> = {
    model,
    max_tokens: o.maxTokens ?? 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: o.effort ?? "medium", ...(o.format ? { format: { type: "json_schema", schema: o.format } } : {}) },
    cache_control: { type: "ephemeral" },
    system: o.system,
    messages: o.messages,
  };
  if (o.tools?.length) params.tools = o.tools;
  // Repli serveur en cas de refus de sécurité (Opus / Sonnet ; pas disponible sur Haiku).
  if (model !== "claude-haiku-5-5") { params.betas = ["server-side-fallback-2026-07-01"]; params.fallbacks = "default"; }

  let message: Anthropic.Beta.BetaMessage;
  try {
    message = await client().beta.messages.create(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming) as Anthropic.Beta.BetaMessage;
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (e instanceof Anthropic.APIConnectionError || status === 429 || status === 529 || (status !== undefined && status >= 500)) {
      throw new TransientLlmError(errMsg(e));
    }
    throw e;
  }
  const cost = costUsd(model, message.usage as UsageLike);
  await audit({
    agent: o.label, action: "llm_turn", agent_id: o.agentId ?? null, task_id: o.taskId ?? null,
    prospect_id: o.prospectId ?? null, mission_id: o.missionId ?? null,
    payload: { stop: message.stop_reason, model: message.model, effort: o.effort ?? "medium" },
    tokens_in: message.usage.input_tokens, tokens_out: message.usage.output_tokens, cout_usd: Number(cost.toFixed(6)),
  });
  return { message, cost };
}

export function textOf(m: Anthropic.Beta.BetaMessage): string {
  return m.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
}

/** Sortie structurée : JSON validé par le schéma côté API ; on re-parse défensivement. */
export function jsonOf<T>(m: Anthropic.Beta.BetaMessage): T {
  const t = textOf(m);
  try { return JSON.parse(t) as T; } catch { throw new Error("Réponse structurée illisible"); }
}
