// SANIX CRM Pro : écran « Financement » dans le CRM (simulation en direct, onglets, exports). node financement_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };

(async () => {
  const server = await start(4219), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4219/index.html"); await page.waitForTimeout(1200);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(2000);

    console.log("▶ Navigation");
    await page.evaluate(() => navGroup("finance", null)); await page.waitForTimeout(300);
    ok(await page.locator("#view-finance, #view-comptabilite").first().count() > 0, "le groupe Finance s'ouvre");
    ok((await page.locator(".grp-tab", { hasText: "Financement" }).count()) === 1, "onglet « Financement » dans le groupe Finance");
    await page.locator(".grp-tab", { hasText: "Financement" }).click(); await page.waitForTimeout(500);
    ok(await page.locator("#view-financement").isVisible(), "l'écran Financement s'affiche");
    ok((await page.locator("#topbar-title").textContent()).includes("Financement"), "titre de la page");
    ok(await page.locator("#fin-body .ban h1").count() === 1, "bandeau d'en-tête");
    ok(await page.locator("#fin-body .stat-card").count() >= 4, "indicateurs clés affichés");
    ok(await page.locator("#fin-body svg polyline").count() === 3, "courbe de trésorerie à trois séries");
    ok(await page.locator("#fin-out table thead th").count() === 5, "tableau comparatif : quatre options");

    console.log("▶ Simulation en direct");
    const before = await page.locator("#fin-out .stat-card").first().innerText();
    const inp = page.locator('#fin-ctl [data-k="clientsAn1"]');
    await inp.focus(); await inp.fill("40"); await page.waitForTimeout(250);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.dataset.k === "clientsAn1"), "le champ garde le focus pendant la saisie");
    const after = await page.locator("#fin-out .stat-card").first().innerText();
    ok(before !== after, "les résultats se recalculent à la saisie");
    await page.selectOption("#fin-ctl [data-scen]", "ambitieux"); await page.waitForTimeout(250);
    ok((await page.locator('#fin-ctl [data-scen]').inputValue()) === "ambitieux", "changement de scénario");
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem("sanix_crm_fin_config")).croiss.join() === "100,80,60,40"), "scénario enregistré sur l'appareil");

    console.log("▶ Hypothèses, projections, dossier");
    await page.click('[data-tab="hyp"]'); await page.waitForTimeout(200);
    ok(await page.locator("#fin-body .alert-warn").count() === 1, "avertissement sur les valeurs indicatives");
    await page.click('[data-act="poste-add"]'); await page.waitForTimeout(200);
    const nPostes = await page.locator('[data-f="nom"]').count();
    ok(nPostes === 6, "ajout d'un poste (6 postes)");
    await page.locator('[data-p] [data-f]').first();
    await page.click('[data-act="poste-del"] >> nth=5'); await page.waitForTimeout(200);
    ok(await page.locator('[data-f="nom"]').count() === 5, "suppression d'un poste");
    await page.click('[data-tab="proj"]'); await page.waitForTimeout(200);
    ok(await page.locator("#fin-body table").count() === 2, "deux tableaux de projections");
    await page.click('[data-tab="dossier"]'); await page.waitForTimeout(200);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="csv"]')]);
    const txt = require("fs").readFileSync(await dl.path(), "utf8");
    ok(dl.suggestedFilename() === "modele_financement.csv" && txt.includes("Comparaison des options") && txt.includes("Detail mensuel"), "export CSV complet");
    ok(txt.split("\r\n").length > 100, "le CSV contient le détail mensuel (60 lignes)");
    const html = await page.evaluate(() => { let h = ""; const w = { document: { write: (x) => { h += x; }, close() {} }, focus() {}, print() {} }; const o = window.open; window.open = () => w; document.querySelector('[data-act="pdf"]').click(); window.open = o; return h; });
    ok(html.includes("Dossier de financement") && html.includes("Besoin de financement") && html.includes("Options de financement"), "dossier PDF généré");
    const noms = await page.evaluate(() => CLIENTS.map((c) => c.nom).filter(Boolean).slice(0, 20));
    ok(noms.length === 0 || noms.every((n) => !html.includes(n)), "aucun nom de client dans le dossier");

    console.log("▶ Droits d'accès");
    ok(await page.evaluate(() => PERMISSIONS.commercial.indexOf("financement") < 0 && PERMISSIONS.apporteur.indexOf("financement") < 0 && PERMISSIONS.manager.indexOf("financement") >= 0), "réservé à la direction (super admin, manager)");

    console.log("▶ Réinitialisation");
    await page.click('[data-tab="hyp"]'); await page.click('[data-act="reset"]'); await page.waitForTimeout(250);
    ok(await page.evaluate(() => localStorage.getItem("sanix_crm_fin_config") === "{}"), "retour aux valeurs initiales");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\nL'écran Financement est conforme.");
  } finally { await browser.close(); server.close && server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
