// SANIX CRM Pro : écran « Levée de fonds » dans le CRM (indicateurs, éligibilité, simulation, enregistrement). node levee_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };

(async () => {
  const server = await start(4231), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4231/index.html"); await page.waitForTimeout(1200);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(2000);

    console.log("▶ Navigation");
    await page.evaluate(() => navGroup("finance", null)); await page.waitForTimeout(300);
    ok((await page.locator(".grp-tab", { hasText: "Levée de fonds" }).count()) === 1, "onglet « Levée de fonds » dans le groupe Finance");
    await page.locator(".grp-tab", { hasText: "Levée de fonds" }).click(); await page.waitForTimeout(700);
    ok(await page.locator("#view-levee").isVisible(), "l'écran Levée de fonds s'affiche");
    ok((await page.locator("#topbar-title").textContent()).includes("Levée de fonds"), "titre de la page");

    console.log("▶ Synthèse");
    ok((await page.locator("#lev-body .card .badge").count()) === 5, "un verdict pour chacun des 5 types de financeurs");
    ok(await page.locator("#lev-body .stat-card").count() === 4, "4 indicateurs clés");
    ok((await page.locator("#lev-body").innerText()).includes("repères indicatifs"), "avertissement sur les seuils indicatifs");
    ok((await page.locator("#lev-body").innerText()).includes("Les 4 actions qui font le plus progresser"), "actions prioritaires proposées");

    console.log("▶ Indicateurs et notes explicatives");
    await page.locator('#lev-body .tab', { hasText: "Indicateurs" }).click(); await page.waitForTimeout(200);
    ok((await page.locator("#lev-body details").count()) === 22, "22 indicateurs, chacun avec sa note");
    await page.locator("#lev-body details summary").nth(5).click(); await page.waitForTimeout(100);
    const noteTxt = await page.locator("#lev-body details[open]").innerText();
    ok(noteTxt.includes("Ce que c'est") && noteTxt.includes("Pourquoi les financeurs") && noteTxt.includes("Comment il est calculé"), "la note explique : définition, intérêt, calcul");

    console.log("▶ Éligibilité");
    await page.locator('#lev-body .tab', { hasText: "Éligibilité" }).click(); await page.waitForTimeout(200);
    ok((await page.locator("#lev-body table").first().locator("tbody tr").count()) === 23, "matrice : 22 critères et la ligne de score");
    const scoreAvant = await page.locator("#lev-body table").first().locator("tbody tr").last().innerText();
    await page.locator('[data-man="deck"]').check(); await page.waitForTimeout(200);
    const scoreApres = await page.locator("#lev-body table").first().locator("tbody tr").last().innerText();
    ok(scoreAvant !== scoreApres, "cocher « pitch deck prêt » change les scores");
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem("sanix_crm_levee_config")).manuel.deck === true), "case enregistrée sur l'appareil");
    await page.locator("#lev-seuils summary").click();
    await page.locator('input[data-seuil="livre12.ok"]').fill("5000000"); await page.locator('input[data-seuil="livre12.ok"]').dispatchEvent("change"); await page.waitForTimeout(200);
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem("sanix_crm_levee_config")).seuils.livre12.ok === 5000000), "seuil modifié et enregistré");
    ok(await page.locator("#lev-seuils").evaluate((d) => d.open), "le bloc des seuils reste ouvert après modification");

    console.log("▶ Simulation");
    await page.locator('#lev-body .tab', { hasText: "Simulation" }).click(); await page.waitForTimeout(300);
    const part0 = await page.locator("#lev-montage .stat-card").nth(1).innerText();
    const champ = page.locator('#lev-ctl [data-sim="montant"]'); await champ.focus(); await champ.fill("60000000"); await page.waitForTimeout(250);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.dataset.sim === "montant"), "le champ garde le focus pendant la saisie");
    ok((await page.locator("#lev-montage .stat-card").nth(1).innerText()) !== part0, "la part cédée se recalcule à la saisie");
    const w0 = await page.locator("#lev-what-out table tbody").innerText();
    await page.locator('[data-what="livre12"]').fill("40000000"); await page.locator('[data-what="clients"]').fill("20"); await page.waitForTimeout(250);
    ok((await page.locator("#lev-what-out table tbody").innerText()) !== w0, "« Et si ? » : les scores se recalculent en direct");

    console.log("▶ Plan d'action, notes, fiche");
    await page.locator('#lev-body .tab', { hasText: "Plan d'action" }).click(); await page.waitForTimeout(200);
    ok((await page.locator("#lev-body table tbody tr").count()) > 3, "plan d'action listé");
    await page.locator('#lev-body .tab', { hasText: "Notes" }).click(); await page.waitForTimeout(200);
    ok((await page.locator("#lev-body dt").count()) >= 10, "glossaire affiché");
    const [popup] = await Promise.all([ctx.waitForEvent("page"), page.locator('[data-act="fiche"]').click()]); await popup.waitForLoadState();
    ok((await popup.locator("body").innerText()).includes("État de préparation à une levée de fonds"), "fiche d'éligibilité imprimable");
    await popup.close();


    console.log("▶ Pitch deck");
    await page.evaluate(() => navigate("levee", null)); await page.waitForTimeout(400);
    await page.locator('#lev-body .tab', { hasText: "Pitch deck" }).click(); await page.waitForTimeout(400);
    ok(await page.locator("#lev-deck-f").count() === 1, "aperçu du deck affiché");
    const frame = async () => await page.locator("#lev-deck-f").evaluate((f) => f.getAttribute("srcdoc"));
    ok((await frame()).split('class="s ').length - 1 === 12, "12 diapositives dans l'aperçu");
    const nb0 = Number((await page.locator("#lev-deck-out .card-title", { hasText: "À compléter" }).innerText()).match(/\((\d+)\)/)[1]);
    ok(nb0 >= 5, nb0 + " éléments à compléter signalés");
    const champD = page.locator('[data-deck="marcheTotal"]'); await champD.focus(); await champD.fill("120 000 entreprises (source test)"); await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.dataset.deck === "marcheTotal"), "le champ garde le focus pendant la saisie");
    ok((await frame()).includes("120 000 entreprises"), "la saisie apparaît dans le deck");
    const nb1 = Number((await page.locator("#lev-deck-out .card-title", { hasText: "À compléter" }).innerText()).match(/\((\d+)\)/)[1]);
    ok(nb1 === nb0 - 1, "un élément de moins à compléter");
    ok((await frame()).includes("commandes en"), "la traction vient des commandes du CRM");
    await page.locator('[data-deck="lancement"]').fill("2027-06"); await page.waitForTimeout(300);
    ok((await page.locator("#lev-deck-out").innerText()).includes("Que devient mon éligibilité"), "projection à la date de lancement affichée");
    const [pop] = await Promise.all([ctx.waitForEvent("page"), page.locator('[data-act="deck-ouvrir"]').click()]); await pop.waitForLoadState();
    ok((await pop.locator("section.s").count()) === 12, "le deck s'ouvre en plein écran (12 diapositives, prêt pour le PDF)");
    await pop.close();
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem("sanix_crm_levee_config")).deck.lancement === "2027-06"), "date de lancement enregistrée");

    console.log("▶ Partage avec l'agent");
    await page.waitForTimeout(2200);
    ok((await page.locator("#lev-sync").innerText()).includes("agent"), "l'état du partage avec l'agent est affiché (session non connectée dans le test : message explicite)");
    await page.evaluate(() => { window.__calls = []; window.aisApi = async (p, o) => { window.__calls.push({ p, b: o && o.body }); return p.includes("levee_etat?") ? [] : "2026-11-19T10:00:00Z"; }; });
    await page.evaluate(() => navigate("levee", null)); await page.waitForTimeout(400);
    await page.locator('#lev-body .tab', { hasText: "Éligibilité" }).click(); await page.locator('[data-man="equipe"]').check(); await page.waitForTimeout(2200);
    const envoi = await page.evaluate(() => window.__calls.filter((c) => c.p.includes("rpc/levee_enregistrer")).map((c) => JSON.parse(c.b)).pop());
    ok(envoi && envoi.p_config.manuel.equipe === true, "la case cochée est envoyée au serveur pour l'agent");
    ok(envoi.p_instantane.scores.length === 5 && envoi.p_instantane.modele && typeof envoi.p_instantane.modele.besoin === "number", "l'instantané contient les 5 scores et le modèle Financement");
    ok((await page.locator("#lev-sync").innerText()).includes("Partagé avec l'agent"), "confirmation « partagé avec l'agent » affichée");

    console.log("▶ Annuaire des financeurs");
    await page.evaluate(() => {
      window.__fin = [
        { id: "f1", nom: "Fonds Alpha", type: "fonds", pays: "Côte d'Ivoire", ticket_min: 20000000, ticket_max: 100000000, devise: "FCFA", conditions: "Sociétés immatriculées de moins de 5 ans", url_source: "https://alpha.example/programme", statut: "a_etudier", notes: "Correspond au profil", ajoute_par: "ag1", created_at: "2026-11-19T10:00:00Z", region: "afrique_ouest", site_web: "https://alpha.example", linkedin_url: "https://www.linkedin.com/company/alpha", contact_email: "contact@alpha.example", contact_telephone: "+225 00 00 00", pertinence: "forte : amorçage logiciel" },
        { id: "f2", nom: "<img src=x onerror=alert(1)> Banque", type: "banque", pays: "UEMOA", ticket_min: null, ticket_max: 50000000, devise: "FCFA", conditions: "Garanties", url_source: "javascript:alert(1)", statut: "ecarte", notes: null, ajoute_par: null, created_at: "2026-11-18T10:00:00Z", region: "europe", site_web: "javascript:alert(2)", linkedin_url: null, contact_email: null },
      ];
      window.__finCalls = []; window.__contacts = [{ id: "c1", financeur_id: "f1", nom: "Awa Koné", fonction: "Directrice des investissements", linkedin_url: "https://www.linkedin.com/in/awa-kone", email: null, source_url: "https://alpha.example/equipe" }];
      window.aisApi = async (p, o) => {
        if (p.includes("levee_contacts")) { const m2 = (o && o.method) || "GET"; window.__finCalls.push({ m: m2, p, b: o && o.body, c: 1 }); if (m2 === "GET") return window.__contacts.slice(); if (m2 === "DELETE") { window.__contacts = window.__contacts.filter((x) => x.id !== (p.match(/id=eq\\.([^&]+)/) || [])[1]); return null; } window.__contacts.push(Object.assign({ id: "c" + (window.__contacts.length + 1) }, JSON.parse(o.body))); return null; }
        if (!p.includes("levee_financeurs")) return p.includes("levee_etat?") ? [] : "2026-11-19T10:00:00Z";
        const m = (o && o.method) || "GET", id = (p.match(/id=eq\.([^&]+)/) || [])[1]; window.__finCalls.push({ m, p, b: o && o.body });
        if (m === "GET") return window.__fin.slice();
        if (m === "DELETE") { window.__fin = window.__fin.filter((x) => x.id !== id); return null; }
        if (m === "PATCH") { Object.assign(window.__fin.find((x) => x.id === id), JSON.parse(o.body)); return null; }
        const row = Object.assign({ id: "f" + (window.__fin.length + 1), ajoute_par: null, created_at: "2026-11-19T11:00:00Z" }, JSON.parse(o.body)); window.__fin.unshift(row); return o.headers && o.headers.Prefer ? [row] : null;
      };
    });
    await page.evaluate(() => navigate("levee", null)); await page.waitForTimeout(300);
    await page.locator('#lev-body .tab', { hasText: "Financeurs" }).click(); await page.waitForTimeout(500);
    ok((await page.locator("#lev-body table tbody tr").count()) === 2, "les 2 financeurs sont listés");
    ok((await page.locator("#lev-body").innerText()).includes("Fonds Alpha") && (await page.locator('a[href="https://alpha.example/programme"]').count()) === 1, "nom cliquable vers la source https");
    ok((await page.locator('#lev-body a[href^="javascript"]').count()) === 0, "un lien non https n'est jamais rendu cliquable");
    ok(!(await page.locator("#lev-body").innerHTML()).includes("<img src=x"), "nom hostile échappé");
    ok((await page.locator("#lev-body").innerText()).includes("🤖"), "l'ajout par l'agent est signalé");
    ok((await page.locator('#lev-body details[data-reg="afrique_ouest"] > summary').innerText()).includes("Afrique de l'Ouest") && (await page.locator('#lev-body details[data-reg="europe"]').count()) === 1, "financeurs groupés par région");
    ok((await page.locator('#lev-body a[href="https://alpha.example"]').count()) === 1 && (await page.locator('#lev-body a[href="mailto:contact@alpha.example"]').count()) === 1, "site web et e-mail publiés affichés");
    ok((await page.locator('#lev-body a[href="https://www.linkedin.com/in/awa-kone"]').count()) === 1 && (await page.locator("#lev-body").innerText()).includes("Directrice des investissements"), "personne ressource avec fonction et profil LinkedIn");
    ok((await page.locator('#lev-body a[href^="javascript"]').count()) === 0, "un site non https n'est jamais cliquable");
    ok((await page.locator("#lev-body").innerText()).includes("👤 1 personnes"), "compteur de personnes");
    await page.locator('[data-finf="region"]').selectOption("europe"); await page.waitForTimeout(200);
    ok((await page.locator("#lev-body table tbody tr").count()) === 1, "filtre par région");
    await page.locator('[data-finf="region"]').selectOption(""); await page.waitForTimeout(150);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator('[data-act="fin-export"]').click()]);
    const csv = require("fs").readFileSync(await dl.path(), "utf8");
    ok(csv.includes("Fonds Alpha") && csv.includes("Awa Koné") && csv.includes("linkedin.com/in/awa-kone"), "export CSV avec les personnes et leur LinkedIn");
    await page.locator('[data-finf="type"]').selectOption("banque"); await page.waitForTimeout(200);
    ok((await page.locator("#lev-body table tbody tr").count()) === 1, "filtre par type");
    await page.locator('[data-finf="type"]').selectOption(""); await page.waitForTimeout(100);
    const qf = page.locator('[data-finf="q"]'); await qf.focus(); await qf.fill("alpha"); await page.waitForTimeout(250);
    ok((await page.locator("#lev-body table tbody tr").count()) === 1 && await page.evaluate(() => document.activeElement && document.activeElement.dataset.finf === "q"), "recherche texte, le champ garde le focus");
    await qf.fill(""); await page.waitForTimeout(150);
    await page.locator('[data-fin-statut="f1"]').selectOption("contacte"); await page.waitForTimeout(300);
    ok(await page.evaluate(() => window.__finCalls.some((c) => c.m === "PATCH" && c.p.includes("id=eq.f1") && JSON.parse(c.b).statut === "contacte")), "changement de statut enregistré (PATCH)");
    await page.locator('[data-act="fin-nouveau"]').click(); await page.waitForTimeout(200);
    await page.locator('#lev-fin-form [name="nom"]').fill("Programme Beta"); await page.locator('#lev-fin-form [name="url_source"]').fill("http://pas-https.example");
    await page.locator('#lev-fin-form button[type="submit"]').click(); await page.waitForTimeout(200);
    ok((await page.locator("#lev-fin-err").innerText()).includes("https"), "lien non https refusé avant tout envoi");
    ok(!(await page.evaluate(() => window.__finCalls.some((c) => c.m === "POST"))), "aucun envoi tant que la source est invalide");
    await page.locator('#lev-fin-form [name="url_source"]').fill("https://beta.example/appel"); await page.locator('#lev-fin-form [name="ticket_max"]').fill("30000000");
    await page.locator('#lev-fin-form [name="cn_nom"]').fill("Jean Test"); await page.locator('#lev-fin-form button[type="submit"]').click(); await page.waitForTimeout(200);
    ok((await page.locator("#lev-fin-err").innerText()).includes("source publique"), "une personne sans source publique est refusée");
    await page.locator('#lev-fin-form [name="cn_source"]').fill("https://beta.example/equipe"); await page.locator('#lev-fin-form [name="cn_linkedin"]').fill("https://exemple.com/pas-linkedin");
    await page.locator('#lev-fin-form button[type="submit"]').click(); await page.waitForTimeout(200);
    ok((await page.locator("#lev-fin-err").innerText()).includes("LinkedIn"), "un lien LinkedIn invalide est refusé");
    await page.locator('#lev-fin-form [name="cn_linkedin"]').fill("https://www.linkedin.com/in/jean-test");
    await page.locator('#lev-fin-form button[type="submit"]').click(); await page.waitForTimeout(500);
    ok(await page.evaluate(() => window.__finCalls.some((c) => c.m === "POST" && JSON.parse(c.b).nom === "Programme Beta" && JSON.parse(c.b).ticket_max === 30000000)), "ajout à la main enregistré (POST)");
    ok(await page.evaluate(() => window.__finCalls.some((c) => c.c && c.m === "POST" && JSON.parse(c.b).nom === "Jean Test" && JSON.parse(c.b).linkedin_url.includes("linkedin.com/in/jean-test"))), "la personne ressource est enregistrée avec sa source");
    ok((await page.locator("#lev-body table tbody tr").count()) === 3, "le nouveau financeur apparaît dans la liste");
    await page.locator('[data-act="fin-suppr"][data-id="f2"]').click(); await page.waitForTimeout(400);
    ok((await page.locator("#lev-body table tbody tr").count()) === 2 && await page.evaluate(() => window.__finCalls.some((c) => c.m === "DELETE")), "suppression confirmée et enregistrée (DELETE)");

    console.log("▶ Persistance et sécurité");
    await page.evaluate(() => navigate("comptabilite", null)); await page.waitForTimeout(300);
    await page.evaluate(() => navigate("levee", null)); await page.waitForTimeout(500);
    await page.locator('#lev-body .tab', { hasText: "Simulation" }).click(); await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.querySelector('#lev-ctl [data-sim="montant"]').value) === "60000000", "le montant simulé est retrouvé à la réouverture");
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem("sanix_crm_levee_config")).sim.montant === 60000000), "la simulation est conservée");
    ok(!(await page.locator("#view-levee").innerHTML()).includes("<script"), "aucun script injecté");
    ok(errors.length === 0, "aucune erreur JavaScript (" + errors.join(" | ") + ")");
  } finally { await browser.close(); server.close(); }
  console.log("\nTOUT EST OK");
})().catch((e) => { console.error(e.message); process.exit(1); });
