// SANIX CRM Pro : la landing page est jointe à chaque message prospect (WhatsApp, SMS, e-mail). node landing_messages_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4243), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4243/index.html"); await page.waitForTimeout(1200);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1800);
    const U = "https://sanix-landing.example";
    console.log("▶ Sans adresse réglée : aucun changement");
    const avant = await page.evaluate(() => { const c = CLIENTS[0]; return { wa: relanceBuildMsg(c, 1, "wa"), em: relanceBuildMsg(c, 1, "email") }; });
    ok(!/En savoir plus/.test(avant.wa + avant.em), "aucun lien ajouté tant qu'aucune landing page n'est réglée");
    console.log("▶ Avec l'adresse réglée");
    const r = await page.evaluate((U) => {
      relanceCfg().landingUrl = U; const c = CLIENTS[0]; c.logiciel = c.logiciel || "Sanix AluExpert ERP";
      const out = { wa1: relanceBuildMsg(c, 1, "wa"), wa0: relanceBuildMsg(c, 0, "wa"), em1: relanceBuildMsg(c, 1, "email"), em0: relanceBuildMsg(c, 0, "email"), sms: relanceBuildMsg(c, 2, "sms"), cour: courrierExemples(c).map((e) => e.corps), once: landingAjoute(landingAjoute("Bonjour\n\nCordialement", "email", c), "email", c) };
      out.cible = landingLien("wa", c); relanceCfg().landingUrl = "http://pas-https.example"; out.refuse = landingAjoute("Bonjour", "wa", c); relanceCfg().landingUrl = ""; return out;
    }, U);
    const compte = (t) => (t.split(U).length - 1);
    ok(compte(r.wa1) === 1 && compte(r.wa0) === 1, "WhatsApp : lien présent une seule fois (relance et premier contact)");
    ok(compte(r.sms) === 1, "SMS : lien présent");
    ok(compte(r.em1) === 1 && compte(r.em0) === 1, "e-mail : lien présent une seule fois (relance et premier contact)");
    ok(r.cour.every((t) => compte(t) === 1), "tous les exemples de courrier contiennent le lien");
    ok(/src=whatsapp/.test(r.wa1) && /src=email/.test(r.em1), "le lien indique le canal (whatsapp / email) pour suivre les visites");
    ok(/[?&]ref=[a-z0-9-]+/.test(r.cible), "le lien indique le logiciel concerné");
    ok(r.once.split(U).length - 1 === 1, "ajout idempotent : jamais deux fois le même lien");
    ok(/Pour en savoir plus[^\n]*\n\nCordialement$/.test(r.once), "e-mail : lien placé avant la formule de politesse");
    ok(r.refuse === "Bonjour", "adresse non https refusée : rien n'est ajouté");
    console.log("▶ Générateur : champs préremplis selon le logiciel");
    const g = await page.evaluate(() => {
      initMarketing(); const sel = document.getElementById("mkt-lp-logiciel"), v = (id) => document.getElementById(id).value, noms = [...sel.options].map((o) => o.value);
      sel.value = noms[0]; sel.dispatchEvent(new Event("change")); const a = { t: v("mkt-lp-titre"), o: v("mkt-lp-offre"), n: noms[0] };
      sel.value = noms[1]; sel.dispatchEvent(new Event("change")); const b = { t: v("mkt-lp-titre"), o: v("mkt-lp-offre"), n: noms[1] };
      const e = document.getElementById("mkt-lp-titre"); e.value = "Mon titre à moi"; e.dispatchEvent(new Event("input"));
      sel.value = noms[0]; sel.dispatchEvent(new Event("change")); const c = { t: v("mkt-lp-titre"), o: v("mkt-lp-offre") };
      lpPreremplir(true); return { a, b, c, d: v("mkt-lp-titre") };
    });
    ok(g.a.t && g.b.t && g.a.t !== g.b.t, "l'accroche change avec le logiciel choisi");
    ok(g.a.o.includes(g.a.n) && g.b.o.includes(g.b.n), "l'offre cite le logiciel choisi");
    ok(g.c.t === "Mon titre à moi" && g.c.o.includes(g.a.n), "ce que vous avez tapé n'est pas écrasé, le reste suit le logiciel");
    ok(g.d === g.a.t, "« Réappliquer les suggestions » remplace tout");
    ok(errors.length === 0, "aucune erreur JavaScript (" + errors.join("; ") + ")");
    console.log("\nTOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
