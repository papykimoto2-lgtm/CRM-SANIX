// Premier contact : un garage (AutoGarage Pro) ne reçoit jamais le message d'AluExpert. node premier_contact_autogarage_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4454), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4454/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    console.log("▶ Premier contact partenaires");
    const r = await page.evaluate(() => {
      const mk = (id, nom, logiciel, secteur) => ({ id, nom, statut: "prospect", secteur, logiciel, phone: "0707000001", email: "e@exemple.test", notes: "", created_at: new Date().toISOString(), interactions: [] });
      const a = mk(996601, "FERME DU SUD", "AviNest Pro", "Aviculture"), g = mk(996602, "PMG CAR", "AutoGarage Pro", "Garage automobile"), an = mk(996603, "FERME ANGEL", "Angel's Agro", "Aviculture");
      CLIENTS.push(a, g, an);
      const wa = fcGet(a, "wa").body, em = fcGet(a, "email");
      const idx = MSG_TEMPLATES.findIndex((t) => t.fc === "avinest" && t.canal === "email");
      _msg.tplId = "b" + idx; _msg.tplTexte = MSG_TEMPLATES[idx].msg; document.getElementById("msg-text").value = MSG_TEMPLATES[idx].msg;
      return { seg: fcSegment(a), segG: fcSegment(g), segAn: fcSegment(an), wa, sujet: em.subject, corps: em.body, idx, opts: [...document.querySelectorAll("#mkt-modele option")].map((o) => o.value),
        surGarage: msgModeleHorsSegment([{ c: g }]), surAvi: msgModeleHorsSegment([{ c: a }]) };
    });
    ok(r.seg === "avinest" && r.segG === "autogarage" && r.segAn !== "avinest", "AviNest Pro est reconnu par son logiciel ; un garage et Angel's Agro ne reçoivent pas ce message");
    ok(/AviNest Pro/.test(r.wa) && /mortalité/.test(r.wa) && /rentabilité de chaque lot/.test(r.wa) && !/AluExpert|alumin|garage|portail/i.test(r.wa), "WhatsApp : message AviNest Pro, sans mention d'un autre logiciel");
    ok(/avicoles/.test(r.sujet) && /AviNest Pro/.test(r.corps) && /prophylaxie/i.test(r.corps) && /SYSCOHADA/.test(r.corps) && /Cordialement/.test(r.corps) && !/AluExpert|alumin|garage|portail/i.test(r.sujet + r.corps), "e-mail : objet et corps AviNest Pro (lots, suivi quotidien, prophylaxie, stock, créances, rentabilité, SYSCOHADA)");
    ok(!/\d\s?%|FCFA/.test(r.wa + r.corps), "aucun prix dans le message (la grille reste dans le devis)");
    ok(!/\{[a-z_]+\}/.test(r.wa + r.sujet + r.corps), "aucune variable laissée telle quelle");
    ok(r.idx >= 0 && r.opts.includes("avinest"), "le modèle apparaît dans la galerie de la Messagerie et dans le Moteur Marketing");
    ok(r.surGarage !== "" && r.surAvi === "", "garde-fou : le message AviNest est bloqué pour un garage, pas pour un éleveur");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors[0] : ""));
    console.log("\nTOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });


