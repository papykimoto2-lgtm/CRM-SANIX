// SANIX CRM Pro : suggestions d'instructions à l'agent selon la situation du prospect (règles déterministes). node tests/fiche_suggestions_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4457), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => {
      class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart;
      window.__stage = "qualifie"; const realFetch = window.fetch.bind(window);
      const J = (b, st = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: st, headers: { "Content-Type": "application/json" } }));
      window.fetch = (url, opt) => {
        const u = String(url);
        if (u.includes("/rest/v1/rpc/crm_client_panel")) return J({ rid: "rid-sg-1", linked: true, prospect: { id: "11111111-aaaa-4aaa-8aaa-111111111111", stage: window.__stage, score: 82, produits: ["immosuite"], opt_out: false }, agent: { id: "22222222-bbbb-4bbb-8bbb-222222222222", code: "ia_qualif_1", nom: "IA Lead Qualifier", fonction: "Qualification" }, missions: [], rdv: [], offres: [], validations: [], events: [] });
        if (u.includes("/rest/v1/")) return J([]);
        return realFetch(url, opt);
      };
      sessionStorage.setItem("sanix_ais_session", JSON.stringify({ t: "tok", exp: Date.now() + 3600e3, email: "op@test.ci" }));
    });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4457/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { SB_CONFIG = SB_CONFIG || { url: "https://demo.supabase.co", key: "k" }; currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => { CLIENTS.push({ id: 999005, _rid: "rid-sg-1", nom: "YAPGI IMMOBILIER", statut: "prospect", phone: "+2250700000005", email: "contact@yapgi.ci", secteur: "Immobilier", logiciel: "ImmoSuite ERP", adresse: "Marcory", commercial: "", date: "2026-11-01", interactions: [], tags: [], notes: "" }); });
    const sg = (stage, extra = {}, c = {}) => page.evaluate(([stage, extra, c]) => { const cl = Object.assign({ id: 1, nom: "YAPGI IMMOBILIER", phone: "+2250700", email: "a@b.ci", logiciel: "ImmoSuite ERP", interactions: [] }, c); const p = Object.assign({ prospect: { stage, score: 82, produits: ["immosuite"], opt_out: false }, missions: [], rdv: [], offres: [] }, extra); const r = SanixCrmSync.suggestions(cl, p); return { opt: r.opt, ids: r.items.map((x) => x.id), prios: r.items.map((x) => x.prio), textes: r.items.map((x) => x.texte), situation: r.situation, ouvertes: r.ouvertes }; }, [stage, extra, c]);
    console.log("▶ Règles de suggestion");
    let r = await sg("enregistre"); ok(r.ids.includes("qualif"), "enregistré : « Qualifier le prospect »");
    r = await sg("qualifie"); ok(r.ids[0] === "premier" && r.prios[0] === 4 && /validation/.test(r.textes[0]) && /signature/.test(r.textes[0]), "qualifié (score élevé) : premier message soumis à validation, priorité haute, objectif de conversion");
    const jours = (n) => new Date(Date.now() - n * 864e5).toISOString();
    r = await sg("premier_contact", {}, { interactions: [{ date: jours(8), type: "E-mail non distribué", note: "adresse incorrecte" }] }); ok(r.ids.includes("mail") && r.ids.includes("relance"), "contacté, e-mail rejeté, sans réponse : corriger l'adresse et relancer autrement");
    r = await sg("conversation"); ok(r.ids.includes("besoin"), "conversation : cerner le besoin et proposer une démonstration");
    r = await sg("demo_realisee"); ok(r.ids.includes("offre"), "démonstration faite : rédiger l'offre");
    r = await sg("negociation"); ok(r.ids.includes("nego") && r.prios[r.ids.indexOf("nego")] === 5, "négociation : relancer l'offre, priorité urgente");
    r = await sg("en_veille"); ok(r.ids.includes("reveil"), "en veille : programmer une réactivation");
    r = await sg("qualifie", { prospect: { stage: "qualifie", score: 82, opt_out: true } }); ok(r.opt && r.ids.length === 1 && r.ids[0] === "veille", "désinscrit : seule suggestion « mettre en veille », aucun contact");
    r = await sg("qualifie", { missions: [{ statut: "en_cours" }, { statut: "terminee" }] }); ok(r.ouvertes === 1 && /1 mission\(s\) ouverte/.test(r.situation), "mission déjà ouverte comptée dans la situation");
    r = await sg("qualifie", {}, { phone: "", email: "" }); ok(r.ids.includes("coord"), "sans téléphone ni e-mail : retrouver les coordonnées");
    r = await sg("qualifie", {}, { interactions: [{ date: jours(30), type: "Appel", note: "" }] }); ok(r.ids.includes("inactif"), "inactif depuis 30 jours : réveiller le dossier");
    r = await sg("qualifie", { prospect: { stage: "enregistre", score: 20 } }); ok(r.ids.includes("fiable"), "score faible : vérifier la fiabilité de la fiche");
    r = await sg("qualifie", {}, { phone: "", email: "", interactions: [{ date: jours(30), type: "Appel", note: "" }, { date: jours(40), type: "E-mail non distribué", note: "" }] }); ok(r.ids.length <= 4, "au plus 4 suggestions (" + r.ids.length + ")");
    console.log("▶ Affichage et clic");
    await page.evaluate(() => { showClientDetail(999005); }); await page.waitForTimeout(500);
    await page.evaluate(() => SanixCrmSync.clientPanel(999005)); await page.waitForSelector("#crm-instr", { timeout: 8000 });
    ok(/suggestion/.test(await page.locator("#crm-instr summary").innerText()), "badge « n suggestions » dans le titre du bloc");
    await page.click("#crm-instr summary");
    ok(await page.locator("#crm-instr button:has-text('Préparer le premier message')").isVisible(), "puce « Préparer le premier message » affichée");
    await page.click("#crm-instr button:has-text('Préparer le premier message')");
    const v = await page.inputValue("#crm-instr-txt"), prio = await page.inputValue("#crm-instr-prio");
    ok(/YAPGI IMMOBILIER/.test(v) && /validation/.test(v) && prio === "4", "clic : l'instruction remplit le champ (modifiable) et règle la priorité (" + prio + ")");
    await page.screenshot({ path: (process.env.SHOT_DIR || "/tmp") + "/crm_suggestions.png" });
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\nTous les contrôles passent.");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
