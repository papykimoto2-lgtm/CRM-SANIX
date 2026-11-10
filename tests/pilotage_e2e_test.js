// SANIX CRM Pro — Budget & plan d'actions de bout en bout : le VRAI CRM dans Chromium (deux appareils), relié par HTTP à une passerelle PostgREST de test
// devant un VRAI PostgreSQL (migrations réelles dont 20261112) : synchronisation multi-appareils, coûts IA, propositions des agents, serveur sans la migration.
// Prérequis : PostgreSQL de test (TEST_PG_PORT, base modèle vc_tpl : supabase/functions/tests/setup_db.sh) et Deno (variable DENO).
//   DENO=deno TEST_PG_PORT=5499 node tests/pilotage_e2e_test.js
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
  const server = await start(4291), bridge = await startBridge(), B = `http://127.0.0.1:${bridge.port}`, browser = await chromium.launch();
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
      await page.goto("http://localhost:4291/index.html"); await page.waitForTimeout(1000);
      await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); });
      await page.waitForFunction(() => window.SanixCrmSync && window.SanixCrmSync._ready(), null, { timeout: 15000 });
      // CRM minimal (un client, aucune affaire ni commande) : le test porte sur le pilotage, pas sur l'import de centaines de fiches de démonstration
      await page.evaluate(() => {
        const now = new Date().toISOString();
        CLIENTS.length = 0; CLIENTS.push({ id: 1, nom: "Alpha Immobilier", phone: "+225 07 01 02 03 04", email: "", secteur: "Immobilier", logiciel: "", statut: "client", commercial: "Aïcha", valeur: 1000000, adresse: "Cocody", notes: "", interactions: [], created_at: now, updated_at: now });
        DEALS.length = 0; COMMANDES.length = 0; ["clients", "deals", "commandes"].forEach((k) => saveStore(k));
        sessionStorage.setItem("sanix_ais_session", JSON.stringify({ t: "tok-direction", exp: Date.now() + 3600e3, email: "president@sanix.ci" }));   // session opérateur (jeton de test)
      });
      return page;
    };
    const st = (p) => p.evaluate(() => { const s = window.SanixCrmSync.status(); return { mode: s.mode, pending: s.pending, init: s.init }; });
    const sync = async (p) => { await p.evaluate(() => window.SanixCrmSync.syncNow()); let last; await wait(async () => { last = await p.evaluate(() => { const s = window.SanixCrmSync.status(); return { mode: s.mode, pending: s.pending, init: s.init, lastErr: s.lastErr, ob: Object.values(window.SanixCrmSync._outbox()).slice(0, 2).map((o) => o.entity + " " + o.attempts + " " + o.last_error), rej: window.SanixCrmSync.status().counters }; }); return last.pending === 0 && last.mode !== "sync" && last.init; }, 40000, "file d'envoi vide " + JSON.stringify(last)).catch((e) => { throw new Error(e.message + " " + JSON.stringify(last)); }); };
    const budget = async (p, tab) => { await p.evaluate(() => navigate("budget")); await p.waitForTimeout(500); if (tab) await p.click(`[data-tab="${tab}"]`); await p.waitForTimeout(250); };
    const fillc = async (p, sel, v) => { await p.fill(sel, v); await p.dispatchEvent(sel, "change"); await p.waitForTimeout(200); };
    const text = async (p) => (await p.locator("#view-budget").innerText()).replace(/[\u202f\u00a0]/g, " ");
    const Y = new Date().getFullYear(), M3 = `${Y}-03`, M4 = `${Y}-04`;

    console.log("▶ Appareil A : saisie du budget et du plan d'actions, envoi au serveur");
    const A = await mkDevice(); await sync(A);
    ok(await A.evaluate(() => window.SanixCrmSync.available()), "connecteur actif (session opérateur, migration installée)");
    await budget(A);
    await fillc(A, `[data-obj="${M3}"]`, "3000000");
    await A.fill('form[data-form="dep"] [name=libelle]', "Billets Abidjan–Bouaké"); await A.fill('form[data-form="dep"] [name=prevu]', "120000"); await A.click('form[data-form="dep"] button'); await A.waitForTimeout(200);
    await A.click('[data-tab="actions"]');
    await A.fill('form[data-form="act"] [name=titre]', "Relancer 20 prospects Santé"); await A.fill('form[data-form="act"] [name=objectifCA]', "4000000"); await A.click('form[data-form="act"] button'); await A.waitForTimeout(300);
    await sync(A);
    const recs = await sql("select entity, rid, data from crm_records where entity like 'pil_%' and deleted_at is null order by entity");
    ok(recs.filter((r) => r.entity === "pil_depenses").length === 1 && recs.find((r) => r.entity === "pil_depenses").data.libelle === "Billets Abidjan–Bouaké", "dépense enregistrée sur le serveur (entité pil_depenses)");
    ok(recs.find((r) => r.entity === "pil_actions").data.titre === "Relancer 20 prospects Santé" && recs.find((r) => r.entity === "pil_actions").data.objectifCA === 4000000, "action enregistrée sur le serveur (entité pil_actions)");
    ok(recs.find((r) => r.entity === "pil_config").data["obj_" + M3] === 3000000, "objectif mensuel enregistré sur le serveur (entité pil_config, clé à plat)");

    console.log("▶ Appareil B : réception, puis modifications simultanées sans écrasement");
    const Bp = await mkDevice(); await sync(Bp); await sync(Bp);
    await budget(Bp, "actions");
    ok((await text(Bp)).includes("Relancer 20 prospects Santé"), "l'action saisie sur A apparaît sur B");
    await Bp.click('[data-tab="budget"]'); await Bp.waitForTimeout(250);
    ok((await text(Bp)).includes("Billets Abidjan–Bouaké") && await Bp.inputValue(`[data-obj="${M3}"]`) === "3000000", "la dépense et l'objectif de mars apparaissent sur B");
    await budget(A, "budget"); await fillc(A, `[data-obj="${Y}-05"]`, "1111111");              // A et B saisissent chacun un objectif différent avant de se synchroniser
    await fillc(Bp, `[data-obj="${M4}"]`, "2222222");
    await sync(A); await sync(Bp); await sync(A);
    const cfg = (await sql("select data from crm_records where entity = 'pil_config'"))[0].data;
    ok(cfg["obj_" + Y + "-05"] === 1111111 && cfg["obj_" + M4] === 2222222 && cfg["obj_" + M3] === 3000000, "deux objectifs saisis en même temps sur deux appareils : tous conservés (fusion champ par champ)");
    await budget(A, "budget"); await budget(Bp, "budget");
    ok(await A.inputValue(`[data-obj="${M4}"]`) === "2222222" && await Bp.inputValue(`[data-obj="${Y}-05"]`) === "1111111", "chaque appareil reçoit la saisie de l'autre");
    await fillc(A, `[data-obj="${M3}"]`, ""); await sync(A); await sync(Bp);
    await budget(Bp, "budget");
    ok(await Bp.inputValue(`[data-obj="${M3}"]`) === "", "objectif effacé sur A : effacé aussi sur B");
    await A.click('[data-tab="actions"]'); await A.click('[data-act="act-del"]'); await A.waitForTimeout(200); await sync(A); await sync(Bp);
    await budget(Bp, "actions");
    ok(!(await text(Bp)).includes("Relancer 20 prospects Santé") && (await sql("select count(*) n from crm_records where entity = 'pil_actions' and deleted_at is null"))[0].n === 0, "action supprimée sur A : supprimée sur B et sur le serveur");

    console.log("▶ Coûts IA (serveur → écran)");
    await sql("insert into ai_actions(agent, action, agent_id, cout_usd, at) select 'x', 'llm_turn', id, 3.25, now() from ai_agents where code = 'sanix_ai_sales_director'");
    await sql("insert into ai_actions(agent, action, agent_id, cout_usd, at) select 'x', 'llm_turn', id, 1.5, now() - interval '35 days' from ai_agents where code = 'sanix_ai_sales_director'");
    await budget(A, "budget");
    await wait(async () => (await text(A)).includes("Coûts IA") && (await text(A)).includes("3,25"), 10000, "coûts IA affichés");
    ok((await text(A)).includes("Plafond mensuel : $400,00"), "coût du jour et du mois, plafond de gouvernance");
    ok(!(await text(A)).includes("≈"), "sans taux de change : pas de conversion inventée");
    await fillc(A, "[data-usd]", "600");
    ok((await text(A)).includes("≈ 1 950 FCFA"), "avec le taux saisi : équivalent en FCFA (3,25 $ × 600)");
    await A.click('[data-tab="previ"]'); await A.waitForTimeout(250);
    ok((await text(A)).includes("dont IA"), "le prévisionnel inclut les coûts IA mensuels dans les dépenses");

    console.log("▶ Propositions des agents : acceptation humaine");
    const prop = (await sql("select ai_propose_commercial_action((select id from ai_agents where code = 'sanix_ai_sales_director'), 'Campagne WhatsApp Distribution', 'Réponse 31 % sur ce segment <b>x</b>', 'Awa', (current_date + 10)::date, 2500000, 'Distribution') r"))[0].r;
    await sql("select ai_propose_commercial_action(null, 'Webinaire Immobilier à refuser')");
    await budget(A, "actions"); await A.click('[data-act="rem-refresh"]'); await wait(async () => (await text(A)).includes("Campagne WhatsApp Distribution"), 10000, "proposition affichée");
    ok((await text(A)).includes("Propositions des agents IA (2)") && !(await A.locator("#view-budget b", { hasText: "x" }).count()) , "2 propositions en attente, texte de l'agent échappé");
    ok((await sql("select count(*) n from crm_records where entity = 'pil_actions' and deleted_at is null"))[0].n === 0, "rien n'entre dans le plan avant la décision humaine");
    await A.click(`[data-act="prop-ok"][data-id="${prop.id}"]`); await A.waitForTimeout(500);
    ok((await text(A)).includes("🤖 IA") && (await text(A)).includes("Campagne WhatsApp Distribution") && (await text(A)).includes("Propositions des agents IA (1)"), "proposition acceptée : action ajoutée au plan, marquée IA");
    ok((await sql("select statut from pilotage_proposals where id = $1", [prop.id]))[0].statut === "acceptee", "décision enregistrée côté serveur");
    await A.click('[data-act="prop-no"]'); await A.waitForTimeout(500);
    ok((await sql("select count(*) n from pilotage_proposals where statut = 'refusee'"))[0].n === 1 && (await text(A)).includes("Propositions des agents IA (0)"), "proposition refusée : archivée, jamais ajoutée au plan");
    await sync(A); await sync(Bp); await budget(Bp, "actions");
    ok((await text(Bp)).includes("Campagne WhatsApp Distribution") && !(await text(Bp)).includes("Webinaire"), "l'action acceptée se synchronise sur l'autre appareil, la refusée n'existe nulle part");

    console.log("▶ Serveur sans la migration du pilotage : aucune erreur de synchronisation, CRM intact");
    await sql("delete from crm_records where entity like 'pil_%'");
    await sql("alter table crm_records drop constraint crm_records_entity_check");
    await sql("alter table crm_records add constraint crm_records_entity_check check (entity in ('clients','deals','commandes','contrats','licences','documents','presentations','rdv','deployments','apporteurs','ecritures','logiciels','config'))");
    await budget(A, "actions");
    await A.fill('form[data-form="act"] [name=titre]', "Action pendant la panne de migration"); await A.click('form[data-form="act"] button'); await A.waitForTimeout(400);
    await A.evaluate(() => window.SanixCrmSync.syncNow()); await A.waitForTimeout(2500);
    const s2 = await A.evaluate(() => ({ noPil: !!window.SanixCrmSync._state().noPil, mode: window.SanixCrmSync.status().mode, lastErr: window.SanixCrmSync.status().lastErr, pil: Object.keys(window.SanixCrmSync._outbox()).filter((k) => k.startsWith("pil_")).length }));
    ok(s2.noPil && s2.pil === 0 && s2.mode === "ok" && !s2.lastErr, `entités du pilotage mises en veille (${JSON.stringify(s2)}) : aucune erreur affichée, rien de bloqué`);
    ok((await text(A)).includes("Action pendant la panne de migration"), "l'action reste enregistrée localement");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\nTous les contrôles de bout en bout du Budget sont passés.");
  } finally { await browser.close(); server.close && server.close(); bridge.proc.kill(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
