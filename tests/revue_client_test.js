// SANIX CRM Pro : correctifs de la revue d'interconnexion côté navigateur. node revue_client_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4434), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4434/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.waitForFunction(() => CLIENTS.filter((c) => c.statut === "prospect").length >= 500, null, { timeout: 15000 });

    console.log("▶ Affichage sûr de l'historique (injection)");
    await page.evaluate(() => { DEALS.push({ id: 77001, client: "Client X", logiciel: "ImmoSuite ERP", stage: "contact", valeur: 0, history: [{ date: new Date().toISOString(), type: "stage_change", ico: "🔄", label: "<img src=x onerror=window.__xss=1>", note: "<script>window.__xss=2</script><b>gras</b>" }] }); openDealHistory(77001); });
    await page.waitForTimeout(250);
    const h = await page.evaluate(() => ({ imgs: document.querySelectorAll(".deal-tl-title img").length, bold: document.querySelectorAll(".deal-history-modal b, #modal-deal-history b").length, xss: window.__xss || 0, texte: document.body.innerText.includes("<img src=x") }));
    ok(h.imgs === 0 && h.xss === 0 && h.texte, "libellé et note d'historique : affichés comme texte, aucune balise ni script exécuté");

    console.log("▶ Restauration d'une sauvegarde");
    await page.evaluate(() => { lsSave("supabase_config", { url: "https://sync.example.supabase.co", key: "cle-legitime" }); backupRestore({ supabase_config: { url: "https://pirate.example", key: "x" }, users_data: [{ id: 1, login: "pirate" }], mon_store: [1, 2, 3], "../mauvais": 1 }); });
    const rs = await page.evaluate(() => ({ cfg: lsLoad("supabase_config"), mon: lsLoad("mon_store"), users: JSON.stringify(lsLoad("users_data") || "").includes("pirate"), mauvais: localStorage.getItem("sanix_crm_../mauvais") }));
    ok(rs.cfg.url === "https://sync.example.supabase.co" && !rs.users && rs.mauvais === null, "l'URL de synchronisation et les comptes ne sont jamais remplacés par un fichier de sauvegarde");
    ok(JSON.stringify(rs.mon) === "[1,2,3]", "les données ordinaires sont bien restaurées");

    console.log("▶ Stockage plein");
    const q = await page.evaluate(() => { const orig = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error("QuotaExceededError"); }; const r = lsSave("test_quota", [1]); Storage.prototype.setItem = orig; const toast = [...document.body.children].filter((e) => e.tagName === "DIV" && e.style.zIndex === "9000").map((e) => e.textContent).join(" | "); return { r, toast }; });
    ok(q.r === false && q.toast.includes("stockage du navigateur est plein"), "écriture impossible : retour faux et alerte visible (" + q.toast.slice(0, 60) + "…)");

    console.log("▶ Définitions communes");
    const t = await page.evaluate(() => { const c = CLIENTS.filter((x) => x.statut === "client").length, p = CLIENTS.filter((x) => x.statut === "prospect").length; initDashboard360(); return { attendu: Math.round(c / (c + p) * 100), affiche: document.getElementById("stat-conv").textContent }; });
    ok(t.affiche === t.attendu + "%", "taux de conversion du tableau de bord = clients ÷ (clients + prospects) = " + t.affiche);
    const refs = await page.evaluate(() => { COMMANDES.length = 0; COMMANDES.push({ id: "a1", ref: "CMD-2026-050", client: "A", date: "2026-11-01", htNet: 1, ttc: 1, statut: "en_cours" }, { id: "a2", ref: "CMD-2026-050", client: "B", date: "2026-11-02", htNet: 1, ttc: 1, statut: "en_cours" }, { id: "a3", ref: "CMD-2026-051", client: "C", date: "2026-11-03", htNet: 1, ttc: 1, statut: "en_cours" }); navigate("commandes", null); return null; });
    await page.waitForTimeout(400);
    const al = await page.evaluate(() => { const e = document.getElementById("cmd-doublons"); return e ? e.innerText : ""; });
    ok(al.includes("CMD-2026-050") && !al.includes("CMD-2026-051"), "numéro en double signalé (CMD-2026-050), pas le numéro unique");
    await page.evaluate(() => { COMMANDES[1].ref = "CMD-2026-052"; initCommandes(); });
    ok(await page.evaluate(() => !document.getElementById("cmd-doublons")), "alerte retirée une fois le numéro corrigé");
    const orph = await page.evaluate(() => { DEALS.push({ id: 77002, client: "Fantôme", clientId: 999999, fromProspect: true, logiciel: "ImmoSuite ERP", stage: "prospect", valeur: 0 }); return { orphelin: _dealOrphelin(DEALS.find((d) => d.id === 77002)), filtre: _pipelineFiltered().some((d) => d.id === 77002) }; });
    ok(orph.orphelin && !orph.filtre, "affaire d'un prospect supprimé : exclue du pipeline");

    console.log("▶ Renouvellement automatique de la session");
    const rn = await page.evaluate(async () => {
      SB_CONFIG = { url: "https://sync.example.supabase.co", key: "cle" };
      sessionStorage.removeItem("sanix_ais_session"); localStorage.setItem("sanix_ais_refresh", JSON.stringify({ r: "ancien-jeton", email: "op@example.com" }));
      const appels = []; const f0 = window.fetch;
      window.fetch = async (url, o) => { appels.push({ url: String(url), body: o && o.body }); return new Response(JSON.stringify({ access_token: "nouveau-acces", expires_in: 3600, refresh_token: "nouveau-jeton" }), { status: 200, headers: { "Content-Type": "application/json" } }); };
      const r = await SanixCrmSync.renewSession(); window.fetch = f0;
      return { r, appels, sess: JSON.parse(sessionStorage.getItem("sanix_ais_session")), ref: JSON.parse(localStorage.getItem("sanix_ais_refresh")) };
    });
    ok(rn.r === true && rn.sess.t === "nouveau-acces" && rn.sess.email === "op@example.com", "session rouverte sans retaper le mot de passe");
    ok(rn.appels.length === 1 && rn.appels[0].url.includes("grant_type=refresh_token") && rn.appels[0].body.includes("ancien-jeton") && rn.ref.r === "nouveau-jeton", "le jeton de renouvellement est utilisé puis remplacé (rotation)");
    const rn2 = await page.evaluate(async () => { sessionStorage.removeItem("sanix_ais_session"); const f0 = window.fetch; window.fetch = async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: { "Content-Type": "application/json" } }); const r = await SanixCrmSync.renewSession(); window.fetch = f0; return { r, ref: localStorage.getItem("sanix_ais_refresh") }; });
    ok(rn2.r === false && rn2.ref === null, "jeton refusé : reconnexion manuelle demandée, jeton périmé effacé");
    const rn3 = await page.evaluate(async () => { localStorage.setItem("sanix_ais_refresh", JSON.stringify({ r: "x", email: "e" })); sessionStorage.removeItem("sanix_ais_session"); const f0 = window.fetch; window.fetch = async () => { throw new Error("offline"); }; const r = await SanixCrmSync.renewSession(); window.fetch = f0; return { r, ref: localStorage.getItem("sanix_ais_refresh") }; });
    ok(rn3.r === false && rn3.ref !== null, "réseau absent : le jeton est conservé pour le prochain essai");
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    console.log("\nCorrectifs de la revue (navigateur) : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
