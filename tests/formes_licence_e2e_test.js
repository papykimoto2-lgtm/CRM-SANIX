// SANIX CRM Pro : les trois formes de licence (utilisation, exploitation commerciale, exclusive) dans les licences, les contrats et le bouton « Contrat » de la fiche. node formes_licence_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4454), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4454/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => {
      window.__html = ""; window.open = () => ({ document: { write: (h) => { window.__html = h; }, close() {} } });
      if (!LOGICIELS.find((l) => l.nom === "ImmoSuite ERP")) LOGICIELS.push({ id: "log_immo", nom: "ImmoSuite ERP", modules: "Programmes", desc: "ERP immobilier. x", prixNum: 4000000, prixMensuel: 75000, type_licence: "Perpetuelle" });
      CONFIG.forme = ""; CONFIG.capital = ""; CONFIG.rccm = "";
      const now = new Date().toISOString();
      CLIENTS.push({ id: 999001, nom: "Distribution Beta", statut: "prospect", phone: "+2250700000001", email: "", secteur: "Immobilier", logiciel: "ImmoSuite ERP", adresse: "Plateau, Abidjan", contact: "M. Beta", valeur: 4000000, valeurSaisie: true, created_at: now, updated_at: now });
      CLIENTS.push({ id: 999003, nom: "Entreprise Delta", statut: "prospect", phone: "+2250700000003", email: "", secteur: "Immobilier", logiciel: "ImmoSuite ERP", adresse: "Marcory", valeur: 4000000, valeurSaisie: true, created_at: now, updated_at: now });
      CLIENTS.push({ id: 999002, nom: "Promoteur Gamma", statut: "prospect", phone: "+2250700000002", email: "", secteur: "Immobilier", logiciel: "ImmoSuite ERP", adresse: "Cocody", valeur: 4000000, valeurSaisie: true, created_at: now, updated_at: now });
    });
    const generer = (id, opts) => page.evaluate(([i, o]) => { window.__html = ""; genDocFromDossier(i, "contrat", o); return window.__html; }, [id, opts]);
    const rendre = async (html) => { const q = await ctx.newPage(); q.on("pageerror", (e) => errors.push("doc : " + e.message)); await q.setContent(html); await q.waitForTimeout(500); return q; };
    const texteDoc = (q) => q.evaluate(() => { const p = [...document.querySelectorAll(".page")]; return { n: p.length / 2, ex1: p.slice(0, p.length / 2).map((x) => x.querySelector(".ct-flow").innerText).join("\n"), boite: p[0].querySelector(".b2").innerText.replace(/\s+/g, " "), titre: p[0].querySelector(".ti").innerText.replace(/\s+/g, " "), coupe: p.some((x) => { const f = x.querySelector(".ct-flow"); return f.scrollHeight > f.clientHeight + 1; }), sigD: document.querySelector(".sig.s-r").innerText.replace(/\s+/g, " ") }; });

    console.log("▶ Formulaire des licences");
    await page.evaluate(() => { navigate("licences", null); openLicenceModal(); }); await page.waitForTimeout(400);
    ok((await page.$$eval("#lic-forme option", (o) => o.map((x) => x.value))).join() === "utilisation,exploitation,exclusive", "le formulaire propose les trois formes de licence");
    ok(await page.evaluate(() => document.getElementById("lic-forme-extra").style.display === "none"), "licence d'utilisation : pas de territoire ni de redevance");
    await page.selectOption("#lic-forme", "exploitation"); await page.waitForTimeout(100);
    ok(await page.evaluate(() => document.getElementById("lic-forme-extra").style.display !== "none"), "licence de partenaire : territoire et redevance apparaissent");
    await page.evaluate(() => { document.getElementById("lic-client").value = "Distribution Beta"; document.getElementById("lic-logiciel").value = "ImmoSuite ERP"; document.getElementById("lic-territoire").value = "Côte d'Ivoire, secteur immobilier"; document.getElementById("lic-redevance").value = "15 % du prix de vente HT"; saveLicence(); });
    await page.waitForTimeout(300);
    const lic = await page.evaluate(() => LICENCES.find((l) => l.client === "Distribution Beta"));
    ok(lic && lic.forme === "exploitation" && lic.territoire === "Côte d'Ivoire, secteur immobilier" && lic.redevance === "15 % du prix de vente HT", "la licence enregistre sa forme, son territoire et sa redevance");
    ok(/Exploitation commerciale/.test(await page.evaluate(() => document.querySelector("#view-licences").innerText)), "la liste des licences affiche la forme (badge « Exploitation commerciale »)");
    await page.evaluate(() => openLicenceModal(LICENCES.find((l) => l.client === "Distribution Beta").id)); await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.getElementById("lic-forme").value === "exploitation" && document.getElementById("lic-territoire").value === "Côte d'Ivoire, secteur immobilier" && document.getElementById("lic-forme-extra").style.display !== "none"), "en modification, forme, territoire et redevance sont relus");
    await page.evaluate(() => closeLicenceModal());
    ok((await page.evaluate(() => LICENCES.filter((l) => !l.forme || l.forme === "utilisation").length)) === (await page.evaluate(() => LICENCES.length)) - 1, "les licences existantes restent des licences d'utilisation (aucune forme à ressaisir)");

    console.log("▶ Registre des contrats");
    await page.evaluate(() => { navigate("contrats", null); openContratModal("contrat"); }); await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.getElementById("contrat-forme-bloc").style.display !== "none"), "« Contrat de licence » : le choix de la forme est proposé");
    await page.selectOption("#contrat-type", "convention"); await page.waitForTimeout(100);
    ok(await page.evaluate(() => document.getElementById("contrat-forme-bloc").style.display === "none"), "une convention ou un contrat de maintenance : pas de forme de licence");
    await page.selectOption("#contrat-type", "contrat"); await page.selectOption("#contrat-forme", "exclusive"); await page.waitForTimeout(100);
    ok(await page.evaluate(() => document.getElementById("contrat-forme-extra").style.display !== "none"), "forme exclusive : territoire et redevance apparaissent");
    await page.evaluate(() => { document.getElementById("contrat-client").value = "Promoteur Gamma"; document.getElementById("contrat-logiciel").value = "ImmoSuite ERP"; document.getElementById("contrat-ref").value = "CTR-2026-901"; document.getElementById("contrat-territoire").value = "Abidjan, promoteurs immobiliers"; document.getElementById("contrat-redevance").value = "20 % du prix de vente HT"; saveContrat(); });
    await page.waitForTimeout(300);
    const ctr = await page.evaluate(() => CONTRATS.find((c) => c.ref === "CTR-2026-901"));
    ok(ctr && ctr.forme === "exclusive" && ctr.territoire === "Abidjan, promoteurs immobiliers" && ctr.redevance === "20 % du prix de vente HT", "l'acte enregistre sa forme, son territoire et sa redevance");
    ok(/Exclusive/.test(await page.evaluate(() => document.getElementById("contrat-tbody").innerText)), "la liste des contrats affiche la forme (badge « Exclusive »)");
    let html = await page.evaluate((id) => { window.__html = ""; contratDocument(id); return window.__html; }, ctr.id);
    let q = await rendre(html); let d = await texteDoc(q); await q.close();
    ok((d.ex1.match(/ARTICLE \d+ –/g) || []).length === 17 && /LICENCE EXCLUSIVE DE LOGICIEL/.test(d.ex1) && /à titre exclusif/.test(d.ex1), "le bouton 📄 du registre génère le contrat de licence exclusive (17 articles)");
    ok(/territoire suivant : Abidjan, promoteurs immobiliers/.test(d.ex1) && /Pour chaque licence vendue : 20 % du prix de vente HT/.test(d.ex1), "territoire et redevance de l'acte repris dans le contrat");
    ok(/PARTENAIRE/.test(d.boite) && /Licence exclusive/.test(d.titre) && /PROMOTEUR GAMMA/.test(d.sigD) && !d.coupe, "page officielle : cadre PARTENAIRE, sous-titre « Licence exclusive », signature du partenaire, rien de coupé");

    console.log("▶ Bouton « Contrat » de la fiche");
    await page.evaluate(() => { document.querySelectorAll(".modal-overlay").forEach((m) => m.classList.add("hidden")); showClientDetail(999001); }); await page.waitForTimeout(400);
    await page.click("#sp-actions >> text=Contrat"); await page.waitForTimeout(300);
    ok(await page.evaluate(() => { const m = document.getElementById("modal-forme-licence"); if (!m || m.classList.contains("hidden")) return false; const b = m.querySelector(".modal-box").getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + 80); return m.contains(e); }), "la fenêtre « Quelle forme de licence ? » s'affiche au-dessus de la fiche");
    ok((await page.$$eval("#modal-forme-licence button", (b) => b.length)) === 3 && /Licence d'utilisation/.test(await page.evaluate(() => document.getElementById("modal-forme-licence").innerText)), "trois choix, avec le principe de chaque forme");
    ok(await page.evaluate(() => { const b = [...document.querySelectorAll("#modal-forme-licence button")].find((x) => /exploitation commerciale/i.test(x.innerText)); return /forme déjà enregistrée/.test(b.innerText) && /var\(--primary\)|2px/.test(b.getAttribute("style")); }), "pour un client déjà titulaire d'une licence d'exploitation commerciale, cette forme est mise en avant");
    await page.click("#modal-forme-licence button >> text=Licence d'exploitation commerciale"); await page.waitForTimeout(400);
    html = await page.evaluate(() => window.__html); q = await rendre(html); d = await texteDoc(q); await q.close();
    ok((d.ex1.match(/ARTICLE \d+ –/g) || []).length === 16 && /EXPLOITATION COMMERCIALE DE LOGICIEL/.test(d.ex1) && /à titre non exclusif/.test(d.ex1), "contrat de licence d'exploitation commerciale généré (16 articles)");
    ok(/territoire suivant : Côte d'Ivoire, secteur immobilier/.test(d.ex1) && /Pour chaque licence vendue : 15 % du prix de vente HT/.test(d.ex1), "territoire et redevance repris de la licence du client");
    ok(/PARTENAIRE/.test(d.boite) && /DISTRIBUTION BETA/.test(d.boite) && !d.coupe && /Pour DISTRIBUTION BETA/.test(d.sigD), "page officielle : cadre PARTENAIRE rempli depuis la fiche");
    ok(!/société de droit ivoirien/i.test(d.ex1) && !/LICENCIÉ/.test(d.ex1), "aucune mention de société de droit ivoirien ; « Partenaire » et non « Licencié »");
    await page.evaluate(() => { document.querySelectorAll(".modal-overlay").forEach((m) => m.classList.add("hidden")); showClientDetail(999003); }); await page.waitForTimeout(300);
    await page.click("#sp-actions >> text=Contrat"); await page.waitForTimeout(300);
    ok(!(await page.evaluate(() => /forme déjà enregistrée/.test(document.getElementById("modal-forme-licence").innerText))), "client sans licence de partenaire : aucune forme présélectionnée par erreur");
    await page.click("#modal-forme-licence button >> text=Licence d'utilisation"); await page.waitForTimeout(400);
    html = await page.evaluate(() => window.__html); q = await rendre(html); d = await texteDoc(q); await q.close();
    ok((d.ex1.match(/ARTICLE \d+ –/g) || []).length === 14 && /CLIENT/.test(d.boite) && /Licence d'exploitation de logiciel/.test(d.titre), "licence d'utilisation : le contrat en 14 articles, inchangé");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\nTous les contrôles passent.");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
