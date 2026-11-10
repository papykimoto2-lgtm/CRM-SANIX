// Faux SDK Anthropic scripté : les tests décrivent, agent par agent, les appels d'outils du « modèle ».
export type Params = { system: string; messages: any[]; tools?: any[]; model: string; [k: string]: unknown };
type Handler = (p: Params, n: number) => any | Promise<any>;
export const llm = { handler: null as Handler | null, calls: [] as Params[] };
export function resetLlm(): void { llm.handler = null; llm.calls = []; }

class APIError extends Error { status?: number; constructor(m: string, status?: number) { super(m); this.status = status; } }
class APIConnectionError extends APIError {}

export default class Anthropic {
  static APIError = APIError;
  static APIConnectionError = APIConnectionError;
  constructor(_o?: unknown) {}
  beta = { messages: { create: async (p: Params) => {
    llm.calls.push(p);
    if (!llm.handler) throw new Error("Aucun script LLM défini");
    return await llm.handler(p, llm.calls.length);
  } } };
}

// ── Aides de scénario ──
let seq = 0;
export const use = (name: string, input: Record<string, unknown>) => ({ type: "tool_use", id: `tu_${++seq}`, name, input });
export const txt = (text: string) => ({ type: "text", text });
export const reply = (content: unknown[], stop = "tool_use", usage: Record<string, number> = {}) => ({
  id: `msg_${++seq}`, type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_details: null,
  usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage },
});
/** Clôture conforme à la règle de preuve : rapport de 40 caractères au moins, résultats de 10 caractères au moins (au moins un). */
export const done = (rapport: string, resultats: string[] = []) => reply([use("terminer_mission", { statut: "terminee",
  rapport: rapport.length >= 40 ? rapport : `${rapport} — compte rendu détaillé enregistré dans la mission.`,
  resultats: (resultats.length ? resultats : ["Mission traitée, résultat enregistré"]).map((r) => r.length >= 10 ? r : `${r} (enregistré)`) })]);
export const json = (o: unknown) => reply([txt(JSON.stringify(o))], "end_turn");

/** Résultats d'outils du dernier message utilisateur, décodés. */
export function results(p: Params): any[] {
  const last = p.messages[p.messages.length - 1];
  return Array.isArray(last?.content) ? last.content.filter((b: any) => b.type === "tool_result").map((b: any) => {
    try { return { ...b, data: JSON.parse(b.content) }; } catch { return { ...b, data: b.content }; }
  }) : [];
}
export const who = (p: Params): string => /^Tu es ([^,\n]+?)(,|\.|\n)/.exec(String(p.system))?.[1] ?? "?";

/** Scénario : file de réponses par agent (clé = nom ou début du nom). */
export function script(queues: Record<string, ((p: Params) => any)[]>): void {
  llm.handler = (p) => {
    const name = who(p);
    const key = Object.keys(queues).find((k) => name === k || name.startsWith(k));
    const next = key ? queues[key].shift() : undefined;
    if (!next) throw new Error(`Script épuisé pour « ${name} » (appel ${llm.calls.length})`);
    return next(p);
  };
}
