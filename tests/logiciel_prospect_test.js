// SANIX CRM Pro : le logiciel conseillé à un prospect respecte son secteur et son logiciel attribué (cas Lux'Alu → AluExpert). node logiciel_prospect_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4443), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://localhost:4443/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    const nom = (c) => page.evaluate((c) => { const b = cokBestLogiciel(c); return b ? b.nom : null; }, c);

    console.log("▶ Recommandation");
    ok((await nom({ nom: "LUX'ALU SOLUTIONS", secteur: "Industrie", logiciel: "Sanix AluExpert ERP" })) === "Sanix AluExpert ERP", "Lux'Alu (Industrie, AluExpert attribué) : AluExpert, plus Factory 4.0");
    ok((await nom({ nom: "Atelier Dupont", secteur: "Industrie", logiciel: "SANIX Factory 4.0" })) === "SANIX Factory 4.0", "un logiciel attribué qui convient au secteur n'est pas remplacé");
    ok((await nom({ nom: "Menuiserie Alu du Plateau", secteur: "Industrie", logiciel: "" })) === "Sanix AluExpert ERP", "sans logiciel : le nom « alu / menuiserie » désigne AluExpert");
    ok((await nom({ nom: "Usine de sachets plastiques", secteur: "Industrie", logiciel: "" })) === "SANIX Factory 4.0", "sans logiciel : « usine / sachets » désigne Factory 4.0");
    ok((await nom({ nom: "Société Y", secteur: "Industrie", logiciel: "" })) === "Sanix AluExpert ERP", "sans indice : le moins cher et le plus vendu du secteur, jamais « le plus cher »");
    ok((await nom({ nom: "Clinique Z", secteur: "Santé", logiciel: "Sanix AluExpert ERP" })) === "MediCore Suite", "un vrai écart (AluExpert attribué à une clinique) est signalé : MediCore");
    ok((await nom({ nom: "Cabinet", secteur: "Immobilier", logiciel: "ImmoSuite ERP" })) === "ImmoSuite ERP", "Immobilier : ImmoSuite");

    console.log("▶ Import de contacts");
    const imp = await page.evaluate(() => ({ a: importGuessLogiciel("Industrie", "Lux Alu Solutions"), b: importGuessLogiciel("Industrie", "Usine de sachets"), c: importGuessLogiciel("Industrie", ""), d: importGuessLogiciel("Santé", "Clinique"), s: importGuessSecteur("Lux Alu Solutions", ""), s2: importGuessSecteur("Menuiserie Inox", "") }));
    ok(imp.a === "Sanix AluExpert ERP" && imp.b === "SANIX Factory 4.0" && imp.c === "Sanix AluExpert ERP", "import Industrie : alu → AluExpert, usine → Factory, par défaut AluExpert");
    ok(imp.d === "MediCore Suite", "import Santé inchangé");
    ok(imp.s === "Industrie" && imp.s2 === "Industrie", "un nom contenant alu / menuiserie / inox est classé Industrie");

    console.log("▶ Fiche prospect et stratégie");
    const r = await page.evaluate(() => {
      const c = { id: 987001, nom: "LUX'ALU SOLUTIONS", statut: "prospect", secteur: "Industrie", logiciel: "Sanix AluExpert ERP", phone: "+22507678401", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      CLIENTS.push(c);
      const b = cokBestLogiciel(c); const mismatch = CLIENTS.filter((x) => x.statut === "prospect").map((x) => ({ x, b: cokBestLogiciel(x) })).filter((y) => y.b && y.b.nom !== y.x.logiciel && y.x.id === 987001).length;
      return { b: b && b.nom, mismatch, pitch: relanceBuildPitch(c) };
    });
    ok(r.mismatch === 0, "la stratégie ne propose plus de remplacer AluExpert de Lux'Alu");
    ok(/AluExpert/.test(r.pitch) && !/Factory/.test(r.pitch), "le message de relance WhatsApp présente AluExpert, pas Factory : " + r.pitch.slice(0, 60));
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    console.log("\nLogiciel conseillé aux prospects : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
