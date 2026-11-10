// Passerelle de test « PostgREST » : expose /rest/v1/rpc/<fonction> sur un vrai PostgreSQL (base clonée du modèle vc_tpl), avec l'identité d'un opérateur
// (rôle authenticated + jwt.sub) et l'émulation de pg_cron (traitement des événements CRM ↔ IA toutes les 400 ms). Sert au test de bout en bout du CRM
// (tests/crm_connector_test.js : navigateur réel → HTTP → SQL réel). Jamais déployée.
//   deno run --allow-net --allow-env --allow-read rpc_bridge.ts   (variables : TEST_PG_PORT, BRIDGE_PORT)
// Routes de test : POST /__sql {text, params} (SQL en tant que service), POST /__sql_as {text, uid} (identité d'un opérateur), POST /__fault {mode: "fail" | "drop" | "absent", count, status} ("absent" : fonctions SQL introuvables, 404 PGRST202, comme une base sans la migration), POST /__cron {on}, POST /__stop.
import pg from "npm:pg@8.13.1";

const { Pool, types } = pg;
types.setTypeParser(1700, (v: string) => parseFloat(v));
types.setTypeParser(20, (v: string) => Number(v));
const port = Number(Deno.env.get("TEST_PG_PORT") ?? 5499);
const COMMERCIAL = "22222222-2222-2222-2222-222222222222", PRESIDENT = "11111111-1111-1111-1111-111111111111";
const TOKENS: Record<string, string> = { "tok-commercial": COMMERCIAL, "tok-direction": PRESIDENT };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-max-age": "600" };
const FULL_CHARTE = Object.fromEntries(["identite", "fonction", "departement", "mission_principale", "missions_secondaires", "competences", "outils", "donnees",
  "objectifs", "delais", "indicateurs", "procedures", "limites", "responsable", "reporting"].map((k) => [k, ["missions_secondaires", "competences", "outils", "donnees", "objectifs", "indicateurs", "procedures", "limites"].includes(k) ? ["x"] : "x"]));

const admin = new Pool({ host: "127.0.0.1", port, user: "postgres", database: "postgres", max: 1 });
const dbname = `vc_e2e_${Date.now()}`;
await admin.query(`create database ${dbname} template vc_tpl`);
const pool = new Pool({ host: "127.0.0.1", port, user: "postgres", database: dbname, max: 6 });
pool.on("connect", (c: { query: (q: string) => Promise<unknown> }) => { c.query("select set_config('request.jwt.claim.role','service_role',false)"); });

// Monde de test : président (direction), commercial, agents de l'équipe commerciale
await pool.query("insert into auth.users(id) values ($1), ($2) on conflict do nothing", [PRESIDENT, COMMERCIAL]);
await pool.query("insert into ai_operators(user_id, nom, role) values ($1, 'Président', 'direction'), ($2, 'Aïcha Commercial', 'commercial') on conflict do nothing", [PRESIDENT, COMMERCIAL]);
for (const [code, nom, dept] of [["ia_qualif_1", "IA Lead Qualifier", "commercial"], ["ia_rdv_1", "IA Appointment Manager", "commercial"], ["ia_nego_1", "IA Sales Negotiator", "commercial"],
  ["ia_mail_1", "IA Email Sales", "commercial"], ["ia_docs", "IA Gestionnaire de documents", "administratif"], ["ia_dir_admin", "IA Directeur Administratif", "administratif"],
  ["ia_success", "IA Customer Success", "relation_client"]]) {
  const m = (await pool.query("select id from ai_agents where code = 'sanix_ai_sales_director'")).rows[0]?.id;
  const id = (await pool.query("insert into ai_agents(code, nom, fonction, departement_id, niveau, manager_id, outils, effort) values ($1,$2,$2,$3,4,$4,'{}','low') returning id", [code, nom, dept, m])).rows[0].id;
  await pool.query("insert into ai_agent_charters(agent_id, version, contenu) values ($1, 1, $2::jsonb)", [id, JSON.stringify(FULL_CHARTE)]);
}
await pool.query("update ai_governance set max_taches_agent = 50, max_missions_actives = 200");

let cron = true, fault: { mode: string; count: number; status?: number } | null = null, calls = 0;
const timer = setInterval(() => { if (cron) pool.query("select crm_process_events(100)").catch(() => {}); }, 400);

async function rpc(fn: string, body: Record<string, unknown>, uid: string) {
  const keys = Object.keys(body), args = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)", [uid]);
    const r = await c.query(`select public.${fn.replace(/[^a-z_0-9]/g, "")}(${args}) as v`, keys.map((k) => typeof body[k] === "object" && body[k] !== null ? JSON.stringify(body[k]) : body[k]));
    await c.query("commit");
    return r.rows[0].v;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "content-type": "application/json" } });

const server = Deno.serve({ port: Number(Deno.env.get("BRIDGE_PORT") ?? 0), hostname: "127.0.0.1", onListen: ({ port: p }) => console.log(`READY ${p} ${dbname}`) }, async (req) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === "/__sql") { const b = await req.json(); try { const r = await pool.query(b.text, b.params ?? []); return json({ rows: r.rows }); } catch (e) { return json({ error: (e as Error).message }, 400); } }
  if (url.pathname === "/__sql_as") {                      // SQL avec l'identité d'un opérateur (garde-fous de la direction), rôle base inchangé
    const b = await req.json(), c = await pool.connect();
    try { await c.query("begin"); await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)", [b.uid]); const r = await c.query(b.text, b.params ?? []); await c.query("commit"); return json({ rows: r.rows }); }
    catch (e) { await c.query("rollback").catch(() => {}); return json({ error: (e as Error).message }, 400); } finally { c.release(); }
  }
  if (url.pathname === "/__fault") { fault = await req.json(); return json({ ok: true }); }
  if (url.pathname === "/__cron") { cron = !!(await req.json()).on; return json({ ok: true }); }
  if (url.pathname === "/__calls") return json({ calls });
  if (url.pathname === "/__stop") { clearInterval(timer); await pool.end(); await admin.query(`drop database if exists ${dbname}`); setTimeout(() => Deno.exit(0), 50); return json({ ok: true }); }
  const m = /^\/rest\/v1\/rpc\/([a-z_0-9]+)$/.exec(url.pathname);
  if (!m || req.method !== "POST") return json({ message: "Not found" }, 404);
  const uid = TOKENS[(req.headers.get("authorization") ?? "").replace(/^Bearer /, "")];
  if (!req.headers.get("apikey") || !uid) return json({ message: "JWT invalid", code: "PGRST301" }, 401);
  calls++;
  if (fault && fault.count > 0 && fault.mode === "absent") { fault.count--; return json({ code: "PGRST202", message: `Could not find the function public.${m[1]} in the schema cache` }, 404); }
  if (fault && fault.count > 0 && fault.mode === "fail") { fault.count--; return json({ message: "Service indisponible (panne simulée)" }, fault.status ?? 503); }
  const body = await req.json().catch(() => ({}));
  try {
    const v = await rpc(m[1], body, uid);
    if (fault && fault.count > 0 && fault.mode === "drop") { fault.count--; return new Response(new ReadableStream({ start(c) { c.error(new Error("connexion coupée (panne simulée)")); } }), { headers: CORS }); }   // exécuté, réponse perdue
    return json(v);
  } catch (e) {
    const err = e as { code?: string; message: string };
    return json({ code: err.code, message: err.message }, err.code === "42501" ? 403 : 400);
  }
});
await server.finished;
