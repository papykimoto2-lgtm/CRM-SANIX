// SANIX CRM Pro : journal des paiements dans le CRM (saisie, modification, suppression, reçu, écritures par paiement, règlement en nature). node paiements_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };

(async () => {
  const server = await start(4426), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = [], dialogs = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await page.goto("http://localhost:4426/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS[0]; enterApp(currentUser); }); await page.waitForTimeout(1300);
    const toast = () => page.evaluate(() => { const l = [...document.body.children].filter((e) => e.tagName === "DIV" && e.style.position === "fixed" && e.style.zIndex === "9000"); return l.length ? l[l.length - 1].textContent : ""; });
    const imprimes = []; await page.exposeFunction("__capter", (h) => imprimes.push(h));
    await page.evaluate(() => { window.open = () => ({ document: { write: (h) => window.__capter(h), close() {} }, focus() {}, print() {} }); });

    console.log("▶ Anciennes commandes : l'acompte devient un paiement estimé");
    await page.evaluate(() => { COMMANDES.length = 0; COMMANDES.push({ id: "old1", ref: "CMD-2026-001", client: "Client Ancien", date: "2026-11-10", logiciel: "ImmoSuite ERP", typeLicence: "Perpetuelle", htBrut: 100000, remise: 0, htNet: 100000, tva: 18000, ttc: 118000, acompte: 50000, solde: 68000, sansTva: false, statut: "confirmee", notes: "" }); });
    ok(await page.evaluate(() => _paiementsMigrer()) === 1, "migration : 1 commande convertie");
    const m0 = await page.evaluate(() => COMMANDES[0].paiements);
    ok(m0.length === 1 && m0[0].montant === 50000 && m0[0].mode === "inconnu" && m0[0].date === "2026-11-10" && m0[0].estimee === true, "paiement unique : 50 000, mode non précisé, date de la vente, estimé");
    ok(await page.evaluate(() => _paiementsMigrer()) === 0, "migration idempotente");

    console.log("▶ Création d'une commande avec un acompte et son mode");
    await page.evaluate(() => navigate("commandes", null)); await page.waitForTimeout(400);
    await page.evaluate(() => { openCommandeModal(); const set = (id, v) => { document.getElementById(id).value = v; }; set("cmd-client", "Client Nouveau"); set("cmd-date", "2026-11-12"); const sel = document.getElementById("cmd-logiciel"); sel.value = [...sel.options].find((o) => o.value).value; set("cmd-prix-ht", 200000); set("cmd-remise", 0); set("cmd-acompte", 100000); set("cmd-acompte-mode", "virement"); set("cmd-statut", "confirmee"); set("cmd-tva-mode", "avec"); });
    ok(await page.locator("#cmd-acompte").isEditable() && await page.locator("#cmd-acompte-mode").isVisible() && (await page.locator("#cmd-acompte-lbl").innerText()).includes("Acompte reçu à la commande") && await page.locator("#cmd-paiements-box").isHidden(), "nouvelle commande : acompte + mode de règlement, pas de journal");
    await page.evaluate(() => saveCommande()); await page.waitForTimeout(200);
    const nv = await page.evaluate(() => COMMANDES.find((c) => c.client === "Client Nouveau"));
    ok(nv.ttc === 236000 && nv.acompte === 100000 && nv.solde === 136000 && nv.paiements.length === 1 && nv.paiements[0].mode === "virement" && nv.paiements[0].date === "2026-11-12" && nv.paiements[0].montant === 100000, "premier paiement créé : 100 000 par virement le 12/11, acompte et solde cohérents");

    console.log("▶ Journal dans la commande, paiement, refus");
    await page.evaluate((id) => editCommande(id), nv.id); await page.waitForTimeout(300);
    ok(await page.locator("#cmd-acompte").isEditable() === false && await page.locator("#cmd-acompte-mode").isHidden() && (await page.locator("#cmd-acompte-lbl").innerText()).includes("journal des paiements") && await page.locator("#cmd-paiements-box").isVisible(), "commande existante : total en lecture seule + journal des paiements");
    ok((await page.locator("#cmd-paiements-box").innerText()).includes("Virement bancaire") && (await page.locator("#cmd-paiements-box").innerText()).replace(/[  ]/g, " ").includes("100 000"), "le journal liste le paiement (mode, montant)");
    await page.click('#cmd-paiements-box button:has-text("Enregistrer un paiement")'); await page.waitForTimeout(200);
    ok(await page.locator("#pay-ov").count() === 1 && await page.locator("#pay-montant").inputValue() === "136000" && await page.locator("#pay-date").inputValue() === await page.evaluate(() => _ajd()), "fenêtre de paiement : montant proposé = reste dû (136 000), date du jour");
    await page.fill("#pay-montant", "200000"); await page.click("#pay-ok"); await page.waitForTimeout(150);
    ok(await page.locator("#pay-ov").count() === 1 && await page.evaluate((id) => COMMANDES.find((c) => c.id === id).acompte, nv.id) === 100000, "paiement supérieur au reste refusé : fenêtre ouverte, rien d'enregistré");
    await page.fill("#pay-montant", "30000"); await page.fill("#pay-date", "2099-01-01"); await page.click("#pay-ok"); await page.waitForTimeout(150);
    ok(await page.locator("#pay-ov").count() === 1 && await page.evaluate((id) => COMMANDES.find((c) => c.id === id).paiements.length, nv.id) === 1, "date future refusée");
    await page.fill("#pay-date", "2026-11-14"); await page.selectOption("#pay-mode", "especes"); await page.fill("#pay-ref", "RECU-7"); await page.click("#pay-ok"); await page.waitForTimeout(300);
    const c1 = await page.evaluate((id) => COMMANDES.find((c) => c.id === id), nv.id);
    ok(c1.acompte === 130000 && c1.solde === 106000 && c1.paiements.length === 2 && c1.paiements[1].mode === "especes" && c1.paiements[1].date === "2026-11-14" && c1.paiements[1].ref === "RECU-7", "30 000 en espèces le 14/11 : acompte 130 000, solde 106 000");
    ok(await page.locator("#cmd-acompte").inputValue() === "130000" && (await page.locator("#cmd-paiements-box").innerText()).includes("RECU-7") && (await page.locator("#cmd-solde").inputValue()).replace(/[  ]/g, " ").includes("106 000"), "la fenêtre de commande se met à jour (total, solde, journal)");
    await page.evaluate(() => closeCommandeModal());

    console.log("▶ Liste des commandes");
    await page.evaluate(() => { initCommandes(); }); await page.waitForTimeout(200);
    const ligne = page.locator("#cmd-tbody tr", { hasText: "Client Nouveau" });
    ok((await ligne.innerText()).replace(/[  ]/g, " ").includes("130 000") && await ligne.locator('button[title="Enregistrer un paiement"]').count() === 1, "colonne « Versé » à jour et bouton 💶 présent (reste dû)");
    await page.evaluate((id) => { const c = COMMANDES.find((x) => x.id === id); SanixPaiements.ajouter(c, { date: "2026-11-15", montant: 106000, mode: "mobile_money" }, { today: "2026-11-16" }); initCommandes(); }, nv.id);
    ok(await page.locator("#cmd-tbody tr", { hasText: "Client Nouveau" }).locator('button[title="Enregistrer un paiement"]').count() === 0, "commande soldée : plus de bouton 💶");
    await page.evaluate((id) => openPaiement(id), nv.id); ok(!(await page.locator("#pay-ov").count()) && (await toast()).includes("déjà soldée"), "commande soldée : « déjà soldée »");
    await page.evaluate(() => { COMMANDES.push({ id: "br", ref: "CMD-2026-090", client: "Client Brouillon", date: "2026-11-10", logiciel: "ImmoSuite ERP", htNet: 100000, ttc: 118000, tva: 18000, acompte: 0, solde: 118000, statut: "brouillon", paiements: [] }); openPaiement("br"); });
    ok(!(await page.locator("#pay-ov").count()) && (await toast()).includes("brouillon"), "commande en brouillon : paiement refusé avec explication");

    console.log("▶ Modifier, préciser, supprimer");
    await page.evaluate(() => { openCommandeModal; }); await page.evaluate((id) => editCommande(id), "old1"); await page.waitForTimeout(300);
    ok((await page.locator("#cmd-paiements-box").innerText()).includes("date estimée"), "ancien acompte : badge « date estimée »");
    await page.click('#cmd-paiements-box button[title="Modifier"]'); await page.waitForTimeout(150);
    ok((await page.locator("#pay-ov").innerText()).includes("indiquez la vraie date"), "fenêtre de modification : demande de préciser la vraie date et le vrai mode");
    await page.fill("#pay-date", "2026-11-11"); await page.selectOption("#pay-mode", "mobile_money"); await page.fill("#pay-ref", "OM-998"); await page.click("#pay-ok"); await page.waitForTimeout(250);
    const old = await page.evaluate(() => COMMANDES.find((c) => c.id === "old1"));
    ok(old.paiements[0].date === "2026-11-11" && old.paiements[0].mode === "mobile_money" && !("estimee" in old.paiements[0]) && old.acompte === 50000 && !(await page.locator("#cmd-paiements-box").innerText()).includes("date estimée"), "ancien paiement précisé : date, mode, référence ; le badge disparaît");
    await page.click('#cmd-paiements-box button[title="Supprimer"]'); await page.waitForTimeout(250);
    ok(dialogs.some((d) => d.includes("Supprimer ce paiement de 50")) && await page.evaluate(() => COMMANDES.find((c) => c.id === "old1").acompte) === 0 && await page.evaluate(() => COMMANDES.find((c) => c.id === "old1").solde) === 118000, "suppression (avec confirmation) : acompte 0, solde 118 000");
    await page.evaluate(() => closeCommandeModal());

    console.log("▶ Comptabilité : une écriture par paiement, à sa date, selon le mode");
    await page.evaluate((id) => { COMMANDES.length = 0; COMMANDES.push({ id, ref: "CMD-2026-001", client: "Client Compta", date: "2026-11-10", logiciel: "ImmoSuite ERP", htNet: 100000, tva: 18000, ttc: 118000, acompte: 0, solde: 118000, sansTva: false, statut: "confirmee", paiements: [] }); const c = COMMANDES[0], T = { today: "2026-11-16" };
      SanixPaiements.ajouter(c, { date: "2026-11-11", montant: 40000, mode: "especes" }, T); SanixPaiements.ajouter(c, { date: "2026-11-13", montant: 30000, mode: "virement", ref: "VIR-1" }, T); SanixPaiements.ajouter(c, { date: "2026-11-15", montant: 28000, mode: "mobile_money" }, T); SanixPaiements.ajouter(c, { date: "2026-11-16", montant: 20000, mode: "nature" }, T); }, "cp1");
    const E = await page.evaluate(() => comptaGenerateAuto().filter((e) => e.id.startsWith("auto_enc_cp1")).map((e) => ({ d: e.date, j: e.journal, c: e.lignes[0].compte, m: e.lignes[0].debit, eq: e.lignes[0].debit === e.lignes[1].credit && e.lignes[1].compte === "411000", lib: e.libelle })));
    ok(E.length === 4 && JSON.stringify(E.map((e) => [e.d, e.j, e.c, e.m])) === JSON.stringify([["2026-11-11", "CA", "571000", 40000], ["2026-11-13", "BQ", "521000", 30000], ["2026-11-15", "BQ", "552000", 28000], ["2026-11-16", "OD", "471000", 20000]]) && E.every((e) => e.eq), "4 écritures aux dates réelles : caisse 571, banque 521, Mobile Money 552, nature 471 (compte d'attente, hors trésorerie)");
    ok(E[1].lib.includes("VIR-1") && await page.evaluate(() => { const e = comptaGenerateAuto(); const s = (c, k) => e.reduce((t, x) => t + x.lignes.filter((l) => l.compte === c).reduce((u, l) => u + l[k], 0), 0); return s("411000", "debit") - s("411000", "credit"); }) === 0, "la référence apparaît au libellé ; le compte client est soldé (118 000 facturés − 118 000 payés)");
    ok(await page.evaluate(() => PLAN_COMPTABLE["471000"] && PLAN_COMPTABLE["571000"] && PLAN_COMPTABLE["521000"]), "plan comptable : 471, 571, 521 présents");

    console.log("▶ Règlement en nature et modèle financier");
    const T = await page.evaluate(() => { const t = SanixFinancement.calc.analyserTraction(COMMANDES, { now: "2026-11-16" }); return { nat: t.encaisseNature, mon: t.encaisseMonetaire, taux: t.tous.taux, enc: t.tous.encaisse }; });
    ok(T.nat === 20000 && T.mon === 98000 && T.enc === 118000 && Math.abs(T.taux - 98000 / 118000) < 1e-9, "financement : 20 000 en nature (hors trésorerie), 98 000 en argent ; taux d'encaissement monétaire 83 %");

    console.log("▶ Reçu de paiement");
    imprimes.length = 0;
    await page.evaluate(() => imprimerRecu("cp1", COMMANDES[0].paiements[0].id)); await page.waitForTimeout(150);
    ok(imprimes.length === 1 && imprimes[0].includes("REC-2026-001") && imprimes[0].includes("Client Compta") && imprimes[0].includes("quarante mille") && imprimes[0].includes("Espèces") && imprimes[0].includes("Reste dû") && imprimes[0].includes("ne tient pas lieu de facture"), "reçu n° REC-2026-001 : client, montant en lettres, mode, reste dû, mention « ne tient pas lieu de facture »");
    await page.evaluate(() => imprimerRecu("cp1", COMMANDES[0].paiements[0].id)); await page.evaluate(() => imprimerRecu("cp1", COMMANDES[0].paiements[1].id)); await page.waitForTimeout(150);
    ok(imprimes[1].includes("REC-2026-001") && imprimes[2].includes("REC-2026-002"), "même paiement : même numéro ; paiement suivant : REC-2026-002");
    ok(await page.evaluate(() => { const p = COMMANDES[0].paiements; COMMANDES[0].paiements = p.filter((x) => x.id !== p[1].id); return lsLoad("rec_compteur_2026"); }) === 2, "compteur de reçus mémorisé : un numéro émis n'est jamais réutilisé après suppression");

    console.log("▶ Persistance");
    await page.evaluate(() => saveStore("commandes")); await page.reload(); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS[0]; enterApp(currentUser); }); await page.waitForTimeout(1300);
    ok(await page.evaluate(() => COMMANDES.length === 1 && COMMANDES[0].paiements.length === 3 && COMMANDES[0].paiements[0].recu === "REC-2026-001"), "journal conservé après rechargement (3 paiements, numéro de reçu)");
    ok(await page.evaluate(() => { const s = backupSnapshot().stores.commandes; return s[0].paiements.length === 3; }), "sauvegarde complète : les paiements sont inclus");
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    console.log("\nJournal des paiements : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
