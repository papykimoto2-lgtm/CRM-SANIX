// Crédit de l'API Anthropic dans l'écran Gouvernance : non renseigné, saisie d'un solde, recharge, alerte de crédit bas, fonction absente. node credit_test.js
const { launch, newPage, ok, loadFixture } = require("./harness.js");

(async () => {
  const { server, browser } = await launch(4178);
  try {
    const run = async (mut, steps) => {
      const FX = loadFixture(); mut(FX);
      const { page, errors } = await newPage(browser, { fixture: JSON.stringify(FX) });
      await page.goto("http://localhost:4178/company/"); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(700);
      await page.click("#tabs button[data-id=gov]"); await page.waitForTimeout(400);
      await steps(page); ok(errors.length === 0, "aucune erreur JavaScript (" + errors.join(" | ") + ")"); await page.close();
    };
    const body = async (p) => (await p.locator("#main").innerText()).replace(/[  ]/g, " ");

    console.log("▶ Fonction absente du serveur");
    await run((FX) => { delete FX.rpc.ai_credit_status; }, async (p) => {
      ok((await body(p)).includes("Suivi du crédit non installé"), "la carte indique que la migration manque, sans erreur");
    });

    console.log("▶ Crédit non renseigné, puis saisie du solde de la Console");
    await run((FX) => { FX.rpc.ai_credit_status = { saisi: false }; }, async (p) => {
      ok((await body(p)).includes("Non renseigné"), "aucun solde inventé : « Non renseigné »");
      ok((await p.locator("#status-chips").innerText()).indexOf("Crédit") < 0, "pas de pastille de crédit tant que rien n'est saisi");
      await p.selectOption('#credit-form select[name=type]', "solde_constate"); await p.fill('#credit-form input[name=montant]', "6.7"); await p.fill('#credit-form input[name=note]', "Console");
      await p.click('#credit-form button[type=submit]'); await p.waitForTimeout(500);
      const c = (await p.evaluate(() => window.__CALLS.filter((x) => x.rpc === "ai_credit_ajouter"))).at(-1);
      ok(c && c.args.p_type === "solde_constate" && c.args.p_montant === 6.7 && c.args.p_date === null && c.args.p_note === "Console", "fonction serveur appelée avec le type, le montant, sans date, avec la note");
      p.__ = 1; await p.click("#tabs button[data-id=gov]"); await p.waitForTimeout(300);
      ok((await body(p)).includes("6.70 $"), "le solde saisi s'affiche");
    });

    console.log("▶ Crédit bas : alerte et pastille");
    await run((FX) => { FX.rpc.ai_credit_status = { saisi: true, solde_usd: 1.4, base_usd: 6.7, base_at: new Date().toISOString(), recharges_depuis_usd: 0, depense_depuis_usd: 5.3, rythme_jour_usd: 2.1, jours_restants: 0, derniere_recharge: null }; }, async (p) => {
      const b = await body(p);
      ok(b.includes("Crédit bas") && b.includes("1.40 $") && b.includes("2.10 $ / jour"), "alerte, solde et rythme affichés");
      const chips = (await p.locator("#status-chips").innerText()).replace(/[  ]/g, " "); ok(/Crédit 1[.,]4 \$/.test(chips), "pastille de l'en-tête : " + chips);
      ok(await p.locator("#status-chips .chip.warn", { hasText: "Crédit" }).count() === 1, "pastille en alerte");
      await p.selectOption('#credit-form select[name=type]', "recharge"); await p.fill('#credit-form input[name=montant]', "10"); await p.fill('#credit-form input[name=date]', "2026-11-11");
      await p.click('#credit-form button[type=submit]'); await p.waitForTimeout(500);
      const c = (await p.evaluate(() => window.__CALLS.filter((x) => x.rpc === "ai_credit_ajouter"))).at(-1);
      ok(c && c.args.p_type === "recharge" && c.args.p_montant === 10 && c.args.p_date === "2026-11-11", "recharge : montant et date transmis");
    });
    console.log("\nCrédit API : TOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
