// SANIX CRM Pro : écran Gmail (connexion, relecture avant envoi, suivi dans la fiche, À faire, réglages) avec un faux serveur. node gmail_ecran_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4447), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const google = []; await ctx.route(/^https?:\/\/(?!localhost)/, (r) => { if (/accounts\.google\.com/.test(r.request().url())) google.push(r.request().url()); r.abort(); });
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4447/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);

    // faux serveur : remplace aisApi (le CRM l'utilise pour toutes ses requêtes authentifiées)
    await page.evaluate(() => {
      const j = (d) => JSON.parse(JSON.stringify(d)); const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
      window.__srv = { etat: { connecte: false }, mails: [], appels: [], hors: false, connectErr: null };
      window.aisApi = async (path, opt = {}) => {
        const S = window.__srv, body = opt.body ? JSON.parse(opt.body) : {}; S.appels.push({ path, body });
        if (S.hors) throw new Error("Connectez l'agent IA (session opérateur)");
        if (path.includes("crm_mail_state")) return j(S.etat);
        if (path.includes("/rest/v1/crm_mails")) return j(S.mails);
        if (path.includes("crm-gmail")) {
          if (body.action === "connect_url") { if (S.connectErr) throw new Error(S.connectErr); return { url: "https://accounts.google.com/o/oauth2/v2/auth?state=x" }; }
          if (body.action === "send") { if (S.sendErr) throw new Error(S.sendErr); S.mails.unshift({ id: "m" + (S.mails.length + 1), client_rid: body.client_rid, to_email: body.to, subject: body.subject, status: "envoye", sent_at: new Date().toISOString(), relance_apres_jours: body.relance_jours, sent_by: "Awa Koné" }); return { ok: true, id: "m1" }; }
          if (body.action === "sync") return { ok: true };
          if (body.action === "disconnect") { S.etat = { connecte: false }; return { ok: true }; }
        }
        return null;
      };
      window.__day = day;
      currentUser.nom = "Awa Koné"; currentUser.poste = "Directrice commerciale"; currentUser.phone = "+225 05 11 22 33 44"; currentUser.email = "awa@societe-exemple.ci";
      CLIENTS.push({ id: 996001, _rid: "c_gm1", nom: "PROMO GMAIL", statut: "prospect", secteur: "Immobilier", logiciel: "ImmoSuite ERP", phone: "0707904919", email: "contact@promo-gmail.ci", notes: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), interactions: [{ date: new Date().toISOString(), type: "Contact établi", note: "Appel", etape: 1 }] });
    });
    const MODAL = () => page.evaluate(() => document.getElementById("courrier-body").innerText.replace(/\s+/g, " "));
    const ouvrir = async () => { await page.evaluate(() => { _gmail.charge = 0; openCourrierModal(996001); }); await page.waitForTimeout(500); };

    console.log("▶ Gmail non connecté : la messagerie reste disponible");
    await ouvrir(); let t = await MODAL();
    ok(/Connecter Gmail/.test(t) && /Ouvrir dans ma messagerie/.test(t) && !/Envoyer depuis Gmail/.test(t), "invite à connecter Gmail, bouton « Ouvrir dans ma messagerie » conservé, pas de bouton d'envoi direct");
    await page.evaluate(() => { __srv.hors = true; _gmail.etat = null; _gmail.charge = 0; }); await ouvrir(); t = await MODAL();
    ok(/connectez l’agent IA/.test(t) && !/Envoyer depuis Gmail/.test(t), "sans session opérateur : explication claire, pas de faux bouton");
    await page.evaluate(() => { __srv.hors = false; });

    console.log("▶ Gmail connecté : relecture avant envoi");
    await page.evaluate(() => { __srv.etat = { connecte: true, email: "sanix@gmail.com" }; });
    await ouvrir(); t = await MODAL();
    ok(/Envoi direct depuis sanix@gmail\.com/.test(t) && /suivi des réponses est automatique/.test(t), "bandeau vert : envoi direct depuis l'adresse connectée");
    ok((await page.evaluate(() => [...document.querySelectorAll("#courrier-body button")].filter((b) => /Envoyer depuis Gmail/.test(b.textContent)).length)) === 7, "chaque exemple a « Envoyer depuis Gmail » ; « Ma messagerie » reste en second");
    await page.evaluate(() => courrierEcrire(window._courrierEx.findIndex((e) => e.id === "proposition")));
    ok(await page.evaluate(() => document.getElementById("cg-envoyer").disabled && /crochets/.test(document.getElementById("cg-msg").textContent)), "proposition avec [crochets] : envoi bloqué tant qu'ils ne sont pas complétés");
    await page.evaluate(() => courrierAnnuler());
    const iAppel = await page.evaluate(() => window._courrierEx.findIndex((e) => e.id === "appel"));
    await page.evaluate((i) => courrierEcrire(i), iAppel);
    ok(await page.evaluate(() => !document.getElementById("cg-envoyer").disabled), "« Suite à notre appel » : aucun crochet, prêt à envoyer");
    await page.fill("#cg-a", "adresse-bidon"); ok(await page.evaluate(() => document.getElementById("cg-envoyer").disabled && /Adresse/.test(document.getElementById("cg-msg").textContent)), "adresse invalide : envoi bloqué");
    await page.fill("#cg-a", "contact@promo-gmail.cl"); ok(await page.evaluate(() => document.getElementById("cg-envoyer").disabled), "adresse en .cl (incertaine) : envoi bloqué, à confirmer");
    await page.fill("#cg-a", "contact@promo-gmail.ci"); await page.selectOption("#cg-relance", "3");
    await page.fill("#cg-objet", "Suite à notre appel — ImmoSuite");
    await page.evaluate(() => { __srv.appels.length = 0; });
    await page.click("#cg-envoyer"); await page.waitForTimeout(600);
    const env = await page.evaluate(() => __srv.appels.find((a) => a.body.action === "send"));
    ok(env && env.body.to === "contact@promo-gmail.ci" && env.body.client_rid === "c_gm1" && env.body.relance_jours === 3 && env.body.subject === "Suite à notre appel — ImmoSuite", "envoi : destinataire, fiche, délai de relance et objet modifié transmis au serveur");
    ok(env.body.body.trim().endsWith(await page.evaluate(() => courrierSignature())) && env.body.from_name === "Awa Koné — SANIX Africa", "le message part signé avec le compte connecté, nom d'expéditeur « Awa Koné — SANIX Africa »");
    ok(await page.evaluate(() => document.getElementById("modal-courrier").classList.contains("hidden")), "après l'envoi, la fenêtre se ferme");
    ok(await page.evaluate(() => _gmail.mails.length === 1 && _gmail.mails[0].status === "envoye"), "le journal est rechargé : l'e-mail apparaît « envoyé »");
    await page.evaluate(() => { __srv.sendErr = "Gmail a refusé l'envoi : Daily limit"; }); await ouvrir(); await page.evaluate((i) => courrierEcrire(i), iAppel);
    await page.click("#cg-envoyer"); await page.waitForTimeout(500);
    ok(await page.evaluate(() => !document.getElementById("cg-envoyer").disabled && /refusé/.test(document.getElementById("cg-msg").textContent)), "échec du serveur : message affiché, le brouillon est conservé et on peut réessayer");
    await page.evaluate(() => { __srv.sendErr = null; courrierAnnuler(); document.getElementById("modal-courrier").classList.add("hidden"); });

    console.log("▶ Suivi dans la fiche et dans « À faire aujourd'hui »");
    await page.evaluate(() => { __srv.mails = [
      { id: "a", client_rid: "c_gm1", to_email: "contact@promo-gmail.ci", subject: "Suite à notre appel", status: "envoye", sent_at: __day(6), relance_apres_jours: 4, sent_by: "Awa Koné" },
      { id: "b", client_rid: "c_gm1", to_email: "contact@promo-gmail.ci", subject: "Première prise de contact", status: "repondu", sent_at: __day(12), replied_at: __day(10), relance_apres_jours: 4, sent_by: "Awa Koné" },
      { id: "c", client_rid: "c_gm1", to_email: "x@promo-gmail.ci", subject: "Autre adresse", status: "echec", error: "Non distribué (retour Gmail) : adresse inexistante", sent_at: __day(20), relance_apres_jours: 4 }]; _gmail.charge = 0; });
    await page.evaluate(() => { showClientDetail(996001); }); await page.waitForTimeout(700);
    const fiche = (await page.evaluate(() => (document.getElementById("gmail-fiche-host") || {}).innerText || "")).replace(/\s+/g, " ");
    ok(/E-mails envoyés \(3\)/i.test(fiche) && /Sans réponse depuis 6 j : relance conseillée/.test(fiche), "fiche : 3 e-mails, le plus récent « sans réponse depuis 6 j : relance conseillée »");
    ok(/Répondu le/.test(fiche) && /adresse inexistante/.test(fiche), "fiche : réponse reçue datée et e-mail non distribué expliqué");
    ok(await page.evaluate(() => [...document.querySelectorAll("#gmail-fiche-host button")].some((b) => /Relancer par e-mail/.test(b.textContent))), "bouton « Relancer par e-mail » dans la fiche");
    await page.evaluate(() => document.getElementById("modal-client-detail").classList.add("hidden"));
    await page.evaluate(() => { _gmail.charge = 0; return gmailRefresh(true); });
    const af = await page.evaluate(() => { const R = afaireDonnees(); afaireRender(R); return { n: R.mails.length, client: R.mails[0] && R.mails[0].client, jours: R.mails[0] && R.mails[0].jours, html: document.getElementById("pipeline-afaire").innerText.replace(/\s+/g, " ") }; });
    ok(af.n === 1 && af.client === "PROMO GMAIL" && af.jours === 6, "À faire aujourd'hui : l'e-mail sans réponse depuis 6 jours est listé avec le nom du prospect");
    ok(/E-mails sans réponse/.test(af.html) && /Relancer/.test(af.html), "bloc « E-mails sans réponse » avec bouton « Relancer »");
    await page.evaluate(() => { document.getElementById("pipeline-afaire").querySelector('button[onclick^="openCourrierModal"]').click(); }); await page.waitForTimeout(400);
    ok(await page.evaluate(() => window._courrierEx[0].id === "relance"), "« Relancer » ouvre les exemples avec « Relance sans réponse » conseillé en premier");
    await page.evaluate(() => document.getElementById("modal-courrier").classList.add("hidden"));

    console.log("▶ Réglages et connexion");
    await page.evaluate(() => { __srv.etat = { connecte: false }; _gmail.charge = 0; });
    await page.evaluate(() => { navigate("relance", null); }).catch(() => {});
    const reg = await page.evaluate(async () => { const h = document.getElementById("gmail-reglage"); if (!h) return null; await gmailReglageRender(); return h.innerText.replace(/\s+/g, " "); });
    ok(reg && /Connecter Gmail/.test(reg) && /jamais lu/.test(reg), "réglages : bouton « Connecter Gmail » et rappel : le contenu de la boîte n'est jamais lu");
    await page.evaluate(() => { __srv.etat = { connecte: true, email: "sanix@gmail.com" }; });
    const reg2 = await page.evaluate(async () => { await gmailReglageRender(); return document.getElementById("gmail-reglage").innerText.replace(/\s+/g, " "); });
    ok(/Connecté : sanix@gmail\.com/.test(reg2) && /3 e-mails envoyés/.test(reg2) && /1 réponse/.test(reg2) && /Déconnecter/.test(reg2), "connecté : adresse, compteurs d'e-mails et de réponses, bouton « Déconnecter »");
    await page.evaluate(() => gmailDeconnecter()); await page.waitForTimeout(300);
    ok(await page.evaluate(() => !gmailConnecte()), "déconnexion : le CRM repasse en « non connecté »");
    await page.evaluate(() => { __srv.connectErr = "Configuration incomplète : secret « GOOGLE_CLIENT_ID » absent (voir supabase/GMAIL.md)"; });
    await page.evaluate(() => gmailConnecter()); await page.waitForTimeout(300);
    ok(await page.evaluate(() => /GOOGLE_CLIENT_ID/.test((document.getElementById("gmail-reglage-msg") || {}).textContent || "")), "serveur pas encore configuré : le message précis s'affiche dans les réglages");
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= 420), "pas de débordement sur téléphone");
    await page.evaluate(() => { __srv.connectErr = null; });
    const nav = page.waitForRequest((r) => /accounts\.google\.com/.test(r.url()), { timeout: 5000 }).catch(() => null);
    await page.evaluate(() => gmailConnecter()); const rq = await nav;
    ok(rq && /accounts\.google\.com\/o\/oauth2/.test(rq.url()), "« Connecter Gmail » envoie vers l'écran d'autorisation de Google");

    console.log("▶ Retour de Google");
    await page.goto("http://localhost:4447/index.html?gmail=erreur&m=" + encodeURIComponent("Connexion refusée sur Google")); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1800);
    ok(await page.evaluate(() => !/gmail=/.test(location.search)), "l'adresse est nettoyée après le retour de Google");
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    console.log("\nGmail (écran) : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
