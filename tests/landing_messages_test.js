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
    console.log("▶ Réglage désactivé : aucun changement");
    const avant = await page.evaluate(() => { relanceCfg().landingActif = false; const c = CLIENTS[0]; return { wa: relanceBuildMsg(c, 1, "wa"), em: relanceBuildMsg(c, 1, "email") }; });
    ok(!/En savoir plus/.test(avant.wa + avant.em), "réglage désactivé : aucun lien ajouté");
    console.log("▶ Avec l'adresse réglée");
    const r = await page.evaluate((U) => {
      relanceCfg().landingActif = true; relanceCfg().landingUrl = U; const c = CLIENTS[0]; c.logiciel = c.logiciel || "Sanix AluExpert ERP";
      const out = { wa1: relanceBuildMsg(c, 1, "wa"), wa0: relanceBuildMsg(c, 0, "wa"), em1: relanceBuildMsg(c, 1, "email"), em0: relanceBuildMsg(c, 0, "email"), sms: relanceBuildMsg(c, 2, "sms"), cour: courrierExemples(c).map((e) => e.corps), once: landingAjoute(landingAjoute("Bonjour\n\nCordialement", "email", c), "email", c) };
      out.cible = landingLien("wa", c); relanceCfg().landingUrl = "http://pas-https.example"; out.refuse = landingAjoute("Bonjour", "wa", c);
      relanceCfg().landingUrl = ""; c.logiciel = "ImmoSuite ERP"; out.defaut = landingLien("wa", c); out.defautMail = landingAjoute("Bonjour\n\nCordialement", "email", c);
      relanceCfg().landingUrl = "https://exemple.example/p/{slug}.html"; out.modele = landingLien("email", c); return out;
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
    console.log("▶ Pages construites avec le CRM");
    ok(r.defaut === "https://crm-sanix.vercel.app/landing/immosuite-erp.html?src=whatsapp", "adresse vide : pages du CRM, une par logiciel (" + r.defaut + ")");
    ok(r.defautMail.includes("landing/immosuite-erp.html?src=email"), "e-mail : même page, canal email");
    ok(r.modele === "https://exemple.example/p/immosuite-erp.html?src=email", "adresse personnalisée avec {slug}");
    const fs = require("fs"), path = require("path"), dir = path.join(__dirname, "..", "landing");
    const fichiers = fs.readdirSync(dir).filter((f) => f.endsWith(".html") && f !== "index.html");
    const actifs = await page.evaluate(() => LOGICIELS.filter((l) => l.actif !== false).map((l) => landingSlug(l.nom)));
    ok(actifs.length > 10 && actifs.every((s) => fichiers.includes(s + ".html")), "une page publique pour chaque logiciel actif (" + fichiers.length + " fichiers) : relancez scripts/build_landing.js si le catalogue change");
    const tout = fichiers.concat(["index.html"]).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
    const externes = [...tout.matchAll(/(?:href|src|action)="(https?:\/\/[^"]+)/g)].map((m) => m[1]).filter((u) => !u.startsWith("https://wa.me/"));
    ok(externes.length === 0, "aucun lien étranger dans les pages (hors WhatsApp) " + externes.slice(0, 3).join(" "));
    ok(!/immo-suite\.vercel\.app|menco-holding|angelsgroups|hotel-suite-erp|sanix-compta-pro/.test(tout), "aucune adresse de démo externe du catalogue");
    ok(!/Déjà adopté par/.test(tout), "aucun chiffre tiré du CRM sur les pages publiques");
    console.log("▶ Corrections de la revue");
    const rv = await page.evaluate(() => {
      relanceCfg().landingActif = true; relanceCfg().landingUrl = ""; const c = CLIENTS[0]; c.logiciel = "ImmoSuite ERP";
      const occ = (t) => (t.split("landing/immosuite-erp.html").length - 1), out = {};
      out.doublon = occ(landingAjoute(landingAjoute("Bonjour", "wa", c), "wa", c)); out.premier = occ(relanceBuildMsg(c, 0, "wa")); out.relance = occ(relanceBuildMsg(c, 1, "email"));
      c.logiciel = "Logiciel Ajouté Après"; out.nouveau = landingAjoute("Bonjour", "wa", c); out.demoNouveau = fcFill("{demo_line}x", { logiciel: "Logiciel Ajouté Après" });
      relanceCfg().landingUrl = "https://exemple.example/p/{slug}.html"; out.perso = landingAjoute("Bonjour", "wa", c).includes("exemple.example/p/logiciel-ajoute-apres.html"); relanceCfg().landingUrl = "";
      const log = LOGICIELS[0]; out.fixe = lpBuildHtml({ logNom: log.nom, log, titre: "", offre: "Offre test", offreFin: "2026-12-31", wa: "2250700000000", tel: "0700000000", gerant: "X", publique: true });
      out.sans = lpBuildHtml({ logNom: log.nom, log, titre: "", offre: "", wa: "2250700000000", tel: "0700000000", gerant: "X", publique: true });
      out.mois = lpBuildHtml({ logNom: log.nom, log: { ...log, color: "red;}body{display:none" }, titre: "", offre: "", wa: "2250700000000", tel: "0700000000", gerant: "X", publique: true });
      return out;
    });
    ok(rv.doublon === 1 && rv.premier === 1 && rv.relance === 1, "adresse par défaut : le lien n'est jamais ajouté deux fois (premier contact, relance, e-mail)");
    ok(rv.nouveau === "Bonjour" && !/demo\//.test(rv.demoNouveau), "logiciel sans page publique : aucun lien vers une page inexistante, ni dans le lien ni dans {demo_line}");
    ok(rv.perso, "adresse personnalisée : le lien est ajouté même pour un logiciel sans page du CRM");
    ok(/var FIN="2026-12-31"/.test(rv.fixe) && /class="chip offre-x"/.test(rv.fixe) && /var FIN=null/.test(rv.sans) && !/class="chip offre-x"/.test(rv.sans), "offre : compte à rebours vers une date fixe, et rien d'affiché sans offre");
    ok(!rv.mois.includes("red;}body") && rv.mois.includes("#0e7490"), "couleur non valide du catalogue : jamais insérée dans le CSS")
    const lf = fs.readFileSync(path.join(dir, "..", "landing", "immosuite-erp.html"), "utf8");
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "scripts", "pages.config.json"), "utf8"));
    ok(!/class="chip offre-x"/.test(lf) && !/Offre du mois/.test(lf), "pages publiques : aucune offre publiée tant que le texte et la date de fin ne sont pas renseignés");
    ok(lf.includes("wa.me/" + (await page.evaluate((t) => waAnalyse(t).num, cfg.whatsapp))), "numéro WhatsApp des pages = celui de scripts/pages.config.json");
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
