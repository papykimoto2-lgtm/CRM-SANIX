// SANIX CRM Pro : assistant IA de la fiche prospect rattaché à l'abonnement Claude (mission pour un agent en mode abonnement, résultat différé). node tests/cockpit_abonnement_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4454), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => {
      class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart;
      window.__rpc = []; window.__edge = 0; window.__etat = { statut: "aucune" };
      const realFetch = window.fetch.bind(window);
      window.fetch = (url, opt) => {
        const u = String(url);
        const J = (b, st = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: st, headers: { "Content-Type": "application/json" } }));
        if (u.includes("/rest/v1/rpc/ai_cockpit_demander")) { const b = JSON.parse(opt.body); window.__rpc.push(["demander", b]); window.__etat = { statut: "a_faire", task_id: "t1", demande_le: new Date().toISOString() }; return J({ task_id: "t1", deja: false }); }
        if (u.includes("/rest/v1/rpc/ai_cockpit_etat")) { window.__rpc.push(["etat", JSON.parse(opt.body)]); return J(window.__etat); }
        if (u.includes("/functions/v1/ai-sales-director")) { window.__edge++; return J({ error: "Plafond Anthropic atteint" }, 400); }
        return realFetch(url, opt);
      };
      sessionStorage.setItem("sanix_ais_session", JSON.stringify({ t: "tok", exp: Date.now() + 3600e3, email: "op@test.ci" }));
    });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4454/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { SB_CONFIG = SB_CONFIG || { url: "https://demo.supabase.co", key: "k" }; currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => { CLIENTS.push({ id: 999003, _rid: "rid-test-1", nom: "VICTOIRE IMMOBILIER", statut: "prospect", phone: "+2252522016322", email: "", secteur: "Immobilier", logiciel: "ImmoSuite ERP", adresse: "Cocody", commercial: "", date: new Date().toISOString().slice(0, 10), interactions: [], tags: [], notes: "" }); showClientDetail(999003); }); await page.waitForTimeout(500);
    console.log("▶ Assistant IA : abonnement Claude");
    ok((await page.locator("#ai-mode-btn").textContent()).includes("Abonnement Claude"), "mode par défaut : abonnement Claude");
    await page.evaluate(() => aiTab("strategie", document.querySelector(".ai-tab-btn")));
    await page.click("#modal-client-detail button:has(#ai-gen-lbl)"); await page.waitForTimeout(600);
    const r1 = await page.evaluate(() => window.__rpc.filter((x) => x[0] === "demander"));
    ok(r1.length === 1 && r1[0][1].p_onglet === "strategie" && r1[0][1].p_rid === "rid-test-1" && /VICTOIRE IMMOBILIER/.test(r1[0][1].p_prompt), "une demande est envoyée pour la fiche et l'onglet, avec la consigne du CRM");
    ok(await page.evaluate(() => window.__edge) === 0, "aucun appel à l'API Anthropic (fonction ai-sales-director)");
    ok(/Demande transmise à Claude via votre abonnement/.test(await page.locator("#ai-output").innerText()), "affichage : demande transmise, en attente");
    // l'exécuteur termine la mission : l'onglet se met à jour au prochain contrôle (accéléré)
    await page.evaluate(() => { window.__etat = { statut: "terminee", task_id: "t1", rapport: "STRATÉGIE : proposer une démonstration de 20 minutes.", demande_le: new Date().toISOString(), termine_le: new Date().toISOString() }; });
    await page.waitForFunction(() => /Rédigé par Claude/.test(document.getElementById("ai-output").innerText), null, { timeout: 20000 });
    ok(/proposer une démonstration de 20 minutes/.test(await page.locator("#ai-output").innerText()), "le texte rédigé par Claude s'affiche dans la fiche");
    ok(await page.locator("#ai-actions").isVisible(), "actions (copier, WhatsApp…) disponibles");
    // rouvrir : le résultat récent est réaffiché sans nouvelle demande
    const n0 = await page.evaluate(() => window.__rpc.filter((x) => x[0] === "demander").length);
    await page.evaluate(() => aiTab("strategie", document.querySelector(".ai-tab-btn"))); await page.click("#modal-client-detail button:has(#ai-gen-lbl)"); await page.waitForTimeout(500);
    ok((await page.evaluate(() => window.__rpc.filter((x) => x[0] === "demander").length)) === n0 && /Rédigé par Claude/.test(await page.locator("#ai-output").innerText()), "réouverture : résultat récent réaffiché, aucune nouvelle demande");
    // mode API : appel direct (et affichage de l'erreur de plafond)
    await page.click("#ai-mode-btn"); ok((await page.locator("#ai-mode-btn").textContent()).includes("API"), "bascule vers le mode API");
    await page.evaluate(() => aiTab("objections", document.querySelectorAll(".ai-tab-btn")[2])); await page.click("#modal-client-detail button:has(#ai-gen-lbl)"); await page.waitForTimeout(600);
    ok(await page.evaluate(() => window.__edge) === 1, "mode API : appel de ai-sales-director (comportement d'origine)");
    await page.click("#ai-mode-btn"); ok((await page.locator("#ai-mode-btn").textContent()).includes("Abonnement"), "retour au mode abonnement");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\nTous les contrôles passent.");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
