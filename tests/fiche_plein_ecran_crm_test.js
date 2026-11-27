// SANIX CRM Pro : la fiche client / prospect s'affiche en plein écran (bouton ⛶, Échap, mémorisation). node tests/fiche_plein_ecran_crm_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4453), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4453/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => { CLIENTS.push({ id: 999002, nom: "VICTOIRE IMMOBILIER", statut: "prospect", phone: "+2252522016322", email: "", secteur: "Immobilier", logiciel: "ImmoSuite ERP", adresse: "Cocody, Angré", commercial: "", date: new Date().toISOString().slice(0, 10), interactions: [], tags: [], notes: "" }); });
    const w = () => page.evaluate(() => Math.round(document.querySelector("#modal-client-detail .smart-panel").getBoundingClientRect().width));
    const ouvrir = async () => { await page.evaluate(() => { document.querySelectorAll(".modal-overlay").forEach((m) => m.classList.add("hidden")); showClientDetail(999002); }); await page.waitForTimeout(400); };
    console.log("▶ Fiche client en plein écran");
    await ouvrir(); const w0 = await w();
    ok(w0 < 1100, `ouverte par défaut en panneau latéral (${w0} px)`);
    ok(await page.locator("#modal-client-detail .sp-expand").isVisible(), "bouton ⛶ visible");
    await page.click("#modal-client-detail .sp-expand"); await page.waitForTimeout(200);
    const w1 = await w(); ok(w1 >= 1360, `plein écran : panneau sur toute la largeur (${w0} → ${w1} px)`);
    ok((await page.locator("#modal-client-detail .sp-expand").textContent()) === "⤡", "le bouton devient ⤡ (quitter)");
    ok(await page.locator("#sp-actions").isVisible() && await page.locator("#modal-client-detail .sp-close:not(.sp-expand)").isVisible(), "actions du bas et bouton de fermeture toujours visibles");
    await page.screenshot({ path: (process.env.SHOT_DIR || "/tmp") + "/crm_fiche_plein_ecran.png" });
    await ouvrir(); ok((await w()) >= 1360, "mémorisé : la fiche suivante s'ouvre aussi en plein écran");
    await page.keyboard.press("Escape"); await page.waitForTimeout(150);
    ok((await w()) < 1100 && !(await page.evaluate(() => document.getElementById("modal-client-detail").classList.contains("hidden"))), "Échap : sortie du plein écran, la fiche reste ouverte");
    await page.click("#modal-client-detail .sp-expand"); await page.click("#modal-client-detail .sp-expand"); await page.waitForTimeout(100);
    ok((await w()) < 1100, "le bouton bascule");
    await page.evaluate(() => spToggleFull("modal-dossier", true));
    ok(await page.evaluate(() => document.getElementById("modal-dossier").classList.contains("sp-full")), "la fiche dossier se comporte de même");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\\nTous les contrôles passent.");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
