// Premier contact : un garage (AutoGarage Pro) ne reçoit jamais le message d'AluExpert. node premier_contact_autogarage_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4449), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4449/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    console.log("▶ Premier contact partenaires");
    const r = await page.evaluate(() => {
      const p = { id: 996201, nom: "SENSOFT", statut: "prospect", secteur: "Partenaire (distributeur / intégrateur)", logiciel: "DistriPro ERP, Compta Pro, SANIX CRM", phone: "+221 33 867 40 93", email: "", adresse: "Dakar", notes: "", created_at: new Date().toISOString(), interactions: [] };
      CLIENTS.push(p); navigate("clients", document.querySelector('[onclick*="navigate(\'clients\'"]')); renderClients(getFilteredClients());
      clientSearchQuery = "partenaire"; const trouves = getFilteredClients().map((c) => c.nom);
      clientSearchQuery = ""; fillClientFilters && fillClientFilters();
      const opts = [...document.querySelectorAll("#cf-secteur option")].map((o) => o.value);
      editClient(p.id); const secteurModale = document.getElementById("c-secteur").value;
      return { trouves, opts, secteurModale };
    });
    ok(r.trouves.includes("SENSOFT"), "la recherche « partenaire » retrouve la fiche");
    ok(r.opts.includes("Partenaire (distributeur / intégrateur)"), "le filtre « Tous secteurs » propose Partenaire");
    ok(r.secteurModale === "Partenaire (distributeur / intégrateur)", "ouvrir la fiche pour la modifier conserve le secteur Partenaire");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors[0] : ""));
    console.log("\nTOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });

