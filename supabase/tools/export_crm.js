// Exporte les prospects, clients et commandes du CRM (index.html, jeu de données intégré) au format JSON attendu par gen_seed_crm_missions.py.
// Usage : node supabase/tools/export_crm.js > crm_export.json   (Playwright requis ; aucun accès réseau : Chart.js simulé)
const { chromium } = require("playwright");
const { start } = require("../../company/tests/server.js");
(async () => {
  const server = await start(4217), browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } }, scale: {} }; window.Chart = Chart; });
  const page = await ctx.newPage();
  await page.goto("http://localhost:4217/index.html"); await page.waitForTimeout(1200);
  await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(2500);
  const out = await page.evaluate(() => {
    const wa = (c) => { try { return !!waAnalyse(c.phone).ok; } catch (e) { return false; } };      // mobile valide pour WhatsApp (règle du CRM)
    return {
      prospects: CLIENTS.filter((c) => c.statut === "prospect").map((c) => ({ id: c.id, nom: c.nom, secteur: c.secteur || null, phone: c.phone || null, email: c.email || null, notes: c.notes || null, wa: wa(c), adresse: c.adresse || null })),
      clients: CLIENTS.filter((c) => c.statut === "client").map((c) => ({ id: c.id, nom: c.nom, logiciel: c.logiciel || null })),
      commandes: COMMANDES.map((c) => ({ statut: c.statut, client: c.client })),
    };
  });
  process.stdout.write(JSON.stringify(out));
  await browser.close(); server.close();
})();
