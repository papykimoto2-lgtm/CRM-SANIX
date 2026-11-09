// SANIX AI SALES DIRECTOR — agent commercial « conversation » (v1) : message entrant, relance, qualification,
// mission de recherche. Les collaborateurs de l'entreprise virtuelle (v2) sont dans company/engine.ts ;
// ils partagent les mêmes outils CRM (crm_tools.ts) et le même appel IA budgété (llm.ts).
import type Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { audit, db, errMsg } from "./core.ts";
import { callClaude, textOf } from "./llm.ts";
import { crmTool, type CrmCtx, runCrmTool } from "./crm_tools.ts";
import { V1_SYSTEM } from "./prompts.ts";

export type RunMode =
  | { mode: "conversation"; prospect_id: string }   // message entrant (WhatsApp / e-mail)
  | { mode: "relance"; prospect_id: string; scenario: string }
  | { mode: "qualification"; prospect_id: string }
  | { mode: "mission"; mission_id: string };

const MAX_TURNS = 12;

const TOOLSETS: Record<RunMode["mode"], string[]> = {
  conversation: ["get_prospect", "recommend_products", "get_product", "update_prospect", "set_stage", "send_message",
    "get_objection", "list_free_slots", "book_appointment", "create_offer", "schedule_followup", "escalate_to_human"],
  relance: ["get_prospect", "get_product", "update_prospect", "set_stage", "send_message", "get_objection",
    "list_free_slots", "schedule_followup", "escalate_to_human"],
  qualification: ["get_prospect", "recommend_products", "get_product", "update_prospect", "set_stage", "schedule_followup"],
  mission: ["recommend_products", "create_prospect"],
};

export async function runAgent(run: RunMode, brief: string): Promise<{ resume: string; created: number; tours: number }> {
  const label = { conversation: "sales_assistant", relance: "followup_manager", qualification: "qualification", mission: "lead_hunter" }[run.mode];
  const pid = "prospect_id" in run ? run.prospect_id : null;
  const mid = run.mode === "mission" ? run.mission_id : null;

  let createCap = 0;
  if (mid) {
    const { data: m } = await db().from("ai_missions").select("objectif").eq("id", mid).single();
    createCap = m?.objectif ?? 0;
  }
  const ctx: CrmCtx = {
    agentLabel: label, agentId: null, fixedProspect: pid ?? undefined, scope: new Set(), missionId: mid,
    createCap, created: 0, source: "web",
  };

  // v1 : jeux d'outils réduits → garantie de schéma stricte possible (limites API respectées).
  const tools: Anthropic.Beta.BetaToolUnion[] = TOOLSETS[run.mode].map((n) => crmTool(n, true));
  if (run.mode === "mission") {
    tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 15,
      user_location: { type: "approximate", country: "CI", city: "Abidjan", timezone: "Africa/Abidjan" } });
  }
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: brief }];
  let resume = "", tours = 0;

  for (; tours < MAX_TURNS; tours++) {
    const { message: res } = await callClaude({
      label, prospectId: pid, missionId: mid, system: V1_SYSTEM, messages, tools,
      effort: run.mode === "mission" ? "high" : "medium",
    });
    if (res.stop_reason === "refusal") { resume = "Requête refusée par le modèle : escalade humaine."; break; }
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "pause_turn") continue;

    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    resume = textOf(res) || resume;
    if (res.stop_reason !== "tool_use" || !uses.length) break;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const u of uses) {   // séquentiel : les outils modifient l'état (ordre des écritures)
      try {
        const out = await runCrmTool(ctx, u.name, u.input as Record<string, unknown>);
        await audit({ agent: label, action: u.name, prospect_id: pid, mission_id: mid, payload: { input: u.input } });
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out ?? null).slice(0, 30000) });
      } catch (e) {
        const msg = errMsg(e);
        await audit({ agent: label, action: u.name, prospect_id: pid, mission_id: mid, ok: false, payload: { input: u.input, erreur: msg } });
        results.push({ type: "tool_result", tool_use_id: u.id, content: msg, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  if (tours >= MAX_TURNS) resume ||= "Limite de tours atteinte.";
  return { resume, created: ctx.created, tours };
}
