// SANIX CRM Pro : démos interactives par logiciel (dossier demo/), construites avec le CRM. node demos_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const fs = require("fs"), path = require("path");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4245), browser = await chromium.launch();
  try {
    const dir = path.join(__dirname, "..", "demo"), fichiers = fs.readdirSync(dir).filter((f) => f.endsWith(".html") && f !== "index.html");
    console.log("▶ Contenu des " + fichiers.length + " démos");
    const tout = fichiers.concat(["index.html"]).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
    const externes = [...tout.matchAll(/(?:href|src|action)="(https?:\/\/[^"]+)/g)].map((m) => m[1]).filter((u) => !u.startsWith("https://wa.me/"));
    ok(externes.length === 0, "aucun lien étranger (hors WhatsApp) " + externes.slice(0, 3).join(" "));
    ok(!/immo-suite\.vercel\.app|angelsgroups|menco-holding/.test(tout), "aucune adresse de démo externe");
    ok(/Démo interactive — <b>données fictives<\/b>/.test(tout) && !/supabase|localStorage|fetch\(|XMLHttpRequest/i.test(tout.replace(/Supabase Sync/gi, "")), "bandeau « données fictives », aucun accès réseau ni stockage");
    console.log("▶ Navigation (navigateur)");
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } }), errs = [];
    page.on("pageerror", (e) => errs.push(e.message)); page.on("requestfailed", (r) => errs.push("req " + r.url()));
    let nbMods = 0;
    for (const f of fichiers) {
      await page.goto("file://" + path.join(dir, f)); const n = await page.locator("#nav button").count(); nbMods += n - 1;
      if (n < 4) throw new Error("ÉCHEC : trop peu de modules dans " + f);
    }
    ok(nbMods > 150, "chaque démo propose ses modules du catalogue (" + nbMods + " modules au total)");
    await page.goto("file://" + path.join(dir, "immosuite-erp.html"));
    ok(!(await page.locator("#nav").innerText()).match(/Supabase|Sync|Offline|PWA/i), "les fonctions techniques ne sont pas présentées comme des modules");
    await page.locator("#nav button", { hasText: "Ventes" }).click();
    const lignes = () => page.locator("tbody tr").count(), avant = await lignes();
    ok(avant === 8, "module Ventes : 8 lignes d'exemple");
    await page.locator("#q").fill("Savane"); const filtrees = await lignes(); ok(filtrees < avant, "la recherche filtre (" + filtrees + ")");
    await page.locator("#q").fill(""); await page.locator("th", { hasText: "Montant" }).click();
    const m1 = (await page.locator("tbody tr td:nth-child(4)").allInnerTexts()).map((t) => Number(t.replace(/\s| /g, "").replace(/\D/g, "")));
    ok(m1.every((v, i) => i === 0 || m1[i - 1] <= v), "tri par montant croissant");
    await page.locator("#add").click(); ok((await lignes()) === avant + 1, "ajout d'une ligne d'exemple");
    await page.locator("tbody .x").first().click(); ok((await lignes()) === avant, "suppression d'une ligne");
    ok((await page.locator("#cta").getAttribute("href")).startsWith("https://wa.me/225") && (await page.locator("a.btn.g").getAttribute("href")) === "../landing/immosuite-erp.html", "boutons : WhatsApp et retour à la présentation");
    while (await page.locator("tbody .x").count()) await page.locator("tbody .x").first().click();
    await page.locator("#add").click(); ok((await lignes()) === 1 && errs.length === 0, "tout supprimer puis ajouter une ligne : fonctionne, sans erreur");
    await page.locator("#nav button").first().click(); ok((await page.locator(".bar div").count()) === 6, "vue d'ensemble avec graphique");
    ok(errs.length === 0, "aucune erreur ni requête échouée (" + errs.slice(0, 3).join("; ") + ")");
    console.log("▶ Liens depuis les pages et messages");
    const landing = fs.readFileSync(path.join(__dirname, "..", "landing", "immosuite-erp.html"), "utf8");
    ok(landing.includes('href="../demo/immosuite-erp.html"') && fichiers.every((f) => fs.existsSync(path.join(__dirname, "..", "landing", f))), "la présentation renvoie vers la démo ; chaque démo a sa présentation");
    const ctx = await browser.newContext(); await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort()); await require("./helpers/crm_fixture.js").installer(ctx, { sansDonnees: true });
    await ctx.addInitScript(() => { class C { constructor() {} update() {} destroy() {} resize() {} static register() {} } C.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = C; });
    const p2 = await ctx.newPage(); await p2.goto("http://localhost:4245/index.html"); await p2.waitForTimeout(1200);
    await p2.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await p2.waitForTimeout(1500);
    const m = await p2.evaluate(() => { const l = LOGICIELS.find((x) => x.id === "log_immo"); l.demo = ""; const vide = fcFill("{demo_line}", { logiciel: "ImmoSuite ERP" }); const a = LOGICIELS.find((x) => x.id === "log_aluexpert"); return { vide, alu: fcFill("{demo_line}", { logiciel: a.nom }), alUrl: a.demo }; });
    ok(m.vide.includes("https://crm-sanix.vercel.app/demo/immosuite-erp.html") && /sans compte/.test(m.vide), "logiciel sans démo propre : les messages donnent la démo interactive du CRM");
    ok(m.alu.includes(m.alUrl), "logiciel avec sa propre démo : son adresse est conservée");
    console.log("\nTOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
