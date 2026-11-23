// Premier contact : un garage (AutoGarage Pro) ne reçoit jamais le message d'AluExpert. node premier_contact_autogarage_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4457), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4457/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    console.log("▶ Premier contact partenaires");
    const r = await page.evaluate(() => { const p = document.getElementById("sync-pill"), cs = getComputedStyle(p), b = p.getBoundingClientRect();
      return { display: cs.display, position: cs.position, left: Math.round(b.left), bas: Math.round(innerHeight - b.bottom), visible: b.width > 20 && b.height > 10 && b.left >= 0 && b.bottom <= innerHeight, largeur: innerWidth }; });
    ok(r.largeur <= 768 && r.display !== "none" && r.position === "fixed" && r.visible, "téléphone : la pastille de synchronisation est visible, en bas à gauche (" + JSON.stringify(r) + ")");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors[0] : ""));
    console.log("\nTOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });


