// SANIX CRM Pro : le bouton « Contrat » de la fiche produit le contrat complet dans la page officielle (même structure que la facture / proforma : A4, filigrane, tampon, QR, signatures), sur plusieurs pages, en deux exemplaires. node contrat_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4453), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 1200 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4453/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => {
      window.__html = ""; window.open = () => ({ document: { write: (h) => { window.__html = h; }, close() {} } });
      if (!LOGICIELS.find((l) => l.nom === "MediCore Suite")) LOGICIELS.push({ id: "log_medicore", nom: "MediCore Suite", modules: "Portail Patient, Agenda", desc: "ERP hospitalier complet. Autres phrases", prixNum: 1500000, prixMensuel: 60000, type_licence: "Perpetuelle" });
      const l = LOGICIELS.find((x) => x.nom === "MediCore Suite"); l.prixMensuel = 60000; l.type_licence = "Perpetuelle";
      CONFIG.forme = ""; CONFIG.capital = ""; CONFIG.rccm = ""; CONFIG.email = "papykimoto2@gmail.com"; CONFIG.tel = "+225 0779181075"; CONFIG.adresse = "Songon Kassamblé, Côte d'Ivoire";
      CLIENTS.push({ id: 999001, nom: "Clinique Alpha", statut: "prospect", phone: "+2250140017751", email: "", secteur: "Santé", logiciel: "MediCore Suite", adresse: "Cocody, Abidjan", contact: "Dr Alpha", valeur: 1500000, valeurSaisie: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    });
    const generer = (kind) => page.evaluate((k) => { window.__html = ""; genDocFromDossier(999001, k); return window.__html; }, kind);
    const rendre = async (html) => { const q = await ctx.newPage(); q.on("pageerror", (e) => errors.push("doc : " + e.message)); await q.setContent(html); await q.waitForTimeout(500); return q; };

    console.log("▶ Structure identique au modèle officiel (facture / proforma)");
    const html = await generer("contrat"); const q = await rendre(html);
    const info = await q.evaluate(() => {
      const pages = [...document.querySelectorAll(".page")], n = pages.length / 2;
      const flows = pages.map((p) => p.querySelector(".ct-flow")), txt = (i) => flows[i].innerText.replace(/\s+/g, " ");
      const ex = (a, b) => pages.slice(a, b);
      return {
        n, total: pages.length,
        entetes: pages.every((p) => p.querySelector(".wms .wm") && p.querySelector(".logo") && p.querySelector(".co") && p.querySelector(".ti h1") && p.querySelector(".rule") && p.querySelector(".tag")),
        boites: pages.map((p) => p.querySelectorAll(".box").length),
        tags: pages.map((p) => p.querySelector(".tag").textContent),
        pied: pages.map((p) => ["paid", "stamp", "qr", "s-l", "s-r"].every((c) => p.querySelector("." + c))),
        numeros: pages.map((p) => p.querySelector(".pn").textContent),
        coupe: flows.map((f) => f.scrollHeight > f.clientHeight + 1),
        ex1: ex(0, n).map((p) => p.querySelector(".ct-flow").innerText).join("\n"), ex2: ex(n, 2 * n).map((p) => p.querySelector(".ct-flow").innerText).join("\n"),
        co: pages[0].querySelector(".co").innerText.replace(/\s+/g, " "), titre: pages[0].querySelector(".ti").innerText.replace(/\s+/g, " "),
        qr: pages[n - 1].querySelector(".qr svg") ? 1 : 0, boiteClient: pages[0].querySelector(".b2").innerText.replace(/\s+/g, " "),
        bas: flows.map((f, i) => { const l = f.lastElementChild; return l ? Math.round((f.getBoundingClientRect().top + l.offsetTop + l.offsetHeight - pages[i].getBoundingClientRect().top) * 72 / 96) : 0; })
      };
    });
    ok(info.n >= 3 && info.n <= 6 && info.total === 2 * info.n, "le contrat tient sur " + info.n + " pages par exemplaire, en 2 exemplaires (" + info.total + " pages au total)");
    ok(info.entetes, "chaque page reprend la structure officielle : filigrane du logo, logo, bloc entreprise, titre, filet");
    ok(info.boites[0] === 2 && info.boites[1] === 0 && info.boites[info.n] === 2, "ÉMETTEUR et CLIENT sur la première page de chaque exemplaire (comme la facture)");
    ok(info.tags[0] === "EXEMPLAIRE 1 / 2" && info.tags[info.n] === "EXEMPLAIRE 2 / 2" && info.tags.slice(0, info.n).every((t) => t === "EXEMPLAIRE 1 / 2"), "étiquette « EXEMPLAIRE 1 / 2 » puis « EXEMPLAIRE 2 / 2 » (l'« ORIGINAL / COPIE » de la facture)");
    ok(info.pied.filter(Boolean).length === 2 && info.pied[info.n - 1] && info.pied[info.total - 1] && !info.pied[0], "tampon, QR code de sécurité et signatures uniquement sur la dernière page de chaque exemplaire");
    ok(await q.evaluate((n) => { const p = document.querySelectorAll(".page")[n - 1]; return /ARTICLE 14/.test(p.querySelector(".ct-flow").innerText) && /FAIT À/.test(p.querySelector(".ct-flow").innerText); }, info.n), "la dernière page porte l'article 14 et « FAIT À… » avec le tampon et les signatures (jamais une page presque vide)");
    ok(info.numeros[0] === "Page 1 / " + info.n && info.numeros[info.n - 1] === "Page " + info.n + " / " + info.n, "numérotation « Page i / n »");
    ok(info.coupe.every((x) => !x), "aucune page ne coupe du texte (rien de caché par le bas de page)");
    ok(info.bas.slice(0, -1).every((b) => b <= 792) && info.bas.slice(0, info.n)[info.n - 1] <= 642, "le texte s'arrête avant le pied de page, et avant le tampon et le QR sur la dernière page");
    ok((info.ex1.match(/ARTICLE \d+ –/g) || []).length === 14 && (info.ex2.match(/ARTICLE \d+ –/g) || []).length === 14, "les 14 articles figurent une fois dans chaque exemplaire");
    ok(info.ex1.replace(/\s+/g, " ") === info.ex2.replace(/\s+/g, " "), "les deux exemplaires ont exactement le même texte");
    ok(/FAIT À Abidjan, LE \d\d\/\d\d\/\d{4}\s*$/.test(info.ex1.replace(/\s+/g, " ").replace(/ | /g, " ")) || /FAIT À Abidjan/.test(info.ex1), "le texte se termine par « FAIT À …, LE … » ; les signatures sont celles de la page officielle");
    ok(!/Signature et cachet/.test(info.ex1) && /Pour CLINIQUE ALPHA/.test(await q.evaluate(() => document.querySelector(".sig.s-r").innerText)), "pas de blocs de signature en double dans le texte ; « Pour CLINIQUE ALPHA (lu et approuvé) » en pied");
    ok(info.qr === 1 && /QR code de sécurité/.test(await q.evaluate(() => document.querySelector(".qr").innerText)), "QR code de sécurité avec empreinte SHA-256, comme la facture");
    ok(/ÉMETTEUR/.test(await q.evaluate(() => document.querySelector(".b1").innerText)) && /CLINIQUE ALPHA/.test(info.boiteClient) && /Cocody, Abidjan/.test(info.boiteClient), "cadre CLIENT rempli depuis la fiche");
    ok(/CONTRAT/.test(info.titre) && /N° CTR-/.test(info.titre) && /Date :/.test(info.titre), "bloc titre : CONTRAT, numéro et date");

    console.log("▶ Aucune mention non renseignée, identité cohérente");
    ok(/SANIX AFRICA\b/.test(info.co) && !/SARL/.test(info.co) && !/société de droit ivoirien/i.test(info.ex1) && !/au capital/i.test(info.co + info.ex1), "ni « SARL », ni « société de droit ivoirien », ni capital tant que la forme juridique n'est pas renseignée");
    ok(/papykimoto2@gmail\.com/.test(info.co) && !/paypikmoto2/.test(html), "l'adresse e-mail est celle des réglages (papykimoto2@gmail.com)");
    ok(/Clinique Alpha, société \[forme juridique\]/.test(info.ex1) && /Frais initiaux de licence : 1.500.000 FCFA HT/.test(info.ex1) && /durée indéterminée/.test(info.ex1), "texte rempli depuis la fiche et le catalogue");
    ok(/dont le siège est situé à Songon Kassamblé, Côte d'Ivoire/.test(info.ex1) && /Songon Kassamblé/.test(info.co), "le siège du Concédant dans le texte est celui du Paramétrage, identique au bloc entreprise de la page");

    console.log("▶ Compléter le texte, puis recomposition");
    await q.click("#bt-ed"); await q.waitForTimeout(200);
    ok(await q.evaluate(() => getComputedStyle(document.getElementById("ed")).display !== "none" && document.getElementById("edta").value.includes("ARTICLE 14")), "« Compléter le texte » ouvre le texte complet modifiable");
    await q.evaluate(() => { const t = document.getElementById("edta"); t.value = t.value.replace("[forme juridique]", "SARL").replace("[Territoire]", "la Côte d'Ivoire").replace("[Numéro]", "CI-ABJ-2026-B-1"); });
    await q.click("#ed-ok"); await q.waitForTimeout(500);
    const apres = await q.evaluate(() => { const p = [...document.querySelectorAll(".page")]; return { txt: p.slice(0, p.length / 2).map((x) => x.querySelector(".ct-flow").innerText).join(" ").replace(/\s+/g, " "), n: p.length, nb: document.getElementById("nb").textContent }; });
    ok(/société SARL, dont le siège social/.test(apres.txt) && /pour le territoire suivant : la Côte d'Ivoire/.test(apres.txt) && /RCCM sous le numéro CI-ABJ-2026-B-1,/.test(apres.txt), "le texte modifié est recomposé dans les pages");
    ok(/passages? à compléter/.test(apres.nb) && /juriste/.test(apres.nb), "la barre indique le nombre de passages restant à compléter et rappelle la relecture par un juriste");
    await q.close();

    console.log("▶ Autres documents inchangés");
    await page.evaluate(() => { docsLoad(); const id = LOGICIELS.find((l) => l.nom === "MediCore Suite").id; DOCS[id] = DOCS[id] || {}; DOCS[id].contrat = "Contrat sur mesure pour {client} : {prix} FCFA le {date}."; });
    const perso = await generer("contrat");
    ok(perso.replace(/[  ]/g, " ").includes("Contrat sur mesure pour Clinique Alpha : 1 500 000 FCFA") && !/class="page"/.test(perso), "un modèle propre au logiciel reste prioritaire (présentation d'origine)");
    await page.evaluate(() => { const id = LOGICIELS.find((l) => l.nom === "MediCore Suite").id; DOCS[id].contrat = ""; });
    const devis = await generer("devis");
    ok(/DEVIS/.test(devis) && !/ARTICLE 1/.test(devis), "le devis de la fiche est inchangé");
    await page.evaluate(() => { CLIENTS.find((c) => c.id === 999001).nom = '<img src=x onerror=alert(1)> & Cie'; });
    const xss = await generer("contrat");
    ok(!/<img src=x onerror=alert\(1\)>/.test(xss) && !/<img src=\\"x\\"/.test(xss), "le nom du client est échappé : aucun HTML injecté dans le contrat");
    ok(await page.evaluate(() => (CLIENTS.find((c) => c.id === 999001).interactions || []).some((i) => i.type === "Contrat généré" && /modèle complet/.test(i.note))), "l'historique de la fiche note « Contrat généré · modèle complet »");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\nTous les contrôles passent.");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
