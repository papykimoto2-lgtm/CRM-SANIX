// SANIX CRM Pro : adresse stable de la démo (écran Présentations & Démos). node demo_adresse_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4244), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4244/index.html"); await page.waitForTimeout(1200);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1800);
    await page.evaluate(() => { window.__v = []; window.__etat = { configure: false, projet: "crm-sanix", branche: "demo", domaines: [] };
      window.aisApi = async (p, o) => { const b = o && o.body ? JSON.parse(o.body) : {}; window.__v.push({ p, b });
        if (!p.includes("crm-vercel")) return null;
        if (b.action === "status") return window.__etat;
        if (b.action === "attach") { if (b.domaine === "crm-sanix.vercel.app") throw new Error("Cette adresse est celle de la production"); return { ok: true, domaine: b.domaine, branche: "demo", verifie: true, verification: [], url: "https://" + b.domaine }; }
        return null; }; });
    await page.evaluate(() => navigate("presentations", null)); await page.waitForTimeout(800);
    console.log("▶ Vercel non relié");
    ok(await page.locator("#demo-adresse").isVisible(), "carte « Adresse stable de la démo » affichée");
    ok((await page.locator("#demo-adresse").innerText()).includes("VERCEL_TOKEN"), "explique le secret à ajouter côté Supabase (jamais dans le CRM)");
    ok(await page.locator("#demo-attach").isDisabled(), "bouton Vercel désactivé tant que le jeton manque");
    await page.locator("#demo-dom").fill("n'importe quoi"); await page.locator("#demo-save").click(); await page.waitForTimeout(200);
    ok((await page.locator("#demo-adresse").innerText()).includes("Adresse invalide"), "adresse invalide refusée");
    await page.locator("#demo-dom").fill("https://Sanix-Demo.vercel.app/"); await page.locator("#demo-save").click(); await page.waitForTimeout(200);
    const cat = await page.evaluate(() => ({ d: LOGICIELS.find((l) => l.id === "log_sanixcrm").demo, c: CONFIG.demoUrl }));
    ok(cat.d === "https://sanix-demo.vercel.app" && cat.c === cat.d, "enregistrement seul : catalogue (SANIX CRM Pro) et réglage mis à jour");
    ok(!(await page.evaluate(() => window.__v.some((x) => x.b.action === "attach"))), "enregistrement seul : aucun appel Vercel");
    console.log("▶ Vercel relié");
    await page.evaluate(() => { window.__etat = { configure: true, projet: "crm-sanix", branche: "demo", domaines: [{ nom: "crm-sanix.vercel.app", branche: null, verifie: true }] }; });
    await page.evaluate(() => demoBrancheRender(true)); await page.waitForTimeout(300);
    ok(await page.locator("#demo-attach").isEnabled() && (await page.locator("#demo-adresse").innerText()).includes("crm-sanix.vercel.app → production"), "bouton actif, domaines listés avec leur branche");
    await page.locator("#demo-dom").fill("sanix-demo2.vercel.app"); await page.locator("#demo-attach").click(); await page.waitForTimeout(500);
    const att = await page.evaluate(() => ({ n: window.__v.filter((x) => x.b.action === "attach").length, d: LOGICIELS.find((l) => l.id === "log_sanixcrm").demo }));
    ok(att.n === 1 && att.d === "https://sanix-demo2.vercel.app", "attribution : un seul appel, adresse enregistrée dans le catalogue");
    ok((await page.locator("#demo-adresse").innerText()).includes("attribué à la branche"), "confirmation affichée");
    await page.locator("#demo-dom").fill("crm-sanix.vercel.app"); await page.locator("#demo-attach").click(); await page.waitForTimeout(400);
    ok((await page.locator("#demo-adresse").innerText()).includes("production") && await page.evaluate(() => LOGICIELS.find((l) => l.id === "log_sanixcrm").demo) === "https://sanix-demo2.vercel.app", "refus par le serveur : message affiché, catalogue inchangé");
    ok(errors.length === 0, "aucune erreur JavaScript (" + errors.join("; ") + ")");
    console.log("\nTOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
