// SANIX CRM Pro — Dépenses de l'API d'IA dans la comptabilité : le VRAI CRM dans Chromium, serveur simulé (consommation et recharges), taux USD/FCFA du module Budget.
//   node tests/compta_ia_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };

(async () => {
  const server = await start(4294), browser = await chromium.launch(), errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } }, scale: {} }; window.Chart = Chart; });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4294/index.html"); await page.waitForTimeout(1000);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); });
    await page.waitForTimeout(1500);
    // serveur simulé : consommation de deux mois et une recharge
    await page.evaluate(() => {
      window.SanixCrmSync = { available: () => true, rpcAux: async (n) => { if (n !== "ai_credit_compta") throw new Error("inattendu " + n);
        return { recharges: [{ id: 7, date: "2026-11-05", montant_usd: 10, note: "Console" }], conso_mois: [{ mois: "2026-10", cout_usd: 4.5 }, { mois: "2026-11", cout_usd: 3.9 }] }; } };
    });
    const ia = () => page.evaluate(() => comptaGenerateAuto().filter((e) => /^auto_ia/.test(e.id)));

    console.log("▶ Sans taux USD/FCFA : rien n'est inventé");
    await page.evaluate(() => { window.SanixPilotage.store.setConfig({}); return comptaLoadIA(); });
    ok((await ia()).length === 0, "aucune écriture sans taux");
    await page.evaluate(() => { showView && 0; initComptabilite(); }).catch(() => {}); await page.waitForTimeout(500);
    const note = await page.evaluate(() => document.getElementById("compta-ia-note").textContent);
    ok(/taux USD/.test(note), "l'écran demande de renseigner le taux : « " + note + " »");

    console.log("▶ Avec un taux de 600 FCFA pour 1 $");
    await page.evaluate(() => { window.SanixPilotage.store.setConfig({ usd_fcfa: 600 }); return comptaLoadIA(); });
    const e = await ia();
    ok(e.length === 3, "trois écritures : deux mois de consommation et une recharge (obtenu " + e.length + " : " + e.map((x) => x.id).join(",") + ")");
    const oct = e.find((x) => x.id === "auto_ia_2026-10"), nov = e.find((x) => x.id === "auto_ia_2026-11"), rec = e.find((x) => x.id === "auto_iarech_7");
    ok(oct.date === "2026-10-31" && oct.journal === "AC", "consommation d'octobre datée du dernier jour du mois, journal des achats");
    ok(oct.lignes[0].compte === "634000" && oct.lignes[0].debit === 2700 && oct.lignes[1].compte === "401000" && oct.lignes[1].credit === 2700, "4,50 $ × 600 = 2 700 FCFA : charge 634000 au débit, fournisseur 401000 au crédit");
    ok(nov.date <= new Date().toISOString().split("T")[0], "le mois en cours est daté d'aujourd'hui au plus tard (jamais dans le futur)");
    ok(rec.journal === "BQ" && rec.lignes[0].compte === "401000" && rec.lignes[0].debit === 6000 && rec.lignes[1].compte === "521000" && rec.lignes[1].credit === 6000, "recharge de 10 $ = 6 000 FCFA : fournisseur 401000 au débit, banque 521000 au crédit");
    ok(e.every((x) => x.lignes.reduce((s, l) => s + l.debit, 0) === x.lignes.reduce((s, l) => s + l.credit, 0)), "chaque écriture est équilibrée");
    ok((await page.evaluate(() => comptaCompteLib("634000"))).includes("API"), "le compte 634000 a un libellé dans le plan comptable");
    ok((await page.evaluate(() => comptaAllEcritures().filter((x) => /^auto_ia/.test(x.id)).length)) === 3, "les écritures figurent dans le journal général");
    ok((await page.evaluate(() => document.getElementById("compta-ia-note").textContent)).includes("600 FCFA"), "l'écran indique le taux utilisé");

    console.log("▶ Serveur sans la fonction");
    await page.evaluate(() => { window.SanixCrmSync = { available: () => true, rpcAux: async () => { const e = new Error("x"); e.code = "NOFUNC"; throw e; } }; AI_COMPTA = { recharges: [], conso: [], loaded: false, err: "" }; return comptaLoadIA(); });
    ok((await ia()).length === 0, "aucune écriture, aucune erreur");
    ok(errors.length === 0, "aucune erreur JavaScript (" + errors.join(" | ") + ")");
    console.log("\nComptabilité IA : TOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
