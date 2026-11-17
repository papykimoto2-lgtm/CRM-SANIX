// SANIX CRM Pro : page « Bureau du jour » dans le navigateur (téléphone 420 px), avec un faux serveur d'agents. node bureau_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4449), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4449/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => {
      const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
      window.__ago = ago;
      window.__srv = { session: true, panne: {}, decisions: [],
        agents: [{ id: "a1", nom: "Prospection", fonction: "Responsable", etat: "actif" }, { id: "a2", nom: "Qualificateur", fonction: "Qualif", etat: "actif" }, { id: "a3", nom: "Chercheur 1", fonction: "Recherche", etat: "suspendu" }, { id: "a4", nom: "Chercheur 2", fonction: "Recherche", etat: "suspendu" }, { id: "a5", nom: "Rédacteur", fonction: "Contenus", etat: "suspendu" }],
        ouvertes: [{ id: "t4", agent_id: "a2", titre: "Appeler les cliniques", statut: "bloquee", rapport: "Aucun numéro mobile", updated_at: ago(1) }],
        terminees: [{ id: "t1", agent_id: "a1", titre: "Qualifier 10 prospects Industrie", statut: "terminee", rapport: "10 prospects qualifiés.", finished_at: ago(2) }],
        incidents: [{ gravite: "critique", type: "suspension_auto", message: "3 échecs", created_at: ago(2) }, { gravite: "attention", type: "erreur_execution", message: "400 {”type”:”error”,”error”:{”type”:”invalid_request_error”,”message”:”Your credit balance is too low to access the Anthropic API.”}}", created_at: ago(1) }],
        validations: [{ id: "11111111-1111-1111-1111-111111111111", type: "remise", motif: "Remise de 10 %", created_at: ago(1), ai_prospects: { entreprise: "BACID" } }],
        gov: [{ actif: true, budget_jour_usd: 7, modele: "claude-opus-5-5", modele_operationnel: "claude-sonnet-5-5" }], actions: [{ cout_usd: 0.9 }, { cout_usd: 0.5 }],
        etat: { connecte: true, email: "sanix@gmail.com" },
        mails: [{ id: "m1", client_rid: "c_b1", to_email: "x@x.ci", subject: "Premier contact", status: "repondu", sent_at: ago(30), replied_at: ago(1), relance_apres_jours: 4 }, { id: "m2", client_rid: "c_b2", to_email: "faux@x.ci", subject: "Essai", status: "echec", error: "Non distribué (retour Gmail)", sent_at: ago(70), last_checked_at: ago(48), relance_apres_jours: 4 }] };
      window.aisApi = async (path, opt = {}) => {
        const S = window.__srv, body = opt.body ? JSON.parse(opt.body) : {};
        if (!S.session) throw new Error("Connectez l'agent IA (session opérateur)");
        for (const k of Object.keys(S.panne)) if (S.panne[k] && path.includes(k)) throw new Error("HTTP 500");
        if (path.includes("crm_mail_state")) return S.etat;
        if (path.includes("/rest/v1/crm_mails")) return S.mails;
        if (path.includes("ai_decide_approval")) { S.decisions.push(body); S.validations = []; return null; }
        if (path.includes("/rest/v1/ai_agents")) return S.agents;
        if (path.includes("statut=not.in")) return S.ouvertes;
        if (path.includes("finished_at=gte")) return S.terminees;
        if (path.includes("ai_incidents")) return S.incidents;
        if (path.includes("ai_approvals")) return S.validations;
        if (path.includes("ai_governance")) return S.gov;
        if (path.includes("ai_actions")) return S.actions;
        return null;
      };
      CLIENTS.push({ id: 998001, _rid: "c_b1", nom: "Marc Dupont", statut: "prospect", secteur: "Immobilier", logiciel: "ImmoSuite ERP", phone: "0707904919", email: "x@x.ci", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), interactions: [{ date: new Date().toISOString(), type: "Contact établi", etape: 1 }] });
      CLIENTS.push({ id: 998002, _rid: "c_b2", nom: "Adresse Fausse", statut: "prospect", secteur: "Immobilier", logiciel: "ImmoSuite ERP", phone: "", email: "faux@x.ci", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), interactions: [] });
      localStorage.removeItem("sanix_crm_notif_vu"); _gmail.charge = 0; _gmail.etat = null;
    });
    const ouvrir = async () => { await page.evaluate(() => { _gmail.charge = 0; _gmail.etat = null; navigate("bureau", null); }); await page.waitForTimeout(1200); };
    const texte = () => page.evaluate(() => document.getElementById("view-bureau").innerText.replace(/\s+/g, " "));

    console.log("▶ Page complète");
    await ouvrir(); let t = await texte();
    ok(await page.evaluate(() => !document.getElementById("view-bureau").classList.contains("hidden") && document.getElementById("topbar-title").textContent === "Bureau du jour"), "la page s'ouvre avec le titre « Bureau du jour »");
    ok(/points? demandent? votre attention/.test(t) || /point demande votre attention/.test(t), "phrase de synthèse en tête : " + (await page.evaluate(() => document.getElementById("bureau-phrase").textContent)));
    ok(/2 actifs · 3 suspendus · 5 au total/.test(t), "agents : 2 actifs, 3 suspendus sur 5");
    ok(/suspendu automatiquement/.test(t) && /erreur pendant l'exécution/.test(t), "incidents d'agents en français courant");
    ok(/Crédit Anthropic insuffisant/.test(t) && !/invalid_request_error/.test(t), "l'erreur brute de l'API est traduite : « Crédit Anthropic insuffisant »");
    ok(/1 validation d'agent en attente/.test(t) && /BACID/.test(t), "validation d'agent en attente, avec le prospect concerné");
    ok(/1 réponse ou retour d'e-mail à lire/.test(t) || /réponses? ou retours? d'e-mail/.test(t), "réponse reçue par e-mail signalée");
    ok(/Qualifier 10 prospects Industrie/.test(t) && /Prospection/.test(t) && /Bloqué \(1\)/i.test(t) && /Appeler les cliniques/.test(t), "ce que les agents ont fait : terminé aujourd'hui (avec l'agent) et mission bloquée");
    ok(/1,40 \$ sur un budget de 7,00 \$ par jour \(20 %\)/.test(t), "coût IA : 1,40 $ sur 7,00 $ = 20 %");
    ok(/Activité du jour/i.test(t) && /sans réponse/.test(t), "bloc « Activité du jour » (e-mails, échanges, rendez-vous)");
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= 420), "aucun débordement sur téléphone");
    ok(await page.evaluate(() => /Bureau du jour/.test(document.querySelector("#view-bureau .grp-tabs").innerText) && document.querySelector('.sb-item[data-grp="accueil"]').classList.contains("active")), "onglet « Bureau du jour » dans Accueil, menu Accueil actif");
    ok(await page.evaluate(() => !!document.querySelector("#note-explicative-host details") && /Bureau|journée/.test(document.getElementById("note-explicative-host").innerText)), "note explicative en bas de page");

    console.log("▶ Actions directes");
    await page.evaluate(() => [...document.querySelectorAll("#bureau-body button")].find((b) => /Approuver/.test(b.textContent)).click()); await page.waitForTimeout(1200);
    const dec = await page.evaluate(() => __srv.decisions[0]);
    ok(dec && dec.p_id === "11111111-1111-1111-1111-111111111111" && dec.p_ok === true, "« Approuver » envoie la décision au serveur pour la bonne validation");
    ok(!/validation d'agent en attente/.test(await texte()), "après la décision, la ligne de validation disparaît (page rechargée)");
    await page.evaluate(() => { const b = [...document.querySelectorAll("#bureau-body button")].find((x) => /bureauAction/.test(x.getAttribute("onclick") || "") && /cloche/.test(x.getAttribute("onclick"))); b.click(); }); await page.waitForTimeout(400);
    ok(await page.evaluate(() => { const p = document.getElementById("notif-panel"); return !!p && !p.classList.contains("hidden"); }), "« Ouvrir » sur les réponses ouvre la cloche (et elle reste ouverte)");
    await page.evaluate(() => document.getElementById("notif-panel").classList.add("hidden"));
    await page.evaluate(() => { const b = [...document.querySelectorAll("#bureau-body button")].find((x) => /"agents"/.test(x.getAttribute("onclick") || "")); if (b) b.click(); }); await page.waitForTimeout(400);
    ok(await page.evaluate(() => !document.getElementById("view-aisales").classList.contains("hidden")), "« Ouvrir » sur un point d'agents mène à l'écran Directeur IA");

    console.log("▶ Pannes et absence de session");
    await page.evaluate(() => { __srv.panne = { "ai_governance": true, "ai_actions": true }; }); await ouvrir(); t = await texte();
    ok(!/Coût IA du jour/.test(t) && /2 actifs/.test(t), "gouvernance et coûts en panne : seul le bloc coût disparaît, le reste s'affiche");
    await page.evaluate(() => { __srv.panne = {}; __srv.session = false; }); await ouvrir(); t = await texte();
    ok(/Connectez l'agent IA/.test(t) && !/actifs · /.test(t) && !/Ce que les agents ont fait/.test(t), "sans session d'agents : invitation à se connecter, aucune donnée d'agent inventée");
    ok(/À faire par vous/.test(t) && await page.evaluate(() => document.querySelector("#view-bureau .badge") !== null), "les actions du CRM restent affichées sans session");
    await page.evaluate(() => { __srv.session = true; __srv.validations = []; __srv.incidents = []; __srv.ouvertes = []; __srv.terminees = []; __srv.agents = [{ id: "a1", nom: "A", etat: "actif" }]; __srv.mails = []; });
    await ouvrir(); t = await texte();
    ok(/Aucun incident ces dernières 24 h/.test(t) && /Aucune mission terminée aujourd'hui/.test(t), "agents sans incident ni mission : messages clairs (pas de page vide)");
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    await page.evaluate(() => { __srv.agents = [{ id: "a1", nom: "Prospection", etat: "actif" }, { id: "a2", nom: "Q", etat: "actif" }, { id: "a3", nom: "C1", etat: "suspendu" }, { id: "a4", nom: "C2", etat: "suspendu" }, { id: "a5", nom: "R", etat: "suspendu" }]; __srv.incidents = [{ gravite: "critique", type: "suspension_auto", message: "3 échecs", created_at: __ago(2) }, { gravite: "attention", type: "erreur_execution", message: "400 {”type”:”error”,”error”:{”message”:”Your credit balance is too low to access the Anthropic API.”}}", created_at: __ago(1) }]; __srv.validations = [{ id: "11111111-1111-1111-1111-111111111111", type: "remise", motif: "Remise de 10 %", created_at: __ago(1), ai_prospects: { entreprise: "BACID" } }]; __srv.terminees = [{ id: "t1", agent_id: "a1", titre: "Qualifier 10 prospects Industrie", rapport: "10 prospects qualifiés.", finished_at: __ago(2) }]; __srv.mails = [{ id: "m1", client_rid: "c_b1", to_email: "x@x.ci", subject: "Premier contact", status: "repondu", sent_at: __ago(30), replied_at: __ago(1), relance_apres_jours: 4 }]; });
    await ouvrir(); await page.evaluate(() => document.querySelector(".content") && document.querySelector(".content").scrollTo({ top: 0 }));
    await page.screenshot({ path: "/tmp/claude-0/-home-user-CRM-SANIX/fda489a8-65a8-578c-bff6-b00bf4b09a64/scratchpad/bureau.png" });
    console.log("\nBureau du jour (écran) : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
