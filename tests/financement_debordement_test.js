// SANIX CRM Pro : aucun onglet du module Financement ne déborde de l'écran d'un téléphone (420 px). node financement_debordement_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4441), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://localhost:4441/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => navigate("financement", null)); await page.waitForTimeout(1500);
    for (const t of ["synthese", "traction", "hyp", "proj", "indic", "opti", "notes", "dossier"]) {
      await page.evaluate((t) => document.querySelector('#fin-body [data-tab="' + t + '"]').click(), t); await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const vw = innerWidth;
        const bad = [...document.querySelectorAll("#fin-body *")].filter((e) => {
          if (e.getBoundingClientRect().right <= vw + 1) return false;
          for (let p = e.parentElement; p && p.id !== "fin-body"; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") return false; }
          return true;
        }).slice(0, 3).map((e) => e.tagName + "." + e.className);
        return { sw: document.documentElement.scrollWidth, vw, bad, x: window.scrollX };
      });
      ok(r.sw <= r.vw && r.bad.length === 0 && r.x === 0, "onglet « " + t + " » : rien ne dépasse de l'écran " + (r.bad.join(",") || ""));
    }
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    console.log("\nFinancement sans débordement : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
