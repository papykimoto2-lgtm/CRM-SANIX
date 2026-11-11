// SANIX CRM Pro — deux appareils avec le CRM complet (fiches de démonstration identiques) : la synchronisation converge et s'arrête (plus de boucle d'envoi).
// Régression : deux fiches locales portant le même identifiant stable (fusion serveur par clé naturelle) étaient renvoyées à chaque échange, sans fin.
// Prérequis : PostgreSQL de test (TEST_PG_PORT, base modèle vc_tpl : supabase/functions/tests/setup_db.sh) et Deno (variable DENO).
//   DENO=deno TEST_PG_PORT=5499 node tests/sync_two_devices_test.js
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const wait = async (fn, ms = 20000, what = "condition") => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`ÉCHEC : délai dépassé (${what})`); await new Promise((r) => setTimeout(r, 150)); } };
const ANON = "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ role: "anon" })).toString("base64") + ".sig";

function startBridge() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.DENO || "deno", ["run", "--no-check", "--allow-net", "--allow-env", "--allow-read", path.join(__dirname, "../supabase/functions/tests/rpc_bridge.ts")], { env: { ...process.env, TEST_PG_PORT: process.env.TEST_PG_PORT || "5499" } });
    let out = ""; const t = setTimeout(() => reject(new Error("passerelle : démarrage trop long : " + out)), 60000);
    p.stdout.on("data", (d) => { out += d; const m = /READY (\d+) (\S+)/.exec(out); if (m) { clearTimeout(t); resolve({ proc: p, port: Number(m[1]), db: m[2] }); } });
    p.stderr.on("data", (d) => { out += d; }); p.on("exit", (c) => { if (c) reject(new Error("passerelle arrêtée : " + out)); });
  });
}

(async () => {
  const server = await start(4293), bridge = await startBridge(), B = `http://127.0.0.1:${bridge.port}`, browser = await chromium.launch();
  const post = async (p, body) => { const r = await fetch(B + p, { method: "POST", body: JSON.stringify(body) }); const j = await r.json(); if (j.error) throw new Error(j.error); return j; };
  const sql = async (text, params = []) => (await post("/__sql", { text, params })).rows;
  const errors = [];
  try {
    const mkDevice = async () => {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
      await ctx.addInitScript(({ url, key }) => {
        class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } }, scale: {} }; window.Chart = Chart;
        if (!sessionStorage.getItem("__seeded")) { sessionStorage.setItem("__seeded", "1"); localStorage.setItem("sanix_crm_supabase_config", JSON.stringify({ url, key })); }   // pas de session opérateur tant que le CRM n'est pas réduit (voir ci-dessous)
      }, { url: B, key: ANON });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
      page.on("dialog", (d) => d.accept());
      await page.goto("http://localhost:4293/index.html"); await page.waitForTimeout(1000);
      await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); });
      await page.waitForFunction(() => window.SanixCrmSync && window.SanixCrmSync._ready(), null, { timeout: 15000 });
      await page.evaluate(() => { sessionStorage.setItem("sanix_ais_session", JSON.stringify({ t: "tok-direction", exp: Date.now() + 3600e3, email: "president@sanix.ci" })); });
      return page;
    };

    const stat = (p) => p.evaluate(() => { const s = window.SanixCrmSync.status(); const rids = {}; CLIENTS.forEach((c) => { rids[c._rid] = (rids[c._rid] || 0) + 1; }); return { mode: s.mode, pending: s.pending, init: s.init, lastErr: s.lastErr, clients: CLIENTS.length, ridsEnDouble: Object.values(rids).filter((n) => n > 1).length, pushed: s.counters.pushed }; });
    const calls = async () => (await post("/__calls", {})).calls;
    const settled = (p) => wait(async () => { const s = await stat(p); return s.init && s.pending === 0 && s.mode !== "sync"; }, 60000, "file d'envoi vide");
    const srvClients = async () => (await sql("select count(*)::int n from crm_records where entity = 'clients' and deleted_at is null"))[0].n;

    console.log("▶ Appareil A : import initial du CRM complet");
    const A = await mkDevice(); await A.evaluate(() => window.SanixCrmSync.syncNow()); await settled(A);
    const a0 = await stat(A);
    ok(a0.clients > 500 && a0.ridsEnDouble === 0, `A : ${a0.clients} clients envoyés, aucun identifiant en double`);

    console.log("▶ Appareil B : mêmes fiches de démonstration, identifiants différents");
    const B2 = await mkDevice(); await B2.evaluate(() => window.SanixCrmSync.syncNow()); await settled(B2);
    await B2.evaluate(() => window.SanixCrmSync.syncNow()); await settled(B2);                                           // l'échange suivant ramasse les copies jumelles reçues
    const b1 = await stat(B2);
    ok(b1.ridsEnDouble === 0, "B : aucune fiche locale ne partage un identifiant stable avec une autre");
    const n0 = await calls(), pushed0 = (await stat(B2)).pushed; await B2.waitForTimeout(7000);
    const b2 = await stat(B2);
    ok(b2.pending === 0 && b2.pushed === pushed0 && (await calls()) - n0 <= 2, "B : plus aucun envoi après la convergence (pas de boucle, aucune rafale d'appels)");
    await A.evaluate(() => window.SanixCrmSync.syncNow()); await settled(A);
    const a1 = await stat(A), srv = await srvClients();
    ok(a1.clients === b2.clients && b2.clients === srv, `A, B et la base centrale ont le même nombre de clients (${srv})`);
    ok(a1.ridsEnDouble === 0, "A : aucun identifiant en double après réception");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.slice(0, 3).join(" | ") : ""));
    console.log("\nSynchronisation à deux appareils : TOUT EST OK");
  } finally { await browser.close(); bridge.proc.kill(); server.close && server.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
