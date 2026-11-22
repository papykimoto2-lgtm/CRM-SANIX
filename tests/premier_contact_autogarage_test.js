// Premier contact : un garage (AutoGarage Pro) ne reçoit jamais le message d'AluExpert. node premier_contact_autogarage_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4447), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4447/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    console.log("▶ Premier contact AutoGarage Pro");
    const r = await page.evaluate(() => {
      const g = { id: 996001, nom: "PMG CAR", statut: "prospect", secteur: "Garage automobile", logiciel: "AutoGarage Pro", phone: "0758132224", email: "", notes: "", created_at: new Date().toISOString(), interactions: [] };
      const a = { id: 996002, nom: "ALU TEST", statut: "prospect", secteur: "Industrie", logiciel: "Sanix AluExpert ERP", phone: "0707000001", email: "", notes: "", created_at: new Date().toISOString(), interactions: [] };
      const sansLogiciel = { id: 996003, nom: "GARAGE SOLEIL", statut: "prospect", secteur: "Garage automobile", logiciel: "", phone: "0707000002", email: "", notes: "", created_at: new Date().toISOString(), interactions: [] };
      CLIENTS.push(g, a, sansLogiciel);
      const wa = fcGet(g, "wa").body, em = fcGet(g, "email");
      const tplIdx = MSG_TEMPLATES.findIndex((t) => t.fc === "autogarage" && t.canal === "wa"), aluIdx = MSG_TEMPLATES.findIndex((t) => t.fc === "aluexpert" && t.canal === "wa");
      const garde = (idx, cibles) => { _msg.tplId = "b" + idx; _msg.tplTexte = MSG_TEMPLATES[idx].msg; document.getElementById("msg-text") ? 0 : 0; return cibles; };
      return { seg: fcSegment(g), segAlu: fcSegment(a), segSecteur: fcSegment(sansLogiciel), wa, emSubject: em.subject, emBody: em.body, tplIdx, aluIdx, opts: [...document.querySelectorAll("#mkt-modele option")].map((o) => o.value), segs: Object.keys(FIRST_CONTACT_DEFAULT) };
    });
    ok(r.seg === "autogarage" && r.segAlu === "aluexpert" && r.segSecteur === "autogarage", "un garage est reconnu (par son logiciel ou son secteur), AluExpert reste AluExpert");
    ok(/AutoGarage Pro/.test(r.wa) && /ordres de réparation/.test(r.wa) && !/AluExpert|alumin|inox|chantiers/i.test(r.wa), "WhatsApp : message AutoGarage Pro, sans aucune mention AluExpert / aluminium / inox");
    ok(/garages/.test(r.emSubject) && /AutoGarage Pro/.test(r.emBody) && !/AluExpert|alumin|inox/i.test(r.emSubject + r.emBody), "e-mail : objet et corps AutoGarage Pro, sans AluExpert");
    ok(/portail client/i.test(r.wa) && /20 minutes/.test(r.wa), "le portail client et la démonstration gratuite de 20 minutes sont proposés");
    ok(r.tplIdx >= 0 && r.aluIdx >= 0 && r.segs.includes("autogarage") && r.opts.includes("autogarage"), "le modèle apparaît dans la galerie de la Messagerie et dans le Moteur Marketing");
    const g = await page.evaluate(() => {
      const mk = (idx) => { _msg.tplId = "b" + idx; _msg.tplTexte = MSG_TEMPLATES[idx].msg; document.getElementById("msg-text").value = MSG_TEMPLATES[idx].msg; };
      const cibles = ["PMG CAR", "ALU TEST"].map((n) => ({ c: CLIENTS.find((x) => x.nom === n) })), garages = [cibles[0]];
      const aluIdx = MSG_TEMPLATES.findIndex((t) => t.fc === "aluexpert" && t.canal === "wa"), agIdx = MSG_TEMPLATES.findIndex((t) => t.fc === "autogarage" && t.canal === "wa");
      mk(aluIdx); const alu_sur_garage = msgModeleHorsSegment(garages), alu_sur_alu = msgModeleHorsSegment([cibles[1]]);
      mk(agIdx); const ag_sur_garage = msgModeleHorsSegment(garages), ag_sur_melange = msgModeleHorsSegment(cibles);
      mk(aluIdx); document.getElementById("msg-text").value = MSG_TEMPLATES[aluIdx].msg + "\nRetouché.";   // texte modifié : l'utilisateur assume
      const retouche = msgModeleHorsSegment(garages);
      return { alu_sur_garage, alu_sur_alu, ag_sur_garage, ag_sur_melange, retouche };
    });
    ok(/AluExpert|Menuiserie/i.test(g.alu_sur_garage) && /PMG CAR : AutoGarage Pro/.test(g.alu_sur_garage), "garde-fou : le message AluExpert est BLOQUÉ pour un garage (avec explication : PMG CAR : AutoGarage Pro)");
    ok(g.alu_sur_alu === "" && g.ag_sur_garage === "", "le bon modèle pour le bon logiciel n'est jamais bloqué");
    ok(/1 destinataire/.test(g.ag_sur_melange), "modèle AutoGarage envoyé à un mélange garage + alu : le destinataire d'un autre logiciel est signalé");
    ok(g.retouche === "", "texte retouché par l'utilisateur : pas de blocage (il assume)");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors[0] : ""));
    console.log("\nTOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
