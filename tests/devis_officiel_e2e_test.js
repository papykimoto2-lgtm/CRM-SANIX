// SANIX CRM Pro : le bouton « Devis » de la fiche produit la page officielle (même structure que la facture proforma). node devis_officiel_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4461), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 1200 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4461/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => {
      window.__html = ""; window.open = () => ({ document: { write: (h) => { window.__html = h; }, close() {} } });
      LOGICIELS.push({ id: "log_dv", nom: "MediCore Suite", modules: "Portail Patient, Agenda", desc: "ERP hospitalier complet. Autres phrases", prixNum: 1500000, prixMensuel: 60000, type_licence: "Perpetuelle" });
      CONFIG.forme = ""; CONFIG.email = "papykimoto2@gmail.com";
      CLIENTS.push({ id: 999002, nom: "Clinique Alpha", statut: "prospect", phone: "+2250140017751", email: "", secteur: "Santé", logiciel: "MediCore Suite", adresse: "Cocody, Abidjan", contact: "Dr Alpha", valeur: 1500000, valeurSaisie: true, etablissements: 2, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    });
    const html = await page.evaluate(() => { window.__html = ""; genDocFromDossier(999002, "devis"); return window.__html; });
    const q = await ctx.newPage(); q.on("pageerror", (e) => errors.push("doc : " + e.message)); await q.setContent(html); await q.waitForTimeout(400);
    const r = await q.evaluate(() => { const p = document.querySelector(".page"); return {
      n: document.querySelectorAll(".page").length, wm: !!p.querySelector(".wms .wm"), logo: !!p.querySelector(".logo"), boites: p.querySelectorAll(".box").length,
      ti: p.querySelector(".ti").innerText.replace(/\s+/g, " "), tot: p.querySelector(".tot").innerText.replace(/\s+/g, " "), paid: p.querySelector(".paid").textContent,
      pied: ["stamp", "qr", "s-l", "s-r"].every((c) => p.querySelector("." + c)), txt: p.innerText.replace(/\s+/g, " "), co: p.querySelector(".co").innerText } });
    ok(r.n === 2 && r.wm && r.logo && r.boites === 2 && r.pied, "même structure que le proforma : filigrane, logo, ÉMETTEUR/CLIENT, tampon, QR, signatures, original + copie");
    ok(/DEVIS/.test(r.ti) && /DEV-\d{4}-/.test(r.ti) && /Valable jusqu/.test(r.ti), "titre DEVIS, numéro DEV-…, date de validité");
    ok(!/RESTE À PAYER|Avance payée/.test(r.tot), "pas de ligne avance / reste à payer sur un devis");
    ok(/Total HT 3 000 000/.test(r.tot) && /TVA \(18 %\) 540 000/.test(r.tot) && /3 540 000/.test(r.tot), "2 sites × 1 500 000 : HT 3 000 000, TVA 540 000, TTC 3 540 000");
    ok(r.paid === "DEVIS" && /bon pour accord/.test(r.txt) && /Clinique Alpha/i.test(r.txt) && /papykimoto2@gmail\.com/.test(r.co) && !/SARL\b/.test(r.co.split("\n")[0]), "tampon DEVIS, « bon pour accord », client, e-mail du paramétrage, pas de SARL");
    ok(/trois millions cinq cent quarante mille/i.test(r.txt) || /3 540 000\) francs/.test(r.txt), "montant arrêté en lettres");
    const logd = await page.evaluate(() => CLIENTS.find((c) => c.id === 999002).interactions.slice(-1)[0].type);
    ok(logd === "Devis généré", "interaction « Devis généré » journalisée");
    ok(errors.length === 0, "aucune erreur JS " + errors.join("|"));
    console.log("✅ devis officiel OK");
  } finally { await browser.close(); server.close && server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
