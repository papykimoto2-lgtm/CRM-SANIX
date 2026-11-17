// SANIX CRM Pro : une fenêtre plus haute que l'écran défile (panneau « Missions des agents » impossible à parcourir avant). node modale_defilement_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4432), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 700 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://localhost:4432/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    console.log("▶ Panneau de synchronisation (missions des agents)");
    await page.evaluate(() => { SanixCrmSync.openPanel("missions"); const b = document.getElementById("crmsync-body"); b.insertAdjacentHTML("beforeend", Array.from({ length: 40 }, (_, i) => `<div class="card" style="padding:10px;margin:6px 0"><b>Mission ${i + 1}</b><div>Compte rendu long…</div></div>`).join("")); });
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => { const bx = document.querySelector("#modal-crmsync .modal-box"), cs = getComputedStyle(bx); return { oy: cs.overflowY, h: bx.clientHeight, sh: bx.scrollHeight, vh: window.innerHeight }; });
    ok(r.oy === "auto" && r.sh > r.h && r.h <= r.vh, "la fenêtre est plus haute que l'écran (" + r.sh + " px) mais limitée à " + r.h + " px et défile");
    await page.evaluate(() => { document.querySelector("#modal-crmsync .modal-box").scrollTop = 99999; });
    const bas = await page.evaluate(() => { const bx = document.querySelector("#modal-crmsync .modal-box"); const last = bx.querySelector(".card:last-child").getBoundingClientRect(); return { top: bx.scrollTop, visible: last.bottom <= window.innerHeight + 1 }; });
    ok(bas.top > 500 && bas.visible, "on atteint le bas de la liste (dernière mission visible)");
    console.log("▶ Autres fenêtres et touche Échap");
    ok(await page.evaluate(() => [...document.querySelectorAll(".modal-box")].every((b) => getComputedStyle(b).overflowY === "auto" || getComputedStyle(b).overflowY === "scroll")), "toutes les fenêtres du CRM défilent si elles dépassent l'écran");
    await page.keyboard.press("Escape"); await page.waitForTimeout(150);
    ok(await page.evaluate(() => document.getElementById("modal-crmsync").classList.contains("hidden")), "Échap ferme la fenêtre ouverte");
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    console.log("\nFenêtres défilantes : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
