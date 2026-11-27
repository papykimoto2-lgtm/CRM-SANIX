// SANIX CRM Pro : indicateur de couverture des coordonnées et lancement d'un lot d'enrichissement (page Clients & Prospects). node tests/couverture_contacts_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4459), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => {
      class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart;
      window.__calls = []; window.__lot = true; window.__refus = false;
      const realFetch = window.fetch.bind(window);
      const J = (b, st = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: st, headers: { "Content-Type": "application/json" } }));
      window.fetch = (url, opt) => {
        const u = String(url);
        if (u.includes("/rest/v1/rpc/ai_contacts_couverture")) return J({ total: 979, sans_aucun_contact: 154, sans_telephone: 165, sans_email: 834, email_invalide: 57, enrichis_7j: 3, recherches_vaines_7j: 2 });
        if (u.includes("/rest/v1/rpc/ai_enrichissement_demander")) { window.__calls.push("demander"); if (window.__refus) return J({ message: "Réservé à la direction", code: "42501" }, 403); return J({ lot_cree: window.__lot, task_id: "t1" }); }
        if (u.includes("/rest/v1/")) return J([]);
        return realFetch(url, opt);
      };
      sessionStorage.setItem("sanix_ais_session", JSON.stringify({ t: "tok", exp: Date.now() + 3600e3, email: "op@test.ci" }));
    });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4459/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { SB_CONFIG = SB_CONFIG || { url: "https://demo.supabase.co", key: "k" }; currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => navigate("clients", null)); await page.waitForSelector("#contact-cover:not(.hidden)", { timeout: 8000 });
    console.log("▶ Couverture des coordonnées");
    const t = await page.locator("#contact-cover").innerText();
    ok(/154 sans aucun contact \(16 %\)/.test(t) && /165 sans téléphone/.test(t) && /834 sans e-mail \(85 %\)/.test(t) && /57 e-mails rejetés/.test(t), "indicateur : sans aucun contact, sans téléphone, sans e-mail, e-mails rejetés, avec pourcentages");
    ok(/Enrichis par l'IA cette semaine : 3/.test(t), "enrichissements de la semaine affichés");
    await page.click("#cc-btn"); await page.waitForTimeout(500);
    ok((await page.evaluate(() => window.__calls.length)) === 1 && /Lot d'enrichissement créé/.test(await page.evaluate(() => document.body.innerText)), "« Enrichir maintenant » : lot demandé, confirmation affichée");
    await page.evaluate(() => { window.__lot = false; }); await page.click("#cc-btn"); await page.waitForTimeout(500);
    ok(/déjà en cours/.test(await page.evaluate(() => document.body.innerText)), "lot déjà ouvert : message explicite");
    await page.evaluate(() => { window.__refus = true; }); await page.click("#cc-btn"); await page.waitForTimeout(500);
    ok(/Réservé à la direction/.test(await page.evaluate(() => document.body.innerText)), "hors direction : « Réservé à la direction »");
    await page.evaluate(() => { let e = document.getElementById("contact-cover"); while (e) { e.scrollTop = 0; e = e.parentElement; } window.scrollTo(0, 0); }); await page.waitForTimeout(200); await page.screenshot({ path: (process.env.SHOT_DIR || "/tmp") + "/crm_couverture.png", clip: { x: 240, y: 0, width: 1126, height: 420 } });
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\nTous les contrôles passent.");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
