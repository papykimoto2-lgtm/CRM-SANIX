// Premier contact : un garage (AutoGarage Pro) ne reçoit jamais le message d'AluExpert. node premier_contact_autogarage_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4450), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4450/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    console.log("▶ Premier contact partenaires");
    const r = await page.evaluate(() => ({
      sn: waAnalyse("+221 33 867 40 93"), bj: waAnalyse("+229 01 20 22 30 96"), ci: waAnalyse("07 79 18 10 75"), ci2: waAnalyse("+225 07 79 18 10 75"),
      lien: waLink("+229 01 20 22 30 96", "Bonjour"), vide: waAnalyse(""), mauvais: waAnalyse("12345"),
    }));
    ok(r.sn.ok && r.sn.num === "221338674093" && r.bj.ok && r.bj.num === "2290120223096", "les numéros +221 (Sénégal) et +229 (Bénin) sont acceptés pour WhatsApp");
    ok(r.ci.ok && r.ci.num === "2250779181075" && r.ci2.ok && r.ci2.num === "2250779181075", "les numéros ivoiriens fonctionnent comme avant");
    ok(r.lien === "https://wa.me/2290120223096?text=Bonjour", "le lien wa.me est correct pour un numéro étranger");
    ok(!r.vide.ok && !r.mauvais.ok, "numéro vide ou invalide : toujours refusé");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors[0] : ""));
    console.log("\nTOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });


