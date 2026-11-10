// Outil « propose_commercial_action » : le VRAI outil des agents contre PostgreSQL réel (migration 20261112000000).
// Un agent propose une action du plan ; elle reste « en attente » jusqu'à la décision d'un opérateur.
import { assert, dropAll, eq, freshDb, one, val } from "./testkit.ts";
import { sql } from "./fake_supabase.ts";
import { CRM_TOOL_NAMES, crmTool, runCrmTool, type CrmCtx } from "../_shared/crm_tools.ts";

const T = (name: string, fn: () => Promise<void>) => Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
const ctx = async (): Promise<CrmCtx> => ({ agentLabel: "test", agentId: String(await val("select id from ai_agents where code = 'sanix_ai_sales_director'")), scope: new Set(), createCap: 0, created: 0, source: "test" });
const fail = async (c: CrmCtx, input: Record<string, unknown>) => { try { await runCrmTool(c, "propose_commercial_action", input); return ""; } catch (e) { return (e as Error).message; } };
const base = { justification: null, responsable: null, echeance: null, objectif_ca: null, segment: null };

T("outil exposé avec un schéma valide", async () => {
  assert(CRM_TOOL_NAMES.includes("propose_commercial_action"), "outil déclaré");
  for (const strict of [true, false]) { const t = crmTool("propose_commercial_action", strict) as { input_schema: { properties: Record<string, unknown> } }; assert("titre" in t.input_schema.properties && !("prospect_id" in t.input_schema.properties), "schéma sans prospect_id"); }
});

T("proposition enregistrée, rattachée à l'agent, en attente", async () => {
  await freshDb(); const c = await ctx();
  const r = await runCrmTool(c, "propose_commercial_action", { ...base, titre: "Relancer les cliniques de Cocody", justification: "Taux de réponse <b>élevé</b>", responsable: "Awa", echeance: "2026-12-15", objectif_ca: 3000000.4, segment: "Santé" }) as { ok: boolean; statut: string };
  eq([r.ok, r.statut], [true, "proposee"], "proposition acceptée");
  const p = await one("select * from pilotage_proposals");
  eq([p.titre, p.statut, Number(p.objectif_ca), p.segment, p.agent_id], ["Relancer les cliniques de Cocody", "proposee", 3000000, "Santé", c.agentId], "champs enregistrés (CA arrondi, agent rattaché)");
  assert(!p.justification.includes("<") && p.justification.includes("élevé"), "HTML neutralisé dans la justification");
  eq(String(await val("select count(*) from crm_records where entity = 'pil_actions'")), "0", "rien n'entre dans le plan sans décision humaine");
  await dropAll();
});

T("garde-fous : date invalide, titre court, doublon, plafond", async () => {
  await freshDb(); const c = await ctx();
  assert((await fail(c, { ...base, titre: "Relancer les cliniques", echeance: "15/12/2026" })).includes("AAAA-MM-JJ"), "date invalide refusée");
  assert((await fail(c, { ...base, titre: "abc" })).includes("trop court"), "titre trop court refusé");
  await runCrmTool(c, "propose_commercial_action", { ...base, titre: "Campagne e-mail Distribution" });
  assert((await fail(c, { ...base, titre: "campagne e-mail distribution" })).includes("identique"), "doublon (casse ignorée) refusé");
  for (let i = 0; i < 19; i++) await runCrmTool(c, "propose_commercial_action", { ...base, titre: `Action de plan numéro ${i}` });
  assert((await fail(c, { ...base, titre: "Une action de trop" })).includes("Trop de propositions"), "plafond de 20 propositions en attente");
  eq(String((await sql("select count(*) n from pilotage_proposals")).rows[0].n), "20", "20 propositions en base");
  await dropAll();
});
