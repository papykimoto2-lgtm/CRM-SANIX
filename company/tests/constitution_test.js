// Constitution SANIX AI : lecture, révision versionnée, alertes de gouvernance. node company/tests/constitution_test.js
const { launch, newPage, ok, loadFixture } = require("./harness.js");
(async () => {
  const { server, browser, port } = await launch(4314);
  try {
    const fx = loadFixture();
    fx.ai_constitution_fixture = [{ version: 1, contenu: "CONSTITUTION SANIX AI — version 1\n\nArt. 1 — Autorité. La direction humaine est l'autorité supérieure.\n\nArt. 5 — Règles cognitives. Aucun agent ne transforme une hypothèse en fait.", motif: "Version initiale", publie_at: new Date().toISOString() }];
    fx.ai_journal_fixture = [{ type: "budget", gravite: "attention", message: "Budget quotidien à 90 %", agent_nom: "IA Prospect Hunter 1", created_at: new Date().toISOString() }];
    const { page, errors } = await newPage(browser, { fixture: JSON.stringify(fx) });
    await page.goto(`http://localhost:${port}/company/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(700);
    await page.click("#tabs button[data-id=constitution]"); await page.waitForSelector("#const-txt");
    console.log("▶ Constitution");
    ok(/Version 1/.test(await page.locator("#main").innerText()) && /autorité supérieure/.test(await page.locator("#const-txt").innerText()), "texte et version affichés");
    ok(/Budget quotidien à 90 %/.test(await page.locator("#gov-journal").innerText()), "alertes de gouvernance listées");
    await page.evaluate(() => { window.confirm = () => true; });
    await page.locator("summary", { hasText: "Réviser" }).click();
    await page.click("#const-form button[type=submit]"); await page.waitForTimeout(300);
    ok(!/Version 2/.test(await page.locator("#main").innerText()), "texte inchangé : aucune version créée");
    await page.fill("#const-new", "CONSTITUTION SANIX AI — version 2\n\nArt. 1 — Autorité. La direction humaine est l'autorité supérieure et seule source de modification.");
    await page.fill("#const-motif", "Précision de l'article 1"); await page.click("#const-form button[type=submit]"); await page.waitForTimeout(500);
    ok(/Version 2/.test(await page.locator("#main").innerText()) && /seule source de modification/.test(await page.locator("#const-txt").innerText()), "révision publiée : version 2 courante");
    ok(/Historique \(2 versions\)/.test(await page.locator("#main").innerText()), "historique conservé (2 versions)");
    const c = await page.evaluate(() => (window.__CALLS ?? []).filter((x) => x.rpc === "ai_constitution_publier").length);
    ok(c === 1, "une seule publication envoyée");
    ok(errors.filter((e) => !/favicon|Failed to load resource/.test(e)).length === 0, "aucune erreur console : " + errors.slice(0, 2).join(" | "));
  } finally { await browser.close(); server.close?.(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
