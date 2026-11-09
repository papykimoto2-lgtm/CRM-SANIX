const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const { launch, newPage, ok, OUT, loadFixture } = require("./harness.js");
const tab = async (page, id) => { await page.click(`#tabs button[data-id=${id}]`); await page.waitForTimeout(250); };

(async () => {
  const { server, browser } = await launch(4173);
  try {
    console.log("▶ Bureau 3D (bureau, 1440×900)");
    const { page, errors } = await newPage(browser);
    await page.goto("http://localhost:4173/company/?debug=1");
    await page.waitForSelector("#app:not([hidden])");
    await page.waitForFunction(() => document.querySelectorAll(".np").length >= 20, null, { timeout: 15000 });
    await page.waitForTimeout(1200);
    ok(await page.locator(".np").count() >= 20, "avatars créés pour les collaborateurs actifs (nameplates)");
    ok((await page.locator("#stage canvas").count()) === 1, "canvas WebGL présent");
    await page.screenshot({ path: path.join(OUT, "office.png") });

    // clic sur un avatar : position écran fournie par le bureau 3D
    const pos = await page.evaluate(() => { const a = window.__vc.agents.find((x) => x.code === "ia_hunter_1"); return window.__vc.office.screenPositionOf(a.id); });
    const box = await page.locator("#stage").boundingBox();
    let clicked = false;
    await page.mouse.click(box.x + pos.x, box.y + pos.y);
    await page.waitForTimeout(300);
    if ((await page.locator("#sheet h2").first().textContent()) === "IA Prospect Hunter 1") clicked = true;
    ok(clicked, "clic sur un avatar : panneau d'activité de l'agent affiché");
    ok((await page.locator("#sheet").textContent()).includes("Trouver 50 promoteurs immobiliers"), "missions en cours de l'agent listées");
    await page.screenshot({ path: path.join(OUT, "office_selected.png") });
    await page.click("#side [data-act=charter]"); await page.waitForSelector("#modal:not([hidden])");
    ok((await page.locator("#modal .charter h4").count()) === 15, "cahier des charges : 15 rubriques");
    await page.keyboard.press("Escape"); ok(await page.locator("#modal").isHidden(), "Échap ferme la fenêtre");

    console.log("▶ Onglets");
    for (const id of ["exec", "org", "tasks", "meet", "perf", "reports", "gov", "valid"]) {
      await tab(page, id); await page.waitForTimeout(150);
      ok((await page.locator("#main").innerText()).length > 40, `onglet « ${id} » rendu`);
      await page.screenshot({ path: path.join(OUT, `tab_${id}.png`) });
    }

    console.log("▶ Bureau du Président");
    await tab(page, "exec");
    ok((await page.locator(".msg").count()) === 2, "conversation existante affichée");
    await page.fill("#exec-t", "Analyse les performances de tous les agents cette semaine.");
    await page.click("#exec-send"); await page.waitForTimeout(1500);
    ok((await page.locator(".msg.p").count()) === 2, "instruction envoyée au directeur général");
    ok((await page.locator(".msg.d").count()) === 2, "réponse du directeur affichée (rafraîchissement)");
    ok((await page.evaluate(() => window.__CALLS.filter((c) => c.fn === "ai-company" && c.body.action === "instruction").length)) === 1, "appel de la fonction ai-company/instruction");
    ok((await page.locator("#exec-side .card").count()) >= 4, "décisions attendues visibles dans le bureau");

    console.log("▶ Validations");
    await tab(page, "valid");
    const before = await page.locator("[data-act=decide][data-ok='1']").count();
    ok(before >= 5, `${before} validations listées`);
    ok(!(await page.locator("#main").innerHTML()).includes("<script>alert"), "contenu hostile d'un message échappé");
    await page.locator("[data-act=decide][data-ok='1']").first().click(); await page.waitForTimeout(300);
    ok((await page.locator("[data-act=decide][data-ok='1']").count()) === before - 1, "approbation enregistrée (RPC) et liste mise à jour");
    await page.locator("[data-act=decide][data-ok='0']").first().click(); await page.waitForSelector("#ask-t");
    await page.fill("#ask-t", "Hors périmètre"); await page.click("#ask button[type=submit]"); await page.waitForTimeout(300);
    ok((await page.evaluate(() => window.__CALLS.filter((c) => c.rpc === "ai_decide_approval" && c.args.p_ok === false && c.args.p_commentaire === "Hors périmètre").length)) === 1, "refus avec motif transmis");

    console.log("▶ Missions / Réunions / Performance");
    await tab(page, "tasks");
    ok((await page.locator("details.t").count()) >= 8, "arbre des missions");
    await page.selectOption("#f-st", "bloquee"); await page.waitForTimeout(150);
    ok((await page.locator("details.t > summary b").allTextContents()).some((t) => t.includes("Qualifier les promoteurs")), "filtre par statut (bloquée) conserve la branche");
    await page.selectOption("#f-st", ""); 
    await page.locator("[data-act=task]").first().click(); await page.waitForSelector("#modal:not([hidden])");
    ok((await page.locator("#modal").innerText()).includes("Description"), "détail d'une mission"); await page.keyboard.press("Escape");
    await tab(page, "meet"); await page.locator("tr[data-act=meeting]").first().click(); await page.waitForSelector("#modal:not([hidden])");
    ok((await page.locator("#modal").innerText()).includes("Plan d'action"), "procès-verbal et plan d'action"); await page.keyboard.press("Escape");
    await tab(page, "perf");
    ok((await page.locator("table.tbl tbody tr").count()) >= 10, "tableau de performance");
    await page.selectOption("#p-days", "30"); await page.waitForTimeout(200);

    console.log("▶ Rapports");
    await tab(page, "reports");
    await page.locator("[data-act=rpt-view]").first().click(); await page.waitForSelector("#modal iframe");
    await page.waitForTimeout(500);
    ok(true, "rapport affiché dans un iframe isolé : aucun script exécuté (pas de boîte de dialogue)");
    await page.keyboard.press("Escape");
    await page.fill("#rc-mail", "nouveau@sanix-africa.ci"); await page.click("#rcp-form button"); await page.waitForTimeout(300);
    ok((await page.locator("#main").innerText()).includes("nouveau@sanix-africa.ci"), "destinataire ajouté");
    await page.locator("tr[data-type=quotidien] input[data-f=heure]").fill("17:30");
    await page.locator("tr[data-type=quotidien] [data-act=save-setting]").click(); await page.waitForTimeout(250);
    ok((await page.evaluate(() => window.__Q.some((q) => q.table === "ai_report_settings" && q.op === "update" && q.payload?.includes("heure")))), "planification enregistrée");
    await page.click("[data-act=gen][data-type=quotidien]"); await page.waitForTimeout(300);
    ok((await page.evaluate(() => window.__CALLS.some((c) => c.body?.action === "report_now"))), "génération immédiate");

    console.log("▶ Gouvernance");
    await tab(page, "gov");
    await page.fill("input[name=max_agents_actifs]", "0"); await page.click("#gov-form button[type=submit]"); await page.waitForTimeout(200);
    ok((await page.locator("input[name=max_agents_actifs]:invalid").count()) === 1 && !(await page.evaluate(() => window.__Q.some((q) => q.table === "ai_governance" && q.op === "update"))), "valeur hors plage refusée avant tout envoi (validation du formulaire)");
    await page.fill("input[name=max_agents_actifs]", "30"); await page.selectOption("#g-comm", "autonome"); await page.click("#gov-form button[type=submit]"); await page.waitForTimeout(250);
    ok((await page.evaluate(() => window.__Q.some((q) => q.table === "ai_governance" && q.op === "update" && q.payload.includes("communication_externe")))), "gouvernance enregistrée");
    ok((await page.locator("#status-chips").innerText()).includes("autonome"), "l'état de la communication externe s'affiche dans l'en-tête");

    console.log("▶ Organisation → agent");
    await tab(page, "org");
    await page.locator(".node", { hasText: "IA Superviseur Santé" }).first().click(); await page.waitForTimeout(400);
    ok((await page.locator("#sheet h2").first().textContent()) === "IA Superviseur Santé", "clic dans l'organigramme ouvre l'agent dans le bureau");
    await page.locator("#side [data-act=agent-etat][data-etat=suspendu]").click(); await page.waitForSelector("#ask-t");
    await page.fill("#ask-t", "Résultats insuffisants"); await page.click("#ask button[type=submit]"); await page.waitForTimeout(300);
    ok((await page.evaluate(() => window.__CALLS.some((c) => c.rpc === "ai_set_agent_etat" && c.args.p_etat === "suspendu"))), "suspension d'un agent");

    console.log("▶ Vue 2D");
    await tab(page, "office"); await page.click("#b2d"); await page.waitForTimeout(200);
    ok((await page.locator("#fb2d .node").count()) >= 20, "vue 2D listant les collaborateurs");

    const q = await page.evaluate(() => window.__Q);
    fs.writeFileSync(path.join(OUT, "queries.json"), JSON.stringify(q));
    const real = errors.filter((e) => !/sandboxed/i.test(e));   // attendu : le script hostile du rapport est bloqué par le bac à sable
    ok(errors.some((e) => /Blocked script execution/.test(e)), "le script hostile du rapport a bien été bloqué par le bac à sable de l'iframe");
    ok(real.length === 0, `aucune autre erreur JS / console / dialogue (${real.length}) ${real.slice(0, 3).join(" | ")}`);
    await page.context().close();

    console.log("▶ Connexion : message fidèle à la cause");
    const L = await newPage(browser, { init: "window.__NOSESSION = true; window.__SIGNIN_ERR = { name: 'AuthApiError', status: 401, message: 'Invalid API key' };" });
    await L.page.goto("http://localhost:4173/company/"); await L.page.waitForSelector("#login-form");
    const info = await L.page.locator("#cfg-info").innerText();
    ok(/demo\.supabase\.co/.test(info) && /anon \(JWT\)/.test(info) && !/eyJ/.test(info), "écran de connexion : projet et type de clé affichés (clé masquée)");
    const submit = async (err) => {
      await L.page.evaluate((e) => { window.__SIGNIN_ERR = e; }, err);
      await L.page.fill("#l-mail", "operateur@sanix.africa"); await L.page.fill("#l-pass", "x"); await L.page.click("#login-form button[type=submit]"); await L.page.waitForTimeout(350);
      return L.page.locator("#l-err").innerText();
    };
    let msg = await submit({ name: "AuthApiError", status: 401, message: "Invalid API key" });
    ok(/Clé du projet refusée/.test(msg) && /401/.test(msg) && /Invalid API key/.test(msg) && /demo\.supabase\.co/.test(msg) && !/Identifiants invalides/.test(msg), "401 : clé du projet refusée (et non « identifiants invalides »)");
    msg = await submit({ name: "AuthApiError", status: 400, code: "invalid_credentials", message: "Invalid login credentials" });
    ok(msg === "Identifiants invalides.", "400 invalid_credentials : « Identifiants invalides. »");
    msg = await submit({ name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" });
    ok(/injoignable/.test(msg), "réseau coupé : Supabase injoignable");
    msg = await submit({ name: "AuthApiError", status: 401, message: "<img src=x onerror=alert(1)>" });
    ok((await L.page.locator("#l-err img").count()) === 0 && msg.includes("<img"), "message serveur hostile affiché en texte brut (aucun HTML interprété)");
    ok(!L.errors.some((e) => /DIALOG|pageerror/.test(e)), "aucune boîte de dialogue ni erreur de page");
    // accès commun avec le CRM : l'identifiant du CRM est accepté et proposé ; le mot de passe n'est jamais pré-rempli
    ok((await L.page.inputValue("#l-mail")) === "kessie" && (await L.page.inputValue("#l-pass")) === "", "identifiant du CRM (kessie) proposé par défaut, mot de passe jamais pré-rempli");
    const tryLogin = async (id) => { await L.page.fill("#l-mail", id); await L.page.fill("#l-pass", "x"); await L.page.click("#login-form button[type=submit]"); await L.page.waitForTimeout(300); return L.page.locator("#l-err").innerText(); };
    await L.page.evaluate(() => { window.__SIGNIN_ERR = { name: "AuthApiError", status: 400, code: "invalid_credentials", message: "Invalid login credentials" }; window.__SIGNINS = []; });
    await tryLogin("kessie");
    ok((await L.page.evaluate(() => window.__SIGNINS)).join() === "cyrille@sanix-africa.ci", "« kessie » est résolu en e-mail du compte opérateur");
    await L.page.evaluate(() => { localStorage.setItem("sanix_crm_directory", JSON.stringify([{ login: "kessie", email: "papy@exemple.ci", nom: "Cyrille KESSIE" }])); window.__SIGNINS = []; });
    await tryLogin("KESSIE");
    ok((await L.page.evaluate(() => window.__SIGNINS)).join() === "papy@exemple.ci", "annuaire publié par le CRM : prime sur la table par défaut (insensible à la casse)");
    await L.page.evaluate(() => { window.__SIGNINS = []; });
    msg = await tryLogin("inconnu");
    ok(/Identifiant inconnu/.test(msg) && (await L.page.evaluate(() => window.__SIGNINS.length)) === 0, "identifiant inconnu : message clair, aucun appel à Supabase");
    msg = await tryLogin("autre@exemple.ci");
    ok((await L.page.evaluate(() => window.__SIGNINS)).join() === "autre@exemple.ci", "un e-mail est repris tel quel");
    await L.page.evaluate(() => { window.__SIGNIN_ERR = null; });
    await L.page.fill("#l-mail", "operateur@sanix.africa"); await L.page.fill("#l-pass", "x"); await L.page.click("#login-form button[type=submit]");
    await L.page.waitForSelector("#app:not([hidden])");
    ok(true, "identifiants valides : accès au bureau");
    await L.ctx.close();

    console.log("▶ Configuration Supabase partagée avec le CRM");
    const JWT_SECRET = "bm90IGEgcHVibGljIGtleSwganVzdCBhIHNlY3JldC1saWtlIGJhc2U2NCBzdHJpbmcgZm9yIHRoZSB0ZXN0IHB1cnBvc2VzIG9ubHk=";   // ni sb_publishable_ ni JWT « anon » : ressemble au « JWT Secret »
    const C1 = await newPage(browser, { init: "window.__NOSESSION = true;", crmCfg: { url: "https://izgp.supabase.co", key: JWT_SECRET } });
    await C1.page.goto("http://localhost:4173/company/"); await C1.page.waitForSelector("#cfg-form");
    const cerr = await C1.page.locator("#cfg-err").innerText();
    ok(/Ce n'est pas une clé publique/.test(cerr) && /JWT Secret/.test(cerr), "clé non publique (type « JWT Secret ») refusée, avec explication");
    ok((await C1.page.inputValue("#cfg-url")) === "https://izgp.supabase.co", "l'URL enregistrée est conservée dans le formulaire");
    ok(JSON.parse(await C1.page.evaluate(() => localStorage.getItem("sanix_crm_supabase_config"))).key === "", "la clé non publique est effacée du navigateur");
    await C1.page.fill("#cfg-key", "sb_secret_abcdefghijklmnopqrstuvwxyz"); await C1.page.click("#cfg-form button[type=submit]");
    ok(/Clé secrète détectée/.test(await C1.page.locator("#cfg-err").innerText()), "clé secrète (sb_secret_) refusée à la saisie");
    await C1.page.fill("#cfg-key", "sb_publishable_abcdefghijklmnopqrstuvwxyz123456"); await C1.page.click("#cfg-form button[type=submit]"); await C1.page.waitForSelector("#login-form");
    const saved = JSON.parse(await C1.page.evaluate(() => localStorage.getItem("sanix_crm_supabase_config")));
    ok(saved.url === "https://izgp.supabase.co" && saved.key.startsWith("sb_publishable_") && (await C1.page.evaluate(() => localStorage.getItem("sanix_company_cfg"))) === null, "clé publique enregistrée dans la configuration du CRM (une seule configuration pour les deux applications)");
    ok(/publishable/.test(await C1.page.locator("#cfg-info").innerText()), "écran de connexion : projet et clé publishable");
    ok(C1.errors.length === 0, `aucune erreur (${C1.errors.join(" | ")})`);
    await C1.ctx.close();
    const C2 = await newPage(browser, { init: "window.__NOSESSION = true;", crmCfg: null });
    await C2.page.goto("http://localhost:4173/company/"); await C2.page.waitForSelector("#cfg-form");
    ok((await C2.page.inputValue("#cfg-url")) === "https://izgpvhwhbrgeagjfhfli.supabase.co", "aucune configuration : l'URL du projet SANIX est proposée par défaut (seule la clé publique reste à saisir)");
    await C2.ctx.close();

    console.log("▶ Pagination des listes longues");
    const fx = loadFixture(), tpl = fx.ai_agent_tasks.find((t) => !t.parent_id);
    fx.ai_agent_tasks = Array.from({ length: 60 }, (_, i) => ({ ...tpl, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, parent_id: null, titre: `Mission de test ${String(i + 1).padStart(2, "0")}`, created_at: new Date(Date.now() - i * 60000).toISOString() }));
    const PG = await newPage(browser, { fixture: JSON.stringify(fx) });
    await PG.page.goto("http://localhost:4173/company/?debug=1"); await PG.page.waitForSelector("#app:not([hidden])"); await PG.page.waitForTimeout(800);
    ok(await PG.page.evaluate(() => typeof window.SanixPager === "object"), "paginateur partagé chargé (CSP de production)");
    ok(!(await PG.page.evaluate(() => window.SanixPager.stats().some((s) => s.id === "sup-body"))), "tableau de supervision exclu (il a déjà « Afficher plus »)");
    await tab(PG.page, "tasks");
    const titles = () => PG.page.evaluate(() => [...document.querySelectorAll("#task-roots > details.t")].filter((d) => d.getAttribute("data-pg") !== "off").map((d) => d.querySelector("b").textContent));
    let t = await titles(); const st = await PG.page.evaluate(() => window.SanixPager.stats().find((s) => s.id === "task-roots"));
    ok(t.length === 10 && st.total === 60, `missions : ${st.total} en tête d'arbre, 10 affichées`);
    ok(/1–10 sur 60/.test(await PG.page.locator("#task-roots + .sx-pager .sx-info").innerText()), "barre « 1–10 sur 60 »");
    await PG.page.click('#task-roots + .sx-pager button[data-a="next"]'); const t2 = await titles();
    ok(t2.length === 10 && t2[0] !== t[0], "page suivante : autres missions");
    await PG.page.selectOption("#task-roots + .sx-pager select", "25"); ok((await titles()).length === 25, "25 missions par page");
    await PG.page.fill("#f-q", "Mission de test 07"); await PG.page.waitForTimeout(700);
    t = await titles(); ok(t.length === 1 && t[0].includes("07"), "recherche : une seule mission, sans barre de pagination");
    ok(PG.errors.length === 0, `aucune erreur (${PG.errors.join(" | ")})`);
    await PG.ctx.close();

    console.log("▶ Mobile (390×844)");
    const m = await newPage(browser, { w: 390, h: 844, mobile: true });
    await m.page.goto("http://localhost:4173/company/"); await m.page.waitForSelector("#app:not([hidden])");
    await m.page.waitForFunction(() => document.querySelectorAll(".np").length >= 3, null, { timeout: 15000 }); await m.page.waitForTimeout(1000);
    ok(!(await m.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), "pas de défilement horizontal de la page");
    await m.page.screenshot({ path: path.join(OUT, "mobile_office.png") });
    await tab(m.page, "exec"); await m.page.screenshot({ path: path.join(OUT, "mobile_exec.png") });
    ok(!(await m.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), "bureau du président : pas de débordement");
    ok(m.errors.length === 0, `mobile sans erreur (${m.errors.join(" | ")})`);
    await m.ctx.close();

    console.log("▶ Sans WebGL → repli 2D");
    const b2 = await chromium.launch({ args: ["--disable-3d-apis", "--disable-gpu", "--disable-webgl", "--disable-webgl2"] });
    const f = await newPage(b2);
    await f.page.goto("http://localhost:4173/company/"); await f.page.waitForSelector("#app:not([hidden])"); await f.page.waitForTimeout(1500);
    ok((await f.page.locator("#fb2d .node").count()) >= 20, "sans WebGL : liste 2D des collaborateurs");
    await f.page.screenshot({ path: path.join(OUT, "fallback2d.png") });
    ok(f.errors.filter((e) => !/WebGL|GPU|GL context|Failed to load resource/i.test(e)).length === 0, `repli sans erreur inattendue (${f.errors.join(" | ")})`);
    await b2.close();
    console.log("\nTOUT EST OK");
  } catch (e) { console.error("\n" + e.message); process.exitCode = 1; await browser.close(); server.close(); return; }
  await browser.close(); server.close();
})();
