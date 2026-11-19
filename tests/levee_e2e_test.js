// SANIX CRM Pro : écran « Levée de fonds » dans le CRM (indicateurs, éligibilité, simulation, enregistrement). node levee_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };

(async () => {
  const server = await start(4231), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4231/index.html"); await page.waitForTimeout(1200);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(2000);

    console.log("▶ Navigation");
    await page.evaluate(() => navGroup("finance", null)); await page.waitForTimeout(300);
    ok((await page.locator(".grp-tab", { hasText: "Levée de fonds" }).count()) === 1, "onglet « Levée de fonds » dans le groupe Finance");
    await page.locator(".grp-tab", { hasText: "Levée de fonds" }).click(); await page.waitForTimeout(700);
    ok(await page.locator("#view-levee").isVisible(), "l'écran Levée de fonds s'affiche");
    ok((await page.locator("#topbar-title").textContent()).includes("Levée de fonds"), "titre de la page");

    console.log("▶ Synthèse");
    ok((await page.locator("#lev-body .card .badge").count()) === 5, "un verdict pour chacun des 5 types de financeurs");
    ok(await page.locator("#lev-body .stat-card").count() === 4, "4 indicateurs clés");
    ok((await page.locator("#lev-body").innerText()).includes("repères indicatifs"), "avertissement sur les seuils indicatifs");
    ok((await page.locator("#lev-body").innerText()).includes("Les 4 actions qui font le plus progresser"), "actions prioritaires proposées");

    console.log("▶ Indicateurs et notes explicatives");
    await page.locator('#lev-body .tab', { hasText: "Indicateurs" }).click(); await page.waitForTimeout(200);
    ok((await page.locator("#lev-body details").count()) === 22, "22 indicateurs, chacun avec sa note");
    await page.locator("#lev-body details summary").nth(5).click(); await page.waitForTimeout(100);
    const noteTxt = await page.locator("#lev-body details[open]").innerText();
    ok(noteTxt.includes("Ce que c'est") && noteTxt.includes("Pourquoi les financeurs") && noteTxt.includes("Comment il est calculé"), "la note explique : définition, intérêt, calcul");

    console.log("▶ Éligibilité");
    await page.locator('#lev-body .tab', { hasText: "Éligibilité" }).click(); await page.waitForTimeout(200);
    ok((await page.locator("#lev-body table").first().locator("tbody tr").count()) === 23, "matrice : 22 critères et la ligne de score");
    const scoreAvant = await page.locator("#lev-body table").first().locator("tbody tr").last().innerText();
    await page.locator('[data-man="deck"]').check(); await page.waitForTimeout(200);
    const scoreApres = await page.locator("#lev-body table").first().locator("tbody tr").last().innerText();
    ok(scoreAvant !== scoreApres, "cocher « pitch deck prêt » change les scores");
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem("sanix_crm_levee_config")).manuel.deck === true), "case enregistrée sur l'appareil");
    await page.locator("#lev-seuils summary").click();
    await page.locator('input[data-seuil="livre12.ok"]').fill("5000000"); await page.locator('input[data-seuil="livre12.ok"]').dispatchEvent("change"); await page.waitForTimeout(200);
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem("sanix_crm_levee_config")).seuils.livre12.ok === 5000000), "seuil modifié et enregistré");
    ok(await page.locator("#lev-seuils").evaluate((d) => d.open), "le bloc des seuils reste ouvert après modification");

    console.log("▶ Simulation");
    await page.locator('#lev-body .tab', { hasText: "Simulation" }).click(); await page.waitForTimeout(300);
    const part0 = await page.locator("#lev-montage .stat-card").nth(1).innerText();
    const champ = page.locator('#lev-ctl [data-sim="montant"]'); await champ.focus(); await champ.fill("60000000"); await page.waitForTimeout(250);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.dataset.sim === "montant"), "le champ garde le focus pendant la saisie");
    ok((await page.locator("#lev-montage .stat-card").nth(1).innerText()) !== part0, "la part cédée se recalcule à la saisie");
    const w0 = await page.locator("#lev-what-out table tbody").innerText();
    await page.locator('[data-what="livre12"]').fill("40000000"); await page.locator('[data-what="clients"]').fill("20"); await page.waitForTimeout(250);
    ok((await page.locator("#lev-what-out table tbody").innerText()) !== w0, "« Et si ? » : les scores se recalculent en direct");

    console.log("▶ Plan d'action, notes, fiche");
    await page.locator('#lev-body .tab', { hasText: "Plan d'action" }).click(); await page.waitForTimeout(200);
    ok((await page.locator("#lev-body table tbody tr").count()) > 3, "plan d'action listé");
    await page.locator('#lev-body .tab', { hasText: "Notes" }).click(); await page.waitForTimeout(200);
    ok((await page.locator("#lev-body dt").count()) >= 10, "glossaire affiché");
    const [popup] = await Promise.all([ctx.waitForEvent("page"), page.locator('[data-act="fiche"]').click()]); await popup.waitForLoadState();
    ok((await popup.locator("body").innerText()).includes("État de préparation à une levée de fonds"), "fiche d'éligibilité imprimable");
    await popup.close();

    console.log("▶ Persistance et sécurité");
    await page.evaluate(() => navigate("comptabilite", null)); await page.waitForTimeout(300);
    await page.evaluate(() => navigate("levee", null)); await page.waitForTimeout(500);
    await page.locator('#lev-body .tab', { hasText: "Simulation" }).click(); await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.querySelector('#lev-ctl [data-sim="montant"]').value) === "60000000", "le montant simulé est retrouvé à la réouverture");
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem("sanix_crm_levee_config")).sim.montant === 60000000), "la simulation est conservée");
    ok(!(await page.locator("#view-levee").innerHTML()).includes("<script"), "aucun script injecté");
    ok(errors.length === 0, "aucune erreur JavaScript (" + errors.join(" | ") + ")");
  } finally { await browser.close(); server.close(); }
  console.log("\nTOUT EST OK");
})().catch((e) => { console.error(e.message); process.exit(1); });
