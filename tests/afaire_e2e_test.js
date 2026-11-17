// SANIX CRM Pro : mode « À faire aujourd'hui » du pipeline. node afaire_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4433), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 1100 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4433/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.waitForFunction(() => CLIENTS.filter((c) => c.statut === "prospect").length >= 500, null, { timeout: 15000 });
    const jours = (j) => new Date(Date.now() - j * 864e5).toISOString();
    await page.evaluate((jj) => {
      const j = (n) => new Date(Date.now() - n * 864e5).toISOString();
      CLIENTS.push({ id: 95001, nom: "Prospect En Retard", statut: "prospect", logiciel: "ImmoSuite ERP", phone: "0701020304", secteur: "Immobilier", interactions: [{ date: j(9), type: "Contact établi", etape: 1 }] });
      CLIENTS.push({ id: 95002, nom: "Prospect Devis", statut: "prospect", logiciel: "ImmoSuite ERP", phone: "0702030405", secteur: "Immobilier", interactions: [{ date: j(1), type: "Démo réalisée", etape: 2 }] });
      COMMANDES.length = 0;
      COMMANDES.push({ id: "k1", ref: "CMD-T-1", client: "Client Reste", date: "2026-08-05", logiciel: "ImmoSuite ERP", htNet: 4237288, tva: 762712, ttc: 5000000, acompte: 2000000, solde: 3000000, statut: "en_cours", paiements: [{ id: "p1", date: "2026-09-04", montant: 1000000, mode: "inconnu" }, { id: "p2", date: "2026-11-11", montant: 1000000, mode: "inconnu" }] },
        { id: "k2", ref: "CMD-T-2", client: "Client Soldé", date: "2026-10-01", logiciel: "AutoGarage Pro", htNet: 338983, tva: 61017, ttc: 400000, acompte: 400000, solde: 0, statut: "livree", paiements: [{ id: "p3", date: "2026-10-28", montant: 400000, mode: "inconnu" }] });
      CLIENTS.push({ id: 95003, nom: "Client Reste", statut: "client", phone: "0703040506", logiciel: "ImmoSuite ERP" });
      const auj = new Date().toISOString().slice(0, 10);
      RDVS.length = 0; RDVS.push({ id: 1, clientId: 95002, client: "Prospect Devis", type: "Appel", date: auj, heure: "10:30", duree: 30, statut: "prevu" }, { id: 2, clientId: 95001, client: "Prospect En Retard", type: "Démo", date: "2000-01-01", heure: "10:00", statut: "prevu" });
      syncProspectsToPipeline(); navigate("pipeline", null);
    }, null);
    await page.waitForTimeout(500);
    console.log("▶ Bascule Tableau / À faire aujourd'hui");
    ok(await page.evaluate(() => !document.getElementById("kanban-board").classList.contains("hidden") && document.getElementById("pipeline-afaire").classList.contains("hidden")), "par défaut : le tableau");
    const n0 = await page.evaluate(() => +document.getElementById("pipe-afaire-n").textContent);
    ok(n0 >= 6, "le compteur du bouton annonce les actions du jour (" + n0 + ")");
    await page.click("#pipe-mode-afaire"); await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.getElementById("kanban-board").classList.contains("hidden") && !document.getElementById("pipeline-afaire").classList.contains("hidden")), "mode « À faire aujourd'hui » affiché, tableau masqué");
    const T = await page.evaluate(() => document.getElementById("pipeline-afaire").innerText.replace(/[  ]/g, " ").replace(/\s+/g, " "));
    ok(T.includes("Rendez-vous du jour") && T.includes("10:30 · Prospect Devis") && !T.includes("Prospect En Retard · Démo"), "rendez-vous : celui d'aujourd'hui seulement, avec l'heure");
    ok(T.includes("Client Reste · 3 000 000 FCFA") && !T.includes("Client Soldé"), "argent : 3 000 000 à encaisser chez Client Reste ; la commande soldée n'apparaît pas");
    ok(T.includes("Prospect En Retard") && /⚠ \d+ j de retard/.test(T), "affaire en retard signalée avec ses jours de retard");
    ok(T.includes("Premiers contacts à passer") && T.includes("les 5 prospects les mieux valorisés"), "bloc des premiers contacts");
    const ordre = await page.evaluate(() => [...document.querySelectorAll("#pipeline-afaire .card > div:first-child b")].map((b) => b.textContent.replace(/\s+/g, " ").trim()));
    ok(ordre[0].includes("Rendez-vous") && ordre[1].includes("Argent") && ordre[ordre.length - 1].includes("Premiers contacts"), "ordre des blocs : rendez-vous, argent, relances, premiers contacts");
    console.log("▶ Actions");
    const avant = await page.evaluate(() => +document.getElementById("pipe-afaire-n").textContent);
    await page.evaluate(() => afaireFait(95001)); await page.waitForTimeout(250);
    const rel = await page.evaluate(() => ({ inter: CLIENTS.find((c) => c.id === 95001).interactions.length, texte: document.getElementById("pipeline-afaire").innerText, n: +document.getElementById("pipe-afaire-n").textContent }));
    ok(rel.inter === 2 && !/Prospect En Retard\s+Relancer/.test(rel.texte) && rel.n === avant - 1, "« Fait » : relance notée sur la fiche, l'affaire sort de la liste (" + avant + " → " + rel.n + ")");
    const premier = await page.evaluate(() => { const b = [...document.querySelectorAll("#pipeline-afaire button")].find((x) => x.textContent.includes("Contacté")); const m = /afaireContacte\((\d+)\)/.exec(b.getAttribute("onclick")); return +m[1]; });
    await page.evaluate((id) => afaireContacte(id), premier); await page.waitForTimeout(250);
    ok(await page.evaluate((id) => aiGetEtape(CLIENTS.find((c) => c.id === id)) === 1, premier), "« Contacté » : le prospect passe à l'étape 1 (il quitte les premiers contacts)");
    await page.evaluate(() => { const c = COMMANDES.find((x) => x.id === "k1"); SanixPaiements.ajouter(c, { date: new Date().toISOString().slice(0, 10), montant: 3000000, mode: "virement" }, { today: new Date().toISOString().slice(0, 10) }); _apresPaiement("k1"); }); await page.waitForTimeout(250);
    ok(!(await page.evaluate(() => document.getElementById("pipeline-afaire").innerText.includes("Client Reste"))), "paiement enregistré : la commande sort de la liste « à encaisser »");
    console.log("▶ Mémorisation et retour au tableau");
    await page.reload(); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); navigate("pipeline", null); }); await page.waitForTimeout(900);
    ok(await page.evaluate(() => !document.getElementById("pipeline-afaire").classList.contains("hidden")), "le mode choisi est conservé après rechargement");
    await page.click("#pipe-mode-tableau"); await page.waitForTimeout(200);
    ok(await page.evaluate(() => !document.getElementById("kanban-board").classList.contains("hidden") && document.getElementById("pipeline-afaire").classList.contains("hidden")), "retour au tableau");
    await page.click("#pipe-mode-afaire"); await page.waitForTimeout(300);
    await page.screenshot({ path: "/tmp/claude-0/-home-user-CRM-SANIX/fda489a8-65a8-578c-bff6-b00bf4b09a64/scratchpad/afaire.png" });
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    console.log("\nÀ faire aujourd'hui : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
