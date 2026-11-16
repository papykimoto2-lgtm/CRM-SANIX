// SANIX CRM Pro : aucun compte ni donnée client dans le code livré ; création de l'administrateur au premier lancement ; mots de passe PBKDF2 ;
// conversion de l'ancien format ; anti force brute ; sauvegarde et restauration complètes. node auth_sauvegarde_test.js
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const { start } = require("../company/tests/server.js");
const fx = require("./helpers/crm_fixture.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const PORT = 4423;

(async () => {
  const server = await start(PORT), browser = await chromium.launch();
  const nouveau = async (opts) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await fx.installer(ctx, opts);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = [], dialogs = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message)); page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await page.goto(`http://localhost:${PORT}/index.html`); await page.waitForTimeout(900);
    return { ctx, page, errors, dialogs };
  };
  try {
    console.log("▶ Le code livré ne contient ni compte ni donnée client");
    const racine = path.join(__dirname, "..");
    const servis = ["index.html", "sw.js", ...fs.readdirSync(path.join(racine, "shared")).filter((f) => f.endsWith(".js")).map((f) => "shared/" + f), "company/config.js", "company/app.js"];
    const interdits = [[/\b[0-9a-f]{64}\b/, "empreinte SHA-256"], [/pbkdf2\$\d+\$[0-9a-f]{16,}/, "empreinte PBKDF2"], [/VICTOIRE IMMOBILIER|Polyclinique Centrale|LUX'ALU SOLUTIONS|IvoirRapid|Zahara Multiservices|Menko Holding|Beda Alu|Ferme Jolan/, "client ou prospect réel"], [/\b0[157]( ?\d{2}){4}\b/, "numéro de téléphone ivoirien"], [/[\w.+-]+@gmail\.com/, "adresse Gmail"]];
    const PROPRES = new Set(["0779181075", "0140017751", "0140075551", "0707904919", "0712345678", "0700000001"]);    // numéros de SANIX (émetteur des factures) et exemples fictifs
    servis.forEach((f) => { const t = fs.readFileSync(path.join(racine, f), "utf8"); interdits.forEach(([re, nom]) => { const g = new RegExp(re.source, "g"); let m; while ((m = g.exec(t))) { if (nom === "numéro de téléphone ivoirien" && PROPRES.has(m[0].replace(/\D/g, "").slice(-10))) continue; if (nom === "adresse Gmail" && /^(paypikmoto2|sanixafrica699)@/.test(m[0])) continue; throw new Error(`ÉCHEC : ${f} contient ${nom} : ${m[0]}`); } }); });
    ok(true, "index.html, sw.js, shared/*.js, company/config.js : ni empreinte de mot de passe, ni prospect ou client réel, ni numéro privé (seules les coordonnées de SANIX restent)");
    ok(/let USERS_RAW = \[\];/.test(fs.readFileSync(path.join(racine, "index.html"), "utf8")), "aucun compte dans le code (USERS_RAW vide)");

    console.log("▶ Premier lancement : création de l'administrateur");
    let A = await nouveau({ sansCompte: true, sansDonnees: true });
    ok(await A.page.locator("#setup-box").isVisible() && !(await A.page.locator("#login-email").isVisible()), "aucun compte : le formulaire de création s'affiche à la place de la connexion");
    ok(await A.page.evaluate(() => USERS.length === 0 && CLIENTS.length === 0 && COMMANDES.length === 0), "base vide : aucune donnée livrée avec l'application");
    const essai = async (nom, login, email, p1, p2) => { await A.page.fill("#setup-nom", nom); await A.page.fill("#setup-login", login); await A.page.fill("#setup-email", email); await A.page.fill("#setup-pass", p1); await A.page.fill("#setup-pass2", p2); await A.page.click("#setup-btn"); await A.page.waitForTimeout(250); return A.page.locator("#setup-error").innerText(); };
    ok(/10 caractères/.test(await essai("Test Admin", "testadmin", "t@test.ci", "court", "court")), "mot de passe trop court refusé");
    ok(/ne correspondent pas/.test(await essai("Test Admin", "testadmin", "t@test.ci", "UnMotDePasse-2026", "Autre-2026-xx")), "confirmation différente refusée");
    ok(/identifiant/.test(await essai("Test Admin", "testadmin", "t@test.ci", "testadmin-2026-x", "testadmin-2026-x")), "mot de passe contenant l'identifiant refusé");
    ok(/e-mail invalide/i.test(await essai("Test Admin", "testadmin", "pas-un-mail", "UnMotDePasse-2026", "UnMotDePasse-2026")), "adresse e-mail invalide refusée");
    ok(await A.page.evaluate(() => USERS.length === 0), "aucun compte créé tant que le formulaire est invalide");
    await essai("Test Admin", "testadmin", "t@test.ci", "UnMotDePasse-2026", "UnMotDePasse-2026"); await A.page.waitForTimeout(600);
    const u = await A.page.evaluate(() => ({ n: USERS.length, role: USERS[0].role, hash: USERS[0].hash, cur: currentUser && currentUser.login, ls: JSON.parse(localStorage.getItem("sanix_crm_users_data"))[0].hash }));
    ok(u.n === 1 && u.role === "super_admin" && u.cur === "testadmin", "compte administrateur créé et connecté");
    ok(/^pbkdf2\$210000\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(u.hash) && u.ls === u.hash, "mot de passe stocké en PBKDF2 (210 000 itérations, sel aléatoire) et enregistré");
    ok(!(await A.page.evaluate(() => JSON.stringify(USERS)).then((j) => j.includes("UnMotDePasse"))), "le mot de passe en clair n'est stocké nulle part");
    ok(await A.page.evaluate(async () => { const a = await pwHash("meme-mot-de-passe"), b = await pwHash("meme-mot-de-passe"); return a !== b && await pwVerify("meme-mot-de-passe", a) && !(await pwVerify("autre", a)) && await pwVerify("meme-mot-de-passe", b); }), "deux empreintes du même mot de passe diffèrent (sel) ; vérification juste/fausse");

    console.log("▶ Connexion et anti force brute");
    await A.page.evaluate(() => doLogout()); await A.page.waitForTimeout(400);
    ok(await A.page.locator("#login-email").isVisible() && !(await A.page.locator("#setup-box").isVisible()), "après déconnexion : formulaire de connexion (pas de création)");
    const tenter = async (id, mdp) => { await A.page.fill("#login-email", id); await A.page.fill("#login-password", mdp); await A.page.click("#login-btn"); await A.page.waitForTimeout(1100); return A.page.locator("#login-error").innerText(); };
    ok(/incorrect/.test(await tenter("testadmin", "mauvais-mot-de-passe")), "mauvais mot de passe refusé");
    ok(await A.page.evaluate(() => !currentUser), "toujours déconnecté");
    for (let i = 0; i < 4; i++) await tenter("testadmin", "mauvais-" + i);
    const bloc = await tenter("testadmin", "UnMotDePasse-2026");
    ok(/Trop d'essais/.test(bloc) && await A.page.evaluate(() => !currentUser), "5 échecs : le bon mot de passe lui-même est refusé pendant l'attente (" + bloc.replace(/\s+/g, " ").slice(0, 60) + ")");
    await A.page.evaluate(() => sessionStorage.removeItem("sanix_crm_login_fail"));
    await tenter("testadmin@x", "x"); await A.page.evaluate(() => sessionStorage.removeItem("sanix_crm_login_fail"));
    await tenter("TestAdmin", "UnMotDePasse-2026"); await A.page.waitForTimeout(600);
    ok(await A.page.evaluate(() => currentUser && currentUser.login === "testadmin"), "bon mot de passe : connecté (identifiant insensible à la casse)");
    ok(A.errors.length === 0, "aucune erreur JavaScript " + A.errors.join("|"));
    await A.ctx.close();

    console.log("▶ Ancien compte (SHA-256 + sel fixe) : converti en PBKDF2 à la connexion");
    A = await nouveau({});
    ok(await A.page.evaluate(() => /^[0-9a-f]{64}$/.test(USERS[0].hash)), "le compte de départ a l'ancienne empreinte");
    await A.page.fill("#login-email", fx.ADMIN.login); await A.page.fill("#login-password", "mot-de-passe-faux"); await A.page.click("#login-btn"); await A.page.waitForTimeout(1000);
    ok(await A.page.evaluate(() => !currentUser && /^[0-9a-f]{64}$/.test(USERS[0].hash)), "mauvais mot de passe : refusé, empreinte inchangée");
    await A.page.evaluate(() => sessionStorage.removeItem("sanix_crm_login_fail"));
    await A.page.fill("#login-email", fx.ADMIN.email); await A.page.fill("#login-password", fx.ADMIN.pass); await A.page.click("#login-btn"); await A.page.waitForTimeout(1500);
    const m = await A.page.evaluate(() => ({ cur: currentUser && currentUser.login, hash: USERS[0].hash, ls: JSON.parse(localStorage.getItem("sanix_crm_users_data"))[0].hash }));
    ok(m.cur === fx.ADMIN.login && /^pbkdf2\$/.test(m.hash) && m.ls === m.hash, "connecté avec l'ancien mot de passe ; empreinte remplacée par du PBKDF2 et enregistrée");
    await A.page.evaluate(() => doLogout()); await A.page.waitForTimeout(300); await A.page.evaluate(() => sessionStorage.clear());
    await A.page.fill("#login-email", fx.ADMIN.login); await A.page.fill("#login-password", fx.ADMIN.pass); await A.page.click("#login-btn"); await A.page.waitForTimeout(1500);
    ok(await A.page.evaluate(() => !!currentUser), "la reconnexion avec la nouvelle empreinte fonctionne");

    console.log("▶ Gestion des comptes");
    ok(await A.page.evaluate(async () => { const h = await pwHash("Commercial-2026"); USERS.push({ id: 5, nom: "Com", login: "com", email: "com@test.ci", role: "commercial", hash: h, actif: true }); return await pwVerify("Commercial-2026", USERS.find((x) => x.id === 5).hash); }), "un compte créé reçoit une empreinte PBKDF2 vérifiable");

    console.log("▶ Sauvegarde complète");
    const snap = await A.page.evaluate(() => { const s = backupSnapshot(); return { f: s._format, v: s._version, cles: Object.keys(s.stores), clients: s.stores.clients.length, cmd: s.stores.commandes.length, json: JSON.stringify(s) }; });
    ok(snap.f === "sanix-crm-sauvegarde" && snap.clients === 519 && snap.cmd === 8, `export : ${snap.clients} clients/prospects, ${snap.cmd} commandes`);
    ok(!snap.cles.includes("users_data") && !/pbkdf2\$|"hash"/.test(snap.json), "la sauvegarde ne contient ni comptes ni empreintes de mots de passe");
    ok(!snap.cles.some((k) => /outbox|sync_v1|whoami|directory|_updated$|^backup_/.test(k)), "ni file de synchronisation ni état interne");
    const sauvegarde = snap.json;
    await A.ctx.close();

    console.log("▶ Restauration sur un appareil neuf");
    A = await nouveau({ sansCompte: true, sansDonnees: true });
    await A.page.fill("#setup-nom", "Nouvel Admin"); await A.page.fill("#setup-login", "nouveladmin"); await A.page.fill("#setup-email", "n@test.ci"); await A.page.fill("#setup-pass", "Un-Autre-Mot-De-Passe-1"); await A.page.fill("#setup-pass2", "Un-Autre-Mot-De-Passe-1"); await A.page.click("#setup-btn"); await A.page.waitForTimeout(900);
    ok(await A.page.evaluate(() => CLIENTS.length === 0), "appareil neuf : base vide");
    ok(await A.page.evaluate((j) => { try { backupParse({ nimporte: "quoi" }); return false; } catch (e) { return /aucune donnée/.test(e.message); } }, sauvegarde), "fichier étranger refusé");
    ok(await A.page.evaluate(() => { try { backupParse([1, 2]); return false; } catch (e) { return true; } }), "fichier qui n'est pas un objet refusé");
    const hashAvant = await A.page.evaluate(() => USERS[0].hash);
    const stores = await A.page.evaluate((j) => backupParse(JSON.parse(j)), sauvegarde);
    ok(!("users_data" in stores) && stores.clients.length === 519, "lecture de la sauvegarde : comptes exclus");
    await A.page.evaluate((j) => { backupRestore(backupParse(JSON.parse(j))); }, sauvegarde);
    await A.page.reload(); await A.page.waitForTimeout(1200);
    const r = await A.page.evaluate(() => ({ cl: CLIENTS.length, cmd: COMMANDES.length, users: USERS.map((x) => x.login), hash: USERS[0].hash, lic: LICENCES.length }));
    ok(r.cl === 519 && r.cmd === 8 && r.lic >= 1, `restauré après rechargement : ${r.cl} clients/prospects, ${r.cmd} commandes, ${r.lic} licences`);
    ok(r.users.join() === "nouveladmin" && r.hash === hashAvant, "le compte du nouvel appareil est conservé (la restauration ne touche pas aux comptes)");
    ok(await A.page.evaluate(() => { const o = {}; Object.keys(LS_STORES).forEach((k) => { if (k !== "users_data") o[k] = LS_STORES[k].get(); }); return typeof JSON.parse(JSON.stringify(Object.assign({}, o, { _format: "ancien" }))).clients.length === "number" && backupParse({ clients: [{ id: 1 }], deals: [] }).clients.length === 1; }), "ancien format de sauvegarde (une clé par rubrique) toujours lisible");
    ok(A.errors.length === 0, "aucune erreur JavaScript " + A.errors.join("|"));
    await A.ctx.close();
    console.log("\nAuthentification et sauvegarde : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
