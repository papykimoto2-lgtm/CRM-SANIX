const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
let fails = 0; const ok = (c, m) => { console.log((c ? "OK  " : "ÉCHEC ") + m); if (!c) fails++; };
(async () => {
  const server = await start(4421), browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await require("./helpers/crm_fixture.js").installer(ctx);
  await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
  const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  let promptVal = "";  page.on("dialog", (d) => d.type() === "prompt" ? d.accept(promptVal) : d.dismiss());
  await page.goto("http://localhost:4421/index.html"); await page.waitForTimeout(800);
  await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1500);
  await page.waitForFunction(() => CLIENTS.filter(c => c.statut === "prospect").length >= 500, null, { timeout: 15000 });   // les données de départ sont chargées de façon différée
  await page.evaluate(() => navigate("qualification", null)); await page.waitForTimeout(700);
  const kp = () => page.evaluate(() => document.getElementById("ql-kpis").innerText.replace(/\s+/g, " "));
  console.log(await kp());
  ok(await page.evaluate(() => !document.getElementById("view-qualification").classList.contains("hidden")), "écran affiché");
  ok(await page.evaluate(() => document.querySelector("#view-qualification .grp-tab.active")?.textContent.includes("Qualification")), "onglet Qualification actif dans Ventes");
  const total = await page.evaluate(() => +document.getElementById("ql-count").textContent.split(" ")[0]);
  ok(total === 511, "511 prospects à qualifier (" + total + ")");
  const visibles = await page.evaluate(() => [...document.querySelectorAll("#ql-list .ql-row")].filter(r => r.offsetParent !== null).length);
  ok(visibles === 25, "pagination : 25 lignes visibles (" + visibles + ")");
  // 1) action unitaire : Contacté
  const id = await page.evaluate(() => +document.querySelector("#ql-list .ql-row").dataset.id);
  await page.click(`#ql-r-${id} button:has-text("Contacté")`);
  let r = await page.evaluate((id) => { const c = CLIENTS.find(x => x.id === id); return { e: aiGetEtape(c), st: DEALS.find(d => d.clientId === id).stage, inter: c.interactions.length }; }, id);
  ok(r.e === 1 && r.st === "contact" && r.inter === 1, "Contacté : étape 1, deal en « contact » " + JSON.stringify(r));
  ok(await page.evaluate((id) => document.querySelector(`#ql-r-${id} button[disabled]`) !== null, id), "bouton déjà fait désactivé (pas de retour en arrière)");
  // 2) devis : demande un montant, le compte dans le pipeline
  promptVal = "1 250 000";
  await page.click(`#ql-r-${id} button:has-text("Devis envoyé")`);
  r = await page.evaluate((id) => { const c = CLIENTS.find(x => x.id === id), d = DEALS.find(x => x.clientId === id); return { e: aiGetEtape(c), v: c.valeur, dv: d.valeur, st: d.stage, saisie: d.valeurSaisie }; }, id);
  ok(r.e === 3 && r.v === 1250000 && r.dv === 1250000 && r.st === "proposition" && r.saisie, "Devis : montant 1 250 000 compté dans le deal " + JSON.stringify(r));
  await page.evaluate(() => navigate("pipeline", null)); await page.waitForTimeout(600);
  const col = await page.evaluate(() => document.getElementById("col-proposition").innerText.replace(/\s+/g, " "));
  ok(/1250k FCFA chiffrés/.test(col) && /1/.test(col), "pipeline : colonne Proposition = 1250k chiffrés -> " + col.slice(0, 60));
  const non = await page.evaluate(() => document.getElementById("pipeline-total").textContent);
  ok(/non chiffrés/.test(non), "pipeline : les autres restent non chiffrés -> " + non);
  // 3) devis sans montant refusé
  await page.evaluate(() => navigate("qualification", null)); await page.waitForTimeout(500);
  const id2 = await page.evaluate(() => +document.querySelector("#ql-list .ql-row").dataset.id);
  promptVal = "";
  await page.click(`#ql-r-${id2} button:has-text("Devis envoyé")`);
  ok(await page.evaluate((i) => aiGetEtape(CLIENTS.find(x => x.id === i)), id2) === 0, "devis sans montant refusé");
  // 4) lot : cocher la page, attribuer, marquer contactés
  await page.click('button:has-text("Cocher la page")');
  const nsel = await page.evaluate(() => document.getElementById("ql-nsel").textContent);
  ok(/^2[0-9] coch/.test(nsel) || /^25 coch/.test(nsel), "cocher la page : " + nsel);
  await page.selectOption("#ql-bulk-com", { index: 1 });
  const nom = await page.evaluate(() => document.getElementById("ql-bulk-com").value);
  await page.click('button:has-text("Attribuer aux cochés")');
  await page.click('button:has-text("Marquer contactés")');
  r = await page.evaluate((nom) => ({ avecCom: CLIENTS.filter(c => c.statut === "prospect" && c.commercial === nom).length, contactes: CLIENTS.filter(c => c.statut === "prospect" && aiGetEtape(c) === 1).length, dealCom: DEALS.filter(d => d.commercial === nom).length }), nom);
  ok(r.avecCom >= 20 && r.contactes >= 20 && r.dealCom >= 20, "lot : attribué à " + nom + " et contactés " + JSON.stringify(r));
  // 5) perdu / réactiver
  const id3 = await page.evaluate(() => +document.querySelector("#ql-list .ql-row:not(:has(.btn-primary))")?.dataset.id || 0);
  const id4 = id3 || id2;
  promptVal = "injoignable";
  await page.evaluate((i) => qlPerdre(i), id4);
  r = await page.evaluate((i) => ({ st: DEALS.find(d => d.clientId === i).stage }), id4);
  ok(r.st === "perdu", "Perdu : deal en perdu");
  await page.evaluate(() => navigate("pipeline", null)); await page.waitForTimeout(400);
  await page.evaluate(() => navigate("qualification", null)); await page.waitForTimeout(500);
  r = await page.evaluate((i) => ({ st: DEALS.find(d => d.clientId === i).stage }), id4);
  ok(r.st === "perdu", "Perdu conservé après resynchronisation du pipeline");
  await page.evaluate(() => { document.getElementById("ql-etape").value = "perdu"; qlRender(); });
  ok(await page.evaluate((i) => !!document.getElementById("ql-r-" + i), id4), "filtre Perdus liste le prospect");
  await page.evaluate((i) => qlReactiver(i), id4);
  ok(await page.evaluate((i) => DEALS.find(d => d.clientId === i).stage !== "perdu", id4), "Réactiver remet le deal en cours");
  // 6) persistance
  await page.reload(); await page.waitForTimeout(900);
  await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1200);
  r = await page.evaluate((id) => { const c = CLIENTS.find(x => x.id === id); return { e: aiGetEtape(c), v: c.valeur }; }, id);
  ok(r.e === 3 && r.v === 1250000, "qualification conservée après rechargement " + JSON.stringify(r));
  // 7) droits
  const rights = await page.evaluate(() => { const o = currentUser; const res = {}; ["commercial", "apporteur"].forEach(role => { currentUser = { role }; res[role] = _canView("qualification"); }); currentUser = o; return res; });
  ok(rights.commercial === true && rights.apporteur === false, "droits : commercial oui, apporteur non " + JSON.stringify(rights));
  await page.evaluate(() => navigate("qualification", null)); await page.waitForTimeout(500);
  console.log(await kp());
  ok(errs.length === 0, "aucune erreur JS " + JSON.stringify(errs.slice(0, 3)));
  await browser.close(); server.close && server.close(); console.log(fails ? "ÉCHECS: " + fails : "TOUT PASSE"); process.exit(fails ? 1 : 0);
})();
