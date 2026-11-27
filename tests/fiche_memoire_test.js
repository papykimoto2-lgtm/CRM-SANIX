// SANIX CRM Pro : mémoire du dossier dans la fiche prospect. node tests/fiche_memoire_test.js
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
      window.__calls = []; window.__mode = "ok"; window.__mem = [{ id: 1, contenu: "Décideur : le DG, préfère WhatsApp le matin", categorie: "interlocuteur", auteur: "agent:lead-qualifier" }];
      const realFetch = window.fetch.bind(window);
      const J = (b, st = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: st, headers: { "Content-Type": "application/json" } }));
      window.fetch = (url, opt) => {
        const u = String(url);
        if (u.includes("/rest/v1/rpc/crm_client_panel")) return J({ rid: "rid-mem-1", linked: true, prospect: { id: "11111111-aaaa-4aaa-8aaa-111111111111", stage: "enregistre", score: 43, produits: ["immosuite"] }, agent: { id: "22222222-bbbb-4bbb-8bbb-222222222222", code: "ia_qualif_1", nom: "IA Lead Qualifier", fonction: "Qualification commerciale" }, missions: [], rdv: [], offres: [], validations: [], events: [] });
        if (u.includes("/rest/v1/rpc/ai_prospect_memoire")) return J(window.__mem);
        if (u.includes("/rest/v1/rpc/ai_prospect_memoriser")) { const b = JSON.parse(opt.body); window.__calls.push(["add", b]); if (window.__mode === "refus") return J({ message: "Réservé aux opérateurs", code: "42501" }, 403); if (window.__mode === "secret") return J({ message: "Refusé : ne mémorisez jamais de secret ni de mot de passe", code: "P0001" }, 400); window.__mem.unshift({ id: 7, contenu: b.p_contenu, categorie: b.p_categorie, auteur: "direction" }); return J({ ok: true, id: 7 }); }
        if (u.includes("/rest/v1/rpc/ai_prospect_oublier")) { const b = JSON.parse(opt.body); window.__calls.push(["del", b]); window.__mem = window.__mem.filter((m) => m.id !== b.p_id); return J(null); }
        if (u.includes("/rest/v1/")) return J([]);
        return realFetch(url, opt);
      };
      sessionStorage.setItem("sanix_ais_session", JSON.stringify({ t: "tok", exp: Date.now() + 3600e3, email: "op@test.ci" }));
    });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4457/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { SB_CONFIG = SB_CONFIG || { url: "https://demo.supabase.co", key: "k" }; currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => { CLIENTS.push({ id: 999004, _rid: "rid-mem-1", nom: "SCI LE LIBERATEUR", statut: "prospect", phone: "+2250700000004", email: "", secteur: "Immobilier", logiciel: "ImmoSuite ERP", adresse: "Cocody", commercial: "", date: new Date().toISOString().slice(0, 10), interactions: [], tags: [], notes: "" }); showClientDetail(999004); }); await page.waitForTimeout(600);
    await page.evaluate(() => SanixCrmSync.clientPanel(999004)); await page.waitForSelector("#crm-instr", { timeout: 8000 });
    console.log("▶ Mémoire du dossier");
    await page.waitForSelector("#crm-mem", { timeout: 8000 }); await page.waitForTimeout(500);
    ok(/Décideur : le DG/.test(await page.locator("#crm-mem").innerText()) && /agent lead-qualifier/.test(await page.locator("#crm-mem").innerText()), "souvenirs affichés avec leur auteur");
    await page.fill("#crm-mem-txt", "Objection : prix jugé élevé"); await page.selectOption("#crm-mem-cat", "objection"); await page.click("#crm-mem .btn-primary"); await page.waitForTimeout(600);
    const c = await page.evaluate(() => window.__calls);
    ok(c[0][0] === "add" && c[0][1].p_prospect === "11111111-aaaa-4aaa-8aaa-111111111111" && c[0][1].p_categorie === "objection" && /prix jugé élevé/.test(c[0][1].p_contenu), "souvenir envoyé pour le prospect de la fiche");
    await page.waitForTimeout(500);
    ok(/prix jugé élevé/.test(await page.locator("#crm-mem").innerText()), "souvenir visible après ajout");
    await page.evaluate(() => { window.__mode = "secret"; }); await page.fill("#crm-mem-txt", "mot de passe: abc"); await page.click("#crm-mem .btn-primary"); await page.waitForTimeout(500);
    ok(/ne mémorisez jamais de secret/.test(await page.evaluate(() => document.body.innerText)), "secret refusé : message explicite");
    await page.evaluate(() => { window.__mode = "refus"; }); await page.fill("#crm-mem-txt", "autre souvenir"); await page.click("#crm-mem .btn-primary"); await page.waitForTimeout(500);
    ok(/Réservé aux opérateurs/.test(await page.evaluate(() => document.body.innerText)), "refus : message explicite");
    await page.locator("#crm-mem button[title=Oublier]").first().click(); await page.waitForTimeout(600);
    ok((await page.evaluate(() => window.__calls)).some((x) => x[0] === "del"), "oubli envoyé");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\nTous les contrôles passent.");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
