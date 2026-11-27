// SANIX CRM Pro : raccourci « ⚖️ Gouvernance » dans la vue Directeur commercial IA (ouvre la plateforme sur l'onglet Gouvernance). node tests/raccourci_gouvernance_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4458), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4458/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => navigate("aisales", null)); await page.waitForTimeout(500);
    console.log("▶ Raccourci Gouvernance");
    ok(await page.locator("#ais-gov-link").isVisible(), "bouton « ⚖️ Gouvernance » visible dans la vue Directeur commercial IA");
    ok((await page.getAttribute("#ais-gov-link", "href")) === "company/#gov" && (await page.getAttribute("#ais-gov-link", "target")) === "_blank" && /noopener/.test(await page.getAttribute("#ais-gov-link", "rel")), "ouvre company/#gov dans un nouvel onglet (noopener)");
    const [popup] = await Promise.all([ctx.waitForEvent("page"), page.click("#ais-gov-link")]);
    await popup.waitForLoadState("domcontentloaded");
    ok(/\/company\/#gov$/.test(popup.url()), "le nouvel onglet charge la plateforme sur #gov (" + popup.url().replace(/^.*:\d+/, "") + ")");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\nTous les contrôles passent.");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
