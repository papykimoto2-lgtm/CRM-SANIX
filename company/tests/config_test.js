// Paramétrage (direction) : logiciels, équipes, agents et rôles modifiables depuis l'interface, sans code. node config_test.js
// Vrai navigateur et vraie interface ; le client Supabase est le faux du harnais, complété pour les tables et fonctions d'administration (journal des appels vérifié).
const { launch, newPage, ok } = require("./harness.js");
const tab = async (page, id) => { await page.click(`#tabs button[data-id=${id}]`); await page.waitForTimeout(300); };

(async () => {
  const { server, browser } = await launch(4176);
  try {
    const { page, errors } = await newPage(browser);
    await page.goto("http://localhost:4176/company/");
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForTimeout(800);

    // tables et fonctions d'administration simulées (le reste de l'application garde son faux client)
    await page.evaluate(async () => {
      const { S } = await import("/company/state.js");
      const actifs = S.agents.filter((a) => a.etat !== "archive"), real = S.sb, hunter = actifs.find((a) => a.niveau === 5), chef = actifs.find((a) => a.niveau === 4);
      window.__IDS = { hunter: hunter.id, chef: chef.id, hunterNom: hunter.nom };
      const DB = {
        ai_products: [
          { id: "immosuite", nom: "ImmoSuite ERP", marche_cible: "Promoteurs et aménageurs", secteurs: ["immobilier"], mots_cles: ["lot"], fonctionnalites: ["Programmes"], questions_decouverte: [], argumentaire: "", actif: true },
          { id: "aluexpert", nom: "Sanix AluExpert", marche_cible: "Menuiseries aluminium", secteurs: ["aluminium"], mots_cles: [], fonctionnalites: [], questions_decouverte: [], argumentaire: "", actif: true },
          { id: "inactif", nom: "Logiciel <img src=x onerror=window.__XSS=1>", marche_cible: "Test", secteurs: [], mots_cles: [], fonctionnalites: [], questions_decouverte: [], argumentaire: "", actif: false },
        ],
        ai_pricing: [{ product_id: "immosuite", actif: true }],
        ai_product_aliases: [{ alias: "immosuite erp", product_id: "immosuite" }],
        ai_roles: [
          { code: "lead_hunter", libelle: "Lead Hunter", description: "Cherche des prospects", niveau: 5, departement_id: "commercial", outils: ["recherche_web", "create_prospect"], effort: "medium", actif: true },
          { code: "qualification", libelle: "Qualification", description: "Note les prospects", niveau: 5, departement_id: "commercial", outils: ["update_prospect"], effort: "medium", actif: true },
        ],
        ai_cells: [{ id: "immosuite", nom: "Cellule ImmoSuite", product_id: "immosuite", responsable_agent_id: null, actif: true }],
        ai_cell_members: [],
        ai_segment_rules: [{ id: 1, priorite: 10, champ: "secteur", motif: "immobilier|foncier", segment: "immosuite", actif: true, note: "Secteur immobilier" },
                           { id: 2, priorite: 20, champ: "entreprise", motif: "\\malu|menuiser", segment: "aluexpert", actif: true, note: null }],
        ai_pilote_entonnoir: [
          { segment: "immosuite", prospects: 95, dans_le_pilote: 20, qualifies: 0, prioritaires: 0, contactes: 0, reponses: 0, rendez_vous: 0, demonstrations: 0, offres: 0, ca_ht_crm: 7627119, cout_ia_usd: 0 },
          { segment: "a_verifier", prospects: 103, dans_le_pilote: 0, qualifies: 0, prioritaires: 0, contactes: 0, reponses: 0, rendez_vous: 0, demonstrations: 0, offres: 0, ca_ht_crm: 0, cout_ia_usd: 0 },
          { segment: "hors_perimetre", prospects: 197, dans_le_pilote: 0, qualifies: 0, prioritaires: 0, contactes: 0, reponses: 0, rendez_vous: 0, demonstrations: 0, offres: 0, ca_ht_crm: 0, cout_ia_usd: 0 }],
        ai_pilote: [{ prospect_id: "11111111-1111-1111-1111-111111111111", product_id: "immosuite", raison: "Sélection automatique : e-mail et téléphone", ai_prospects: { entreprise: "Promoteur <b>Test</b>", secteur: "Immobilier", telephone: "+2250700000001", email: "a@b.ci" } }],
      };
      window.__DB = DB; window.__RPC = [];
      const builder = (t) => { const api = { select: () => api, order: () => api, then: (res, rej) => Promise.resolve({ data: DB[t], error: null }).then(res, rej) }; return api; };
      const apply = (n, a) => {
        if (n === "ai_cfg_save_product") { const p = DB.ai_products.find((x) => x.id === a.p_id); if (p) Object.assign(p, a.p); else DB.ai_products.push({ id: a.p_id, actif: false, ...a.p }); }
        if (n === "ai_cfg_set_member") { DB.ai_cell_members = DB.ai_cell_members.filter((m) => !(m.cell_id === a.p_cell && m.role_code === a.p_role && m.agent_id === a.p_agent)); if (a.p_on) DB.ai_cell_members.push({ cell_id: a.p_cell, role_code: a.p_role, agent_id: a.p_agent, ordre: 0 }); }
        if (n === "ai_segmenter_prospects") return a.p_appliquer ? { applique: true, fiches_modifiees: 14, segments_calcules: { immosuite: 95 } } : { applique: false, segments_calcules: { immosuite: 95, aluexpert: 108, a_verifier: 103, hors_perimetre: 198 }, deja_travailles: 0, choix_manuels: 0 };
        if (n === "ai_choisir_pilote") return { immosuite: { quota: a.p_quotas.immosuite, ajoutes: 20, manque: 0 }, aluexpert: { quota: 20, ajoutes: 20, manque: 0 }, avicosuite: { quota: 10, ajoutes: 1, manque: 9 } };
        if (n === "ai_cfg_save_segment_rule" && a.p.id) { const r = DB.ai_segment_rules.find((x) => x.id === a.p.id); if (r) Object.assign(r, a.p); }
        return { ok: true };
      };
      S.sb = new Proxy(real, { get(t, k) {
        if (k === "from") return (tb) => (DB[tb] ? builder(tb) : t.from(tb));
        if (k === "rpc") return (n, a) => { if (n.startsWith("ai_cfg_") || ["ai_segmenter_prospects", "ai_choisir_pilote"].includes(n)) { window.__RPC.push({ n, a }); return Promise.resolve({ data: apply(n, a), error: null }); } return t.rpc(n, a); };
        const v = Reflect.get(t, k); return typeof v === "function" ? v.bind(t) : v;
      } });
    });
    const rpcs = () => page.evaluate(() => window.__RPC);
    const body = async () => (await page.locator("#main").innerText()).replace(/[\u202f\u00a0]/g, " ");

    console.log("▶ Onglet Paramétrage (direction)");
    ok(await page.locator("#tabs button[data-id=cfg]").count() === 1, "onglet « Paramétrage » visible pour la direction");
    await tab(page, "cfg");
    ok((await body()).includes("Logiciels vendus, équipes, agents et rôles"), "écran Paramétrage ouvert");

    console.log("▶ Logiciels");
    ok((await body()).includes("ImmoSuite ERP") && (await body()).includes("Sanix AluExpert") && (await body()).includes("⚠️ aucune grille"), "catalogue affiché, grille tarifaire absente signalée");
    ok(await page.evaluate(() => window.__XSS === undefined), "nom de logiciel malveillant : échappé, rien d'exécuté");
    await page.click('button[data-act="cfg-product-toggle"][data-id="aluexpert"]'); await page.waitForTimeout(300);
    let r = (await rpcs()).at(-1);
    ok(r.n === "ai_cfg_save_product" && r.a.p_id === "aluexpert" && r.a.p.actif === false, "désactiver un logiciel : fonction d'administration appelée");
    ok(await page.locator("tr", { hasText: "Sanix AluExpert" }).innerText().then((t) => t.includes("Inactif")), "l'écran reflète le nouvel état");
    await page.click('button[data-act="cfg-product-edit"][data-id="immosuite"]'); await page.waitForTimeout(200);
    await page.fill('#cfg-form [name=marche_cible]', "Promoteurs, aménageurs et syndics"); await page.fill('#cfg-form [name=aliases]', "ImmoSuite ERP, Immo Suite");
    await page.click('#cfg-form button[type=submit]'); await page.waitForTimeout(500);
    const calls = await rpcs();
    ok(calls.some((c) => c.n === "ai_cfg_save_product" && c.a.p.marche_cible === "Promoteurs, aménageurs et syndics"), "modification du logiciel enregistrée");
    ok(calls.some((c) => c.n === "ai_cfg_set_alias" && c.a.p_alias === "immo suite" && c.a.p_on === true) && !calls.some((c) => c.n === "ai_cfg_set_alias" && c.a.p_alias === "immosuite erp"), "équivalence de nom ajoutée, celle déjà présente laissée intacte");
    await page.click('button[data-act="cfg-product-new"]'); await page.waitForTimeout(200);
    await page.fill('#cfg-form [name=id]', "monlogiciel"); await page.fill('#cfg-form [name=nom]', "Mon Logiciel"); await page.fill('#cfg-form [name=marche_cible]', "PME");
    await page.click('#cfg-form button[type=submit]'); await page.waitForTimeout(500);
    ok((await body()).includes("Mon Logiciel") && (await body()).match(/Mon Logiciel[\s\S]*Inactif/), "nouveau logiciel ajouté (inactif tant qu'il n'est pas activé)");

    console.log("▶ Équipes");
    await page.click('button[data-act="cfg-sec"][data-sec="equipes"]'); await page.waitForTimeout(250);
    ok((await body()).includes("Cellule ImmoSuite") && (await body()).includes("poste vacant"), "cellule affichée, postes vacants signalés");
    const ids = await page.evaluate(() => window.__IDS);
    await page.selectOption('select[data-act-change="cfg-member-add"][data-role="lead_hunter"]', ids.hunter); await page.waitForTimeout(400);
    r = (await rpcs()).at(-1);
    ok(r.n === "ai_cfg_set_member" && r.a.p_cell === "immosuite" && r.a.p_role === "lead_hunter" && r.a.p_agent === ids.hunter && r.a.p_on === true, "agent affecté à un rôle de la cellule");
    ok((await body()).includes(ids.hunterNom), "le membre apparaît dans la cellule");
    await page.click(`button[data-act="cfg-member-del"][data-role="lead_hunter"]`); await page.waitForTimeout(400);
    r = (await rpcs()).at(-1);
    ok(r.n === "ai_cfg_set_member" && r.a.p_on === false, "agent retiré de la cellule");
    await page.selectOption('select[data-act-change="cfg-cell-resp"]', ids.chef); await page.waitForTimeout(300);
    r = (await rpcs()).at(-1);
    ok(r.n === "ai_cfg_save_cell" && r.a.p.id === "immosuite" && r.a.p.responsable_agent_id === ids.chef, "responsable de la cellule modifié");

    console.log("▶ Agents et rôles");
    await page.click('button[data-act="cfg-sec"][data-sec="agents"]'); await page.waitForTimeout(250);
    await page.click('button[data-act="cfg-agent-new"]'); await page.waitForTimeout(200);
    await page.selectOption('#cfg-role', "lead_hunter"); await page.waitForTimeout(150);
    ok(await page.inputValue('#cfg-form [name=fonction]') === "Lead Hunter" && (await page.inputValue('#cfg-form [name=outils]')).includes("recherche_web"), "le rôle pré-remplit la fonction et les outils");
    await page.fill('#cfg-form [name=nom]', "Chasseur Alu"); await page.selectOption('#cfg-form [name=manager_id]', ids.chef); await page.selectOption('#cfg-form [name=cell_id]', "immosuite");
    await page.click('#cfg-form button[type=submit]'); await page.waitForTimeout(500);
    r = (await rpcs()).at(-1);
    ok(r.n === "ai_cfg_create_agent" && r.a.p.role_code === "lead_hunter" && r.a.p.nom === "Chasseur Alu" && r.a.p.manager_id === ids.chef && r.a.p.cell_id === "immosuite" && r.a.p.outils.includes("create_prospect"), "création d'un agent depuis un rôle");
    await page.click('button[data-act="cfg-sec"][data-sec="roles"]'); await page.waitForTimeout(250);
    ok((await body()).includes("Lead Hunter") && (await body()).includes("Qualification"), "rôles affichés");
    await page.click('button[data-act="cfg-role-edit"][data-id="qualification"]'); await page.waitForTimeout(200);
    await page.fill('#cfg-form [name=outils]', "update_prospect, set_stage, get_prospect"); await page.click('#cfg-form button[type=submit]'); await page.waitForTimeout(400);
    r = (await rpcs()).at(-1);
    ok(r.n === "ai_cfg_save_role" && r.a.p.code === "qualification" && r.a.p.outils.length === 3, "modèle de poste modifié");
    console.log("▶ Pilote : segmentation, sélection, entonnoir");
    await page.evaluate(() => { window.confirm = () => true; });
    await page.click('button[data-act="cfg-sec"][data-sec="pilote"]'); await page.waitForTimeout(300);
    ok((await body()).includes("Entonnoir par logiciel") && (await body()).includes("ImmoSuite ERP") && (await body()).includes("Hors périmètre commercial actuel") && (await body()).includes("À vérifier"), "entonnoir par segment : logiciels, à vérifier, hors périmètre");
    ok((await body()).includes("7 627 119"), "ventes du CRM (HT) rapprochées par logiciel");
    ok(await page.evaluate(() => window.__XSS === undefined) && !(await page.locator("#main b", { hasText: "Test" }).count()), "nom de prospect : échappé");
    ok((await body()).includes("immobilier|foncier") && (await body()).includes("Règles de segmentation"), "règles de segmentation affichées");
    await page.click('button[data-act="cfg-seg-preview"]'); await page.waitForTimeout(300);
    r = (await rpcs()).at(-1);
    ok(r.n === "ai_segmenter_prospects" && r.a.p_appliquer === false && (await body()).includes("rien n'est enregistré"), "aperçu : fonction appelée sans écriture, répartition affichée");
    await page.click('button[data-act="cfg-seg-apply"]'); await page.waitForTimeout(400);
    r = (await rpcs()).filter((c) => c.n === "ai_segmenter_prospects").at(-1);
    ok(r.a.p_appliquer === true, "application de la segmentation demandée après confirmation");
    await page.click('button[data-act="cfg-rule-toggle"][data-id="2"]'); await page.waitForTimeout(300);
    r = (await rpcs()).at(-1);
    ok(r.n === "ai_cfg_save_segment_rule" && r.a.p.id === 2 && r.a.p.actif === false, "règle désactivée sans toucher au code");
    await page.click('button[data-act="cfg-rule-new"]'); await page.waitForTimeout(200);
    await page.fill('#cfg-form [name=motif]', "poulet|ferme"); await page.selectOption('#cfg-form [name=segment]', "immosuite"); await page.fill('#cfg-form [name=priorite]', "12");
    await page.click('#cfg-form button[type=submit]'); await page.waitForTimeout(400);
    r = (await rpcs()).at(-1);
    ok(r.n === "ai_cfg_save_segment_rule" && r.a.p.motif === "poulet|ferme" && r.a.p.priorite === 12 && r.a.p.champ === "entreprise", "nouvelle règle enregistrée");
    await page.fill('#cfg-pilote-form [name=q_immosuite]', "20"); await page.click('#cfg-pilote-form button[type=submit]'); await page.waitForTimeout(400);
    r = (await rpcs()).filter((c) => c.n === "ai_choisir_pilote").at(-1);
    ok(r.a.p_quotas.immosuite === 20 && !("aluexpert" in r.a.p_quotas), "sélection du pilote : quotas des seuls logiciels ACTIFS (AluExpert a été désactivé plus haut)");
    await page.click('button[data-act="cfg-pilote-del"]'); await page.waitForTimeout(300);
    r = (await rpcs()).at(-1);
    ok(r.n === "ai_cfg_pilote_set" && r.a.p_on === false, "retrait d'un prospect du pilote");
    ok(errors.filter((e) => !/Failed to load resource|favicon/.test(e)).length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.slice(0, 3).join(" | ") : ""));
    console.log("\nParamétrage : TOUT EST OK");
  } finally { await browser.close(); server.close && server.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
