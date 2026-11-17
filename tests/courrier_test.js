// SANIX CRM Pro : exemples de courrier signés avec les références de l'utilisateur connecté. node courrier_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4446), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4446/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    const mk = () => page.evaluate(() => {
      currentUser.nom = "Awa Koné"; currentUser.poste = "Directrice commerciale"; currentUser.phone = "+225 05 11 22 33 44"; currentUser.email = "awa@societe-exemple.ci";
      CLIENTS.push({ id: 995001, nom: "PROMO TEST", statut: "prospect", secteur: "Immobilier", logiciel: "ImmoSuite ERP", phone: "0707904919", email: "contact@promo-test.ci", notes: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        interactions: [{ date: new Date().toISOString(), type: "Contact établi", note: "Appel", etape: 1, ico: "📞" }] });
      return true; });
    await mk();

    console.log("▶ Exemples de courrier");
    const r = await page.evaluate(() => { openCourrierModal(995001); const m = document.getElementById("modal-courrier"); const ex = window._courrierEx; return { visible: !m.classList.contains("hidden"), n: ex.length, reco: ex[0].id, ids: ex.map((e) => e.id), t: m.innerText.replace(/\s+/g, " "), sig: courrierSignature(),
      fin: ex.map((e) => e.corps.trim().endsWith(courrierSignature().trim()) || e.corps.includes(courrierSignature())), objets: ex.every((e) => e.objet && e.objet.length > 5), accolades: ex.some((e) => /\{[a-z_]+\}/.test(e.corps + e.objet)) }; });
    ok(r.visible && r.n === 7, "la fenêtre propose 7 exemples de courrier");
    ok(r.reco === "appel", "juste après un appel (étape « contact ») : « Suite à notre appel » est conseillé en premier");
    ok(r.fin.every(Boolean), "chaque exemple se termine par la signature de l'utilisateur connecté");
    ok(/^Awa Koné\nDirectrice commerciale — SANIX Africa\n/.test(r.sig) && r.sig.includes("📞 +225 05 11 22 33 44") && r.sig.includes("📧 awa@societe-exemple.ci"), "signature : nom, fonction — société, téléphone, e-mail du compte connecté");
    ok(!r.accolades && r.objets, "aucune variable {…} non remplie, un objet pour chaque courrier");
    ok(r.t.includes("Signé : Awa Koné") && r.t.includes("Conseillé"), "l'écran indique qui signe et quel exemple est conseillé");
    ok(!/Cyrille KESIE/.test(r.t), "l'ancien nom de gérant par défaut ne signe plus à la place de l'utilisateur");
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= 420), "pas de débordement sur téléphone");

    console.log("▶ Contenu des courriers");
    const c = await page.evaluate(() => { const g = (id) => window._courrierEx.find((e) => e.id === id); return { appel: g("appel").corps, rel: g("relance").corps, prop: g("proposition").corps, premier: g("premier").corps, pitch: /ImmoSuite/.test(g("appel").corps) }; });
    ok(/Merci pour le temps/.test(c.appel) && c.pitch, "« Suite à notre appel » remercie pour l'échange et présente le logiciel du prospect (ImmoSuite)");
    ok(/ne vous relancerai plus/.test(c.rel), "la relance laisse une porte de sortie polie");
    ok(/\[montant/.test(c.prop) && /\[licence/.test(c.prop), "la proposition garde des [crochets] à compléter plutôt que d'inventer un prix");
    ok(c.premier.includes("Awa Koné"), "le courrier de premier contact est lui aussi signé par l'utilisateur connecté");

    console.log("▶ Étape suivante : conseil adapté");
    const rec = await page.evaluate(() => { const c = CLIENTS.find((x) => x.id === 995001); const out = {}; const t = (k, f) => { f(c); out[k] = courrierExemples(c)[0].id; };
      t("prospect", (c) => { c.interactions = []; }); t("demo", (c) => { c.interactions = [{ date: new Date().toISOString(), type: "Démo réalisée", etape: 2 }]; });
      t("relance", (c) => { c.interactions = [{ date: new Date(Date.now() - 9 * 864e5).toISOString(), type: "Contact établi", etape: 1 }]; });
      t("proposition", (c) => { c.interactions = [{ date: new Date().toISOString(), type: "Proposition envoyée", etape: 3 }]; }); return out; });
    ok(rec.prospect === "premier" && rec.demo === "apres_demo" && rec.relance === "relance" && rec.proposition === "proposition", "conseil selon l'étape : premier contact, après démo, relance (sans nouvelle depuis 9 jours), proposition");

    console.log("▶ Adresse douteuse et fiche sans e-mail");
    const w = await page.evaluate(() => { const c = CLIENTS.find((x) => x.id === 995001); c.email = "abri@societe-exemple.cl"; openCourrierModal(995001); const a = document.getElementById("courrier-body").innerText.replace(/\s+/g, " "); c.email = ""; openCourrierModal(995001); const b = document.getElementById("courrier-body").innerText.replace(/\s+/g, " "); c.email = "contact@promo-test.ci"; return { a, b }; });
    ok(/semble incorrecte/.test(w.a) && /societe-exemple\.ci/.test(w.a), "adresse en .cl : avertissement et proposition .ci avant envoi");
    ok(/Aucune adresse e-mail/.test(w.b), "fiche sans e-mail : avertissement, courrier à copier");

    console.log("▶ Compte incomplet : repli sur les réglages");
    const f = await page.evaluate(() => { const u = currentUser; const sv = { poste: u.poste, phone: u.phone }; u.poste = ""; u.phone = ""; const s = courrierSignature(); u.poste = sv.poste; u.phone = sv.phone; return s; });
    ok(/^Awa Koné\nDirection — SANIX Africa/.test(f) && /📞 \+225 07 79 18 10 75/.test(f), "sans fonction ni téléphone : fonction du rôle (« Direction ») et téléphone de la société");

    console.log("▶ Copie, envoi et points d'entrée");
    await page.evaluate(() => openCourrierModal(995001)); await page.evaluate(() => courrierEnvoyer(0)).catch(() => {});
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => CLIENTS.find((x) => x.id === 995001).interactions.some((i) => i.type === "Relance Email")), "« Ouvrir dans ma messagerie » trace l'envoi dans l'historique de la fiche");
    await page.goto("http://localhost:4446/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await mk();
    const entry = await page.evaluate(() => { showClientDetail(995001); const a = [...document.querySelectorAll("#modal-client-detail a")].find((x) => /openCourrierModal/.test(x.getAttribute("onclick") || "")); if (!a) return false; a.click(); return !document.getElementById("modal-courrier").classList.contains("hidden"); });
    ok(entry, "dans la fiche, le bouton e-mail ouvre les exemples de courrier");

    console.log("▶ Fonction dans le compte utilisateur");
    const u = await page.evaluate(() => { openUserModal(currentUser.id); document.getElementById("u-poste").value = "Responsable des ventes"; return saveUser().then(() => USERS.find((x) => x.id === currentUser.id).poste); });
    ok(u === "Responsable des ventes", "le champ « Fonction » est enregistré dans le compte");
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    await page.evaluate(() => { document.getElementById("modal-user")?.classList.add("hidden"); openCourrierModal(995001); }); await page.waitForTimeout(200);
    await page.screenshot({ path: "/tmp/claude-0/-home-user-CRM-SANIX/fda489a8-65a8-578c-bff6-b00bf4b09a64/scratchpad/courrier.png" });
    console.log("\nExemples de courrier : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
