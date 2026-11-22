// Premier contact : un garage (AutoGarage Pro) ne reçoit jamais le message d'AluExpert. node premier_contact_autogarage_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4452), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4452/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    console.log("▶ Premier contact partenaires");
    const r = await page.evaluate(() => {
      const p = { id: 996401, nom: "SENSOFT", statut: "prospect", secteur: "Partenaire (distributeur / intégrateur)", logiciel: "DistriPro ERP", phone: "", email: "x@exemple.test", notes: "", created_at: new Date().toISOString(), interactions: [] };
      const g = { id: 996402, nom: "PMG CAR", statut: "prospect", secteur: "Garage automobile", logiciel: "AutoGarage Pro", phone: "", email: "g@exemple.test", notes: "", created_at: new Date().toISOString(), interactions: [] };
      CLIENTS.push(p, g);
      const idx = MSG_TEMPLATES.findIndex((t) => /présentation détaillée/.test(t.titre));
      const t = MSG_TEMPLATES[idx], s = SanixMessagerie.separerObjet(t.msg), rempli = fcFill(s.corps, p), objet = fcFill(s.objet, p);
      _msg.tplId = "b" + idx; _msg.tplTexte = s.corps; document.getElementById("msg-text").value = s.corps;
      return { idx, fc: t.fc, canal: t.canal, objet, rempli, accolades: (rempli.match(/\{[a-z_]+\}/g) || []), surGarage: msgModeleHorsSegment([{ c: g }]), surPartenaire: msgModeleHorsSegment([{ c: p }]) };
    });
    ok(r.idx >= 0 && r.fc === "partenaire" && r.canal === "email", "le modèle détaillé existe (e-mail, segment partenaire)");
    ok(/Partenariat/.test(r.objet) && /SENSOFT/.test(r.rempli) && /19 logiciels|DistriPro ERP/.test(r.objet + r.rempli) && /SANIX CRM Pro/.test(r.rempli) && /Cordialement/.test(r.rempli), "objet et corps remplis pour la fiche, avec le catalogue et le CRM");
    ok(r.accolades.length === 0, "aucune variable laissée telle quelle : " + r.accolades.join(","));
    ok(!/\d\s?%|FCFA|prix de/i.test(r.rempli), "aucun taux ni prix dans le message");
    ok(r.surGarage !== "" && r.surPartenaire === "", "garde-fou : bloqué pour un garage, libre pour un partenaire");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors[0] : ""));
    console.log("\nTOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });


