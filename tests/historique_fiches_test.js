// SANIX CRM Pro : historiques des fiches (alertes lisibles, changements d'étape tracés pour le suivi de la stratégie). node historique_fiches_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4444), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://localhost:4444/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);

    console.log("▶ Notes d'historique lisibles");
    const RAW = "400 {”type”:”error”,”error”:{”type”:”invalid_request_error”,”message”:”Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing.”},”request_id”:”req_01”";
    const l = await page.evaluate((RAW) => ({ a: histNoteLisible(RAW), b: histNoteLisible("Mission « X » bloquée"), c: histNoteLisible('429 {"type":"error","error":{"type":"rate_limit_error"}}'), d: histNoteLisible('500 {"type":"error","error":{"message":"Panne interne du service"}}') }), RAW);
    ok(/^Crédit Anthropic insuffisant/.test(l.a), "crédit épuisé : phrase claire");
    ok(l.b === "Mission « X » bloquée", "un texte normal reste intact");
    ok(/^Limite de requêtes/.test(l.c) && l.d === "Panne interne du service", "limite de requêtes et message utile extrait du JSON");

    console.log("▶ Fiche client : historique lisible, sans débordement");
    const r = await page.evaluate((RAW) => {
      const c = { id: 987100, nom: "LUX'ALU TEST", statut: "prospect", secteur: "Industrie", logiciel: "Sanix AluExpert ERP", phone: "+22507000001", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        interactions: [{ date: "2026-11-10T21:46:03Z", type: "Alerte IA (attention)", note: RAW, ico: "🤖" }, { date: "2026-11-09T10:00:00Z", type: "Contact établi", note: "Étape mise à jour manuellement", etape: 1, ico: "📞" }] };
      CLIENTS.push(c); showClientDetail(c.id);
      const m = document.getElementById("modal-client-detail"); const t = m.innerText.replace(/\s+/g, " ");
      const boxes = [...m.querySelectorAll("div")].filter((d) => d.style.maxHeight === "280px");
      return { lisible: t.includes("Crédit Anthropic insuffisant"), brut: /invalid_request_error|request_id/.test(t), deborde: boxes.some((b) => b.scrollWidth > b.clientWidth + 1), boxes: boxes.length };
    }, RAW);
    ok(r.lisible && !r.brut, "la fiche affiche « Crédit Anthropic insuffisant » et non le JSON brut");
    ok(r.boxes === 1 && !r.deborde, "le texte passe à la ligne : plus de débordement horizontal");
    await page.evaluate(() => document.getElementById("modal-client-detail").classList.add("hidden"));

    console.log("▶ Changements d'étape tracés dans la fiche pipeline");
    const s = await page.evaluate(() => {
      const hier = new Date(Date.now() - 864e5).toISOString();
      const c = { id: 987200, nom: "ATELIER ALU TEST", statut: "prospect", secteur: "Industrie", logiciel: "Sanix AluExpert ERP", phone: "+22507000002", commercial: "Test", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), interactions: [] };
      CLIENTS.push(c); syncProspectsToPipeline();
      const d = DEALS.find((x) => x.clientId === c.id); const n0 = d.history.length, st0 = d.stage;
      c.interactions.push({ date: hier, type: "Contact établi", note: "Appel", etape: 1, ico: "📞" }); syncProspectsToPipeline();
      c.interactions.push({ date: new Date().toISOString(), type: "Démo réalisée", note: "Démo", etape: 2, ico: "🎬" }); syncProspectsToPipeline();
      const sc = d.history.filter((h) => h.type === "stage_change");
      syncProspectsToPipeline();                                         // rien n'a changé : aucune ligne en plus
      const n1 = d.history.filter((h) => h.type === "stage_change").length;
      const sem = SanixStrategie.semaine([], DEALS, { now: new Date().toISOString().slice(0, 10) }).lignes.find((x) => x.famille === "Sanix AluExpert ERP");
      c.statut = "client"; syncDealForClient(c.id);
      const gagne = d.history.filter((h) => h.type === "stage_change").pop();
      return { st0, notes: sc.map((h) => h.note), date1: sc[0] && sc[0].date, hier, n1, contacts: sem && sem.contacts, demos: sem && sem.demos, gagne: gagne && gagne.note, stage: d.stage };
    });
    ok(s.st0 === "prospect" && s.notes.length === 2, "chaque avancée laisse une ligne dans la fiche pipeline : " + s.notes.join(" | "));
    ok(/Prospect → Contact/.test(s.notes[0]) && /Contact → Démo/.test(s.notes[1]), "notes de la forme « ancienne étape → nouvelle étape »");
    ok(s.date1 === s.hier, "la ligne porte la date du vrai échange, pas celle de la synchronisation");
    ok(s.n1 === 2, "une synchronisation sans changement n'ajoute rien");
    ok(s.contacts >= 1 && s.demos >= 1, "le suivi hebdomadaire de la stratégie compte le contact et la démo (" + s.contacts + " contact, " + s.demos + " démo)");
    ok(/→ Gagné/.test(s.gagne) && s.stage === "gagne", "la conversion en client est tracée : " + s.gagne);
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    console.log("\nHistoriques des fiches : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
