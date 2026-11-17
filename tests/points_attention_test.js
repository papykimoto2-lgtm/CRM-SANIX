// SANIX CRM Pro : points d'attention du plan de financement (surveillance, champs liés, atelier de correction). node points_attention_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4435), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });     // largeur d'un téléphone
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4435/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => { const l = LOGICIELS.find((x) => x.nom === "ImmoSuite ERP"); l.prixNum = 750000; l.prix = "750 000"; });
    await page.evaluate(() => navigate("financement", null)); await page.waitForTimeout(1500);
    const toasts = () => page.evaluate(() => [...document.body.children].filter((e) => e.tagName === "DIV" && e.style.zIndex === "9000").map((e) => e.textContent).join(" | "));

    console.log("▶ Surveillance");
    const sv = await page.evaluate(() => { const e = document.querySelector("#fin-body .fin-surv"); return e ? { t: e.innerText.replace(/\s+/g, " "), chips: e.querySelectorAll("button[data-act='atelier']").length } : null; });
    ok(sv && sv.t.includes("Surveillance") && sv.chips >= 1, "bandeau de surveillance avec un bouton par point d'attention (" + (sv && sv.chips) + ") : " + (sv && sv.t.slice(0, 90)));
    const badge = await page.evaluate(() => { const t = document.querySelector('#fin-body [data-tab="synthese"] .badge'); return t ? +t.textContent : 0; });
    ok(badge >= 1, "pastille rouge sur l'onglet Synthèse : " + badge + " point(s) sur le montage retenu");

    console.log("▶ Points cliquables du tableau comparatif");
    const nPts = await page.evaluate(() => document.querySelectorAll("#fin-out table .fin-pt").length);
    ok(nPts >= 4, "dans le tableau, chaque point d'attention est un bouton coloré (" + nPts + ")");
    const coul = await page.evaluate(() => [...new Set([...document.querySelectorAll("#fin-out table .fin-pt")].map((b) => b.style.getPropertyValue("--c")))].length);
    ok(coul >= 3, "couleurs distinctes selon le type de point (" + coul + " couleurs)");

    console.log("▶ Atelier de correction : part cédée");
    await page.click('#fin-out table .fin-pt[data-al="part"][data-opt="capital"]'); await page.waitForTimeout(300);
    const at = await page.evaluate(() => { const a = document.getElementById("fin-atelier"); return a ? { t: a.innerText.replace(/\s+/g, " "), champs: [...a.querySelectorAll("[data-k]")].map((i) => i.dataset.k) } : null; });
    ok(at && at.t.includes("Part cédée supérieure à 49 %") && at.t.includes("à corriger") && at.t.includes("Cible"), "l'atelier s'ouvre avec la mesure et la cible");
    ok(["preMoney", "multEntree", "partCapital", "partDette", "partSubvention", "margeSecuritePct"].every((k) => at.champs.includes(k)), "champs directs : valorisation, multiple d'entrée, parts du mix, marge de sécurité");
    ok(["clientsAn1", "delaiEncaissement", "fixesMensuels"].every((k) => at.champs.includes(k)), "champs indirects : nouveaux clients, délai d'encaissement, charges fixes");
    ok(at.t.includes("Valorisation avant apport nécessaire pour passer sous 49 %") && at.t.includes("Apport maximum"), "repères chiffrés : valorisation nécessaire et apport maximum");
    ok((await page.evaluate(() => document.querySelectorAll("#fin-atelier button[data-act='goto-postes']").length)) === 1, "bouton vers les embauches");

    console.log("▶ Correction en direct et suivi");
    const valo = await page.evaluate(() => { const rp = SanixFinancement.calc ? null : null; const t = document.getElementById("fin-atelier").innerText; return 0; });
    await page.fill('#fin-atelier [data-k="preMoney"]', "5000000000"); await page.keyboard.press("Tab"); await page.waitForTimeout(500);
    const apres = await page.evaluate(() => { const a = document.getElementById("fin-atelier"); return a ? a.innerText.replace(/\s+/g, " ") : ""; });
    ok(apres.includes("Réglé"), "valorisation très élevée : l'atelier annonce « Réglé »");
    ok((await toasts()).includes("Point d'attention réglé : Part cédée"), "message : « Point d'attention réglé : Part cédée »");
    await page.click('#fin-atelier [data-act="atelier-close"]'); await page.waitForTimeout(200);
    ok(await page.evaluate(() => !document.getElementById("fin-atelier")), "l'atelier se ferme");

    console.log("▶ Pastilles sur les champs des hypothèses");
    await page.evaluate(() => { const b = document.querySelector('#fin-body [data-tab="hyp"]'); b.click(); }); await page.waitForTimeout(400);
    const lie = await page.evaluate(() => [...document.querySelectorAll("#fin-body .fin-lien[data-act='atelier']")].map((b) => b.closest("label") && b.closest("label").querySelector("[data-k]") ? b.closest("label").querySelector("[data-k]").dataset.k : ""));
    ok(lie.length >= 3 && lie.includes("clientsAn1"), "des pastilles apparaissent à côté des champs qui commandent un point actif (" + [...new Set(lie)].join(", ") + ")");
    ok(await page.evaluate(() => [...document.querySelectorAll("#fin-body .fin-lien[data-act='atelier']")].every((b) => b.title.includes("agit sur"))), "chaque pastille indique les points qu'elle commande");
    await page.evaluate(() => document.querySelector("#fin-body .fin-lien[data-act='atelier']").click()); await page.waitForTimeout(400);
    ok(await page.evaluate(() => !!document.getElementById("fin-atelier") && document.querySelector('#fin-body .tab.active').dataset.tab === "synthese"), "un clic sur la pastille ouvre l'atelier correspondant dans la Synthèse");
    await page.evaluate(() => { const b = document.querySelector('#fin-out table .fin-pt[data-al="besoin"], #fin-out table .fin-pt[data-al="capacite"], #fin-out table .fin-pt[data-al="part"]'); if (b) b.click(); }); await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('#fin-atelier [data-act="goto-postes"]').click()); await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.querySelector('#fin-body .tab.active').dataset.tab === "hyp" && !!document.querySelector("#fin-body [data-p]")), "« Ouvrir les embauches » mène aux postes dans les hypothèses");
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    await page.evaluate(() => { document.querySelector('#fin-body [data-tab="synthese"]').click(); }); await page.waitForTimeout(300);
    await page.screenshot({ path: "/tmp/claude-0/-home-user-CRM-SANIX/fda489a8-65a8-578c-bff6-b00bf4b09a64/scratchpad/points.png", fullPage: false });
    console.log("\nPoints d'attention (atelier, surveillance, champs liés) : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
