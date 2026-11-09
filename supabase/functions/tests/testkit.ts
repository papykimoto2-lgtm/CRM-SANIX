import pg from "npm:pg@8.13.1";
import { closeDatabase, sql, useDatabase } from "./fake_supabase.ts";
import { resetLlm } from "./fake_anthropic.ts";
import { resetModelCache } from "../_shared/llm.ts";

Deno.env.set("SUPABASE_URL", "http://fake.local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test");
Deno.env.set("ANTHROPIC_API_KEY", "test");
Deno.env.set("CRON_SECRET", "secret");
Deno.env.set("AI_RUN_BUDGET_MS", "60000");

const port = Number(Deno.env.get("TEST_PG_PORT") ?? 5499);
const made: string[] = [];
let n = 0;

async function admin<T>(f: (c: InstanceType<typeof pg.Client>) => Promise<T>): Promise<T> {
  const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres", database: "postgres" });
  await c.connect();
  try { return await f(c); } finally { await c.end(); }
}

/** Nouvelle base isolée (copie de la base modèle migrée). */
export async function freshDb(): Promise<void> {
  const name = `vc_t${Date.now()}_${n++}`;
  await admin((c) => c.query(`create database ${name} template vc_tpl`));
  made.push(name);
  await useDatabase(name);
  resetLlm();
  resetModelCache();
}
export async function dropAll(): Promise<void> {
  await closeDatabase();
  for (const d of made) await admin((c) => c.query(`drop database if exists ${d}`));
}
export const rows = async (text: string, params: unknown[] = []) => (await sql(text, params)).rows;
export const one = async (text: string, params: unknown[] = []) => (await rows(text, params))[0];
export const val = async (text: string, params: unknown[] = []) => { const r = await one(text, params); return r ? Object.values(r)[0] : undefined; };

export function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(`Assertion : ${msg}`); }
export function eq<T>(a: T, b: T, msg: string): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}\n  obtenu  : ${JSON.stringify(a)}\n  attendu : ${JSON.stringify(b)}`);
}
export async function rejects(f: () => Promise<unknown>, partie: string, msg: string): Promise<void> {
  try { await f(); } catch (e) {
    if (!String((e as Error).message).includes(partie)) throw new Error(`${msg} : erreur inattendue « ${(e as Error).message} »`);
    return;
  }
  throw new Error(`${msg} : une erreur était attendue`);
}

export const PRESIDENT = "11111111-1111-1111-1111-111111111111";
const FULL_CHARTE = Object.fromEntries(["identite", "fonction", "departement", "mission_principale", "missions_secondaires", "competences", "outils", "donnees",
  "objectifs", "delais", "indicateurs", "procedures", "limites", "responsable", "reporting"].map((k) => [k, ["missions_secondaires", "competences", "outils", "donnees", "objectifs", "indicateurs", "procedures", "limites"].includes(k) ? ["x"] : "x"]));
export async function mkAgent(code: string, nom: string, niveau: number, chef: string | null, outils: string[] = [], dept = "commercial"): Promise<string> {
  const m = chef ? await val("select id from ai_agents where code = $1", [chef]) : null;
  const id = await val("insert into ai_agents(code, nom, fonction, departement_id, niveau, manager_id, outils, effort) values ($1,$2,$3,$4,$5,$6,$7,'low') returning id", [code, nom, nom, dept, niveau, m, outils]);
  await sql("insert into ai_agent_charters(agent_id, version, contenu) values ($1, 1, $2::jsonb)", [id, JSON.stringify(FULL_CHARTE)]);
  return String(id);
}
export async function mkTask(code: string, titre: string, o: { statut?: string; description?: string; parent?: string | null; donneur?: string | null; type?: string } = {}): Promise<string> {
  const a = await val("select id from ai_agents where code = $1", [code]);
  const d = o.donneur ? await val("select id from ai_agents where code = $1", [o.donneur]) : null;
  const statut = o.statut ?? "en_cours";
  return String(await val(
    "insert into ai_agent_tasks(agent_id, donneur_agent_id, parent_id, type, titre, description, statut, executions, started_at) values ($1,$2,$3,$4,$5,$6,$7,$8, case when $7 = 'en_cours' then now() end) returning id",
    [a, d, o.parent ?? null, o.type ?? "mission", titre, o.description ?? "Description de la mission", statut, statut === "en_cours" ? 1 : 0]));
}
export async function asPresident(requete: string): Promise<void> {
  await sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', '${PRESIDENT}', true); ${requete}; commit;`);
}
export async function president(): Promise<void> {
  await sql("insert into auth.users(id) values ($1) on conflict do nothing", [PRESIDENT]);
  await sql("insert into ai_operators(user_id, nom, role) values ($1, 'Président', 'direction') on conflict do nothing", [PRESIDENT]);
}
