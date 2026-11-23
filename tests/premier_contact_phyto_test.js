// Premier contact : un garage (AutoGarage Pro) ne reçoit jamais le message d'AluExpert. node premier_contact_autogarage_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4456), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4456/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    console.log("▶ Premier contact partenaires");
    const r = await page.evaluate(() => {
      const mk = (id, nom, logiciel, secteur) => ({ id, nom, statut: "prospect", secteur, logiciel, phone: "0707000001", email: "e@exemple.test", notes: "", created_at: new Date().toISOString(), interactions: [] });
      const p = mk(996801, "FIRMAGRO", "Phyto Strike Force", "Distribution"), g = mk(996802, "PMG CAR", "AutoGarage Pro", "Garage automobile"), d = mk(996803, "SOCIETE DISTRI", "DistriPro ERP", "Distribution");
      CLIENTS.push(p, g, d);
      const wa = fcGet(p, "wa").body, em = fcGet(p, "email");
      const idx = MSG_TEMPLATES.findIndex((t) => t.fc === "phyto" && t.canal === "email");
      _msg.tplId = "b" + idx; _msg.tplTexte = MSG_TEMPLATES[idx].msg; document.getElementById("msg-text").value = MSG_TEMPLATES[idx].msg;
      return { seg: fcSegment(p), segG: fcSegment(g), segD: fcSegment(d), wa, sujet: em.subject, corps: em.body, idx, opts: [...document.querySelectorAll("#mkt-modele option")].map((o) => o.value), surGarage: msgModeleHorsSegment([{ c: g }]), surPhyto: msgModeleHorsSegment([{ c: p }]) };
    });
    ok(r.seg === "phyto" && r.segG === "autogarage" && r.segD !== "phyto", "Phyto Strike Force est reconnu par son logiciel ; un garage et DistriPro ne reçoivent pas ce message");
    ok(/Phyto Strike Force/.test(r.wa) && /encours/.test(r.wa) && /FIFO/.test(r.wa) && !/AluExpert|alumin|garage|AviNest|portail/i.test(r.wa), "WhatsApp : message Phyto Strike Force, sans mention d'un autre logiciel");
    ok(/phytosanitaires/.test(r.sujet) && /Phyto Strike Force/.test(r.corps) && /FIFO/.test(r.corps) && /TVA/.test(r.corps) && /SYSCOHADA/.test(r.corps) && /Cordialement/.test(r.corps) && !/AluExpert|alumin|garage|AviNest|portail/i.test(r.sujet + r.corps), "e-mail : objet et corps Phyto Strike Force (commandes, livraisons partielles, encours, FIFO, TVA, SYSCOHADA)");
    ok(!/\d\s?%\s?(de|sur)|FCFA/.test(r.wa + r.corps.replace("TVA 18 %", "TVA")), "aucun prix dans le message (la grille reste dans le devis)");
    ok(!/\{[a-z_]+\}/.test(r.wa + r.sujet + r.corps), "aucune variable laissée telle quelle");
    ok(r.idx >= 0 && r.opts.includes("phyto"), "le modèle apparaît dans la galerie de la Messagerie et dans le Moteur Marketing");
    ok(r.surGarage !== "" && r.surPhyto === "", "garde-fou : le message Phyto est bloqué pour un garage, pas pour un distributeur phytosanitaire");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors[0] : ""));
    console.log("\nTOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });


