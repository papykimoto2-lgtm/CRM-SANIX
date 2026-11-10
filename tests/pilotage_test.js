// SANIX CRM Pro : Budget & plan d'actions (suivi budgétaire, plan d'actions, prévisionnel). node pilotage_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };

(async () => {
  const server = await start(4217), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4217/index.html"); await page.waitForTimeout(1200);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(2200);

    console.log("▶ Calculs");
    const r = await page.evaluate(() => {
      const c = SanixPilotage.calc;
      const commandes = [
        { date: "2026-03-10", statut: "livree", htNet: 1000000 }, { date: "2026-03-20", statut: "confirmee", htNet: 500000 },
        { date: "2026-03-25", statut: "brouillon", htNet: 9e6 }, { date: "2026-03-26", statut: "annulee", htNet: 9e6 }, { date: "2026-04-02", statut: "en_cours", htNet: 200000 },
      ];
      const deals = [
        { stage: "negociation", valeur: 1000000 }, { stage: "proposition", valeur: 2000000 }, { stage: "demo", valeur: 400000 },
        { stage: "gagne", valeur: 5e6 }, { stage: "perdu", valeur: 5e6 }, { stage: "negociation", valeur: 0 }, { stage: "inconnue", valeur: 9e6 },
      ];
      const st = { objectifs: { "2026-03": 2000000 }, depenses: [{ mois: "2026-03", prevu: 100000, reel: 0 }, { mois: "2026-03", prevu: 50000, reel: 80000 }, { mois: "2026-05", prevu: 70000, reel: 0 }], actions: [], hyp: null };
      return {
        realise: c.realise(commandes), pipe: c.pipeline(deals, "2026-03", null, null), dep: c.depenses(st.depenses),
        suivi: c.suivi(st, 2026, { commandes, objectifDefaut: 1500000 }), previ: c.previsionnel(st, "2026-03", { commandes, deals, objectifDefaut: 1500000 }),
        act: c.actions([{ statut: "a_faire", echeance: "2026-01-01", objectifCA: 100 }, { statut: "en_cours", echeance: "2099-01-01", objectifCA: 50 }, { statut: "fait", echeance: "2026-01-01", objectifCA: 200 }, { statut: "annule", echeance: "2026-01-01", objectifCA: 999 }], "2026-06-01"),
        add: c.addMonths("2026-11", 3),
      };
    });
    ok(r.realise["2026-03"] === 1500000 && r.realise["2026-04"] === 200000, "CA réalisé : brouillons et annulées exclus");
    ok(r.pipe["2026-03"].pondere === 750000 && r.pipe["2026-04"].pondere === 1100000 && r.pipe["2026-05"].pondere === 140000, "pipeline pondéré : valeur × probabilité dans le mois de l'étape (gagné, perdu, valeur 0 et étape inconnue exclus)");
    ok(r.pipe["2026-03"].n === 1 && r.pipe["2026-04"].brut === 2000000, "pipeline : nombre et montant brut par mois");
    ok(r.dep["2026-03"].retenu === 180000 && r.dep["2026-03"].prevu === 150000, "dépenses : le réel remplace le prévu ligne par ligne… sinon prévu (mois : 100 000 prévu + 80 000 réel)");
    const mars = r.suivi[2];
    ok(mars.objectif === 2000000 && mars.realise === 1500000 && mars.ecart === -500000 && mars.taux === 0.75 && mars.solde === 1320000, "suivi de mars : objectif saisi, écart, atteinte 75 %, solde = CA − dépenses");
    ok(r.suivi[0].objectif === 1500000, "suivi : objectif par défaut du Paramétrage quand aucun objectif saisi");
    ok(r.previ.length === 12 && r.previ[0].mois === "2026-03" && r.previ[11].mois === "2027-02", "prévisionnel : 12 mois glissants à partir du mois courant");
    ok(r.previ[0].ca === 1500000 + 750000 && r.previ[0].solde === 2250000 - 180000, "prévisionnel : mois courant = réalisé + pipeline pondéré");
    ok(r.previ[1].ca === 1100000 && r.previ[2].depenses === 70000, "prévisionnel : mois futurs = pipeline pondéré seul, dépenses prévues");
    ok(r.previ[11].cumul === r.previ.reduce((s, x) => s + x.solde, 0), "prévisionnel : solde cumulé cohérent");
    ok(r.act.total === 4 && r.act.retard === 1 && r.act.caVise === 350 && r.act.caViseFait === 200, "plan d'actions : retard = échéance dépassée non faite ; CA visé hors annulées");
    ok(r.add === "2027-02", "addMonths franchit l'année");

    console.log("▶ Écran");
    await page.evaluate(() => navigate("budget")); await page.waitForTimeout(500);
    ok(await page.locator("#view-budget").isVisible(), "écran Budget visible via le menu Pilotage");
    ok((await page.locator(".grp-tab.active").first().textContent()).includes("Budget"), "onglet « Budget & actions » actif dans le groupe Pilotage");
    ok(await page.locator("#view-budget table tbody tr").count() >= 12, "tableau de 12 mois");
    const fillc = async (sel, v) => { await page.fill(sel, v); await page.dispatchEvent(sel, "change"); await page.waitForTimeout(150); };
    await fillc('[data-obj$="-03"]', "3000000");
    ok((await page.evaluate(() => JSON.parse(localStorage.sanix_crm_pil_config)))["obj_" + new Date().getFullYear() + "-03"] === 3000000, "objectif mensuel enregistré");
    await page.fill('form[data-form="dep"] [name=libelle]', "Billets <b>Abidjan</b>"); await page.fill('form[data-form="dep"] [name=prevu]', "120000");
    await page.click('form[data-form="dep"] button'); await page.waitForTimeout(200);
    ok((await page.locator("#view-budget").innerText()).includes("Billets <b>Abidjan</b>") && (await page.locator("#view-budget b", { hasText: "Abidjan" }).count()) === 0, "dépense ajoutée, libellé échappé (pas de HTML injecté)");
    await page.click('[data-tab="actions"]');
    await page.fill('form[data-form="act"] [name=titre]', "Relancer 20 prospects Santé"); await page.fill('form[data-form="act"] [name=echeance]', "2020-01-01"); await page.fill('form[data-form="act"] [name=objectifCA]', "4000000");
    await page.click('form[data-form="act"] button'); await page.waitForTimeout(200);
    ok((await page.locator("#view-budget").innerText()).includes("Relancer 20 prospects Santé") && (await page.locator("#view-budget").innerText()).includes("⚠️"), "action ajoutée, signalée en retard");
    await page.selectOption("[data-act-statut]", "fait"); await page.waitForTimeout(200);
    ok(!(await page.locator("#view-budget").innerText()).includes("⚠️"), "action faite : plus de retard");
    await page.click('[data-tab="previ"]'); await page.waitForTimeout(200);
    ok((await page.locator("#view-budget table").first().locator("tbody tr").count()) === 12, "prévisionnel : 12 mois affichés");
    await fillc('[data-hyp-proba="negociation"]', "90");
    ok((await page.evaluate(() => JSON.parse(localStorage.sanix_crm_pil_config).proba_negociation)) === 0.9, "hypothèse de probabilité enregistrée");
    await page.reload(); await page.waitForTimeout(1200);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1500);
    await page.evaluate(() => navigate("budget")); await page.click('[data-tab="actions"]');
    ok((await page.locator("#view-budget").innerText()).includes("Relancer 20 prospects Santé"), "données conservées après rechargement");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\nTous les contrôles du module Budget sont passés.");
  } finally { await browser.close(); server.close && server.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
