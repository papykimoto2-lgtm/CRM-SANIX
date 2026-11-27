// Mémoire de Jarvis : commandes vocales/écrites, contexte transmis au LLM, onglet Mémoire. node company/tests/memoire_test.js
const { launch, newPage, ok, loadFixture } = require("./harness.js");
(async () => {
  const { server, browser, port } = await launch(4312);
  try {
    const fx = loadFixture(); fx.ai_jarvis_memory = [{ id: 1, contenu: "Le président préfère les relances le matin", categorie: "preference", epingle: true, created_at: new Date().toISOString() }];
    const { page, errors } = await newPage(browser, { fixture: JSON.stringify(fx) });
    await page.goto(`http://localhost:${port}/company/live.html?debug=1&fast=1`); await page.waitForSelector("#live:not([hidden])"); await page.waitForTimeout(2200);
    await page.evaluate(() => window.__jarvis.setLLM(false));
    const ask = (t) => page.evaluate((x) => window.__jarvis.ask(x), t);
    const mem = () => page.evaluate(() => window.__CALLS?.filter((c) => c.rpc?.startsWith("ai_jarvis_")).map((c) => c.rpc + ":" + (c.args.p_contenu ?? c.args.p_texte ?? "")) ?? []);
    console.log("▶ Jarvis : mémoire");
    const a1 = await ask("Jarvis, retiens que je veux toujours un rapport le lundi à 8h");
    ok(/Retenu/.test(a1), "retenir : confirmation : " + a1);
    const a2 = await ask("Jarvis, retiens que je veux toujours un rapport le lundi à 8h");
    ok(/déjà/.test(a2), "doublon détecté : " + a2);
    const a3 = await ask("Jarvis, que sais-tu de moi ?");
    ok(/2 éléments/.test(a3) && /rapport le lundi/.test(a3), "lister : les 2 souvenirs lus : " + a3);
    const a4 = await ask("Jarvis, retiens que le mot de passe est : abc123");
    ok(/pas pu le retenir/.test(a4) && /secret|mot de passe/i.test(a4), "secret refusé : " + a4);
    const a5 = await ask("Jarvis, oublie rapport le lundi");
    ok(/oublié/.test(a5), "oublier un souvenir unique : " + a5);
    const a6 = await ask("Jarvis, oublie inexistant truc");
    ok(/aucun souvenir/.test(a6), "oubli sans correspondance : " + a6);
    const a7 = await ask("Jarvis, oublie la fiche du prospect Alpha");
    ok(!/oublié|aucun souvenir/.test(a7), "« oublie la fiche… » ne touche pas la mémoire : " + a7);
    console.log("▶ Onglet Mémoire");
    await page.goto(`http://localhost:${port}/company/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(700);
    await page.click("#tabs button[data-id=memoire]"); await page.waitForSelector("#mem-form");
    ok(/relances le matin/.test(await page.locator("#mem-list").innerText()), "souvenir listé");
    await page.fill("#mem-txt", "Toujours valider les devis supérieurs à 1 million"); await page.selectOption("#mem-cat", "consigne"); await page.click("#mem-form button[type=submit]"); await page.waitForTimeout(400);
    ok(/devis supérieurs/.test(await page.locator("#mem-list").innerText()), "ajout depuis l'onglet");
    const row = () => page.locator("#mem-list .row", { hasText: "devis supérieurs" });
    await row().locator("[data-mem=pin]").click(); await page.waitForTimeout(300);
    ok((await row().locator("[data-mem=pin]").getAttribute("aria-pressed")) === "true", "épinglage");
    await page.evaluate(() => { window.confirm = () => true; });
    await row().locator("[data-mem=del]").click(); await page.waitForTimeout(400);
    ok(!/devis supérieurs/.test(await page.locator("#mem-list").innerText()) && /relances le matin/.test(await page.locator("#mem-list").innerText()), "suppression ciblée");
    ok(errors.filter((e) => !/favicon|Failed to load resource/.test(e)).length === 0, "aucune erreur console : " + errors.slice(0, 2).join(" | "));
  } finally { await browser.close(); server.close?.(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
