// Premier contact : un garage (AutoGarage Pro) ne reçoit jamais le message d'AluExpert. node premier_contact_autogarage_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4455), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4455/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    console.log("▶ Premier contact partenaires");
    const r = await page.evaluate(() => {
      const mk = (id, nom, statut, interactions) => ({ id, nom, statut, secteur: "Aviculture", logiciel: "AviNest Pro", phone: "0707000001", email: "", notes: "", created_at: new Date().toISOString(), interactions });
      const wa = mk(996701, "CONTACTE WA", "prospect", [{ date: new Date().toISOString(), type: "Message WhatsApp", note: "x", etape: 1 }]);
      const neuf = mk(996702, "JAMAIS CONTACTE", "prospect", []);
      const cl = mk(996703, "UN CLIENT", "client", [{ date: new Date().toISOString(), type: "Message WhatsApp", note: "x", etape: 1 }]);
      CLIENTS.length = 0; CLIENTS.push(wa, neuf, cl);
      navigate("clients", null); updateClientCounts();
      clientCurrentFilter = "contacte"; const liste = getFilteredClients().map((c) => c.nom);
      clientCurrentFilter = "all"; renderClients(getFilteredClients());
      return { l1: statutLabel(wa), l2: statutLabel(neuf), l3: statutLabel(cl), b1: statutBadge(wa), liste, cnt: document.getElementById("cnt-contacte").textContent, cntP: document.getElementById("cnt-prospect").textContent, html: document.body.innerHTML.includes(">Contacté<"), statutBase: wa.statut };
    });
    ok(r.l1 === "Contacté" && r.l2 === "Prospect" && r.l3 === "Client actif", "un prospect déjà contacté par WhatsApp s'affiche « Contacté » ; un prospect jamais contacté reste « Prospect » ; un client reste client");
    ok(r.liste.length === 1 && r.liste[0] === "CONTACTE WA" && r.cnt === "1" && r.cntP === "2", "onglet « Contactés » : 1 fiche ; l'onglet Prospects garde ses 2 fiches (statut enregistré inchangé)");
    ok(r.statutBase === "prospect" && r.html, "le statut enregistré reste « prospect » ; le badge « Contacté » apparaît dans la liste");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors[0] : ""));
    console.log("\nTOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });


