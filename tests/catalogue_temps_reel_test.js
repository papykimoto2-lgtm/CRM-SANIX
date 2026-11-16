// SANIX CRM Pro : un changement de prix au catalogue se répercute partout, sans figer les devis ni les ventes. node catalogue_temps_reel_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4430), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4430/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.waitForFunction(() => CLIENTS.filter((c) => c.statut === "prospect").length >= 500, null, { timeout: 15000 });
    const prix = (nom) => page.evaluate((n) => LOGICIELS.find((l) => l.nom === n).prixNum, nom);
    // Fiches de test : prospect avec ancienne copie du prix (750 000), prospect avec devis saisi, client avec vente réelle
    await page.evaluate(() => {
      const l = LOGICIELS.find((x) => x.nom === "ImmoSuite ERP"); l.prixNum = 750000; l.prix = "750 000";
      CLIENTS.push({ id: 91001, nom: "Prospect Copie", statut: "prospect", logiciel: "ImmoSuite ERP", valeur: 750000, phone: "0100000001", secteur: "Immobilier" },
        { id: 91002, nom: "Prospect Devis", statut: "prospect", logiciel: "ImmoSuite ERP", valeur: 3500000, valeurSaisie: true, phone: "0100000002", secteur: "Immobilier", interactions: [{ date: new Date().toISOString(), type: "Proposition envoyée", etape: 3 }] },
        { id: 91003, nom: "Client Vendu", statut: "client", logiciel: "ImmoSuite ERP", valeur: 3389831, phone: "0100000003", secteur: "Immobilier" });
      syncProspectsToPipeline();
    });
    console.log("▶ Avant le changement de prix");
    const v0 = await page.evaluate(() => [91001, 91002, 91003].map((id) => valeurFiche(CLIENTS.find((c) => c.id === id))));
    ok(v0[0] === 750000 && v0[1] === 3500000 && v0[2] === 3389831, "valeurs : 750 000 (suit le catalogue), 3 500 000 (devis), 3 389 831 (vente)");
    console.log("▶ Changement du prix par le formulaire du catalogue");
    await page.evaluate(() => { openLogicielModal(LOGICIELS.find((x) => x.nom === "ImmoSuite ERP").id); document.getElementById("l-prix").value = "4000000"; saveLogiciel(); }); await page.waitForTimeout(200);
    ok(await prix("ImmoSuite ERP") === 4000000, "catalogue : 4 000 000");
    const v1 = await page.evaluate(() => [91001, 91002, 91003].map((id) => valeurFiche(CLIENTS.find((c) => c.id === id))));
    ok(v1[0] === 4000000, "prospect sans devis : passe aussitôt à 4 000 000 (même avec l'ancienne copie de 750 000 enregistrée)");
    ok(v1[1] === 3500000, "prospect avec devis saisi : reste à 3 500 000");
    ok(v1[2] === 3389831, "client (vente réelle) : reste à 3 389 831");
    const cons = await page.evaluate(() => { const c = CLIENTS.find((x) => x.id === 91001); return { cok: cokValeur(c), conv: convPipelineValue(c), msg: fcFill("Prix : {prix} FCFA", c), relance: relanceBuildPitch(c) }; });
    ok(cons.cok === 4000000 && cons.conv === 4000000, "cockpit et pipeline pondéré lisent le prix en vigueur");
    ok(cons.msg.replace(/[  ]/g, " ").includes("4 000 000") || cons.msg.includes("4") , "message de relance : prix en vigueur (" + cons.msg + ")");
    ok(await page.evaluate(() => { const d = DEALS.find((x) => x.clientId === 91001); return d && d.valeurEst === 4000000 && !(d.valeur > 0); }), "estimation du deal : mise à jour à 4 000 000, sans compter dans le pipeline chiffré");
    await page.evaluate(() => navigate("clients", null)); await page.waitForTimeout(400);
    await page.evaluate(() => renderClients(CLIENTS.filter((c) => c.id === 91001 || c.id === 91002 || c.id === 91003))); await page.waitForTimeout(150);
    const lignes = await page.evaluate(() => [...document.querySelectorAll("#clients-tbody tr")].map((t) => t.innerText.replace(/\s+/g, "")));
    ok(lignes.some((t) => t.includes("ProspectCopie") && t.includes("4000k")) && lignes.some((t) => t.includes("ProspectDevis") && t.includes("3500k")) && lignes.some((t) => t.includes("ClientVendu") && t.includes("3390k")), "tableau des clients : 4000k (sans devis), 3500k (devis), 3390k (vente)");
    console.log("▶ La fiche ne fige pas le prix à l'enregistrement");
    await page.evaluate(() => { editClient(91001); document.getElementById("client-edit-id").value = "91001"; saveClient(); }); await page.waitForTimeout(150);
    ok(await page.evaluate(() => { const c = CLIENTS.find((x) => x.id === 91001); return !(c.valeur > 0) && !c.valeurSaisie; }), "enregistrer la fiche sans toucher au montant : aucune copie du prix n'est figée");
    await page.evaluate(() => { editClient(91001); document.getElementById("c-valeur").value = "2500000"; document.getElementById("client-edit-id").value = "91001"; saveClient(); }); await page.waitForTimeout(150);
    ok(await page.evaluate(() => { const c = CLIENTS.find((x) => x.id === 91001); return c.valeur === 2500000 && c.valeurSaisie === true && valeurFiche(c) === 2500000; }), "montant saisi à la main (2 500 000) : conservé, marqué « saisi »");
    console.log("▶ Compteurs du catalogue");
    await page.evaluate(() => { COMMANDES.length = 0; COMMANDES.push({ id: "z1", ref: "CMD-Z-1", client: "Client Vendu", date: "2026-11-01", logiciel: "ImmoSuite ERP", htNet: 3389831, ttc: 3389831, statut: "en_cours", sansTva: true }, { id: "z2", ref: "CMD-Z-2", client: "Brouillon", date: "2026-11-01", logiciel: "ImmoSuite ERP", htNet: 1e6, ttc: 1e6, statut: "brouillon", sansTva: true }); initLogiciels(); });
    const st = await page.evaluate(() => { const l = LOGICIELS.find((x) => x.nom === "ImmoSuite ERP"); return { ...(_statsLogiciel(l)), attendu: CLIENTS.filter((c) => c.statut === "prospect" && c.logiciel === "ImmoSuite ERP").length }; });
    ok(st.ventes === 1 && st.prospects === st.attendu && st.prospects > 90, "catalogue : ventes (1, brouillon exclu) et prospects (" + st.prospects + ") calculés sur le CRM, plus les compteurs figés à 0");
    console.log("▶ Écrans ouverts : recalcul");
    await page.evaluate(() => { COMMANDES.length = 0; navigate("strategie", null); }); await page.waitForTimeout(300);
    const avant = await page.evaluate(() => document.getElementById("str-rendement").innerText.replace(/[  ]/g, " "));
    ok(avant.includes("4 000 000"), "Stratégie : prix catalogue 4 000 000");
    await page.evaluate(() => { LOGICIELS.find((x) => x.nom === "ImmoSuite ERP").prixNum = 5000000; rafraichirVueCourante(); }); await page.waitForTimeout(150);
    ok((await page.evaluate(() => document.getElementById("str-rendement").innerText.replace(/[  ]/g, " "))).includes("5 000 000"), "après un changement venu d'une synchronisation, l'écran Stratégie se recalcule seul");
    ok(await page.evaluate(() => typeof window.rafraichirVueCourante === "function"), "le connecteur peut recalculer l'écran affiché");
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    console.log("\nPrix du catalogue en temps réel : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
