// Premier contact : un garage (AutoGarage Pro) ne reçoit jamais le message d'AluExpert. node premier_contact_autogarage_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4448), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4448/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    console.log("▶ Premier contact partenaires");
    const r = await page.evaluate(() => {
      const p = { id: 996101, nom: "SENSOFT", statut: "prospect", secteur: "Partenaire (distributeur / intégrateur)", logiciel: "DistriPro ERP, Compta Pro, SANIX CRM", phone: "+221 33 867 40 93", email: "contact@sensoft.sn", notes: "", created_at: new Date().toISOString(), interactions: [] };
      const g = { id: 996102, nom: "PMG CAR", statut: "prospect", secteur: "Garage automobile", logiciel: "AutoGarage Pro", phone: "0758132224", email: "", notes: "", created_at: new Date().toISOString(), interactions: [] };
      CLIENTS.push(p, g);
      const wa = fcGet(p, "wa").body, _dbg = console.log(fcGet(p,"wa").body), em = fcGet(p, "email"), rl = relanceBuildMsg(p, 1, "wa"), rle = relanceBuildMsg(p, 1, "email");
      const idx = MSG_TEMPLATES.findIndex((t) => t.fc === "partenaire" && t.canal === "wa");
      _msg.tplId = "b" + idx; _msg.tplTexte = MSG_TEMPLATES[idx].msg; document.getElementById("msg-text").value = MSG_TEMPLATES[idx].msg;
      return { seg: fcSegment(p), segG: fcSegment(g), wa, emSubject: em.subject, emBody: em.body, rl, rle, idx, opts: [...document.querySelectorAll("#mkt-modele option")].map((o) => o.value), surGarage: msgModeleHorsSegment([{ c: g }]), surPartenaire: msgModeleHorsSegment([{ c: p }]) };
    });
    ok(r.seg === "partenaire" && r.segG === "autogarage", "un secteur « Partenaire » est reconnu, un garage reste un garage");
    console.log(r.wa);
    ok(/partenaire local/.test(r.wa) && /DistriPro/.test(r.wa) && !/portail|démo gratuite|AluExpert|AutoGarage/i.test(r.wa), "WhatsApp : message de partenariat, sans offre client ni portail");
    ok(/Partenariat/.test(r.emSubject) && /commission/.test(r.emBody) && !/\d\s?%/.test(r.emBody) && !/portail|En savoir plus/i.test(r.emBody) && /Cordialement/.test(r.emBody), "e-mail : partenariat, commission sans aucun taux chiffré, pas de lien produit");
    ok(/partenariat/.test(r.rl) && /partenariat/.test(r.rle) && !/logiciel/i.test(r.rl), "la relance d'un partenaire parle de partenariat");
    ok(r.idx >= 0 && r.opts.includes("partenaire"), "le modèle apparaît dans la galerie de la Messagerie et le Moteur Marketing");
    ok(r.surGarage !== "" && r.surPartenaire === "", "garde-fou : le message partenaire est bloqué pour un garage, pas pour un partenaire");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors[0] : ""));
    console.log("\nTOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });

