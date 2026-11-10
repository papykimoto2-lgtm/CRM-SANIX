// Paramétrage : l'organisation et le catalogue sont des DONNÉES. Preuves sur un vrai PostgreSQL (routage du CRM par rôle et par logiciel, prompts, administration).
import pg from "npm:pg@8.13.1";
import { assert, dropAll, eq, freshDb, mkAgent, mkTask, president, PRESIDENT, rows, val } from "./testkit.ts";
import { sql } from "./fake_supabase.ts";
import { done, llm, script } from "./fake_anthropic.ts";
import { runTask } from "../_shared/company/engine.ts";
import { resetPortfolioCache } from "../_shared/catalogue.ts";

const T = (name: string, fn: () => Promise<void>) => Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
const COMMERCIAL = "22222222-2222-2222-2222-222222222222";

async function as(uid: string, text: string, params: unknown[] = []): Promise<Record<string, any>[]> {
  const db = String(await val("select current_database()"));
  const c = new pg.Client({ host: "127.0.0.1", port: Number(Deno.env.get("TEST_PG_PORT") ?? 5499), user: "postgres", database: db });
  await c.connect();
  try {
    await c.query("begin"); await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)", [uid]);
    const r = await c.query(text, params); await c.query("commit"); return r.rows;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { await c.end(); }
}
const cfg = async (call: string, params: unknown[] = []) => (await as(PRESIDENT, `select ${call} as v`, params))[0].v;
const op = (n: string, rid: string, data: Record<string, unknown>) => ({ op_id: `op-param-${n}`.padEnd(12, "0"), entity: "clients", rid, action: "upsert", data, base_version: null, client_ts: new Date().toISOString(), import: false, natural: true });
const client = (nom: string, phone: string, logiciel: string) => ({ nom, phone, email: "", secteur: "Divers", logiciel, statut: "prospect", commercial: "Aïcha", valeur: 500000, adresse: "Abidjan", notes: "", interactions: [] });
const run = async () => (await sql("select crm_process_events(200) as v")).rows[0].v;
const assigned = async (nom: string) => String(await val("select a.code from ai_agent_tasks t join ai_agents a on a.id = t.agent_id where t.titre like $1 order by t.created_at limit 1", [`%${nom}%`]));

async function world() {
  await freshDb(); await president();
  await sql("insert into auth.users(id) values ($1) on conflict do nothing", [COMMERCIAL]);
  await sql("insert into ai_operators(user_id, nom, role) values ($1, 'Aïcha Commercial', 'commercial')", [COMMERCIAL]);
}

T("PA1 · le CRM route un prospect vers l'agent qui tient le rôle dans la cellule de SON logiciel, et la réaffectation ne demande aucun code", async () => {
  await world();
  for (const [code, nom] of [["ia_qualif_a", "IA Qualification A"], ["ia_qualif_b", "IA Qualification B"]]) {
    await mkAgent(code, nom, 4, "sanix_ai_sales_director", [], "commercial");
    await sql("update ai_agents set role_code = 'qualification' where code = $1", [code]);
  }
  const idOf = async (code: string) => String(await val("select id from ai_agents where code = $1", [code]));
  await cfg("ai_cfg_set_member('immosuite', 'qualification', $1::uuid, true, 0::smallint)", [await idOf("ia_qualif_a")]);
  await cfg("ai_cfg_set_member('aluexpert', 'qualification', $1::uuid, true, 0::smallint)", [await idOf("ia_qualif_b")]);
  const push = (ops: unknown[]) => as(COMMERCIAL, "select crm_sync_push('device-param-0001', $1::jsonb) as v", [JSON.stringify(ops)]);
  await push([op("1", "c_immo1", client("Promoteur Immo Un", "07 01 02 03 04", "ImmoSuite ERP")), op("2", "c_alu1", client("Menuiserie Alu Un", "07 09 08 07 06", "Sanix AluExpert ERP"))]);
  await run();
  eq(await assigned("Promoteur Immo Un"), "ia_qualif_a", "prospect ImmoSuite → l'agent de qualification de la cellule ImmoSuite");
  eq(await assigned("Menuiserie Alu Un"), "ia_qualif_b", "prospect AluExpert → l'agent de qualification de la cellule AluExpert");
  // la direction réaffecte : B prend aussi ImmoSuite, A est retiré ; aucun code modifié
  await cfg("ai_cfg_set_member('immosuite', 'qualification', $1::uuid, false, 0::smallint)", [await idOf("ia_qualif_a")]);
  await cfg("ai_cfg_set_member('immosuite', 'qualification', $1::uuid, true, 0::smallint)", [await idOf("ia_qualif_b")]);
  await push([op("3", "c_immo2", client("Promoteur Immo Deux", "07 11 22 33 44", "ImmoSuite ERP"))]);
  await run();
  eq(await assigned("Promoteur Immo Deux"), "ia_qualif_b", "après réaffectation par la direction : le nouvel agent reçoit les prospects ImmoSuite");
  // propriétaire de l'étape : suit lui aussi la cellule
  const p = await rows("select a.code from ai_prospects p join ai_agents a on a.id = p.agent_id where p.entreprise like 'Promoteur Immo Deux%'");
  eq(p[0]?.code, "ia_qualif_b", "agent responsable du prospect = membre actuel de la cellule");
  // agent suspendu : jamais désigné, repli sur un autre agent de même rôle
  await sql("update ai_agents set etat = 'suspendu' where code = 'ia_qualif_b'");
  await push([op("4", "c_immo3", client("Promoteur Immo Trois", "07 55 66 77 88", "ImmoSuite ERP"))]);
  await run();
  eq(await assigned("Promoteur Immo Trois"), "ia_qualif_a", "agent suspendu écarté : repli sur un autre agent actif portant le rôle");
  await dropAll();
});

T("PA2 · le portefeuille présenté aux agents est le catalogue ACTIF : activer, désactiver ou ajouter un logiciel suffit", async () => {
  await world();
  await mkAgent("ia_t", "IA Testeur", 4, "sanix_ai_sales_director", ["lister_prospects", "get_prospect"]);
  const prompt = async () => {
    resetPortfolioCache(); llm.calls = [];
    const t = await mkTask("ia_t", `Mission ${Math.random().toString(36).slice(2, 8)}`, { donneur: "sanix_ai_sales_director" });
    script({ "IA Testeur": [() => done("Mission traitée avec succès sur les données du CRM.", ["Mission traitée : résultat enregistré"])] });
    await runTask(t, { deadline: Date.now() + 60000 });
    return String(llm.calls[0].system);
  };
  let s = await prompt();
  assert(s.includes("PORTEFEUILLE") && s.includes("ImmoSuite ERP") && s.includes("MedicorERP"), "tous les logiciels actifs du catalogue sont présentés");
  for (const id of ["medicor", "angels", "distripro", "comptapro", "inox100", "snifi", "cilegrenier"]) await cfg("ai_cfg_save_product($1, '{\"actif\": false}'::jsonb)", [id]);
  s = await prompt();
  assert(s.includes("ImmoSuite ERP") && s.includes("AluExpert") && s.includes("AvicoSuite"), "il reste les trois logiciels actifs");
  assert(!s.includes("MedicorERP") && !s.includes("Angel's") && !s.includes("DistriPro"), "un logiciel désactivé n'est plus jamais présenté aux agents");
  await cfg("ai_cfg_save_product('nouveau', '{\"nom\": \"Nouveau Logiciel\", \"marche_cible\": \"PME\", \"actif\": true}'::jsonb)");
  s = await prompt();
  assert(s.includes("Nouveau Logiciel (PME)"), "un logiciel ajouté et activé par la direction apparaît sans modifier le code");
  for (const id of ["immosuite", "aluexpert", "avicosuite", "nouveau"]) await cfg("ai_cfg_save_product($1, '{\"actif\": false}'::jsonb)", [id]);
  s = await prompt();
  assert(s.includes("aucun logiciel actif"), "catalogue vide : les agents sont invités à le signaler, pas à improviser");
  await dropAll();
});
