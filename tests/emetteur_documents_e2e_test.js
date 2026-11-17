// SANIX CRM Pro : l'émetteur des documents (facture, proforma, reçu, devis, contrat) vient d'une seule source, le Paramétrage. node emetteur_documents_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4462), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 1200 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4462/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    const sortie = (cfg) => page.evaluate((c) => {
      Object.assign(CONFIG, c);
      const d = { num: "FAC-2026-0001", date: "2026-11-17", client: "Clinique Alpha", clientLignes: ["Abidjan"], lignes: [{ titre: "ImmoSuite ERP", qte: 1, pu: 1000, remise: 0, net: 1000 }], totaux: [["Montant total net", "1 000 FCFA", "net"]],
        proforma: false, avecTva: false, taux: 18, total: 1000, verse: 0, reste: 1000, phrase: "", info: "", tampon: "À RÉGLER", qr: ["x"], empreinte: "A".repeat(64) };
      const html = factureHtml(d), E = facEmetteur();
      return { nom: E.nom, email: E.email, html, co: (/<div class="co">([\s\S]*?)<\/div>/.exec(html) || [])[1] || "" };
    }, cfg);
    const sans = await sortie({ forme: "", email: "papykimoto2@gmail.com", tel: "+225 0779181075", adresse: "Abidjan, Côte d'Ivoire" });
    ok(sans.nom === "SANIX AFRICA" && !/SARL/.test(sans.html), "forme juridique non renseignée : aucun « SARL » nulle part dans la facture (en-tête, filigrane, tampon)");
    ok(/papykimoto2@gmail\.com/.test(sans.co) && /0779181075/.test(sans.co) && /Abidjan, Côte d'Ivoire/.test(sans.co) && !/paypikmoto|Songon|0140017751/.test(sans.html), "e-mail, téléphone et adresse viennent du Paramétrage (plus rien d'écrit en dur : ni faute, ni ancien siège, ni second numéro)");
    const avec = await sortie({ forme: "SARL", email: "contact@sanix.example", tel: "+225 0102030405", adresse: "Songon Kassamblé" });
    ok(avec.nom === "SANIX AFRICA SARL" && /<b>SANIX AFRICA SARL<\/b>/.test(avec.co) && (avec.html.match(/SANIX AFRICA SARL/g) || []).length >= 3, "forme renseignée : « SANIX AFRICA SARL » en en-tête, filigrane et tampon");
    ok(/contact@sanix\.example/.test(avec.co) && /0102030405/.test(avec.co) && /Songon Kassamblé/.test(avec.co) && !/papykimoto2|0779181075/.test(avec.co), "changer le Paramétrage change aussitôt l'en-tête (e-mail, téléphone, siège)");
    const vide = await sortie({ forme: "", email: "contact@sanix-africa.ci", tel: "+225 ", adresse: "" });
    ok(!/Email|Tél|contact@sanix-africa/.test(vide.co) && !/Email :|Tél :/.test(vide.html), "valeurs non renseignées ou restées à leur exemple : lignes absentes (rien d'inventé)");
    const autre = await sortie({ forme: "SA", email: "x@y.z", tel: "+225 0102030405", adresse: "Abidjan" });
    ok(autre.nom === "SANIX AFRICA SA", "une autre forme juridique (SA) est reprise telle quelle");
    // reçu de paiement : même émetteur
    await page.evaluate(() => { Object.assign(CONFIG, { forme: "", email: "papykimoto2@gmail.com", tel: "+225 0779181075", adresse: "Abidjan" }); window.__h = ""; window.open = () => ({ document: { write: (h) => { window.__h = h; }, close() {} } });
      COMMANDES.push({ id: "cr9", ref: "CMD-9", client: "Clinique Alpha", logiciel: "ImmoSuite ERP", ttc: 1180000, htNet: 1000000, statut: "confirmee", date: "2026-11-10", paiements: [{ id: "p1", date: "2026-11-11", montant: 500000, mode: "especes" }] }); });
    const recu = await page.evaluate(() => { imprimerRecu("cr9", "p1"); return window.__h; });
    ok(recu.includes("REÇU DE PAIEMENT") && /papykimoto2@gmail\.com/.test(recu) && !/SARL|paypikmoto/.test(recu), "reçu de paiement : même émetteur, sans « SARL » ni faute");
    ok(errors.length === 0, "aucune erreur JS " + errors.join("|"));
    console.log("✅ émetteur des documents OK");
  } finally { await browser.close(); server.close && server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
