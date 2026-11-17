// SANIX CRM Pro : le bouton « Contrat » de la fiche produit le contrat complet (14 articles), rempli depuis la fiche, sans affirmer de société non renseignée. node contrat_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4453), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4453/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => {
      window.__html = ""; window.open = () => ({ document: { write: (h) => { window.__html = h; }, close() {} } });
      if (!LOGICIELS.find((l) => l.nom === "MediCore Suite")) LOGICIELS.push({ id: "log_medicore", nom: "MediCore Suite", modules: "Portail Patient, Agenda", desc: "ERP hospitalier complet. Autres phrases", prixNum: 1500000, prixMensuel: 60000, type_licence: "Perpetuelle" });
      const l = LOGICIELS.find((x) => x.nom === "MediCore Suite"); l.prixMensuel = 60000; l.type_licence = "Perpetuelle";
      CONFIG.raisonSociale = "SANIX Africa Division Technologies"; CONFIG.forme = ""; CONFIG.capital = ""; CONFIG.rccm = ""; CONFIG.adresse = "Abidjan, Côte d'Ivoire";
      CLIENTS.push({ id: 999001, nom: "Clinique Alpha", statut: "prospect", phone: "+2250140017751", email: "", secteur: "Santé", logiciel: "MediCore Suite", adresse: "Cocody, Abidjan", contact: "Dr Alpha", valeur: 1500000, valeurSaisie: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    });
    const T = (s) => s.replace(/<[^>]+>/g, "").replace(/[\u00a0\u202f]/g, " ");   // texte sans balises (les passages à compléter sont surlignés)
    const generer = (kind) => page.evaluate((k) => { window.__html = ""; genDocFromDossier(999001, k); return window.__html; }, kind);

    console.log("▶ Contrat complet (entreprise non enregistrée)");
    let h = await generer("contrat");
    ok((h.match(/<h3 class="ar">/g) || []).length === 14, "14 articles dans le contrat");
    ok(T(h).includes("Clinique Alpha, société [forme juridique]") && T(h).includes("Cocody, Abidjan") && T(h).includes("représentée par Dr Alpha"), "le Licencié est rempli depuis la fiche : nom, adresse, représentant");
    ok(h.includes("MediCore Suite") && /Frais initiaux de licence : 1 500 000 FCFA HT/.test(T(h)) && /Frais de maintenance : 60 000 FCFA par mois/.test(T(h)) && /conclu pour une durée indéterminée/.test(T(h)), "logiciel, prix, maintenance et durée (licence perpétuelle) repris du catalogue");
    ok(!/société de droit ivoirien/i.test(T(h)) && !/au capital/i.test(T(h)) && !/RCCM sous le numéro CI/.test(T(h)), "AUCUNE mention de société de droit ivoirien, de capital ni de RCCM tant que les réglages sont vides");
    ok(T(h).includes("SANIX AFRICA DIVISION TECHNOLOGIES, dont le siège est situé à Abidjan, Côte d'Ivoire, représentée par"), "le Concédant : nom, siège et représentant des réglages");
    ok(h.includes('contenteditable="true"') && (h.match(/<mark class="ph">/g) || []).length >= 6, "texte modifiable, passages à compléter surlignés");
    ok(/passages surlignés en jaune/.test(h) && /juriste/.test(h), "bandeau d'avertissement : passages à compléter et relecture par un juriste");
    ok(!/Le client<br>/.test(h) && h.includes("ANNEXE 1 – RÉCAPITULATIF FINANCIER") && /Total TTC/.test(h), "pas de bloc de signature en double ; récapitulatif financier en annexe");
    ok(/FAIT À Abidjan, LE \d\d\/\d\d\/\d{4}/.test(T(h)), "lieu et date de signature");
    ok(await page.evaluate(() => CLIENTS.find((c) => c.id === 999001).interactions.some((i) => i.type === "Contrat généré" && /modèle complet/.test(i.note))), "l'historique de la fiche note « Contrat généré · modèle complet »");

    console.log("▶ Les mentions légales n'apparaissent que si elles sont renseignées");
    await page.evaluate(() => { CONFIG.forme = "SARL"; CONFIG.capital = "1000000"; CONFIG.rccm = "CI-ABJ-2026-B-12345"; });
    h = await generer("contrat");
    ok(/société SARL au capital de 1000000 FCFA, immatriculée au RCCM sous le numéro CI-ABJ-2026-B-12345/.test(T(h)), "forme, capital et RCCM renseignés : ils apparaissent");
    await page.evaluate(() => { CONFIG.forme = ""; CONFIG.capital = ""; CONFIG.rccm = ""; });

    console.log("▶ Modèle propre au logiciel, devis, sécurité");
    await page.evaluate(() => { docsLoad(); const id = LOGICIELS.find((l) => l.nom === "MediCore Suite").id; DOCS[id] = DOCS[id] || {}; DOCS[id].contrat = "Contrat sur mesure pour {client} : {prix} FCFA le {date}."; });
    h = await generer("contrat");
    ok(T(h).includes("Contrat sur mesure pour Clinique Alpha : 1 500 000 FCFA") && !/<h3 class="ar">/.test(h) && /Le client<br>/.test(h), "un modèle propre au logiciel reste prioritaire, avec l'ancienne présentation");
    await page.evaluate(() => { const id = LOGICIELS.find((l) => l.nom === "MediCore Suite").id; DOCS[id].contrat = ""; });
    h = await generer("devis");
    ok(/DEVIS/.test(h) && !/ARTICLE 1/.test(h) && /Total TTC/.test(h), "le devis est inchangé");
    await page.evaluate(() => { CLIENTS.find((c) => c.id === 999001).nom = '<img src=x onerror=alert(1)> & Cie'; });
    h = await generer("contrat");
    ok(!/<img src=x onerror=alert\(1\)>/.test(h.split("ANNEXE 1")[0]) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(h), "le nom du client est échappé dans le texte du contrat (aucun HTML injecté)");
    ok(await page.evaluate(() => typeof dossierContratDefaut === "function" && SanixContrat.MODELE.length > 3000), "l'éditeur de modèles propose « Insérer le modèle complet »");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\nTous les contrôles passent.");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
