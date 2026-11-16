// SANIX CRM Pro : une note explicative sur chaque onglet. node notes_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4429), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://localhost:4429/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    console.log("▶ Couverture");
    const vues = await page.evaluate(() => [...document.querySelectorAll('[id^="view-"]')].map((v) => v.id.slice(5)));
    const sans = await page.evaluate((v) => v.filter((x) => x !== "strategie" && !NOTES_VUES[x]), vues);
    ok(sans.length === 0, "chaque onglet a sa note (" + vues.length + " vues) — manquantes : " + sans.join(","));
    ok(await page.evaluate(() => Object.keys(NOTES_VUES).filter((k) => NOTES_VUES[k]).every((k) => NOTES_VUES[k].quoi.length > 30 && NOTES_VUES[k].pts.length >= 1)), "chaque note a un texte et au moins un point");
    console.log("▶ Affichage dans chaque onglet");
    let n = 0, manquants = [];
    for (const v of vues) {
      if (v === "strategie") continue;
      await page.evaluate((x) => { try { navigate(x, null); } catch (e) {} }, v); await page.waitForTimeout(120);
      const r = await page.evaluate((x) => { const h = document.getElementById("note-explicative-host"); const d = h && h.querySelector("details.view-note"); return { ok: !!d && d.innerText.includes("Note explicative") && h.parentElement.id === "main-content", txt: d ? d.innerText.slice(0, 60) : "" }; }, v);
      if (!r.ok) manquants.push(v); else n++;
    }
    ok(manquants.length === 0, n + " onglets affichent leur note ; absents : " + manquants.join(","));
    await page.evaluate(() => navigate("commandes", null)); await page.waitForTimeout(200);
    ok((await page.locator("#note-explicative-host").innerText()).includes("Plusieurs paiements par commande"), "note Commandes : paiements multiples");
    await page.evaluate(() => navigate("financement", null)); await page.waitForTimeout(500);
    ok((await page.locator("#note-explicative-host").innerText()).includes("régime d'imposition"), "note Financement : régime d'imposition");
    console.log("▶ Replier / mémoriser");
    await page.evaluate(() => navigate("clients", null)); await page.waitForTimeout(200);
    await page.click("#note-explicative-host summary"); await page.waitForTimeout(100);
    ok(await page.evaluate(() => !document.querySelector("#note-explicative-host details").open && JSON.parse(localStorage.getItem("sanix_crm_notes_fermees")).includes("clients")), "note repliée et mémorisée");
    await page.evaluate(() => navigate("pipeline", null)); await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.querySelector("#note-explicative-host details").open), "les autres notes restent ouvertes");
    await page.evaluate(() => navigate("clients", null)); await page.waitForTimeout(200);
    ok(await page.evaluate(() => !document.querySelector("#note-explicative-host details").open), "la note repliée le reste au retour");
    await page.evaluate(() => navigate("strategie", null)); await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.getElementById("note-explicative-host").innerHTML === "" && !!document.getElementById("str-note")), "Stratégie : sa propre note, pas de doublon");
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    console.log("\nNotes explicatives : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
