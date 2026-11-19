// SANIX CRM Pro : écran « Crédit IA » (solde, plafonds, déclaration). node credit_ia_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4241), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4241/index.html"); await page.waitForTimeout(1200);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(2000);
    await page.evaluate(() => {
      window.__rpc = []; window.__solde = 80.4;
      window.aisApi = async (p, o) => {
        const b = o && o.body ? JSON.parse(o.body) : {}; window.__rpc.push({ p, b });
        if (p.includes("ai_credit_status")) return { saisi: true, solde_usd: window.__solde, base_usd: 80.89, base_at: "2026-11-19T19:38:45Z", depense_depuis_usd: 0.49, recharges_depuis_usd: 0, rythme_jour_usd: 1.2, jours_restants: window.__solde / 1.2 | 0 };
        if (p.includes("ai_cost_center")) return b.p_days === 7 ? { periode_usd: 4, agents: [{ tokens_in: 100000, tokens_out: 20000 }] } : { jour_usd: 0.5, mois_usd: 9.12, prevision_fin_mois_usd: 13.4, budget_jour_usd: 7, budget_mois_usd: 20, jours: [{ jour: "2026-11-18", cout_usd: 3, appels: 20, erreurs: 1 }, { jour: "2026-11-19", cout_usd: 0.5, appels: 4, erreurs: 0 }], modeles: [{ modele: "claude-sonnet-5-5", cout_usd: 8, appels: 30, erreurs: 2 }], agents: [{ nom: "SANIX AI GENERAL DIRECTOR", fonction: "Directeur", cout_usd: 5, appels: 10 }] };
        if (p.includes("ai_credit_ajouter")) { window.__solde = b.p_montant; return { ok: true }; }
        return null;
      };
    });
    console.log("▶ Navigation");
    await page.evaluate(() => navGroup("pilot", null)); await page.waitForTimeout(300);
    ok((await page.locator(".grp-tab", { hasText: "Crédit IA" }).count()) >= 1, "onglet « Crédit IA » dans le groupe Pilotage");
    await page.evaluate(() => navigate("creditia", null)); await page.waitForTimeout(800);
    ok(await page.locator("#view-creditia").isVisible(), "l'écran Crédit IA s'affiche");
    console.log("▶ Solde et tableau de bord");
    const t = (await page.locator("#cr-body").innerText()).replace(/[  ]/g, " ");
    ok(t.includes("80,40 $") && t.includes("80,89 $"), "solde estimé 80,40 $ et dernier relevé 80,89 $");
    ok(t.includes("46 %") && t.includes("plafond 20,00 $"), "plafond mensuel : 9,12 $ sur 20 $, 46 % utilisé");
    ok(t.includes("150 000") === false && t.includes("100 000") && t.includes("20 000"), "volume de jetons sur 7 jours affiché");
    ok(t.includes("claude-sonnet-5-5") && t.includes("SANIX AI GENERAL DIRECTOR"), "dépenses par modèle et par collaborateur");
    ok((await page.locator('#cr-body [role="img"] > div').count()) === 2, "courbe : une barre par jour");
    ok(t.includes("La Console Anthropic fait foi"), "note : le solde est estimé, la Console fait foi");
    ok(await page.evaluate(() => window.__rpc.filter((c) => c.p.includes("ai_cost_center")).length === 2), "deux lectures du centre des coûts (30 et 7 jours)");
    console.log("▶ Déclarer un solde");
    await page.locator('[data-act="form-ouvrir"]').click(); await page.waitForTimeout(200);
    await page.locator('#cr-form [name="montant"]').fill("-3"); await page.locator('#cr-form button[type="submit"]').click(); await page.waitForTimeout(150);
    ok(!(await page.evaluate(() => window.__rpc.some((c) => c.p.includes("ai_credit_ajouter")))), "montant négatif refusé avant tout envoi");
    await page.locator('#cr-form [name="montant"]').fill("95.5"); await page.locator('#cr-form [name="note"]').fill("Console"); await page.locator('#cr-form button[type="submit"]').click(); await page.waitForTimeout(600);
    ok(await page.evaluate(() => window.__rpc.some((c) => c.p.includes("ai_credit_ajouter") && c.b.p_type === "solde_constate" && c.b.p_montant === 95.5 && c.b.p_note === "Console")), "solde constaté enregistré avec sa note");
    ok((await page.locator("#cr-body").innerText()).replace(/[  ]/g, " ").includes("95,50 $"), "le nouveau solde s'affiche après enregistrement");
    console.log("▶ Alerte de crédit bas");
    await page.evaluate(() => { window.__solde = 3; }); await page.locator('[data-act="actualiser"]').first().click(); await page.waitForTimeout(500);
    ok((await page.locator("#cr-body .alert-warn").first().innerText()).includes("Crédit bas"), "alerte « crédit bas » sous 5 $");
    console.log("▶ Sans session de l'agent");
    await page.evaluate(() => { window.aisApi = async () => { throw new Error("Connectez l'agent IA (session opérateur)"); }; });
    await page.locator('[data-act="actualiser"]').first().click(); await page.waitForTimeout(400);
    ok((await page.locator("#cr-body").innerText()).includes("Connectez l'agent IA"), "message clair quand l'agent n'est pas connecté");
    ok(!(await page.locator("#view-creditia").innerHTML()).includes("<script"), "aucun script injecté");
    ok(errors.length === 0, "aucune erreur JavaScript (" + errors.join(" | ") + ")");
  } finally { await browser.close(); server.close(); }
  console.log("\nTOUT EST OK");
})().catch((e) => { console.error(e.message); process.exit(1); });
