// SANIX CRM Pro : le dossier de financement est lisible à l'écran avant tout export. node dossier_apercu_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4442), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://localhost:4442/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => navigate("financement", null)); await page.waitForTimeout(1500);
    await page.evaluate(() => document.querySelector('#fin-body [data-tab="dossier"]').click()); await page.waitForTimeout(600);

    console.log("▶ Aperçu à l'écran");
    const ap = await page.evaluate(() => { const f = document.getElementById("fin-apercu-f"); const d = f && f.contentDocument; return d ? { txt: d.body.innerText.replace(/\s+/g, " "), h: f.getBoundingClientRect().height, dh: d.documentElement.scrollHeight, h2: [...d.querySelectorAll("h2")].map((x) => x.textContent) } : null; });
    ok(ap && ap.h2.length >= 9, "l'aperçu affiche les 9 chapitres du dossier (" + (ap && ap.h2.length) + ")");
    ok(ap.txt.includes("Besoin de financement") && ap.txt.includes("Options de financement") && ap.txt.includes("Tour de table"), "besoin, options et tour de table lisibles à l'écran");
    ok(ap.txt.includes("DOCUMENT DE TRAVAIL"), "la mention « document de travail » figure aussi dans l'aperçu");
    ok(ap.h >= ap.dh - 10, "l'aperçu s'étire à la hauteur du dossier (pas de défilement dans le cadre) : " + Math.round(ap.h) + " px");
    ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 420, "la page ne déborde pas de l'écran");

    console.log("▶ Mise à jour automatique");
    await page.evaluate(() => document.querySelector('#fin-body [data-tab="hyp"]').click()); await page.waitForTimeout(300);
    await page.click('[data-sub="ventes"]'); await page.fill('#fin-body [data-k="clientsAn1"]', "37"); await page.keyboard.press("Tab"); await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('#fin-body [data-tab="dossier"]').click()); await page.waitForTimeout(600);
    const apres = await page.evaluate(() => { const f = document.getElementById("fin-apercu-f"); return f.contentDocument.body.innerText.replace(/\s+/g, " "); });
    ok(apres !== ap.txt, "après une modification des hypothèses, l'aperçu change");

    console.log("▶ Export inchangé");
    ok(await page.evaluate(() => !!document.querySelector('#fin-body [data-act="pdf"]') && !!document.querySelector('#fin-body [data-act="csv"]')), "boutons PDF et CSV toujours présents");
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    await page.evaluate(() => document.getElementById("fin-apercu").scrollIntoView()); await page.waitForTimeout(300);
    await page.screenshot({ path: "/tmp/claude-0/-home-user-CRM-SANIX/fda489a8-65a8-578c-bff6-b00bf4b09a64/scratchpad/apercu.png" });
    console.log("\nAperçu du dossier : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
