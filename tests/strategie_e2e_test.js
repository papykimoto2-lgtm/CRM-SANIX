// SANIX CRM Pro : écran « Stratégie par logiciel » dans le CRM. node strategie_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4427), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://localhost:4427/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.waitForFunction(() => CLIENTS.filter((c) => c.statut === "prospect").length >= 500, null, { timeout: 15000 });
    // Données fictives : 2 ventes ImmoSuite (3 M + 4 M HT) pour 10 fiches, 1 vente AluExpert (400 k) pour 20 fiches
    await page.evaluate(() => {
      COMMANDES.length = 0; DEALS.length = 0;
      const cm = (id, client, logiciel, ht) => COMMANDES.push({ id, ref: "CMD-X-" + id, client, date: new Date().toISOString().slice(0, 10), logiciel, htNet: ht, htBrut: ht, tva: 0, ttc: ht, acompte: 0, solde: ht, statut: "en_cours", sansTva: true });
      cm("1", "Client A", "ImmoSuite ERP", 3e6); cm("2", "Client B", "ImmoSuite ERP", 4e6); cm("3", "Client C", "Sanix AluExpert ERP", 4e5);
      let id = 1; const d = (client, logiciel, stage, history) => DEALS.push({ id: id++, client, logiciel, stage, valeur: 0, history: history || [] });
      for (let i = 0; i < 10; i++) d("I" + i, "ImmoSuite ERP", i < 2 ? "gagne" : "prospect", i === 5 ? [{ date: new Date().toISOString(), type: "stage_change", note: "Prospect → Contact" }, { date: new Date().toISOString(), type: "stage_change", note: "Démo réalisée" }] : []);
      for (let i = 0; i < 20; i++) d("L" + i, "Sanix AluExpert ERP", i < 1 ? "gagne" : "prospect");
    });
    console.log("▶ Navigation");
    await page.evaluate(() => navigate("strategie", null)); await page.waitForTimeout(500);
    ok(await page.evaluate(() => !document.getElementById("view-strategie").classList.contains("hidden")), "écran affiché");
    ok(await page.evaluate(() => document.querySelector("#view-strategie") && [...document.querySelectorAll(".grp-tab")].some((t) => t.textContent.includes("Stratégie par logiciel"))), "onglet « Stratégie par logiciel » dans Ventes");
    console.log("▶ Rendement par logiciel");
    const txt = (sel) => page.evaluate((s) => document.querySelector(s).innerText.replace(/[  ]/g, " ").replace(/\s+/g, " "), sel);
    const T = await txt("#str-rendement");
    ok(T.indexOf("ImmoSuite ERP") < T.indexOf("Sanix AluExpert ERP"), "classement : ImmoSuite avant AluExpert (CA par fiche décroissant)");
    ok(/ImmoSuite ERP \(indicatif\)/.test(T) && T.includes("7 000 000") && T.includes("700 000") && (T.includes("20.0 %") || T.includes("20,0 %")), "ImmoSuite : 7 000 000 HT, 700 000 par fiche, conversion 20 %");
    ok(T.includes("20 000"), "AluExpert : 400 000 / 20 fiches = 20 000 par fiche");
    ok(T.includes("4 000 000"), "prix catalogue ImmoSuite 4 000 000 (licence définitive)");
    const K = await txt("#str-kpis"), A = await txt("#str-alertes");
    ok(K.includes("7,4 M"), "CA HT total affiché (3 ventes : 7,4 M)");
    ok(A.includes("Le premier client pèse") && A.includes("Seulement 3 ventes"), "alertes : concentration et échantillon faible");
    console.log("▶ Semaine et objectifs");
    const H = await txt("#str-hebdo");
    ok(H.includes("ImmoSuite ERP") && H.includes("Angel's Livraison") && H.includes("MediCore Suite") && H.includes("réalisé / objectif"), "semaine : toutes les familles suivies, format réalisé / objectif");
    const reel = await page.evaluate(() => { const r = SanixStrategie.semaine(COMMANDES, DEALS, _strOpts()).lignes.find((x) => x.famille === "ImmoSuite ERP"); return { c: r.contacts, d: r.demos, v: r.ventes }; });
    ok(reel.c === 1 && reel.d === 1 && reel.v === 2, "activité de la semaine lue dans l'historique et les commandes (1 contact, 1 démo, 2 ventes)");
    await page.evaluate(() => strSet("ImmoSuite ERP", "contacts", 20)); await page.waitForTimeout(150);
    ok(await page.evaluate(() => CONFIG.strategie["ImmoSuite ERP"].contacts === 20 && JSON.parse(localStorage.getItem("sanix_crm_config")).strategie["ImmoSuite ERP"].contacts === 20), "objectif modifié et enregistré dans les réglages du CRM");
    await page.evaluate(() => strSet("ImmoSuite ERP", "part", 70)); await page.waitForTimeout(150);
    ok((await txt("#str-alertes")).includes("120 %"), "parts de temps ≠ 100 % : alerte (120 %)");
    await page.evaluate(() => strSet("Sanix AluExpert ERP", "part", 0)); await page.evaluate(() => strSet("MediCore Suite", "part", 0)); await page.evaluate(() => strSet("Angel's Livraison", "part", 30)); await page.waitForTimeout(150);
    ok(!(await txt("#str-alertes")).includes("devraient totaliser"), "parts à 100 % : plus d'alerte");
    ok(await page.evaluate(() => { const d = document.getElementById("str-note"); return d && d.open && d.innerText.includes("CA par fiche") && d.innerText.includes("Part du temps") && d.innerText.includes("(indicatif)") && d.innerText.includes("Cette semaine"); }), "note explicative affichée (CA par fiche, parts de temps, indicatif, semaine)");
    console.log("▶ Rechargement");
    await page.reload(); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    ok(await page.evaluate(() => CONFIG.strategie && CONFIG.strategie["ImmoSuite ERP"].contacts === 20 && CONFIG.strategie["ImmoSuite ERP"].part === 70), "objectifs conservés après rechargement");
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    console.log("\nStratégie par logiciel : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
