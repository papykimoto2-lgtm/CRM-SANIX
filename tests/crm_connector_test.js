// SANIX CRM ↔ SANIX AI — test de bout en bout : le VRAI CRM (index.html + shared/crm-connector.js) dans Chromium, relié par HTTP à une passerelle PostgREST
// de test (supabase/functions/tests/rpc_bridge.ts) devant un VRAI PostgreSQL (migrations réelles, déclencheurs, RLS, traitement des événements).
// Prérequis : PostgreSQL de test (TEST_PG_PORT, base modèle vc_tpl : supabase/functions/tests/setup_db.sh) et Deno (variable DENO).
//   DENO=deno TEST_PG_PORT=5499 node tests/crm_connector_test.js
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const wait = async (fn, ms = 20000, what = "condition") => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`ÉCHEC : délai dépassé (${what})`); await new Promise((r) => setTimeout(r, 200)); } };
const ANON = "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ role: "anon" })).toString("base64") + ".sig";   // clé publique factice
const PRESIDENT = "11111111-1111-1111-1111-111111111111";

function startBridge() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.DENO || "deno", ["run", "--no-check", "--allow-net", "--allow-env", "--allow-read", path.join(__dirname, "../supabase/functions/tests/rpc_bridge.ts")], { env: { ...process.env, TEST_PG_PORT: process.env.TEST_PG_PORT || "5499" } });
    let out = ""; const t = setTimeout(() => reject(new Error("passerelle : démarrage trop long : " + out)), 60000);
    p.stdout.on("data", (d) => { out += d; const m = /READY (\d+) (\S+)/.exec(out); if (m) { clearTimeout(t); resolve({ proc: p, port: Number(m[1]), db: m[2] }); } });
    p.stderr.on("data", (d) => { out += d; }); p.on("exit", (c) => { if (c) reject(new Error("passerelle arrêtée : " + out)); });
  });
}

(async () => {
  const server = await start(4290), bridge = await startBridge(), B = `http://127.0.0.1:${bridge.port}`, browser = await chromium.launch();
  const post = async (p, body) => { const r = await fetch(B + p, { method: "POST", body: JSON.stringify(body) }); const j = await r.json(); if (j.error) throw new Error(j.error); return j; };
  const sql = async (text, params = []) => (await post("/__sql", { text, params })).rows;
  const sqlAs = async (text, uid = PRESIDENT) => (await post("/__sql_as", { text, uid })).rows;
  const rpcAs = async (fn, body, token = "tok-direction") => { const r = await fetch(`${B}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: ANON, authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(j.message); return j; };
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());                                      // pas de réseau externe
    const now = new Date().toISOString();
    const seed = {
      sanix_crm_clients: [
        { id: 1, nom: "Alpha Immobilier", phone: "+225 07 01 02 03 04", email: "", secteur: "Immobilier", logiciel: "ImmoSuite ERP", statut: "client", commercial: "Aïcha", valeur: 1000000, adresse: "Cocody", notes: "", interactions: [], created_at: now, updated_at: now },
        { id: 2, nom: "Beta Santé", phone: "05 05 05 05 05", email: "", secteur: "Santé", logiciel: "", statut: "prospect", commercial: "Aïcha", valeur: 500000, adresse: "Plateau", notes: "Clinique", interactions: [], created_at: now, updated_at: now },
        { id: 3, nom: "Gamma BTP", phone: "01 01 01 01 01", email: "", secteur: "BTP", logiciel: "", statut: "prospect", commercial: "Aïcha", valeur: 300000, adresse: "Yopougon", notes: "", interactions: [], created_at: now, updated_at: now }],
      sanix_crm_commandes: [{ id: "cmd_1731000000000", ref: "CMD-2026-001", client: "Alpha Immobilier", date: "2026-11-01", logiciel: "ImmoSuite ERP", htBrut: 1000000, remise: 0, htNet: 1000000, tva: 180000, ttc: 1180000, acompte: 300000, solde: 880000, commercial: "Aïcha", statut: "en_cours", presId: "", notes: "" }],
      sanix_crm_sanix_crm_rdv: [{ id: 1, clientId: 1, client: "Alpha Immobilier", type: "Suivi", date: "2026-12-01", heure: "10:00", duree: 30, visio: "", lieu: "", notes: "", statut: "prevu", createdAt: now }]
    };
    await ctx.addInitScript(({ url, key, seed }) => {
      class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } }, scale: {} }; window.Chart = Chart;
      if (!sessionStorage.getItem("__seeded")) {
        sessionStorage.setItem("__seeded", "1");
        localStorage.setItem("sanix_crm_supabase_config", JSON.stringify({ url, key }));
        for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
      }
      sessionStorage.setItem("sanix_ais_session", JSON.stringify({ t: "tok-commercial", exp: Date.now() + 3600e3, email: "aicha@sanix.ci" }));   // session opérateur (jeton de test)
    }, { url: B, key: ANON, seed });
    const open = async () => {
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
      page.on("dialog", (d) => { errors.push("DIALOG: " + d.message()); d.dismiss(); });
      page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_|net::|Failed to fetch/i.test(m.text())) errors.push("console: " + m.text()); });
      await page.goto("http://localhost:4290/index.html"); await page.waitForTimeout(1000);
      await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); });
      await page.waitForFunction(() => window.SanixCrmSync && window.SanixCrmSync._ready(), null, { timeout: 15000 });
      return page;
    };
    const sync = (page) => page.evaluate(() => window.SanixCrmSync.syncNow());
    const st = (page) => page.evaluate(() => { const s = window.SanixCrmSync.status(); return { mode: s.mode, pending: s.pending, init: s.init, lastErr: s.lastErr }; });
    const quiet = (page, ms = 25000) => wait(async () => { const s = await st(page); return s.pending === 0 && s.mode !== "sync" && s.init; }, ms, "file d'envoi vide");

    console.log("▶ Mode dormant — migration non appliquée (fonctions SQL absentes) : le CRM reste utilisable, rien n'est perdu");
    await post("/__fault", { mode: "absent", count: 1e9 });                                                           // base sans la migration : 404 PGRST202
    let page = await open();
    const legacyReq = []; page.on("request", (r) => { if (/\/rest\/v1\/crm_/.test(r.url())) legacyReq.push(r.method() + " " + new URL(r.url()).pathname); });
    await sync(page);
    await wait(async () => (await st(page)).mode === "absent", 15000, "mode « connecteur absent »");
    ok(await page.evaluate(() => window.SanixCrmSync.status().backend === "absent"), "fonctions SQL introuvables (404) : connecteur en veille, sans erreur ni boîte de dialogue");
    ok((await page.locator("#sync-label").innerText()).includes("connecteur serveur absent"), "pilulier de l'en-tête : « Local · connecteur serveur absent »");
    await page.evaluate(() => { CLIENTS.push({ id: Math.max(...CLIENTS.map((x) => x.id)) + 1, nom: "Dormant SA", phone: "07 90 90 90 90", email: "", secteur: "Commerce", statut: "prospect", commercial: "Aïcha", valeur: 100000, adresse: "Abidjan", notes: "créé avant l'installation", interactions: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); saveStore("clients"); });
    ok(await page.evaluate(() => CLIENTS.some((x) => x.nom === "Dormant SA") && JSON.parse(localStorage.getItem("sanix_crm_clients")).some((x) => x.nom === "Dormant SA")), "le CRM continue d'enregistrer localement (fiche créée pendant la veille)");
    const n0 = (await post("/__calls", {})).calls; await page.waitForTimeout(3500);
    ok((await post("/__calls", {})).calls === n0, "aucune rafale de tentatives : le serveur n'est pas sollicité tant que le connecteur est absent");
    await page.evaluate(() => window.SanixCrmSync.openPanel("etat"));
    await wait(async () => (await page.locator("#crmsync-body").innerText()).includes("Connecteur serveur non installé"), 10000, "panneau d'état");
    ok(true, "panneau « Synchronisation » : explication « connecteur serveur non installé : mode local »");
    await page.evaluate(() => document.getElementById("modal-crmsync").classList.add("hidden"));
    const names = await page.evaluate(() => JSON.stringify(CLIENTS.map((x) => x.nom))), reqBefore = legacyReq.length;
    await page.evaluate(() => syncPull());                                                                              // ancienne réception : désactivée (elle remplaçait les données locales)
    await page.waitForTimeout(400);
    ok(legacyReq.length === reqBefore && await page.evaluate((n) => JSON.stringify(CLIENTS.map((x) => x.nom)) === n, names), "ancienne réception « remplace tout » : désactivée, aucune donnée touchée, aucune requête");
    await page.evaluate(() => syncPush()); await wait(async () => legacyReq.some((q) => q.startsWith("POST /rest/v1/crm_clients")), 10000, "ancien envoi");
    ok(true, "ancien envoi (tables crm_*) : toujours disponible tant que le connecteur n'est pas installé");
    await post("/__fault", { mode: "none", count: 0 });                                                                // la migration est appliquée
    await sync(page);                                                                                                  // « Synchroniser maintenant » : nouvelle détection immédiate

    console.log("▶ Phase B — import initial : sauvegarde, idempotence, aucun événement pour l'historique");
    await quiet(page);
    ok(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("sanix_crm_backup_"))), "sauvegarde locale créée avant le premier envoi");
    const counts = async () => Object.fromEntries((await sql("select entity, count(*)::int n from crm_records where deleted_at is null group by entity")).map((r) => [r.entity, r.n]));
    let c = await counts();
    const loc = await page.evaluate(() => { rdvLoad(); return { clients: CLIENTS.length, deals: DEALS.length, commandes: COMMANDES.length, rdv: RDVS.length, documents: DOCUMENTS.length }; });
    ok(loc.clients >= 3 && c.clients === loc.clients && c.deals === (loc.deals || undefined) || (loc.deals === 0 && !c.deals), `clients : ${c.clients} dans la base centrale = ${loc.clients} dans le navigateur`);
    ok(c.commandes === loc.commandes && c.rdv === loc.rdv && (c.deals || 0) === loc.deals, `commandes ${c.commandes}/${loc.commandes}, rendez-vous ${c.rdv}/${loc.rdv}, affaires ${c.deals || 0}/${loc.deals} : tout est dans la base centrale`);
    ok((await sql("select count(*)::int n from crm_ai_events"))[0].n === 0, "import initial : aucun événement (pas de mission pour l'historique)");
    ok(await page.evaluate(() => CLIENTS.every((x) => x._rid) && CLIENTS.some((x) => x.nom === "Gamma BTP")), "le CRM garde ses données locales (identifiants stables ajoutés aux fiches)");
    await sync(page); await sync(page);
    const c2 = await counts(); ok(JSON.stringify(c2) === JSON.stringify(c), "resynchroniser n'ajoute aucun doublon");
    const local = await page.evaluate(() => JSON.stringify(CLIENTS.map((x) => x.nom)));
    await page.evaluate(() => syncPull());                                                                              // ancienne fonction de réception : ne remplace plus rien
    ok(await page.evaluate((l) => JSON.stringify(CLIENTS.map((x) => x.nom)) === l, local), "l'ancienne réception « remplace tout » est neutralisée");

    console.log("▶ Scénario 1 — prospect créé dans le CRM → SANIX AI");
    await page.evaluate(() => { CLIENTS.push({ id: Math.max(...CLIENTS.map((x) => x.id)) + 1, nom: "Zénith Cliniques", phone: "+225 05 55 66 77 88", email: "", secteur: "Santé", statut: "prospect", commercial: "Aïcha", valeur: 900000, adresse: "Cocody", notes: "Clinique privée, 3 sites", interactions: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); saveStore("clients"); });
    const zp = await wait(async () => (await sql("select p.id, p.stage, p.source, p.crm_rid from ai_prospects p where p.entreprise = 'Zénith Cliniques'"))[0], 20000, "prospect dans SANIX AI");
    ok(zp.source === "crm" && zp.stage === "enregistre" && zp.crm_rid, "le prospect apparaît dans SANIX AI (source crm, lié au dossier)");
    const zt = await wait(async () => (await sql("select a.code, t.statut, t.titre from ai_agent_tasks t join ai_agents a on a.id = t.agent_id where t.prospect_id = $1", [zp.id]))[0], 10000, "mission de qualification");
    ok(zt.code === "ia_qualif_1" && zt.titre.includes("Zénith"), "une mission de qualification est confiée à l'agent « IA Lead Qualifier »");
    await sync(page);
    ok(await page.evaluate(() => { const z = CLIENTS.find((x) => x.nom === "Zénith Cliniques"); return z && z.ia && z.ia.agent_code === "ia_qualif_1" && z.interactions.some((i) => i.type === "Pris en charge par l'IA"); }), "le CRM reçoit l'agent responsable et l'historique (écrits par le serveur)");
    await page.evaluate(() => showClientDetail(CLIENTS.find((x) => x.nom === "Zénith Cliniques").id));
    await wait(async () => (await page.locator("#crm-ia-panel").innerText()).includes("IA Lead Qualifier"), 10000, "fiche client : agent responsable");
    ok(true, "fiche client du CRM : agent responsable et missions affichés");
    await page.evaluate(() => document.getElementById("modal-client-detail").classList.add("hidden"));

    console.log("▶ Scénario 2 — qualification par un agent → le CRM reçoit le nouveau statut");
    await sql("update ai_prospects set crit_produit=22, crit_besoin=15, crit_finance=10, crit_decideur=12, crit_court_terme=10, crit_disponibilite=6, score_justification='Clinique identifiée, besoin de dossier patient, décideur joignable', produits_recommandes='{medicor}', stage='qualifie' where id = $1", [zp.id]);
    await wait(async () => { await sync(page); return page.evaluate(() => { const z = CLIENTS.find((x) => x.nom === "Zénith Cliniques"); return z && z.ia && z.ia.stage === "qualifie"; }); }, 20000, "statut IA dans le CRM");
    ok(await page.evaluate(() => { const z = CLIENTS.find((x) => x.nom === "Zénith Cliniques"); return z.ia.score === 75 && z.interactions.some((i) => i.type === "Prospect qualifié par l'IA" && i.etape === 1 && aiGetEtape(z) >= 1); }), "qualification reçue : score 75/100, historique et étape du CRM (« Contact établi »)");

    console.log("▶ Scénario 3 — mission créée dans le bureau → visible dans le CRM");
    const agent = (await sql("select id from ai_agents where code = 'ia_mail_1'"))[0].id;
    const tid = await rpcAs("crm_assign_mission", { p_agent: agent, p_prospect: zp.id, p_titre: "Relancer la clinique Zénith", p_description: "Appeler le directeur et envoyer la brochure MedicorERP", p_priorite: 2, p_echeance_h: 48 });
    await wait(async () => { await sync(page); return page.evaluate(() => CLIENTS.find((x) => x.nom === "Zénith Cliniques").interactions.some((i) => i.type === "Mission assignée à l'IA" && i.note.includes("Relancer la clinique"))); }, 20000, "mission dans l'historique");
    await page.evaluate(() => showClientDetail(CLIENTS.find((x) => x.nom === "Zénith Cliniques").id));
    await wait(async () => (await page.locator("#crm-ia-panel").innerText()).includes("Relancer la clinique Zénith"), 10000, "mission dans la fiche");
    ok(true, "la mission créée côté bureau apparaît dans la fiche client du CRM");
    await page.evaluate(() => document.getElementById("modal-client-detail").classList.add("hidden"));
    await page.evaluate(() => window.SanixCrmSync.openPanel("missions"));
    await wait(async () => (await page.locator("#crmsync-body").innerText()).includes("Relancer la clinique Zénith"), 10000, "panneau missions");
    ok(true, "panneau « Missions des agents » du CRM");
    await page.evaluate(() => document.getElementById("modal-crmsync").classList.add("hidden"));

    console.log("▶ Scénario 4 — rendez-vous organisé par l'IA → calendrier du CRM");
    await sql("insert into ai_appointments(prospect_id, debut, fin, mode, lien_visio, statut, fiche_prep) values ($1, '2026-12-10 09:00+00', '2026-12-10 09:30+00', 'visio', 'https://meet.example/zenith', 'confirme', 'Présenter MedicorERP')", [zp.id]);
    await wait(async () => { await sync(page); return page.evaluate(() => RDVS.some((r) => r.client === "Zénith Cliniques")); }, 20000, "rendez-vous IA dans le calendrier");
    const rdv = await page.evaluate(() => { rdvLoad(); const r = RDVS.find((x) => x.client === "Zénith Cliniques"); return { date: r.date, heure: r.heure, duree: r.duree, statut: r.statut, clientOk: r.clientId === CLIENTS.find((x) => x.nom === "Zénith Cliniques").id, persisted: JSON.parse(localStorage.getItem("sanix_crm_sanix_crm_rdv")).some((x) => x.client === "Zénith Cliniques") }; });
    ok(rdv.date === "2026-12-10" && rdv.heure === "09:00" && rdv.duree === 30 && rdv.statut === "prevu" && rdv.clientOk && rdv.persisted, "le rendez-vous apparaît dans l'agenda du CRM (date, heure, durée, rattaché au bon client, enregistré localement)");
    await page.evaluate(() => navigate("agenda", null)); await page.waitForTimeout(600);
    ok((await page.locator("#view-agenda").innerText()).includes("Zénith Cliniques"), "visible dans la vue Agenda");
    await sql("update ai_appointments set statut = 'realise', compte_rendu = 'Directeur très intéressé : 3 sites à équiper.' where prospect_id = $1", [zp.id]);
    await wait(async () => { await sync(page); return page.evaluate(() => { rdvLoad(); const r = RDVS.find((x) => x.client === "Zénith Cliniques"); return r && r.compte_rendu && r.statut === "fait"; }); }, 20000, "compte rendu");
    ok(true, "compte rendu du rendez-vous reçu (statut « fait »)");

    console.log("▶ Scénario 5 — offre générée par l'IA → offres du CRM ; acceptée → commande");
    await sql("insert into ai_products(id, nom, marche_cible) values ('medicor', 'MedicorERP', 'Cliniques') on conflict do nothing");
    const off = (await sql("insert into ai_offers(prospect_id, product_id, lignes, total_brut_ht, remise_pct, total_ht, total_ttc, statut) values ($1, 'medicor', $2::jsonb, 2000000, 5, 1900000, 2242000, 'envoyee') returning id, reference", [zp.id, JSON.stringify([{ poste: "licence", libelle: "MedicorERP 3 sites", qte: 3, pu_ht: 600000, montant_ht: 1800000 }])]))[0];
    await wait(async () => { await sync(page); return page.evaluate((ref) => DOCUMENTS.some((d) => d.ref === ref && d.type === "proforma" && d.source === "IA" && d.html.includes("MedicorERP")), off.reference); }, 20000, "offre dans les documents");
    ok(true, `l'offre ${off.reference} apparaît dans les documents du CRM (proforma, source IA)`);
    await sql("update ai_offers set statut = 'acceptee' where id = $1", [off.id]);
    await wait(async () => { await sync(page); return page.evaluate(() => COMMANDES.some((x) => x.client === "Zénith Cliniques" && x.statut === "confirmee" && x.ttc === 2242000)); }, 20000, "commande");
    ok(true, "offre acceptée : commande confirmée créée dans le CRM");

    console.log("▶ Scénario 6 — conversion prospect → client : une seule fiche");
    await sqlAs("update ai_prospects set stage = 'marche_gagne' where id = '" + zp.id + "'");
    await wait(async () => { await sync(page); return page.evaluate(() => CLIENTS.find((x) => x.nom === "Zénith Cliniques").statut === "client"); }, 20000, "conversion");
    ok(await page.evaluate(() => CLIENTS.filter((x) => x.nom === "Zénith Cliniques").length === 1), "converti en client : une seule fiche « Zénith Cliniques » dans le CRM");
    ok((await sql("select count(*)::int n from crm_records where entity = 'clients' and data->>'nom' = 'Zénith Cliniques' and deleted_at is null"))[0].n === 1, "une seule fiche dans la base centrale");

    console.log("▶ Scénario 7 — fermeture du navigateur : les traitements du serveur continuent");
    await page.close();
    await sql("insert into ai_appointments(prospect_id, debut, fin, mode, statut) values ($1, '2026-12-20 14:00+00', '2026-12-20 14:30+00', 'telephone', 'confirme')", [zp.id]);
    await wait(async () => (await sql("select count(*)::int n from crm_records where entity = 'rdv' and rid like 'ia_%'"))[0].n === 2, 15000, "traitement serveur sans navigateur");
    page = await open(); await quiet(page);
    await wait(async () => { await sync(page); return page.evaluate(() => { rdvLoad(); return RDVS.filter((r) => r.client === "Zénith Cliniques").length === 2; }); }, 20000, "rattrapage à la réouverture");
    ok(true, "le rendez-vous traité pendant que le CRM était fermé apparaît à la réouverture");

    console.log("▶ Scénario 8 — perte de connexion puis reconnexion : aucune donnée perdue");
    await ctx.setOffline(true); await page.waitForTimeout(300);
    await page.evaluate(() => {
      const mk = (nom, phone) => ({ id: Math.max(...CLIENTS.map((x) => x.id)) + 1, nom, phone, email: "", secteur: "Commerce", statut: "prospect", commercial: "Aïcha", valeur: 100000, adresse: "Abidjan", notes: "", interactions: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      CLIENTS.push(mk("Hors Ligne Un", "07 12 12 12 12")); CLIENTS.push(mk("Hors Ligne Deux", "07 34 34 34 34")); saveStore("clients");
      const g = CLIENTS.find((x) => x.nom === "Gamma BTP"); g.notes = "modifié hors ligne"; saveStore("clients");
    });
    await wait(async () => (await st(page)).pending >= 3, 5000, "modifications en file");
    ok(true, "hors ligne : 3 modifications gardées en file (" + (await st(page)).mode + ")");
    ok((await sql("select count(*)::int n from crm_records where data->>'nom' like 'Hors Ligne%'"))[0].n === 0, "rien n'est parti pendant la coupure");
    await ctx.setOffline(false);
    await quiet(page, 30000);
    ok((await sql("select count(*)::int n from crm_records where entity = 'clients' and data->>'nom' like 'Hors Ligne%'"))[0].n === 2, "reconnexion : les deux nouvelles fiches sont arrivées");
    ok((await sql("select data->>'notes' n from crm_records where entity = 'clients' and data->>'nom' = 'Gamma BTP'"))[0].n === "modifié hors ligne", "et la modification d'une fiche existante");

    console.log("▶ Scénario 9 — échec de synchronisation : reprise automatique sans doublon");
    await post("/__fault", { mode: "fail", count: 2, status: 503 });
    await page.evaluate(() => { CLIENTS.push({ id: Math.max(...CLIENTS.map((x) => x.id)) + 1, nom: "Panne Réseau SA", phone: "07 56 56 56 56", email: "", secteur: "Commerce", statut: "prospect", commercial: "Aïcha", valeur: 100000, adresse: "Abidjan", notes: "", interactions: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); saveStore("clients"); });
    await wait(async () => (await st(page)).mode === "error", 15000, "panne détectée");
    ok(true, "panne du serveur : l'erreur est affichée, la fiche reste en file");
    await quiet(page, 40000);
    ok((await sql("select count(*)::int n from crm_records where entity = 'clients' and data->>'nom' = 'Panne Réseau SA'"))[0].n === 1, "reprise automatique après deux échecs : une seule fiche");
    await post("/__fault", { mode: "drop", count: 1 });                                                                  // le serveur applique l'envoi mais la réponse est perdue
    await page.evaluate(() => { CLIENTS.push({ id: Math.max(...CLIENTS.map((x) => x.id)) + 1, nom: "Réponse Perdue SA", phone: "07 78 78 78 78", email: "", secteur: "Commerce", statut: "prospect", commercial: "Aïcha", valeur: 100000, adresse: "Abidjan", notes: "", interactions: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); saveStore("clients"); });
    await wait(async () => (await sql("select count(*)::int n from crm_records where entity = 'clients' and data->>'nom' = 'Réponse Perdue SA'"))[0].n >= 1, 40000, "envoi exécuté par le serveur");
    await wait(async () => (await page.evaluate(() => window.SanixCrmSync.status().lastErr)) !== null || true, 100);
    await quiet(page, 40000);
    ok((await sql("select count(*)::int n from crm_records where entity = 'clients' and data->>'nom' = 'Réponse Perdue SA'"))[0].n === 1, "réponse perdue puis renvoi : une seule fiche (rejeu idempotent)");
    ok((await sql("select count(*)::int n from crm_sync_ops where result->>'rid' = (select rid from crm_records where data->>'nom' = 'Réponse Perdue SA')"))[0].n === 1, "l'opération est mémorisée une seule fois côté serveur");
    ok((await sql("select count(*)::int n from crm_ai_events where type = 'crm.prospect.created' and payload->>'nom' = 'Réponse Perdue SA'"))[0].n === 1, "un seul événement pour cette fiche");
    await wait(async () => (await sql("select count(*)::int n from ai_prospects where entreprise = 'Réponse Perdue SA'"))[0].n === 1, 15000, "prospect IA");
    ok((await sql("select count(*)::int n from ai_agent_tasks t join ai_prospects p on p.id = t.prospect_id where p.entreprise = 'Réponse Perdue SA'"))[0].n === 1, "une seule mission, aucun doublon côté IA");

    console.log("▶ Interface de synchronisation");
    await page.evaluate(() => window.SanixCrmSync.openPanel("etat"));
    await wait(async () => (await page.locator("#crmsync-body").innerText()).includes("Synchronisé"), 10000, "panneau d'état");
    ok(true, "panneau « Synchronisation CRM ↔ SANIX AI » : état « Synchronisé », aucun envoi en attente");
    ok((await page.locator("#sync-label").innerText()).includes("Synchronisé"), "pilulier de l'en-tête du CRM : « Synchronisé »");
    await page.evaluate(() => document.getElementById("modal-crmsync").classList.add("hidden"));
    const failing = (await sql("select count(*)::int n from crm_ai_events where status in ('failed','dead')"))[0].n;
    ok(failing === 0, "aucun événement en échec côté serveur");
    ok(errors.length === 0, `aucune erreur JavaScript ni boîte de dialogue (${errors.join(" | ")})`);
    console.log("\nCRM ↔ IA : TOUT EST OK");
  } catch (e) { console.error("\n" + e.message); process.exitCode = 1; }
  await browser.close(); server.close();
  try { await fetch(B + "/__stop", { method: "POST", body: "{}" }); } catch (e) { /* arrêtée */ }
  setTimeout(() => process.exit(process.exitCode || 0), 500);
})();
