// Planification des envois : réglages de la Gouvernance (fenêtre, jours, plafond) et état. node company/tests/envoi_test.js
const { launch, newPage, ok } = require("./harness.js");
(async () => {
  const { server, browser, port } = await launch(4298);
  try {
    const { page, errors } = await newPage(browser, { w: 1300, h: 900 });
    await page.goto(`http://localhost:${port}/company/`); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(800);
    const tab = async () => { await page.click("#tabs button[data-id=gov]"); await page.waitForTimeout(400); };
    console.log("▶ Planification des envois");
    await tab(); ok((await page.locator("#envoi-form").count()) === 0, "colonnes absentes (base non migrée) : la carte n'apparaît pas (aucune régression)");
    await page.evaluate(async () => {
      const { S } = await import("/company/state.js");
      Object.assign(S.gov, { envoi_planifie: true, envoi_jours: [1, 2, 3, 4, 5, 6], envoi_debut: "08:00:00", envoi_fin: "18:00:00", envoi_plafond_wa_jour: 20 });
      const row = window.__FIX.ai_governance[0]; Object.assign(row, S.gov);
      const rpc = S.sb.rpc.bind(S.sb); S.sb.rpc = (n, a) => n === "ai_envoi_etat" ? Promise.resolve({ data: { planifie: true, fenetre_ouverte: false, prochain_creneau: "2026-11-23T08:00:00Z", wa_envoyes_aujourdhui: 3, plafond_wa_jour: 20, wa_restants_aujourdhui: 17, en_file: 2, a_valider: 5, relances_planifiees: 1 }, error: null }) : rpc(n, a);
      const from = S.sb.from.bind(S.sb); S.sb.from = (t) => { const b = from(t); if (t === "ai_governance") { const u = b.update.bind(b); b.update = (p) => { window.__upd = (window.__upd ?? []).concat([p]); return u(p); }; } return b; };
    });
    await page.click("#tabs button[data-id=office]"); await tab();
    ok((await page.locator("#envoi-form").count()) === 1, "carte « Planification des envois » affichée");
    ok(await page.locator("#e-on").isChecked() && (await page.locator(".e-j:checked").count()) === 6 && (await page.inputValue("#e-debut")) === "08:00" && (await page.inputValue("#e-fin")) === "18:00" && (await page.inputValue("#e-plafond")) === "20", "valeurs actuelles : lundi-samedi, 08:00-18:00, plafond 20");
    const et = await page.textContent("#e-etat"); ok(/Fenêtre fermée/.test(et) && /prochain créneau : lundi/.test(et) && /3 \/ 20/.test(et) && /en file : 2/.test(et) && /à valider : 5/.test(et), "état en direct : fenêtre fermée, prochain créneau lundi, 3 / 20 envoyés, file et validations (" + et.slice(0, 120) + ")");
    for (const n of [1, 2, 3, 4, 5, 6]) await page.uncheck(`.e-j[value="${n}"]`); await page.click("#envoi-form button[type=submit]"); await page.waitForTimeout(300);
    ok(!(await page.evaluate(() => window.__upd?.length)), "aucun jour coché : refusé, rien n'est enregistré");
    for (const n of [1, 2, 3, 4, 5]) await page.check(`.e-j[value="${n}"]`);
    await page.fill("#e-debut", "18:00"); await page.fill("#e-fin", "09:00"); await page.click("#envoi-form button[type=submit]"); await page.waitForTimeout(300);
    ok(!(await page.evaluate(() => window.__upd?.length)), "début après la fin : refusé");
    await page.fill("#e-debut", "09:00"); await page.fill("#e-fin", "17:30"); await page.fill("#e-plafond", "15"); await page.click("#envoi-form button[type=submit]"); await page.waitForTimeout(400);
    const u = await page.evaluate(() => window.__upd?.at(-1));
    ok(u && JSON.stringify(u.envoi_jours) === "[1,2,3,4,5]" && u.envoi_debut === "09:00" && u.envoi_fin === "17:30" && u.envoi_plafond_wa_jour === 15 && u.envoi_planifie === true, "enregistrement : lundi-vendredi, 09:00-17:30, plafond 15");
    ok(await page.evaluate(() => window.__FIX.ai_governance[0].envoi_plafond_wa_jour === 15), "valeur écrite dans la gouvernance");
    const bad = errors.filter((e) => !/WebGL|swiftshader|GPU/i.test(e)); ok(bad.length === 0, "aucune erreur dans la console" + (bad.length ? " : " + bad.slice(0, 2).join(" | ") : ""));
    console.log("\nTOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
