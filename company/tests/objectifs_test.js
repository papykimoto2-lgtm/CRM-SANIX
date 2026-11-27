// Goal Engine : onglet Objectifs et question à Jarvis. node company/tests/objectifs_test.js
const { launch, newPage, ok, loadFixture } = require("./harness.js");
(async () => {
  const { server, browser, port } = await launch(4313);
  try {
    const fx = loadFixture(), d = (n) => new Date(Date.now() + n * 864e5).toISOString();
    fx.ai_goals_fixture = [
      { id: "g1", titre: "20 prospects qualifiés AluExpert", metrique: "qualifies", produit: null, agent_id: null, agent_nom: "IA Lead Qualifier", cible: 20, baseline: 5, actuel: 18, fait: 13, pct: 65, temps_pct: 50, etat: "en_bonne_voie", statut: "actif", debut: d(-10), echeance: d(10) },
      { id: "g2", titre: "3 rendez-vous confirmés", metrique: "rdv", produit: null, agent_id: null, agent_nom: null, cible: 3, baseline: 0, actuel: 0, fait: 0, pct: 0, temps_pct: 60, etat: "en_retard", statut: "actif", debut: d(-12), echeance: d(8) },
      { id: "g3", titre: "Ancien objectif", metrique: "offres", produit: null, agent_id: null, agent_nom: null, cible: 2, baseline: 0, actuel: 2, fait: 2, pct: 100, temps_pct: 100, etat: "atteint", statut: "atteint", debut: d(-40), echeance: d(-10) }];
    const { page, errors } = await newPage(browser, { fixture: JSON.stringify(fx) });
    await page.goto(`http://localhost:${port}/company/live.html?debug=1&fast=1`); await page.waitForSelector("#live:not([hidden])"); await page.waitForTimeout(2200);
    await page.evaluate(() => window.__jarvis.setLLM(false));
    console.log("▶ Jarvis : objectifs");
    const a = await page.evaluate(() => window.__jarvis.ask("Jarvis, où en sont nos objectifs ?"));
    ok(/2 objectifs actifs, dont 1 à risque/.test(a) && /13 sur 20, en bonne voie/.test(a) && /0 sur 3, en retard/.test(a) && !/Ancien/.test(a), "résumé : décompte, risque, avancement réel : " + a);
    console.log("▶ Onglet Objectifs");
    await page.goto(`http://localhost:${port}/company/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(700);
    await page.click("#tabs button[data-id=objectifs]"); await page.waitForSelector("#goal-form");
    ok((await page.locator(".goal").count()) === 3, "3 objectifs affichés (2 actifs + 1 clôturé)");
    const t = await page.locator("#main").innerText();
    ok(/13 \/ 20/.test(t) && /65 %/.test(t) && /En retard/.test(t) && /En bonne voie/.test(t), "progression, pourcentage et état affichés");
    await page.fill("#g-titre", "10 démonstrations ImmoSuite"); await page.selectOption("#g-metrique", "demos"); await page.fill("#g-cible", "10"); await page.click("#goal-form button[type=submit]"); await page.waitForTimeout(500);
    ok(/10 démonstrations ImmoSuite/.test(await page.locator("#main").innerText()) && /Démonstrations réalisées/.test(await page.locator("#main").innerText()), "création d'un objectif");
    const call = await page.evaluate(() => (window.__CALLS ?? []).filter((c) => c.rpc === "ai_goal_creer").pop());
    ok(call && call.args.p_metrique === "demos" && call.args.p_cible === 10 && /T23:59:59|Z$/.test(call.args.p_echeance), "paramètres transmis : indicateur, cible, échéance");
    await page.locator('.goal[data-id=g2] [data-go=abandonne]').click(); await page.waitForTimeout(500);
    ok(!(await page.locator('.goal[data-id=g2] [data-go]').count()) || /Clôturés/.test(await page.locator("#main").innerText()), "abandon : objectif sorti des actifs");
    ok(errors.filter((e) => !/favicon|Failed to load resource/.test(e)).length === 0, "aucune erreur console : " + errors.slice(0, 2).join(" | "));
  } finally { await browser.close(); server.close?.(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
