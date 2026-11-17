// SANIX CRM Pro : pagination des tableaux/listes et onglets de section (aucune pile verticale). node crm_pagination_test.js
// Jeu de données : prospects et clients de démonstration intégrés à l'application (plusieurs centaines de lignes).
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };

(async () => {
  const server = await start(4211), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());                 // pas de réseau : Chart.js simulé
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } }, scale: {} }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("dialog", (d) => { errors.push("DIALOG: " + d.message()); d.dismiss(); });
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_/i.test(m.text())) errors.push("console: " + m.text()); });
    await page.goto("http://localhost:4211/index.html"); await page.waitForTimeout(1200);
    // session ouverte directement (le test n'a pas besoin du mot de passe) : compte super administrateur de démonstration
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(2500);
    const nav = async (v) => { await page.evaluate((v) => navigate(v, null), v); await page.waitForTimeout(450); };
    const height = () => page.evaluate(() => document.querySelector(".content").scrollHeight);
    const stat = (id) => page.evaluate((id) => window.SanixPager.stats().find((s) => s.id === id) ?? null, id);
    const visibleViews = () => page.evaluate(() => [...document.querySelectorAll('[id^="view-"]')].filter((v) => v.offsetParent !== null).map((v) => v.id.slice(5)));

    console.log("▶ Hauteur des pages (fenêtre 1366×768)");
    const CAP = { pipeline: 1500, conversion: 3400, clients: 2300, direction: 1700, cockpit: 1900, intel: 2300, aisales: 2800, logiciels: 3000 };
    for (const [v, cap] of Object.entries(CAP)) { await nav(v); const h = await height(); ok(h <= cap, `${v} : ${h} px (≤ ${cap}) — sans pagination : plusieurs dizaines de milliers de pixels`); }

    console.log("▶ Tableau des clients");
    await nav("clients");
    let st = await stat("clients-tbody");
    ok(st && st.total >= 400 && st.shown === 25 && st.bar, `${st && st.total} lignes : 25 affichées, barre de pagination visible`);
    const first = () => page.evaluate(() => [...document.querySelectorAll("#clients-tbody tr")].find((r) => r.getAttribute("data-pg") !== "off").innerText.slice(0, 40));
    const f1 = await first();
    await page.click('#clients-table-view + .sx-pager button[data-a="next"]');
    ok((await first()) !== f1, "page suivante : autres clients");
    await page.selectOption("#clients-table-view + .sx-pager select", "50"); ok((await stat("clients-tbody")).shown === 50, "50 lignes par page");
    await page.selectOption("#clients-table-view + .sx-pager select", "25");
    await page.fill("#client-search", "VILLA"); await page.waitForTimeout(500);
    st = await stat("clients-tbody"); ok(st.total > 0 && st.total < 25 && !st.bar, `recherche « VILLA » : ${st.total} résultat(s), plus de barre`);
    await page.fill("#client-search", ""); await page.waitForTimeout(500);
    ok((await stat("clients-tbody")).total >= 400, "recherche effacée : liste complète paginée");

    console.log("▶ Pipeline (kanban)");
    await nav("pipeline");
    const back = await page.evaluate(() => { const c = document.getElementById("col-prospect"); return { existe: !!c, n: c ? +c.querySelector(".stage-count").textContent : 0, top: c ? c.querySelectorAll(".pipe-top").length : 0, cartes: document.querySelectorAll("#cards-prospect .deal-card").length, bouton: !!(c && c.querySelector('button[onclick*="qualification"]')) }; });
    ok(back.existe && back.n >= 400 && back.top === 10 && back.cartes === 0 && back.bouton, `prospects à froid : une carte « À qualifier » (${back.n}), 10 en tête, aucune des centaines de cartes dans le tableau`);
    const nCartes = await page.evaluate(() => document.querySelectorAll("#kanban-board .deal-card").length);
    ok(nCartes < 60, `tableau léger : ${nCartes} cartes affichées`);
    const funnel = await page.evaluate(() => [...document.querySelectorAll("#pipeline-bar .pipe-step")].map((x) => x.querySelector(".l").textContent + ":" + x.querySelector(".n").textContent));
    ok(funnel.length >= 6 && funnel[0].startsWith("Prospect:"), "entonnoir : un chiffre par étape (" + funnel.join(" · ") + ")");
    const moved = await page.evaluate(() => {
      DEALS.push({ id: 99999, client: "Affaire Test", clientId: null, logiciel: "ImmoSuite ERP", valeur: 0, commercial: "", stage: "contact", notes: "", color: "#0e7490", date: new Date().toLocaleDateString("fr-FR"), history: [] });
      initPipeline(); const before = DEALS.filter((d) => d.stage === "contact").length;
      startDrag({}, 99999); dropDeal({ preventDefault() {} }, "perdu");
      return { before };
    });
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => { const c = document.getElementById("deal-99999"); return { inPerdu: !!c && c.closest("#cards-perdu") !== null, contact: DEALS.filter((d) => d.stage === "contact").length }; });
    ok(after.inPerdu && after.contact === moved.before - 1, "glisser-déposer : l'affaire déposée apparaît dans sa nouvelle colonne");

    console.log("▶ Onglets de section (plus de pile verticale)");
    await nav("direction");
    ok((await visibleViews()).join() === "direction", "Direction : seule la section Direction est affichée");
    ok(await page.evaluate(() => document.getElementById("view-cockpit").classList.contains("sec-off") && document.getElementById("view-intel").classList.contains("sec-off")), "Cockpit IA et Intelligence sont masqués (onglets)");
    await nav("cockpit");
    ok((await visibleViews()).join() === "direction,cockpit", "Cockpit IA : la section Cockpit s'affiche");
    ok(await page.evaluate(() => [...document.getElementById("view-direction").children].filter((c) => !c.classList.contains("grp-tabs") && c.id !== "view-cockpit" && c.offsetParent !== null).length === 0), "le contenu Direction est masqué pendant l'onglet Cockpit");
    ok((await page.locator("#view-direction .grp-tab.active").innerText()).includes("Cockpit"), "l'onglet actif est « Cockpit IA »");
    await nav("intel"); ok(await page.evaluate(() => !document.getElementById("view-cockpit").offsetParent && !!document.getElementById("view-intel").offsetParent), "Intelligence : section Intelligence seule");
    st = await stat("intel-tbody"); ok(st && st.total >= 400 && st.shown === 25, `portefeuille priorisé : ${st && st.total} lignes, 25 affichées`);
    await nav("conversion"); ok((await visibleViews()).join() === "pipeline,conversion", "Relances prioritaires : section Conversion seule");
    st = await stat("conv-list"); ok(st && st.size === 10 && st.shown === 10 && st.total >= 400, `file d'action : ${st && st.total} prospects, 10 par page`);
    await nav("pipeline"); ok((await visibleViews()).join() === "pipeline" && (await page.evaluate(() => document.getElementById("view-conversion").classList.contains("sec-off"))), "retour au Pipeline : la section Conversion est de nouveau masquée");

    console.log("▶ Autres vues");
    for (const v of ["dashboard", "agenda", "carte", "rapports", "journal", "marketing", "messagerie", "logiciels", "presentations", "commandes", "contrats", "licences", "planning", "comptabilite", "commissions", "apresvente", "aisales", "equipe", "documents", "parametrage"]) await nav(v);
    st = await stat("logiciels-grid"); await nav("logiciels"); st = await stat("logiciels-grid");
    ok(st && st.size === 9 && st.shown === 9 && st.total >= 10, `catalogue : ${st && st.total} logiciels, 9 par page`);
    await nav("aisales"); st = await stat("ais-score-body"); ok(st && st.total >= 200 && st.shown === 25, `Directeur IA : ${st && st.total} scores, 25 affichés`);
    ok(errors.length === 0, `aucune erreur JS / boîte de dialogue (${errors.join(" | ")})`);
    console.log("\nTOUT EST OK");
  } catch (e) { console.error("\n" + e.message); process.exitCode = 1; }
  await browser.close(); server.close();
})();
