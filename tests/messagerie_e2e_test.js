// SANIX CRM Pro : Messagerie commerciale dans le navigateur — ciblage, aperçu personnalisé, file WhatsApp, envoi Gmail (serveur simulé), modèles, historique durable. node messagerie_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4450), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = [], dialogs = []; page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await page.goto("http://localhost:4450/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    // WhatsApp : on intercepte l'ouverture ; Gmail : faux serveur (connecté, journal vide, envois enregistrés)
    await page.evaluate(() => {
      window.__ouvert = []; window.open = (u) => { window.__ouvert.push(u); return {}; };
      window.__srv = { mails: [], envois: [], panne: false };
      window.aisApi = async (path, opt = {}) => {
        const S = window.__srv, body = opt.body ? JSON.parse(opt.body) : {};
        if (path.includes("crm_mail_state")) return { connecte: true, email: "sanix@gmail.com" };
        if (path.includes("/rest/v1/crm_mails")) return S.mails;
        if (path.includes("crm-gmail")) { if (S.panne) throw new Error("Erreur Gmail simulée"); S.envois.push(body); S.mails.push({ id: "m" + S.mails.length, client_rid: body.client_rid, to_email: body.to, subject: body.subject, status: "envoye", sent_at: new Date().toISOString(), relance_apres_jours: 4 }); return { ok: true }; }
        return null;
      };
      _gmail.charge = 0; _gmail.etat = null;
    });
    const ouvrir = async () => { await page.evaluate(() => { _gmail.charge = 0; _gmail.etat = null; navigate("messagerie", null); }); await page.waitForTimeout(800); };
    const txt = (sel) => page.evaluate((s) => document.querySelector(s).innerText.replace(/\s+/g, " "), sel);
    const val = (id, v) => page.evaluate(([i, x]) => { const e = document.getElementById(i); e.value = x; e.dispatchEvent(new Event(e.tagName === "SELECT" ? "change" : "input", { bubbles: true })); }, [id, v]);
    const ids = () => page.evaluate(() => _msg.cible.retenus.map((r) => r.c.id));
    const choisirSeulement = (n) => page.evaluate((k) => { msgTout(false); _msg.cible.retenus.slice(0, k).forEach((r) => _msg.desel.delete(r.c.id)); msgRender(); }, n);

    console.log("▶ Ciblage");
    await ouvrir();
    ok(await page.evaluate(() => !document.getElementById("view-messagerie").classList.contains("hidden")), "la page Messagerie s'ouvre");
    const total = await page.evaluate(() => CLIENTS.filter((c) => c.statut === "prospect").length);
    let r = await txt("#msg-cible-resume");
    ok(new RegExp("^" + total + " joignables par WhatsApp").test(r), "WhatsApp : les " + total + " prospects ont un mobile → tous joignables (" + r.slice(0, 60) + ")");
    await val("msg-f-logiciel", "ImmoSuite ERP");
    r = await txt("#msg-cible-resume"); ok(/^95 joignables par WhatsApp/.test(r), "filtre logiciel ImmoSuite : 95 prospects");
    await page.evaluate(() => { const c = CLIENTS.find((x) => x.logiciel === "ImmoSuite ERP" && x.statut === "prospect"); c.phone = "21 00 00 00 00"; const d = CLIENTS.filter((x) => x.logiciel === "ImmoSuite ERP" && x.statut === "prospect")[1]; d.phone = ""; msgRender(); });
    r = await txt("#msg-cible-resume"); ok(/^93 joignables par WhatsApp · 2 exclus sur 95/.test(r), "un fixe et une fiche sans numéro sont exclus : " + r.slice(0, 60));
    await page.evaluate(() => { document.querySelector("#msg-exclus details").open = true; });
    const ex = await txt("#msg-exclus"); ok(/Numéro fixe : pas de WhatsApp : 1/.test(ex) && /Pas de numéro de téléphone : 1/.test(ex), "les exclus sont expliqués : fixe et numéro manquant");
    await page.click("#msg-ch-email"); await page.waitForTimeout(300);
    r = await txt("#msg-cible-resume"); ok(/joignables? par e-mail/.test(r) && /exclus? sur 95/.test(r), "canal e-mail : seuls ceux qui ont une adresse valide : " + r.slice(0, 70));
    ok(/Pas d'adresse e-mail/.test((await page.evaluate(() => { document.querySelector("#msg-exclus details").open = true; return document.getElementById("msg-exclus").innerText; }))), "raison « Pas d'adresse e-mail » affichée");
    ok(/sanix@gmail\.com/.test(await txt("#msg-gmail-ligne")) && /il reste 100 e-mail/.test(await txt("#msg-gmail-ligne")), "Gmail connecté : expéditeur et reste du jour (100)");

    console.log("▶ Message personnalisé");
    ok(await page.evaluate(() => document.getElementById("msg-btn-envoyer").disabled), "sans message : « Envoyer » est inactif et dit pourquoi : " + (await txt("#msg-envoi")).slice(0, 60));
    await page.evaluate(() => { const t = msgModeles().find((x) => x.titre === "Invitation démo"); msgChoisirModele(t.id); });
    const obj = await page.inputValue("#msg-objet"); ok(/Démonstration gratuite de \{logiciel\}/.test(obj), "le modèle e-mail remplit l'objet");
    const ap = await txt("#msg-apercu"); const premier = await page.evaluate(() => msgSelection(_msg.cible)[0].c);
    ok(ap.includes(premier.nom) && !/\{[a-z_]+\}/.test(ap) && !/XX XX/.test(ap), "l'aperçu est rempli pour " + premier.nom + " : aucun {mot} ni faux numéro");
    ok(/Admin Test/.test(ap), "le courrier est signé avec l'utilisateur connecté");
    await val("msg-text", "Bonjour {prenom}, voici {logiciel}.");
    ok(/Il reste à compléter : \{prenom\}/.test(await txt("#msg-manques")) && await page.evaluate(() => document.getElementById("msg-btn-envoyer").disabled), "mot inconnu {prenom} : message bloqué, avec l'explication");
    await val("msg-text", "Bonjour [prénom], voici {logiciel}.");
    ok(/\[prénom\]/.test(await txt("#msg-manques")), "passage [à compléter] : bloqué aussi");
    await page.evaluate(() => { msgChoisirModele(msgModeles().find((x) => x.titre === "Invitation démo").id); });
    ok(!(await page.evaluate(() => document.getElementById("msg-btn-envoyer").disabled)), "message complet : « Envoyer » s'active");

    console.log("▶ Envoi Gmail");
    await choisirSeulement(3);
    const cibles = await page.evaluate(() => msgSelection(_msg.cible).map((r) => ({ nom: r.c.nom, mail: r.cible, id: r.c.id })));
    ok(cibles.length === 3, "3 destinataires cochés");
    await page.evaluate((id) => { const c = CLIENTS.find((x) => x.id === id); delete c._rid; }, cibles[1].id);   // fiche non synchronisée : le CRM trace lui-même l'envoi
    await page.evaluate((id) => { const c = CLIENTS.find((x) => x.id === id); c._rid = "c_test_rid"; }, cibles[0].id);   // fiche synchronisée : c'est le serveur qui écrit l'interaction
    dialogs.length = 0; await page.click("#msg-btn-envoyer"); await page.waitForTimeout(4600);
    ok(dialogs.some((d) => /Envoyer 3 e-mails depuis sanix@gmail\.com/.test(d)), "une confirmation précise le nombre et l'expéditeur avant l'envoi");
    const envois = await page.evaluate(() => __srv.envois);
    ok(envois.length === 3 && envois.every((e, i) => e.action === "send" && e.to === cibles[i].mail), "3 e-mails envoyés, chacun à SON adresse");
    ok(envois.every((e, i) => e.body.includes(cibles[i].nom) && !/\{[a-z_]+\}/.test(e.body + e.subject)), "chaque e-mail est personnalisé (nom du prospect) et complet");
    const h = await page.evaluate(() => MSG_HISTORY.map((m) => m.statut + "|" + m.canal));
    ok(h.length === 3 && h.every((x) => x === "envoye|Email"), "3 lignes « envoyé » dans l'historique");
    ok(envois[0].client_rid === "c_test_rid" && envois[1].client_rid === null, "la fiche synchronisée est transmise au serveur (qui y écrit l'interaction), l'autre non");
    ok(await page.evaluate((id) => (CLIENTS.find((c) => c.id === id).interactions || []).some((i) => i.type === "Email (Gmail)"), cibles[1].id) && !(await page.evaluate((id) => (CLIENTS.find((c) => c.id === id).interactions || []).some((i) => i.type === "Email (Gmail)"), cibles[0].id)), "fiche non synchronisée : l'envoi est tracé sur la fiche ; fiche synchronisée : pas de doublon local");
    ok(/✅/.test(await txt("#msg-history-list")) && /envoyé/.test(await txt("#msg-history-list")), "l'historique affiche les envois");

    console.log("▶ Déjà contactés exclus, plafond, échecs");
    await ouvrir();
    r = await txt("#msg-cible-resume"); ok(/3 exclus? sur 95|exclus? sur 95/.test(r), "les 3 contactés à l'instant sont exclus (7 jours) : " + r.slice(0, 70));
    ok(/Déjà contacté récemment : 3/.test(await page.evaluate(() => { document.querySelector("#msg-exclus details").open = true; return document.getElementById("msg-exclus").innerText; })), "raison « Déjà contacté récemment »");
    await page.evaluate(() => { __srv.envois.length = 0; __srv.mails = Array.from({ length: 99 }, (_, i) => ({ id: "m" + i, client_rid: "x" + i, to_email: "a" + i + "@x.ci", subject: "s", status: "envoye", sent_at: new Date().toISOString() })); _gmail.charge = 0; });
    await page.evaluate(() => gmailRefresh(true)); await page.evaluate(() => msgRender());
    await choisirSeulement(3);
    ok(/il reste 1 e-mail/.test(await txt("#msg-gmail-ligne")) && /Plafond du jour : seuls 1 e-mail/.test(await txt("#msg-envoi")), "plafond : 99 déjà envoyés → il en reste 1, annoncé avant l'envoi");
    dialogs.length = 0; await page.click("#msg-btn-envoyer"); await page.waitForTimeout(1500);
    ok(dialogs.some((d) => /Envoyer 1 e-mail/.test(d) && /2 autre\(s\) resteront/.test(d)), "la confirmation annonce 1 envoi et 2 reportés");
    ok((await page.evaluate(() => __srv.envois.length)) === 1, "un seul e-mail part");
    await page.evaluate(() => { __srv.mails = []; __srv.panne = true; _gmail.charge = 0; return gmailRefresh(true); });
    await ouvrir(); await val("msg-f-recent", ""); await page.evaluate(() => { document.getElementById("msg-f-recent").checked = false; msgRender(); });
    await choisirSeulement(5); await page.click("#msg-btn-envoyer"); await page.waitForTimeout(5200);
    const hh = await page.evaluate(() => MSG_HISTORY.slice(0, 3).map((m) => m.statut));
    ok(hh.every((s) => s === "echec"), "échecs enregistrés dans l'historique, avec la raison");
    ok(/Erreur Gmail simulée/.test(await txt("#msg-history-list")), "la raison de l'échec est lisible");
    ok((await page.evaluate(() => MSG_HISTORY.filter((m) => m.statut === "echec").length)) === 3, "3 échecs de suite : l'envoi s'interrompt (5 prévus, 3 tentés)");
    await page.evaluate(() => { __srv.panne = false; });

    console.log("▶ WhatsApp un par un");
    await ouvrir(); await page.click("#msg-ch-wa"); await page.waitForTimeout(300);
    await page.evaluate(() => { document.getElementById("msg-f-recent").checked = false; msgRender(); });
    ok(/Prudence/.test(await txt("#msg-envoi")) === (await page.evaluate(() => msgSelection(_msg.cible).length > 30)), "avertissement de prudence uniquement au-delà de 30 messages");
    await page.evaluate(() => { msgChoisirModele(msgModeles().find((x) => x.titre === "Présentation produit").id); });
    await choisirSeulement(2);
    const wa = await page.evaluate(() => msgSelection(_msg.cible).map((r) => ({ nom: r.c.nom, id: r.c.id, tel: r.cible })));
    await page.click("#msg-btn-envoyer"); await page.waitForTimeout(300);
    ok(/Message 1 sur 2/.test(await txt("#msg-envoi")) && (await txt("#msg-envoi")).includes(wa[0].nom), "la file présente le 1er message, prêt à partir");
    await page.click("#msg-btn-ouvrir"); await page.waitForTimeout(300);
    const url = await page.evaluate(() => __ouvert[__ouvert.length - 1]);
    ok(url.startsWith("https://wa.me/" + wa[0].tel + "?text=") && decodeURIComponent(url).includes(wa[0].nom), "WhatsApp s'ouvre sur le bon numéro avec le message personnalisé");
    ok(/Message 2 sur 2/.test(await txt("#msg-envoi")), "la file passe au contact suivant");
    await page.click("text=⏭ Passer"); await page.waitForTimeout(300);
    ok(/Terminé : 1 ouvert, 1 passé/.test(await txt("#msg-envoi")), "bilan : 1 ouvert, 1 passé");
    ok(await page.evaluate((id) => (CLIENTS.find((c) => c.id === id).interactions || []).some((i) => i.type === "Message WhatsApp"), wa[0].id), "l'envoi est tracé sur la fiche");
    ok(/ouvert, à envoyer dans l'application/.test(await txt("#msg-history-list")), "l'historique dit honnêtement « ouvert, à envoyer dans l'application »");
    ok((await page.evaluate(() => MSG_HISTORY.length)) === 8, "historique : 3 envoyés + 1 (plafond) + 3 échecs + 1 ouvert = 8");

    console.log("▶ Modèles");
    await page.evaluate(() => { _msg.file = null; });
    const nb0 = await page.evaluate(() => document.querySelectorAll("#msg-templates .msg-template").length);
    ok((await txt("#msg-templates")).split("WhatsApp").length > 2 && !/Email/.test(await txt("#msg-templates")), "canal WhatsApp : seuls les modèles WhatsApp sont listés (" + nb0 + ")");
    await val("msg-tpl-seg", "immo"); ok(await page.evaluate(() => [...document.querySelectorAll("#msg-templates .msg-template")].every((e) => /ImmoSuite|Immobilier/.test(e.innerText))), "filtre par logiciel : modèle Immobilier");
    await val("msg-tpl-seg", "");
    await val("msg-text", "Bonjour {destinataire}, ceci est mon modèle."); await val("msg-tpl-titre", "Mon test");
    await page.click("text=💾 Enregistrer comme modèle"); await page.waitForTimeout(300);
    ok(/Mon test/.test(await txt("#msg-templates")) && /Mon modèle/.test(await txt("#msg-templates")), "le modèle enregistré apparaît, marqué « Mon modèle »");
    await page.click("#msg-ch-email"); await page.waitForTimeout(200); ok(!/Mon test/.test(await txt("#msg-templates")), "il n'apparaît pas dans l'autre canal");
    await page.click("#msg-ch-wa"); await page.waitForTimeout(200);
    await page.reload(); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => { window.__ouvert = []; window.open = (u) => { window.__ouvert.push(u); return {}; }; navigate("messagerie", null); }); await page.waitForTimeout(800);
    ok(/Mon test/.test(await txt("#msg-templates")), "le modèle survit au rechargement");
    ok((await page.evaluate(() => MSG_HISTORY.length)) === 8 && /WhatsApp/.test(await txt("#msg-history-list")), "l'historique des envois survit au rechargement (8 lignes)");
    await page.evaluate(() => { const m = msgModeles().find((x) => x.titre === "Mon test"); msgSupprimerModele(m.rid); });
    ok(!/Mon test/.test(await txt("#msg-templates")), "le modèle se supprime (avec confirmation)");
    await page.click("#msg-ch-email"); await page.evaluate(() => msgChoisirModele(msgModeles().find((x) => x.titre === "Invitation démo").id));
    await page.click("#msg-ch-wa"); await page.waitForTimeout(200);
    ok((await page.inputValue("#msg-text")) === "" && (await page.inputValue("#msg-objet")) === "", "changer de canal efface le texte d'un modèle de l'autre canal");

    console.log("▶ Toast d'erreur et mobile");
    await page.evaluate(() => showToast("Erreur de test", "error")); await page.waitForTimeout(900);
    ok(await page.evaluate(() => [...document.querySelectorAll("body > div")].some((d) => d.textContent === "Erreur de test" && d.style.opacity !== "0")), "un toast d'erreur reste affiché (avant : il disparaissait aussitôt)");
    await page.setViewportSize({ width: 420, height: 900 }); await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "téléphone 420 px : aucun défilement horizontal de la page");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\nTous les contrôles passent.");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
