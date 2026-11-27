// SANIX CRM Pro : instruction à l'agent responsable depuis la fiche prospect (mission créée via crm_assign_mission). node tests/fiche_instruction_agent_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4456), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => {
      class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart;
      window.__calls = []; window.__mode = "ok";
      const realFetch = window.fetch.bind(window);
      const J = (b, st = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: st, headers: { "Content-Type": "application/json" } }));
      window.fetch = (url, opt) => {
        const u = String(url);
        if (u.includes("/rest/v1/rpc/crm_client_panel")) return J({ rid: "rid-instr-1", linked: true, prospect: { id: "11111111-aaaa-4aaa-8aaa-111111111111", stage: "enregistre", score: 43, produits: ["immosuite"] }, agent: { id: "22222222-bbbb-4bbb-8bbb-222222222222", code: "ia_qualif_1", nom: "IA Lead Qualifier", fonction: "Qualification commerciale" }, missions: [], rdv: [], offres: [], validations: [], events: [] });
        if (u.includes("/rest/v1/rpc/crm_assign_mission")) { const b = JSON.parse(opt.body); window.__calls.push(b); if (window.__mode === "refus") return J({ message: "Réservé à la direction", code: "42501" }, 403); if (window.__mode === "doublon") return J({ message: "duplicate key", code: "23505" }, 409); return J("33333333-cccc-4ccc-8ccc-333333333333"); }
        if (u.includes("/rest/v1/")) return J([]);
        return realFetch(url, opt);
      };
      sessionStorage.setItem("sanix_ais_session", JSON.stringify({ t: "tok", exp: Date.now() + 3600e3, email: "op@test.ci" }));
    });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4456/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { SB_CONFIG = SB_CONFIG || { url: "https://demo.supabase.co", key: "k" }; currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => { CLIENTS.push({ id: 999004, _rid: "rid-instr-1", nom: "SCI LE LIBERATEUR", statut: "prospect", phone: "+2250700000004", email: "", secteur: "Immobilier", logiciel: "ImmoSuite ERP", adresse: "Cocody", commercial: "", date: new Date().toISOString().slice(0, 10), interactions: [], tags: [], notes: "" }); showClientDetail(999004); }); await page.waitForTimeout(600);
    await page.evaluate(() => SanixCrmSync.clientPanel(999004)); await page.waitForSelector("#crm-instr", { timeout: 8000 });
    console.log("▶ Instruction à l'agent responsable");
    ok(/Donner une instruction à IA Lead Qualifier/.test(await page.locator("#crm-instr summary").innerText()), "bloc « Donner une instruction à <agent> » présent dans la fiche");
    await page.click("#crm-instr summary");
    await page.click("#crm-instr-btn"); await page.waitForTimeout(300);
    ok((await page.evaluate(() => window.__calls.length)) === 0, "instruction vide : rien n'est envoyé");
    await page.fill("#crm-instr-txt", "Relance ce prospect par WhatsApp demain matin et propose une démonstration."); await page.selectOption("#crm-instr-prio", "4");
    // un rafraîchissement du panneau pendant la saisie ne perd pas le texte
    await page.evaluate(() => SanixCrmSync.clientPanel(999004)); await page.waitForTimeout(500);
    ok((await page.inputValue("#crm-instr-txt")).startsWith("Relance ce prospect"), "le brouillon survit à un rafraîchissement du panneau");
    await page.click("#crm-instr-btn"); await page.waitForTimeout(400);
    const c = await page.evaluate(() => window.__calls);
    ok(c.length === 1 && c[0].p_agent === "22222222-bbbb-4bbb-8bbb-222222222222" && c[0].p_prospect === "11111111-aaaa-4aaa-8aaa-111111111111", "mission créée pour l'agent responsable et le prospect de la fiche");
    ok(c[0].p_priorite === 4 && /^Instruction du CRM : Relance ce prospect/.test(c[0].p_titre) && /Instruction du président/.test(c[0].p_description) && /demain matin/.test(c[0].p_description), "priorité, titre et texte de l'instruction transmis");
    ok((await page.inputValue("#crm-instr-txt").catch(() => "")) === "", "après l'envoi : champ vidé");
    ok(/Instruction transmise à IA Lead Qualifier/.test(await page.evaluate(() => document.body.innerText)), "confirmation affichée");
    // refus (hors direction) et doublon : messages clairs, bouton réactivé
    for (const [mode, re] of [["refus", /Réservé à la direction/], ["doublon", /identique est déjà en cours/]]) {
      await page.evaluate((m) => { window.__mode = m; }, mode);
      await page.click("#crm-instr summary").catch(() => {}); if (!(await page.locator("#crm-instr-txt").isVisible())) await page.evaluate(() => { document.getElementById("crm-instr").open = true; });
      await page.fill("#crm-instr-txt", "Nouvelle consigne de test " + mode); await page.click("#crm-instr-btn"); await page.waitForTimeout(500);
      ok(re.test(await page.evaluate(() => document.body.innerText)) && !(await page.locator("#crm-instr-btn").isDisabled()), mode + " : message explicite, bouton réactivé");
    }
    await page.screenshot({ path: (process.env.SHOT_DIR || "/tmp") + "/crm_instruction.png" });
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\nTous les contrôles passent.");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
