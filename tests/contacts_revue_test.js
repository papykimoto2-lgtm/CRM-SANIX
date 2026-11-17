// SANIX CRM Pro : revue des contacts des prospects (téléphone, e-mail, joignabilité, corrections). node contacts_revue_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4445), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://localhost:4445/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    const E = (v) => page.evaluate((v) => { const r = emailAnalyse(v); return { ok: r.ok, vide: !!r.vide, principal: r.principal, codes: r.problemes.map((p) => p.code), sure: r.sure, confirmer: r.confirmer }; }, v);

    console.log("▶ Analyse des e-mails");
    let r = await E("info@abc.ci"); ok(r.ok && r.codes.length === 0 && !("email" in r.sure), "adresse correcte : valide, rien à corriger");
    r = await E("  INFO@ABC.CI "); ok(r.ok && r.sure.email === "info@abc.ci", "espaces et majuscules : corrigé en minuscules");
    r = await E("marc@gmial.com"); ok(r.ok && r.sure.email === "marc@gmail.com" && r.codes.includes("faute"), "faute de frappe connue (gmial.com) : corrigée");
    r = await E("info@batinet.cl"); ok(!r.ok && r.confirmer.email === "info@batinet.ci" && !("email" in r.sure), "domaine .cl : refusé, « .ci » proposé à confirmer, jamais appliqué seul");
    r = await E("https://ivoirrapid.ci"); ok(!r.ok && r.codes.includes("site") && r.sure.email === "" && r.sure.noteSite === "https://ivoirrapid.ci", "site web saisi comme e-mail : retiré du champ e-mail et gardé dans les notes");
    r = await E("a@x.com / b@y.org"); ok(r.ok && r.principal === "a@x.com" && r.sure.noteEmails[0] === "b@y.org", "deux adresses : la première reste, la seconde va dans les notes");
    r = await E("Dg cetp@gmail.com"); ok(!r.ok && r.confirmer.email === "cetp@gmail.com" && !("email" in r.sure), "texte parasite : adresse proposée à confirmer, pas appliquée");
    r = await E("mixta@cotedivoire@mixtafrica.com"); ok(!r.ok && r.confirmer.email === "cotedivoire@mixtafrica.com", "deux « @ » : proposition à confirmer");
    r = await E("bidon"); ok(!r.ok && r.codes.includes("invalide"), "texte sans adresse : invalide");
    r = await E("test@example.com"); ok(!r.ok && r.codes.includes("factice"), "adresse factice : refusée");
    r = await E(""); ok(r.vide && !r.ok, "champ vide");

    console.log("▶ Qualité d'une fiche");
    const Q = (c) => page.evaluate((c) => { const q = contactQualite(c); return { niveau: q.niveau, wa: q.wa, mail: q.mail, sure: q.sure, codes: q.problemes.map((p) => p.code) }; }, c);
    let q = await Q({ phone: "07 07 90 49 19", email: "a@b.ci" }); ok(q.niveau === "complet" && q.sure.phone === "+2250707904919", "mobile + e-mail : complet, numéro standardisé en +225");
    q = await Q({ phone: "0707904919", email: "" }); ok(q.niveau === "joignable" && q.wa && !q.mail, "mobile seul : joignable par WhatsApp");
    q = await Q({ phone: "", email: "a@b.ci" }); ok(q.niveau === "joignable" && !q.wa && q.mail, "e-mail seul : joignable par e-mail");
    q = await Q({ phone: "2520000402", email: "" }); ok(q.niveau === "fixe" && !q.wa && q.sure.phone === "+2252520000402", "fixe à 10 chiffres sans indicatif : « fixe », indicatif +225 ajouté");
    q = await Q({ phone: "20211652", email: "" }); ok(q.niveau === "fixe" && !("phone" in q.sure), "ancien fixe à 8 chiffres : « fixe », jamais réécrit au hasard");
    q = await Q({ phone: "2520000402 / 0707904919", email: "" }); ok(q.niveau === "joignable" && q.sure.phone === "+2250707904919" && q.sure.noteTels.length === 1, "fixe puis mobile dans le champ : le mobile est retenu, le fixe va dans les notes");
    q = await Q({ phone: "", email: "" }); ok(q.niveau === "aucun" && q.codes.includes("notel"), "ni téléphone ni e-mail : sans contact");
    q = await Q({ phone: "12345", email: "" }); ok(q.niveau === "aucun" && q.codes.includes("telinvalide"), "numéro invalide : sans contact");

    console.log("▶ Écran de revue");
    const nb = await page.evaluate(() => {
      const mk = (id, nom, secteur, phone, email) => ({ id, nom, statut: "prospect", secteur, phone, email, notes: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      CLIENTS.push(mk(990001, "P Mobile", "Industrie", "07 07 90 49 19", ""), mk(990002, "P Fixe", "Santé", "22 52 24 59 / 22 42 33 32", ""), mk(990003, "P CL", "Immobilier", "", "info@batinet.cl"),
        mk(990004, "P Double", "Immobilier", "0505050505", "a@x.com / b@y.org"), mk(990005, "P Rien", "Santé", "", ""));
      openContactsModal(); const m = document.getElementById("modal-contacts");
      return { visible: !m.classList.contains("hidden"), t: m.innerText.replace(/\s+/g, " ") };
    });
    ok(nb.visible && nb.t.includes("Revue des contacts") && nb.t.includes("joignables") && nb.t.includes("sans contact"), "la revue s'ouvre avec les indicateurs");
    ok(/Industrie/.test(nb.t) && /Santé/.test(nb.t) && /Immobilier/.test(nb.t), "tableau par secteur");
    ok(/Appliquer les \d+ corrections sûres/.test(nb.t), "bouton des corrections sûres");
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= 420), "pas de débordement sur téléphone");
    await page.evaluate(() => contactsToutCorriger());
    const ap = await page.evaluate(() => { const g = (id) => CLIENTS.find((x) => x.id === id); return { p1: g(990001).phone, p4: g(990004).email, n4: g(990004).notes, p3: g(990003).email, p2: g(990002).phone }; });
    ok(ap.p1 === "+2250707904919", "corrections sûres appliquées : numéro standardisé");
    ok(ap.p4 === "a@x.com" && ap.n4.includes("Autres e-mails : b@y.org"), "deux e-mails : le second est conservé dans les notes, rien n'est perdu");
    ok(ap.p3 === "info@batinet.cl", "l'e-mail en .cl n'est PAS modifié sans confirmation");
    ok(ap.p2 === "22 52 24 59 / 22 42 33 32", "les deux fixes (indécidables) restent tels quels");
    await page.evaluate(() => contactConfirmer(990003));
    ok((await page.evaluate(() => CLIENTS.find((x) => x.id === 990003).email)) === "info@batinet.ci", "« Accepter » applique la proposition .ci après confirmation");
    await page.evaluate(() => contactVerifie(990001));
    ok(/^\d{4}-\d{2}-\d{2}$/.test(await page.evaluate(() => CLIENTS.find((x) => x.id === 990001).contactVerifie)), "« Vérifié » date la dernière confirmation du contact");
    const filt = await page.evaluate(() => { document.getElementById("cf-contact").value = "injoignable"; return getFilteredClients().map((c) => c.nom).filter((n) => /^P /.test(n)); });
    ok(filt.includes("P Rien") && !filt.includes("P Mobile"), "filtre « Aucun contact valide » dans la liste des clients");
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    await page.evaluate(() => { document.getElementById("cf-contact").value = ""; openContactsModal(); }); await page.waitForTimeout(200);
    await page.screenshot({ path: "/tmp/claude-0/-home-user-CRM-SANIX/fda489a8-65a8-578c-bff6-b00bf4b09a64/scratchpad/contacts.png" });
    console.log("\nRevue des contacts : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
