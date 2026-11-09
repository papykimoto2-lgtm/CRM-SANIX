// SANIX CRM Pro : configuration Supabase = clé PUBLIQUE uniquement ; identité publiée pour SANIX AI VIRTUAL COMPANY. node crm_config_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (role) => `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ iss: "supabase", role })}.signature`;

(async () => {
  const server = await start(4215), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } }, scale: {} }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("dialog", (d) => { errors.push("DIALOG: " + d.message()); d.dismiss(); });
    await page.goto("http://localhost:4215/index.html"); await page.waitForTimeout(1200);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(2200);
    const SECRET_LIKE = "bm90IGEgcHVibGljIGtleSwganVzdCBhIHNlY3JldC1saWtlIGJhc2U2NCBzdHJpbmcgZm9yIHRoZSB0ZXN0IHB1cnBvc2VzIG9ubHk=";

    console.log("▶ Clé publique uniquement");
    const probe = (k) => page.evaluate((k) => sbKeyProblem(k), k);
    ok((await probe("sb_publishable_abcdefghijklmnopqrstuvwxyz")) === "", "clé « publishable » acceptée");
    ok((await probe(jwt("anon"))) === "", "clé « anon » (JWT, rôle anon) acceptée");
    ok(/SECRÈTE/.test(await probe(jwt("service_role"))), "clé service_role refusée (secrète)");
    ok(/SECRÈTE/.test(await probe("sb_secret_abcdefghijklmnopqrstuvwxyz")), "clé sb_secret_ refusée (secrète)");
    ok(/pas une clé publique/.test(await probe(SECRET_LIKE)) && /JWT Secret/.test(await probe(SECRET_LIKE)), "valeur de type « JWT Secret » refusée, avec explication");
    ok(/pas une clé publique/.test(await probe("nimportequoi")), "valeur quelconque refusée");

    console.log("▶ Enregistrement et chargement");
    await page.evaluate(() => paramTab("sync", null)); await page.waitForTimeout(400);
    ok((await page.inputValue("#sb-url")) === "https://izgpvhwhbrgeagjfhfli.supabase.co", "aucune configuration : l'URL du projet SANIX est proposée par défaut");
    await page.fill("#sb-key", SECRET_LIKE); await page.evaluate(() => saveSbConfig());
    ok(/pas une clé publique/.test(await page.locator("#conn-msg").innerText()) && (await page.evaluate(() => lsLoad("supabase_config"))) === null, "enregistrement refusé : rien n'est stocké");
    await page.fill("#sb-key", "sb_publishable_abcdefghijklmnopqrstuvwxyz"); await page.evaluate(() => saveSbConfig());
    ok((await page.evaluate(() => lsLoad("supabase_config"))).key.startsWith("sb_publishable_"), "clé publique enregistrée");
    // valeur non publique déjà stockée (saisie antérieure) : refusée, effacée, URL conservée
    await page.evaluate((k) => { SB_CONFIG = null; localStorage.setItem("sanix_crm_supabase_config", JSON.stringify({ url: "https://izgp.supabase.co", key: k })); }, SECRET_LIKE);
    const loaded = await page.evaluate(() => loadSbConfig());
    const after = await page.evaluate(() => lsLoad("supabase_config"));
    ok(loaded === false && (await page.evaluate(() => SB_CONFIG)) === null && after.key === "" && after.url === "https://izgp.supabase.co", "clé non publique déjà stockée : non utilisée, effacée du navigateur, URL conservée");

    console.log("▶ Accès commun avec SANIX AI VIRTUAL COMPANY");
    const who = await page.evaluate(() => ({ me: lsLoad("whoami"), dir: lsLoad("directory") }));
    ok(who.me.login === "kessie" && !!who.me.email && who.dir.some((u) => u.login === "kessie"), "identité publique publiée (identifiant, e-mail, nom)");
    ok(!JSON.stringify(who).match(/hash|pass/i), "aucun mot de passe ni empreinte dans l'identité publiée");
    ok(errors.length === 0, `aucune erreur (${errors.join(" | ")})`);
    console.log("\nTOUT EST OK");
  } catch (e) { console.error("\n" + e.message); process.exitCode = 1; }
  await browser.close(); server.close();
})();
