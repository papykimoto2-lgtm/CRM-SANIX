// SANIX CRM Pro : WhatsApp API dans le navigateur — réglages, envoi direct par modèle approuvé, fiche (remis / lu / réponse), cloche, désinscription. Serveur simulé. node whatsapp_api_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4451), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = [], dialogs = []; page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await page.goto("http://localhost:4451/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
    await page.evaluate(() => {
      const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
      window.__srv = { configure: false, manquants: ["WHATSAPP_TOKEN"], webhook: false, envois: [], textes: [], msgs: [], inb: [], optout: [], refus: null };
      window.aisApi = async (path, opt = {}) => {
        const S = window.__srv, body = opt.body ? JSON.parse(opt.body) : {};
        if (path.includes("crm_mail_state")) return { connecte: false };
        if (path.includes("/rest/v1/crm_mails")) return [];
        if (path.includes("crm-whatsapp")) {
          if (body.action === "status") return { configure: S.configure, manquants: S.manquants, webhook: S.webhook };
          if (body.action === "send_template") { if (S.refus) throw new Error(S.refus); S.envois.push(body); S.msgs.push({ id: "w" + S.envois.length, client_rid: body.client_rid, to_phone: body.to, kind: "template", template: body.template, body: body.preview, sent_by: "Admin Test", status: "envoye", sent_at: new Date().toISOString() }); return { ok: true }; }
          if (body.action === "send_text") { S.textes.push(body); return { ok: true }; }
        }
        if (path.includes("/rest/v1/crm_wa_messages")) return S.msgs.slice();
        if (path.includes("/rest/v1/crm_wa_inbound")) return S.inb.slice();
        if (path.includes("/rest/v1/crm_wa_optout")) return S.optout.slice();
        return null;
      };
      // trois prospects connus du CRM, avec des numéros mobiles fictifs
      [[1, "c_wa1"], [2, "c_wa2"], [3, "c_wa3"], [4, "c_wa4"]].forEach(([id, rid]) => { const c = CLIENTS.find((x) => x.id === id); c._rid = rid; });
      localStorage.removeItem("sanix_crm_notif_vu"); _wa.etat = null; _wa.charge = 0;
    });
    const txt = (sel) => page.evaluate((s) => document.querySelector(s).innerText.replace(/\s+/g, " "), sel);
    const ouvrirMsg = async () => { await page.evaluate(() => { _wa.charge = 0; _wa.etat = null; navigate("messagerie", null); }); await page.waitForTimeout(900); };
    const num = (id) => page.evaluate((i) => waAnalyse(CLIENTS.find((c) => c.id === i).phone).num, id);

    console.log("▶ Serveur non configuré");
    await ouvrirMsg();
    ok(!/Envoi direct \(API\)/.test(await txt("#msg-gmail-ligne")) && /Paramétrage → WhatsApp/.test(await txt("#msg-gmail-ligne")), "sans secrets Meta : seul l'envoi un par un est proposé, avec le chemin vers le réglage");
    await page.evaluate(() => { navigate("parametrage", null); try { initRelanceConfig(); } catch (e) {} }); await page.waitForTimeout(700);
    await page.evaluate(() => waReglageRender()); await page.waitForTimeout(500);
    let rg = await txt("#wa-reglage");
    ok(/Serveur non configuré/.test(rg) && /WHATSAPP_TOKEN/.test(rg), "réglages : le secret manquant est nommé");

    console.log("▶ Serveur configuré, aucun modèle approuvé");
    await page.evaluate(() => { __srv.configure = true; __srv.manquants = []; __srv.webhook = false; });
    await page.evaluate(() => waReglageRender()); await page.waitForTimeout(500);
    rg = await txt("#wa-reglage");
    ok(/Serveur prêt/.test(rg) && /Webhook non configuré/.test(rg) && /WHATSAPP_APP_SECRET/.test(rg), "réglages : serveur prêt, mais l'absence de webhook est signalée (pas de « remis / lu »)");
    ok((await page.$$("#wa-reglage textarea")).length === 3 && /sanix_crm_premier_contact/.test(await page.evaluate(() => document.getElementById("wa-reglage").innerHTML)), "3 modèles proposés, avec le nom à créer chez Meta");
    await ouvrirMsg();
    ok(/Un par un \(manuel\)/.test(await txt("#msg-gmail-ligne")) && !(await page.evaluate(() => msgDirect())), "aucun modèle approuvé : envoi direct non proposé par défaut (mode manuel)");

    console.log("▶ Envoi direct");
    await page.evaluate(() => { waModeleMaj("premier", { approuve: true }); _msg.mode = null; msgRender(); });
    ok(await page.evaluate(() => msgDirect()), "un modèle approuvé : l'envoi direct devient le mode par défaut");
    await page.evaluate(() => { const s = document.getElementById("msg-f-logiciel"); s.value = "ImmoSuite ERP"; s.dispatchEvent(new Event("change")); });
    await page.evaluate(() => { msgTout(false); [1, 2, 3].forEach((id) => _msg.desel.delete(id)); msgRender(); });
    ok(await page.evaluate(() => document.getElementById("msg-texte-bloc").style.display === "none" && document.getElementById("msg-wa-direct").style.display !== "none"), "le texte libre est remplacé par le choix d'un modèle approuvé");
    ok((await page.$$eval("#msg-wa-modele option", (o) => o.map((x) => x.textContent))).join("|") === "— Choisir un modèle approuvé —|Premier contact", "seuls les modèles approuvés sont proposés");
    ok(await page.evaluate(() => document.getElementById("msg-btn-envoyer").disabled) && /Choisissez un modèle approuvé/.test(await txt("#msg-envoi")), "sans modèle : bouton inactif, raison affichée");
    await page.selectOption("#msg-wa-modele", "premier"); await page.waitForTimeout(200);
    ok(/Cochez la confirmation d'accord/.test(await txt("#msg-envoi")) && await page.evaluate(() => document.getElementById("msg-btn-envoyer").disabled), "sans confirmation d'accord des destinataires : envoi bloqué");
    const ap = await txt("#msg-apercu"), premier = await page.evaluate(() => msgSelection(_msg.cible)[0].c);
    ok(ap.includes(premier.nom) && ap.includes("ImmoSuite ERP") && ap.includes("Admin Test") && !/\{\{\d\}\}/.test(ap), "aperçu : nom du prospect, logiciel et signataire (utilisateur connecté), aucune variable {{n}} restante");
    await page.check("#msg-wa-consent"); await page.waitForTimeout(200);
    ok(!(await page.evaluate(() => document.getElementById("msg-btn-envoyer").disabled)) && /Envoyer 3 messages WhatsApp \(API\)/.test(await txt("#msg-envoi")), "accord confirmé : « Envoyer 3 messages WhatsApp (API) »");
    dialogs.length = 0; await page.click("#msg-btn-envoyer"); await page.waitForTimeout(4500);
    ok(dialogs.some((d) => /Envoyer 3 messages WhatsApp avec le modèle « Premier contact »/.test(d) && /accepté d'être contactées/.test(d) && /facturé par Meta/.test(d)), "confirmation : nombre, modèle, rappel de l'accord et du coût");
    const envois = await page.evaluate(() => __srv.envois);
    ok(envois.length === 3 && envois.every((e) => e.template === "sanix_crm_premier_contact" && e.lang === "fr" && e.consent === true && e.params.length === 3), "3 appels serveur : bon modèle, langue, 3 variables, accord transmis");
    ok(envois[0].to === await num(1) && envois[0].client_rid === "c_wa1" && envois[0].params[2] === "Admin Test", "le 1er part vers le bon numéro (225…) et la bonne fiche, signé par l'utilisateur");
    ok(envois[0].preview.includes(envois[0].params[0]) && !/\{\{/.test(envois[0].preview), "le texte conservé dans l'historique est le texte réel envoyé");
    const hist = await page.evaluate(() => MSG_HISTORY.slice(0, 3).map((m) => m.statut + "|" + m.canal));
    ok(hist.every((x) => x === "envoye|WhatsApp"), "3 lignes « envoyé » dans l'historique du module");
    ok((await page.evaluate(() => (CLIENTS.find((c) => c.id === 1).interactions || []).filter((i) => i.type === "Message WhatsApp").length)) === 0, "fiche synchronisée : pas de doublon local (le serveur écrit l'interaction)");

    console.log("▶ Refus du serveur");
    await page.evaluate(() => { __srv.refus = "WhatsApp a refusé l'envoi : (#132001) Template name does not exist in the translation"; __srv.envois.length = 0; document.getElementById("msg-f-recent").checked = false; msgTout(false); [4, 5, 6].forEach((id) => _msg.desel.delete(id)); msgRender(); });
    await page.waitForTimeout(200);
    const avant = await page.evaluate(() => MSG_HISTORY.length);
    await page.click("#msg-btn-envoyer"); await page.waitForTimeout(1800);
    ok((await page.evaluate(() => MSG_HISTORY.length)) - avant === 1 && (await page.evaluate(() => MSG_HISTORY[0].statut)) === "echec", "modèle inconnu de Meta : l'envoi s'arrête au premier refus (1 échec journalisé sur 3 prévus), les autres ne sont pas tentés");
    ok(/Template name does not exist/.test(await txt("#msg-history-list")), "la raison réelle est affichée dans l'historique");
    await page.evaluate(() => { __srv.refus = null; });

    console.log("▶ Désinscrits exclus");
    await page.evaluate(() => { __srv.optout = [{ phone: waAnalyse(CLIENTS.find((c) => c.id === 7).phone).num }]; return waRefresh(true); });
    await page.evaluate(() => { document.getElementById("msg-f-recent").checked = false; msgRender(); });
    await page.evaluate(() => { document.querySelector("#msg-exclus details").open = true; });
    ok(/A demandé à ne plus être contacté \(STOP\) : 1/.test(await txt("#msg-exclus")) && !(await page.evaluate(() => _msg.cible.retenus.some((r) => r.c.id === 7))), "un numéro désinscrit (STOP) est exclu avec sa raison");

    console.log("▶ Fiche : remis, lu, réponse, fenêtre de 24 h");
    await page.evaluate(() => {
      const ago = (h) => new Date(Date.now() - h * 36e5).toISOString(), n = (id) => waAnalyse(CLIENTS.find((c) => c.id === id).phone).num;
      __srv.msgs = [
        { id: "a", client_rid: "c_wa2", to_phone: n(2), kind: "template", template: "sanix_crm_premier_contact", body: "Bonjour…", sent_by: "Admin Test", status: "lu", sent_at: ago(3) },
        { id: "b", client_rid: "c_wa3", to_phone: n(3), kind: "template", template: "sanix_crm_premier_contact", body: "Bonjour…", sent_by: "Admin Test", status: "remis", sent_at: ago(60) },
        { id: "c", client_rid: "c_wa4", to_phone: n(4), kind: "template", template: "sanix_crm_premier_contact", body: "Bonjour…", sent_by: "Admin Test", status: "echec", error: "Le destinataire n'est pas sur WhatsApp", sent_at: ago(1) }];
      __srv.inb = [{ id: "i1", client_rid: "c_wa2", from_phone: n(2), body: "Oui, rappelez-moi demain à 10 h", kind: "text", received_at: ago(1) },
        { id: "i2", client_rid: "c_wa3", from_phone: n(3), body: "Merci, pas intéressé pour le moment", kind: "text", received_at: ago(50) }];
      __srv.optout = [{ phone: n(3) }];
      return waRefresh(true);
    });
    await page.evaluate(() => showClientDetail(2)); await page.waitForTimeout(500);
    let f = await txt("#wa-fiche-host");
    ok(/✓✓ lu/.test(f) && /Réponse/.test(f) && /rappelez-moi demain à 10 h/.test(f), "fiche : message « lu » et réponse du prospect affichés");
    ok(await page.evaluate(() => !!document.getElementById("wa-rep")), "réponse reçue il y a moins de 24 h : la zone de réponse libre est proposée");
    await page.fill("#wa-rep", "Parfait, à demain 10 h."); await page.click("text=📤 Envoyer la réponse"); await page.waitForTimeout(500);
    const t = await page.evaluate(() => __srv.textes);
    ok(t.length === 1 && t[0].action === "send_text" && t[0].text === "Parfait, à demain 10 h." && t[0].client_rid === "c_wa2", "la réponse part vers le serveur avec la bonne fiche et le bon texte");
    await page.evaluate(() => showClientDetail(3)); await page.waitForTimeout(500);
    f = await txt("#wa-fiche-host");
    ok(/✓✓ remis/.test(f) && /ne plus être contacté/.test(f) && !(await page.evaluate(() => !!document.getElementById("wa-rep"))), "fiche désinscrite : avertissement STOP, aucune zone de réponse");
    await page.evaluate(() => { __srv.optout = []; return waRefresh(true); }); await page.evaluate(() => showClientDetail(3)); await page.waitForTimeout(400);
    f = await txt("#wa-fiche-host");
    ok(/fenêtre de 24 h est fermée/.test(f) && !(await page.evaluate(() => !!document.getElementById("wa-rep"))), "réponse vieille de 50 h : fenêtre fermée, seul un modèle approuvé est possible");
    await page.evaluate(() => showClientDetail(4)); await page.waitForTimeout(400);
    f = await txt("#wa-fiche-host"); ok(/⚠️ échec/.test(f) && /pas sur WhatsApp/.test(f), "échec de distribution : la raison de Meta est lisible");

    console.log("▶ Cloche");
    await page.waitForFunction(() => !_wa.enCours);
    await page.evaluate(() => { __srv.inb.push({ id: "i3", client_rid: "c_wa4", from_phone: waAnalyse(CLIENTS.find((c) => c.id === 4).phone).num, body: "STOP", kind: "text", received_at: new Date().toISOString() }); __srv.optout = [{ phone: waAnalyse(CLIENTS.find((c) => c.id === 4).phone).num }]; localStorage.removeItem("sanix_crm_notif_vu"); return waRefresh(true); });
    await page.waitForTimeout(300);
    ok((await page.evaluate(() => document.querySelector(".notif-count") && document.querySelector(".notif-count").textContent)) === "3", "pastille de la cloche : 3 réponses WhatsApp non lues");
    await page.evaluate(() => notifToggle()); await page.waitForTimeout(500);
    const cl = await txt("#notif-panel");
    ok(/💬 WhatsApp/i.test(cl) && /a répondu/.test(cl) && /rappelez-moi demain/.test(cl) && /demande à ne plus être contacté/.test(cl), "cloche : réponses WhatsApp listées, la demande STOP est mise en évidence");
    ok(await page.evaluate(() => document.querySelector(".notif-count") === null), "ouvrir la cloche remet la pastille à zéro");
    ok((await page.evaluate(() => { const R = waAlertes(); return R.filter((a) => a.stop).length; })) === 1, "une seule alerte « STOP » parmi les réponses");

    console.log("▶ Bureau du jour");
    const R = await page.evaluate(async () => { localStorage.removeItem("sanix_crm_notif_vu"); document.getElementById("notif-panel").classList.add("hidden"); const x = await bureauCharger(); return x.R.pourVous.map((p) => p.id + ":" + p.titre); });
    ok(R.some((x) => /^wa_reponses:3 réponses WhatsApp à lire$/.test(x)), "le Bureau du jour signale « 3 réponses WhatsApp à lire »");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\nTous les contrôles passent.");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
