// CRM : tablette portrait = menu en barre d'icônes (contenu plus large), téléphone = menu tiroir, aucune page qui déborde. node tests/tablette_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4436), browser = await chromium.launch();
  try {
    for (const [w, h, label] of [[390, 844, "téléphone 390"], [820, 1180, "tablette portrait 820"], [1024, 768, "tablette paysage 1024"], [1440, 900, "ordinateur 1440"]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 1100, isMobile: w < 1100 });
      await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
      await require("./helpers/crm_fixture.js").installer(ctx);
      await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
      const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
      await page.goto("http://localhost:4436/index.html"); await page.waitForTimeout(800);
      await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
      console.log("▶ " + label);
      const r = await page.evaluate(() => { const sb = document.getElementById("sidebar").getBoundingClientRect(); return { left: sb.left, w: sb.width, sw: document.documentElement.scrollWidth, vw: innerWidth }; });
      if (w <= 768) ok(r.left + r.w <= 1, "téléphone : menu rangé hors écran (tiroir)");
      else if (w <= 900) ok(Math.round(r.w) === 68, `tablette portrait : menu réduit à ${Math.round(r.w)} px`);
      else if (w <= 1100) ok(Math.round(r.w) === 208, `tablette paysage : menu de ${Math.round(r.w)} px`);
      else ok(Math.round(r.w) === 240, "ordinateur : menu complet inchangé (240 px)");
      for (const v of ["dashboard", "clients", "pipeline"]) { await page.evaluate((v) => navigate(v, null), v); await page.waitForTimeout(350); ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), v + " : aucun défilement horizontal"); }
      if (w <= 900 && w > 768) { await page.evaluate(() => document.getElementById("sb-terrain-item").click()); await page.waitForTimeout(300); ok(await page.evaluate(() => !document.getElementById("view-terrain").classList.contains("hidden")), "barre d'icônes : « Prospection terrain » reste utilisable"); }
      ok(errors.length === 0, "aucune erreur JavaScript"); await ctx.close();
    }
  } finally { await browser.close(); server.close && server.close(); }
  console.log("\nTOUT EST OK");
})().catch((e) => { console.error(e.message); process.exit(1); });
