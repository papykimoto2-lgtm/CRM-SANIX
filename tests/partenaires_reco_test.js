// Premier contact : un garage (AutoGarage Pro) ne reçoit jamais le message d'AluExpert. node premier_contact_autogarage_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4451), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4451/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    console.log("▶ Premier contact partenaires");
    const r = await page.evaluate(() => {
      const mk = (id, nom, secteur, logiciel) => ({ id, nom, statut: "prospect", secteur, logiciel, phone: "", email: nom.toLowerCase().replace(/\W/g, "") + "@exemple.test", notes: "", created_at: new Date().toISOString(), interactions: [] });
      CLIENTS.length = 0; CLIENTS.push(mk(996301, "SENSOFT", "Partenaire (distributeur / intégrateur)", "DistriPro ERP"), mk(996302, "COMTEL", "Partenaire (distributeur / intégrateur)", "DistriPro ERP"));
      navigate("messagerie", null); _msg.canal = "email"; _msg.desel = new Set(); msgRender();
      const l1 = msgModeles(), reco = msgSegDominant(), html = document.getElementById("msg-templates").innerHTML;
      CLIENTS.push(mk(996303, "ALU TEST", "Industrie", "Sanix AluExpert ERP")); msgRender();
      return { reco, premier: l1[0] && l1[0].titre, estPartenaire: l1[0] && l1[0].seg, badge: /Recommandé/.test(html), melange: msgSegDominant() };
    });
    ok(r.reco === "partenaire" && r.estPartenaire === "partenaire" && /Partenaires/.test(r.premier), "destinataires 100 % partenaires : le modèle Partenaires passe en tête");
    ok(r.badge, "il porte la mention « Recommandé »");
    ok(r.melange === "", "destinataires mélangés : aucune recommandation");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors[0] : ""));
    console.log("\nTOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });


