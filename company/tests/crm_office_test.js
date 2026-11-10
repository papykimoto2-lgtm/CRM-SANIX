// Bureau 3D et bureau du Président connectés au CRM : fiche collaborateur (dossiers CRM suivis, ouverture dans le CRM, mission pour un dossier, validations)
// et carte « Activité commerciale (CRM) » (ventes, objectif, missions en retard avec arbitrage, anomalies). Fonctions SQL simulées (fakesb.js) : leur
// comportement réel (PostgreSQL) est prouvé par supabase/functions/tests/crm_connector_test.ts. node company/tests/crm_office_test.js
const { launch, ok, newPage, openOffice, loadFixture } = require("./harness.js");

(async () => {
  const { server, browser } = await launch(4291);
  const port = server.address().port;
  try {
    const A = Object.fromEntries(loadFixture().ai_agents.map((a) => [a.code, a.id]));
    const nego = A.ia_nego_1, late = "99999999-0000-4000-8000-000000000001";
    const init = `
      const A = Object.fromEntries(window.__FIX.ai_agents.map((a) => [a.code, a.id]));
      window.__FIX.ai_agent_tasks.push({ id: "${late}", agent_id: A.ia_nego_1, type: "mission", titre: "Relancer Alpha Immobilier (en retard)", description: "x", statut: "en_cours", priorite: 3, objectifs: [], resultats: [], echeance: new Date(Date.now() - 7200e3).toISOString(), created_at: new Date(Date.now() - 86400e3).toISOString(), updated_at: new Date().toISOString() });
      window.__FIX.crm = {
        dashboard: { objectif_mensuel_fcfa: 1500000, clients: 12, prospects: 40, deals: { proposition: 3 }, ca_commandes_mois: 900000, encaisse_mois: 300000, ca_ia_total: 450000, rdv_a_venir: 5, offres: { envoyee: 2, acceptee: 1 },
          missions_ouvertes: 7, missions_en_retard: [{ id: "${late}", titre: "Relancer Alpha Immobilier (en retard)", agent: "IA Sales Negotiator", echeance: new Date(Date.now() - 7200e3).toISOString(), statut: "en_cours", priorite: 3 }],
          validations_en_attente: 2, anomalies: [{ id: "e1", type: "ia.alert.raised", niveau: "critique", message: "Mission « Cartographier 30 cliniques » en échec", status: "done", created_at: new Date().toISOString() }], sync: { en_attente: 0, en_echec: 1, morts: 0 } },
        portfolio: { [A.ia_nego_1]: { prospects: [{ id: "aaaaaaaa-0000-4000-8000-000000000001", entreprise: "Alpha Immobilier", stage: "negociation", score: 82, priorite: "prioritaire", crm_rid: "c_alpha1", statut_crm: "prospect" },
            { id: "aaaaaaaa-0000-4000-8000-000000000002", entreprise: "Beta Santé", stage: "interesse", score: 61, priorite: "interessant", crm_rid: null, statut_crm: null }],
          missions: [{ id: "${late}", titre: "Relancer Alpha Immobilier (en retard)", statut: "en_cours", prospect_id: "aaaaaaaa-0000-4000-8000-000000000001", entreprise: "Alpha Immobilier", crm_rid: "c_alpha1" }],
          validations: [{ id: "v1", type: "remise", motif: "Remise 15 %", prospect_id: "aaaaaaaa-0000-4000-8000-000000000001", created_at: new Date().toISOString() }] } } };`;
    const { page, errors } = await newPage(browser, { w: 1440, h: 900, init });
    await openOffice(page, port);

    console.log("▶ Fiche collaborateur : dossiers CRM");
    await page.locator("#sup-body tr", { hasText: "IA Sales Negotiator" }).first().click();
    await page.waitForSelector("#sheet h3.sh:has-text('Dossiers CRM suivis')");
    const sheet = await page.locator("#sheet").innerText();
    ok(sheet.includes("Dossiers CRM suivis (2)") && sheet.includes("Alpha Immobilier") && sheet.includes("82/100") && sheet.includes("CRM : prospect"), "la fiche liste les dossiers suivis (étape, score, statut dans le CRM)");
    const href = await page.locator("#sheet a:has-text('Ouvrir dans le CRM')").first().getAttribute("href");
    ok(/index\.html\?crm_client=c_alpha1$/.test(href) && (await page.locator("#sheet a:has-text('Ouvrir dans le CRM')").count()) === 1, `« Ouvrir dans le CRM » mène à la fiche (${href}) ; pas de lien pour un dossier non rattaché`);
    ok(sheet.includes("1 validation(s) en attente") && sheet.includes("Missions liées à un dossier"), "validations en attente et missions liées affichées");
    await page.locator("#sheet [data-act=tab][data-id=valid]").click(); await page.waitForTimeout(400);
    ok((await page.locator("#tabs [aria-selected=true]").innerText()).includes("Validations"), "le lien ouvre l'onglet des validations");
    await page.locator("#tabs [data-id=office]").click();                                   // la fiche reste ouverte au retour sur le bureau
    await page.waitForSelector("#sheet [data-act=crm-mission]");

    console.log("▶ Mission pour un dossier");
    await page.locator("#sheet [data-act=crm-mission]").first().click(); await page.waitForSelector("#crm-mission-form");
    await page.fill("#cm-desc", "Appeler le directeur et proposer la démonstration"); await page.selectOption("#cm-prio", "1"); await page.selectOption("#cm-ech", "24");
    await page.click("#crm-mission-form button[type=submit]"); await page.waitForSelector("#modal", { state: "hidden" });
    const call = await page.evaluate(() => window.__CALLS.find((c) => c.rpc === "crm_assign_mission")?.args);
    ok(call && call.p_agent && call.p_prospect === "aaaaaaaa-0000-4000-8000-000000000001" && call.p_titre === "Relancer Alpha Immobilier" && call.p_priorite === 1 && call.p_echeance_h === 24, "mission transmise avec l'agent, le dossier, le titre, la priorité et l'échéance");

    console.log("▶ Bureau du Président : résultats CRM");
    await page.locator("#tabs [data-id=exec]").click(); await page.waitForSelector("#crm-card-h");
    const card = await page.locator("#exec-side").innerText();
    ok(card.includes("Activité commerciale (CRM)") && card.includes("Prospects 40") && card.includes("Clients 12") && card.includes("Rendez-vous à venir 5"), "indicateurs CRM : prospects, clients, rendez-vous");
    ok(/Objectif mensuel.*: 60 %/s.test(card) && card.includes("Ventes obtenues par l'IA") && card.includes("2 envoyee"), "ventes du mois, objectif atteint à 60 %, ventes de l'IA, offres");
    ok(card.includes("Missions en retard") && card.includes("Relancer Alpha Immobilier") && card.includes("Anomalies remontées") && card.includes("en échec") && card.includes("1 en reprise"), "missions en retard, anomalie remontée, état de la synchronisation");
    await page.locator("#exec-side [data-act=crm-arb][data-a=cancel]").first().click(); await page.waitForTimeout(600);
    ok(await page.evaluate((id) => window.__CALLS.some((c) => c.rpc === "crm_arbitrate_task" && c.args.p_task === id && c.args.p_action === "cancel"), late), "arbitrage : l'annulation est transmise");
    ok(!(await page.locator("#exec-side").innerText()).includes("Missions en retard"), "la carte se met à jour");

    console.log("▶ Sans connecteur (fonctions SQL absentes) : aucune carte, aucune erreur");
    const p2 = await newPage(browser, { w: 1440, h: 900 });
    await openOffice(p2.page, port);
    await p2.page.locator("#tabs [data-id=exec]").click(); await p2.page.waitForSelector("#exec-side");
    ok(!(await p2.page.locator("#exec-side").innerText()).includes("Activité commerciale") && p2.errors.length === 0, "carte CRM absente et aucune erreur lorsque le connecteur n'est pas installé");
    ok(errors.length === 0, `aucune erreur console (${errors.join(" | ")})`);
    console.log("\nCRM × BUREAU : TOUT EST OK");
  } catch (e) { console.error("\n" + e.message); process.exitCode = 1; }
  await browser.close(); server.close();
})();
