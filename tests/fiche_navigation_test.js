// SANIX CRM Pro : flèches ‹ › et touches ← → de la fiche client (prospect précédent / suivant de la liste affichée). node tests/fiche_navigation_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4455), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4455/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    const mk = (id, nom) => ({ id, nom, statut: "prospect", phone: "+225070000" + id, email: "", secteur: "Immobilier", logiciel: "ImmoSuite ERP", adresse: "Cocody", commercial: "", date: new Date().toISOString().slice(0, 10), interactions: [], tags: [], notes: "" });
    await page.evaluate((a) => { a.forEach((c) => CLIENTS.push(c)); renderClients(a); }, [mk(990001, "ALPHA IMMO"), mk(990002, "BETA IMMO"), mk(990003, "GAMMA IMMO")]);
    const cur = () => page.evaluate(() => _aiCurrentClientId);
    const nom = () => page.evaluate(() => document.getElementById("sp-header").innerText);
    const pos = () => page.locator("#sp-nav-pos").textContent();
    const dis = (id) => page.getAttribute(id, "aria-disabled");
    console.log("▶ Navigation entre fiches");
    await page.evaluate(() => showClientDetail(990001)); await page.waitForTimeout(300);
    ok((await pos()) === "1 / 3" && (await dis("#sp-nav-prev")) === "true" && (await dis("#sp-nav-next")) === "false", "première fiche : « 1 / 3 », précédent désactivé, suivant actif");
    await page.click("#sp-nav-next"); await page.waitForTimeout(300);
    ok((await cur()) === 990002 && /BETA IMMO/.test(await nom()) && (await pos()) === "2 / 3", "flèche › : fiche suivante (BETA IMMO, « 2 / 3 »)");
    ok((await page.getAttribute("#sp-nav-next", "title")).includes("GAMMA IMMO"), "l'infobulle annonce le nom de la fiche suivante");
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(300);
    ok((await cur()) === 990003 && (await dis("#sp-nav-next")) === "true", "touche → : fiche suivante ; dernier : suivant désactivé");
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150);
    ok((await cur()) === 990003, "→ sur la dernière fiche : reste en place");
    await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(300);
    ok((await cur()) === 990002, "touche ← : fiche précédente");
    // saisie dans un champ : les flèches ne changent pas de fiche
    await page.evaluate(() => { const i = document.createElement("input"); i.id = "tmp-in"; document.getElementById("modal-client-detail").appendChild(i); i.focus(); });
    await page.keyboard.press("ArrowRight"); ok((await cur()) === 990002, "dans un champ de saisie : → ne change pas de fiche");
    await page.evaluate(() => document.getElementById("tmp-in").remove());
    // plein écran conservé et retour en haut
    await page.evaluate(() => { spToggleFull("modal-client-detail", true); const sc = document.querySelector("#modal-client-detail .sp-scroll"); sc.scrollTop = 400; });
    await page.click("#sp-nav-prev"); await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.getElementById("modal-client-detail").classList.contains("sp-full")), "le plein écran est conservé d'une fiche à l'autre");
    ok((await page.evaluate(() => document.querySelector("#modal-client-detail .sp-scroll").scrollTop)) === 0, "la nouvelle fiche s'ouvre en haut");
    await page.evaluate(() => spToggleFull("modal-client-detail", false));
    // une autre fenêtre ouverte par-dessus : les flèches clavier ne naviguent pas
    await page.evaluate(() => document.getElementById("modal-relance").classList.remove("hidden")); await page.keyboard.press("ArrowRight");
    ok((await cur()) === 990001, "fenêtre ouverte par-dessus la fiche : touches ignorées");
    await page.evaluate(() => document.getElementById("modal-relance").classList.add("hidden"));
    // fiche ouverte hors de la liste : repli sur les prospects
    await page.evaluate(() => { CLIENTS.push({ id: 990009, nom: "DELTA HORS LISTE", statut: "prospect", phone: "", email: "", secteur: "Autre", logiciel: "", adresse: "", commercial: "", date: "2026-11-01", interactions: [], tags: [], notes: "" }); showClientDetail(990009); }); await page.waitForTimeout(300);
    ok(/ \/ \d+$/.test(await pos()), "fiche hors de la liste affichée : navigation parmi les prospects (" + (await pos()) + ")");
    await page.screenshot({ path: (process.env.SHOT_DIR || "/tmp") + "/crm_fiche_nav.png" });
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\nTous les contrôles passent.");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
