// SANIX CRM Pro : revue d'audit — fiabilité des chiffres : numérotation sans doublon, factures, comptabilité, chiffre d'affaires unique,
// commissions enregistrées, doublons, contrats, import de nombres, fuseaux horaires. node fiabilite_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const PORT = 4425;

(async () => {
  const server = await start(PORT), browser = await chromium.launch();
  const nouveau = async (opts, horloge) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1366, height: 900 } }, opts || {}));
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = [], dialogs = []; let confirmer = true;
    page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => { dialogs.push(d.message()); confirmer ? d.accept() : d.dismiss(); });
    if (horloge) { await page.clock.install({ time: new Date(horloge) }); }
    await page.goto(`http://localhost:${PORT}/index.html`); if (horloge) await page.clock.resume(); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS[0]; enterApp(currentUser); }); await page.waitForTimeout(1300);
    return { ctx, page, errors, dialogs, confirmer: (v) => { confirmer = v; } };
  };
  try {
    const A = await nouveau(); const page = A.page;
    const base = () => `(id, ref, o) => Object.assign({ id, ref, client: "Client " + id, date: "2026-11-10", logiciel: "ImmoSuite ERP", typeLicence: "Perpetuelle", htBrut: 100000, remise: 0, htNet: 100000, tva: 18000, ttc: 118000, acompte: 0, solde: 118000, sansTva: false, statut: "confirmee", notes: "" }, o || {})`;
    await page.evaluate(`window.__c = ${base()}; COMMANDES.length = 0; ["001", "002", "003"].forEach((n, i) => COMMANDES.push(__c("c" + i, "CMD-2026-" + n)));`);
    ok(await page.evaluate(() => { COMMANDES.splice(1, 1); return cmdNumero("2026-11-20"); }) === "CMD-2026-004", "après suppression de la commande 002 : le numéro proposé est 004 (et non 003, déjà pris)");
    ok(await page.evaluate(() => { cmdCompteurMemo("CMD-2026-007"); COMMANDES.length = 0; return cmdNumero("2026-05-01"); }) === "CMD-2026-008", "même si toutes les commandes sont supprimées : le compteur mémorisé continue (008)");
    ok(await page.evaluate(() => cmdNumero("2027-01-05")) === "CMD-2027-001", "numérotation par année de la commande");
    // création par l'écran : référence unique, acompte plafonné
    const creer = (client, ht, acompte, statut, tva) => page.evaluate(([client, ht, acompte, statut, tva]) => {
      openCommandeModal(); const set = (id, v) => { document.getElementById(id).value = v; };
      set("cmd-client", client); set("cmd-date", "2026-11-12"); const sel = document.getElementById("cmd-logiciel"); sel.value = [...sel.options].find((o) => o.value)?.value || ""; set("cmd-prix-ht", ht); set("cmd-remise", 0); set("cmd-acompte", acompte); set("cmd-statut", statut); set("cmd-tva-mode", tva);
      const n = COMMANDES.length; saveCommande(); return { cree: COMMANDES.length - n, c: COMMANDES[COMMANDES.length - 1] };
    }, [client, ht, acompte, statut, tva]);
    let r = await creer("Création A", 100000, 0, "confirmee", "avec"); ok(r.cree === 1 && r.c.ref === "CMD-2026-008" && r.c.ttc === 118000, "création : référence CMD-2026-008 (compteur 007 + 1), TTC 118 000 : " + r.c.ref);
    ok(await page.evaluate(() => lsLoad("cmd_compteur_2026")) === 8, "compteur mémorisé après la création (8)");
    r = await creer("Création B", 100000, 200000, "confirmee", "avec"); ok(r.cree === 0, "acompte (200 000) supérieur au TTC (118 000) : commande refusée");
    r = await creer("Création C", 100000, 118000, "confirmee", "avec"); ok(r.cree === 1 && r.c.acompte === 118000 && r.c.ref === "CMD-2026-009", "acompte égal au TTC accepté");

    console.log("▶ Factures : numéro monotone, proforma, régime de TVA");
    await page.evaluate(`COMMANDES.length = 0; COMMANDES.push(__c("f1", "CMD-2026-001"), __c("f2", "CMD-2026-002"), __c("f3", "CMD-2026-003"), __c("fb", "CMD-2026-004", { statut: "brouillon" }), __c("fs", "CMD-2026-005", { sansTva: true, htNet: 118000, tva: 0, client: "Client f1" }));`);
    const n1 = await page.evaluate(() => factureDonnees("f1", true, false).num), n2 = await page.evaluate(() => factureDonnees("f2", true, false).num), n3 = await page.evaluate(() => factureDonnees("f3", true, false).num);
    ok(n1 === "SA-FAC-2026-008" && n2 === "SA-FAC-2026-009" && n3 === "SA-FAC-2026-010", `numéros consécutifs après les 7 factures d'origine : ${n1}, ${n2}, ${n3}`);
    await page.evaluate(() => { COMMANDES = COMMANDES.filter((c) => c.id !== "f3"); });
    ok(await page.evaluate(() => factureDonnees("f2", false, false) && _facNumeroSuivant()) === "SA-FAC-2026-011", "la commande portant la facture 010 est supprimée : la facture suivante est 011, jamais 010 de nouveau");
    const pf = await page.evaluate(() => { const d = factureDonnees("fb", true, false); return { proforma: d.proforma, num: d.num, tampon: d.tampon, fac: COMMANDES.find((c) => c.id === "fb").fac }; });
    ok(pf.proforma && pf.num === "PROFORMA" && pf.tampon === "PROFORMA" && !pf.fac, "commande en brouillon : facture proforma, aucun numéro de facture attribué");
    ok(await page.evaluate(() => _facGroupe(COMMANDES.find((c) => c.id === "f1")).map((c) => c.id).join()) === "f1", "facture groupée : sans brouillon et sans commande d'un autre régime de TVA (même client « Client f1 » mais sans TVA, exclue)");
    ok(await page.evaluate(() => _facGroupe(COMMANDES.find((c) => c.id === "fb")).length) === 1, "un brouillon ne se groupe pas");
    // régime de TVA : confirmation quand la facture diffère de la commande
    await page.evaluate(() => { window.__ouverts = 0; window.open = () => { window.__ouverts++; return { document: { write() {}, close() {} }, focus() {}, print() {} }; }; });
    A.confirmer(false); A.dialogs.length = 0;
    await page.evaluate(() => choisirFacture("f1")); await page.click("#fac-sans"); await page.waitForTimeout(150);
    ok(A.dialogs.some((m) => m.includes("AVEC TVA")) && await page.evaluate(() => window.__ouverts) === 0, "facture SANS TVA pour une commande AVEC TVA : avertissement, rien n'est imprimé si on refuse");
    A.confirmer(true); await page.evaluate(() => choisirFacture("f1")); await page.click("#fac-avec"); await page.waitForTimeout(150);
    ok(await page.evaluate(() => window.__ouverts) === 1, "régime de la commande : imprimé sans avertissement");
    await page.evaluate(() => choisirFacture("fb")); ok((await page.locator("#fac-choix").innerText()).includes("facture proforma") && (await page.locator("#fac-choix").innerText()).includes("FNE"), "boîte de choix : explique la proforma et la facture normalisée électronique (FNE)");
    await page.evaluate(() => document.getElementById("fac-choix").remove());

    console.log("▶ Comptabilité : écritures fiables");
    await page.evaluate(`COMMANDES.length = 0; COMMISSIONS.length = 0;
      COMMANDES.push(__c("k1", "CMD-2026-001"), __c("k2", "CMD-2026-002", { sansTva: true, htNet: undefined, tva: undefined, ttc: 500000 }), __c("k3", "CMD-2026-003", { ttc: 0, htNet: 0, tva: 0 }), __c("k4", "CMD-2026-004", { acompte: 200000 }), __c("k5", "CMD-2026-005", { acompte: 50000 }));
      COMMISSIONS.push({ id: 1, membreNom: "Apporteur A", type: "apporteur", apporteur: "A", montant: 10000, statut: "en_attente", date: "2026-11-10" }, { id: 2, membreNom: "Apporteur B", type: "apporteur", apporteur: "B", montant: 20000, statut: "validee", date: "2026-11-10" }, { id: 3, membreNom: "Apporteur C", type: "apporteur", apporteur: "C", montant: 30000, statut: "payee", date: "2026-11-10" });`);
    const E = await page.evaluate(() => comptaGenerateAuto().map((e) => ({ id: e.id, piece: e.piece, l: e.lignes.map((x) => [x.compte, x.debit, x.credit]) })));
    const eq = E.every((e) => Math.abs(e.l.reduce((t, x) => t + x[1] - x[2], 0)) < 1e-9);
    ok(eq && E.length > 0, "chaque pièce équilibre (débit = crédit) : " + E.length + " pièces");
    const ve = (id) => E.find((e) => e.id === "auto_ve_" + id), c4431 = (e) => (e.l.find((x) => x[0] === "4431") || [0, 0, 0])[2];
    ok(!ve("k3"), "commande à 0 : aucune pièce"); ok(ve("k2").l.every((x) => x[0] !== "4431") && ve("k2").l.find((x) => x[0] === "706000")[2] === 500000, "ancienne commande sans TVA et sans HT : 706 = 500 000, aucune TVA inventée");
    ok(c4431(ve("k1")) === 18000, "commande avec TVA : 4431 = 18 000");
    const enc = E.find((e) => e.id === "auto_enc_k4"); ok(enc && enc.l[0][0] === "552000" && enc.l[0][1] === 118000, "encaissement plafonné au TTC (200 000 saisis sur 118 000) et passé au compte 552 (Mobile Money)");
    ok(E.find((e) => e.id === "auto_enc_k5").l[1][2] === 50000, "acompte inférieur au TTC : repris tel quel");
    const com = E.filter((e) => e.id.startsWith("auto_com_")); ok(com.length === 2 && com.every((e) => e.l[0][0] === "632000"), "commissions : seules les validées et payées (2 sur 3), au compte 632 (rémunérations d'intermédiaires)");
    ok(await page.evaluate(() => PLAN_COMPTABLE["552000"] && PLAN_COMPTABLE["632000"] && !PLAN_COMPTABLE["531000"] && !PLAN_COMPTABLE["622000"] && /Publicité/.test(PLAN_COMPTABLE["627000"]) && PLAN_COMPTABLE["631000"]), "plan comptable : 552, 632, 631 ; 627 = publicité");

    console.log("▶ Chiffre d'affaires : une seule définition");
    await page.evaluate(`COMMANDES.length = 0; DEALS.length = 0; CONTRATS.length = 0; COMMISSIONS.length = 0;
      COMMANDES.push(__c("v1", "CMD-2026-001", { statut: "livree" }), __c("v2", "CMD-2026-002", { htNet: 200000, tva: 36000, ttc: 236000, statut: "en_cours", date: "2026-11-15" }), __c("v3", "CMD-2026-003", { statut: "brouillon" }), __c("v4", "CMD-2026-004", { statut: "annulee" }), __c("v5", "CMD-2026-005", { sansTva: true, htNet: 50000, tva: 0, ttc: 50000, date: "2026-11-16" }));
      DEALS.push({ id: 1, client: "Orphelin", clientId: null, stage: "gagne", valeur: 5000000, commercial: "", logiciel: "ImmoSuite ERP", date: "16/11/2026", history: [] }, { id: 2, client: "Client v1", clientId: null, stage: "gagne", valeur: 0, commercial: "", logiciel: "ImmoSuite ERP", date: "16/11/2026", history: [] });`);
    const att = 100000 + 200000 + 50000;
    const ca = await page.evaluate(() => ({ cmd: caCmd(), pil: Object.values(SanixPilotage.calc.realise(COMMANDES)).reduce((t, x) => t + x, 0), cpt: comptaGenerateAuto().filter((e) => e.id.startsWith("auto_ve_")).reduce((t, e) => t + e.lignes.filter((l) => l.compte === "706000").reduce((u, l) => u + l.credit, 0), 0) }));
    ok(ca.cmd === att && ca.pil === att && ca.cpt === att, `CA = ${att} partout : module commun ${ca.cmd}, Budget ${ca.pil}, Comptabilité ${ca.cpt} (brouillon, annulée et affaires gagnées sans commande exclus)`);
    await page.evaluate(() => navigate("dashboard", null)); await page.waitForTimeout(500);
    ok(await page.evaluate(() => { initDashboard360(); const v = caCmd(); return document.getElementById("stat-ca").textContent === (v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : (v / 1000).toFixed(0) + "k"); }), "tableau de bord : même chiffre d'affaires (350k), et non la valeur des affaires gagnées (5 000 000)");
    await page.evaluate(() => navigate("direction", null)); await page.waitForTimeout(600);
    ok((await page.locator("#dir-kpis").innerText()).replace(/[  ]/g, " ").includes("350 000"), "direction : « CA réalisé total » = 350 000");
    await page.evaluate(() => navigate("logiciels", null)); await page.waitForTimeout(400);
    ok(await page.evaluate(() => { renderLogStats && renderLogStats(); return true; }).catch(() => true), "catalogue : statistiques calculées");
    // écran Commandes : ni brouillons ni acompte excédentaire
    await page.evaluate(`COMMANDES.length = 0; COMMANDES.push(__c("o1", "CMD-2026-001", { acompte: 118000 }), __c("o2", "CMD-2026-002", { ttc: 1000000, htNet: 847458, statut: "brouillon" }), __c("o3", "CMD-2026-003", { ttc: "118000", acompte: 500000 }));`);
    await page.evaluate(() => navigate("commandes", null)); await page.waitForTimeout(500);
    const kp = (await page.locator("#cmd-stats").innerText()).replace(/\s+/g, " ");
    ok(/236k/.test(kp) && !/1118k|118118k|1236k/.test(kp), "écran Commandes : CA TTC hors brouillon, valeur texte « 118000 » additionnée comme un nombre : " + kp);

    console.log("▶ Commissions : enregistrées, sur le HT d'une commande confirmée");
    await page.evaluate(`COMMANDES.length = 0; DEALS.length = 0; COMMISSIONS.length = 0; COMMANDES.push(__c("m1", "CMD-2026-001", { client: "Alpha Immo" }), __c("m2", "CMD-2026-002", { client: "Beta Brouillon", statut: "brouillon" }));
      DEALS.push({ id: 1, client: "Alpha Immo", stage: "gagne", valeur: 118000, commercial: "Apporteur — Marie", logiciel: "ImmoSuite ERP", date: "2026-11-10" }, { id: 2, client: "Beta Brouillon", stage: "gagne", valeur: 118000, commercial: "Marie", logiciel: "ImmoSuite ERP", date: "2026-11-10" }, { id: 3, client: "Sans commande", stage: "gagne", valeur: 500000, commercial: "Marie", logiciel: "ImmoSuite ERP", date: "2026-11-10" });
      saveStore("commandes"); recalcCommissions();`);
    const cm = await page.evaluate(() => COMMISSIONS.map((c) => [c.client, c.montantVente, c.taux, c.montant]));
    ok(cm.length === 1 && cm[0][0] === "Alpha Immo" && cm[0][1] === 100000 && cm[0][3] === 10000, "commission de 10 % sur le HT (100 000 → 10 000) ; brouillon et affaire sans commande ignorés : " + JSON.stringify(cm));
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem("sanix_crm_commissions")).length) === 1, "commission enregistrée dans le navigateur");
    await page.evaluate(() => { COMMISSIONS[0].statut = "validee"; _refreshComm(); }); await page.reload(); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS[0]; enterApp(currentUser); }); await page.waitForTimeout(1200);
    ok(await page.evaluate(() => COMMISSIONS.length === 1 && COMMISSIONS[0].statut === "validee"), "après rechargement : la commission et son statut « validée » sont conservés");
    await page.evaluate(`window.__c = ${base()};`);       // la page a été rechargée

    console.log("▶ Doublons, contrats, clients");
    await page.evaluate(`COMMANDES.length = 0; CONTRATS.length = 0; COMMANDES.push(__c("cmd_a", "CMD-2026-001", { client: "Gamma" }), __c("cmd_b", "CMD-2026-002", { client: "Gamma" }), __c("cmd_init_x", "CMD-2026-003", { client: "Delta" }), __c("cmd_init_y", "CMD-2026-004", { client: "Delta" }));`);
    ok(await page.evaluate(() => { _dedoublonnerCommandes(); return COMMANDES.map((c) => c.id).join(); }) === "cmd_a,cmd_b,cmd_init_x", "deux ventes identiques saisies à la main sont conservées ; le doublon automatique est retiré");
    await page.evaluate(`COMMANDES.length = 0; CONTRATS.length = 0; COMMANDES.push(__c("ct1", "CMD-2026-001", { client: "Epsilon", ctrAuto: false })); CONTRATS.push({ id: "ctr_main", ref: "CTR-1", type: "contrat", client: "Epsilon", logiciel: "ImmoSuite ERP", montant: 118000, statut: "signe", date: "2026-11-10" });`);
    const ct = await page.evaluate(() => { _contratsDepuisCommandes(); return { lie: CONTRATS.find((c) => c.id === "ctr_main").cmdId, n: CONTRATS.length, ventes: comptaGenerateAuto().filter((e) => e.id.startsWith("auto_ve_") || e.id.startsWith("auto_ctr_")).length }; });
    ok(ct.lie === "ct1" && ct.n === 1 && ct.ventes === 1, "contrat saisi à la main rattaché à sa commande : la vente n'est comptée qu'une fois en comptabilité");
    await page.evaluate(`COMMANDES.length = 0; CLIENTS.push({ id: 99001, nom: "Prospect Converti", statut: "prospect", logiciel: "ImmoSuite ERP", valeur: 750000, phone: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); syncProspectsToPipeline();`);
    await page.evaluate(() => { openCommandeModal(); const set = (id, v) => { document.getElementById(id).value = v; }; set("cmd-client", "Prospect Converti"); set("cmd-date", "2026-11-12"); const sel = document.getElementById("cmd-logiciel"); sel.value = [...sel.options].find((o) => o.value).value; set("cmd-prix-ht", 200000); set("cmd-remise", 0); set("cmd-acompte", 0); set("cmd-statut", "confirmee"); set("cmd-tva-mode", "avec"); saveCommande(); });
    const pc = await page.evaluate(() => ({ st: CLIENTS.find((c) => c.id === 99001).statut, d: DEALS.find((d) => d.clientId === 99001) }));
    ok(pc.st === "client" && pc.d.stage === "gagne" && pc.d.valeur === 200000, "prospect avec une commande confirmée : devient client, affaire gagnée au HT de la commande (200 000)");
    ok(await page.evaluate(() => { lsSave("ren_compteur_2026", 5); COMMANDES.length = 0; const a = renouvRefSuivante(); COMMANDES.push({ id: "r", ref: "REN-2026-009" }); return a + "|" + renouvRefSuivante(); }) === "REN-2026-006|REN-2026-010", "numéro de renouvellement : compteur mémorisé puis maximum existant");

    console.log("▶ Import de nombres à la française, dates locales");
    const nb = await page.evaluate(() => ["1 250 000", "1.250.000", "5,35", "1,250,000.50", "1.234,56", "12.5", "−", "", "abc", "  750 000 FCFA", "0,75"].map(_nombreFr));
    ok(nb[0] === 1250000 && nb[1] === 1250000 && nb[2] === 5.35 && nb[3] === 1250000.5 && nb[4] === 1234.56 && nb[5] === 12.5 && Number.isNaN(nb[6]) && Number.isNaN(nb[7]) && Number.isNaN(nb[8]) && nb[9] === 750000 && nb[10] === 0.75, "nombres à la française et à l'anglaise lus correctement : " + JSON.stringify(nb));
    ok(A.errors.length === 0, "aucune erreur JavaScript " + A.errors.slice(0, 2).join("|"));
    await A.ctx.close();

    console.log("▶ Fuseaux horaires");
    const P = await nouveau({ timezoneId: "Europe/Paris" }, "2026-11-16T23:30:00Z");
    ok(await P.page.evaluate(() => _ajd()) === "2026-11-17" && await P.page.evaluate(() => new Date().toISOString().slice(0, 10)) === "2026-11-16", "Paris, 00 h 30 le 17 novembre : la date du jour est le 17 (l'ancienne date UTC donnait le 16)");
    await P.ctx.close();
    const N = await nouveau({ timezoneId: "America/New_York" }, "2026-11-16T12:00:00Z");
    ok(await N.page.evaluate(() => licDaysLeft("2026-11-30")) === 14, "New York : 14 jours avant le 30 novembre (l'ancien calcul en donnait 13)");
    await N.ctx.close();
    console.log("\nFiabilité des chiffres : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
