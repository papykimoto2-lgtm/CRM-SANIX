// SANIX CRM Pro : la cloche signale les réponses reçues et les e-mails non distribués (Gmail). node gmail_cloche_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4448), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4448/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => {
      const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
      window.__ago = ago; window.__srv = { etat: { connecte: true, email: "sanix@gmail.com" }, mails: [] };
      window.aisApi = async (path, opt = {}) => {
        const S = window.__srv, body = opt.body ? JSON.parse(opt.body) : {};
        if (path.includes("crm_mail_state")) return JSON.parse(JSON.stringify(S.etat));
        if (path.includes("select=body")) { const id = decodeURIComponent(path.split("id=eq.")[1] || ""); return [{ body: (S.mails.find((m) => m.id === id) || {}).body || "" }]; }
        if (path.includes("/rest/v1/crm_mails")) return JSON.parse(JSON.stringify(S.mails.map((m) => { const c = { ...m }; delete c.body; return c; })));
        if (path.includes("crm-gmail") && body.action === "send") { S.envois = (S.envois || []).concat([body]); S.mails.unshift({ id: "n" + S.mails.length, client_rid: body.client_rid, to_email: body.to, subject: body.subject, body: body.body, status: "envoye", sent_at: new Date().toISOString(), relance_apres_jours: 4 }); return { ok: true }; }
        if (path.includes("crm-gmail") && body.action === "sync") { if (S.onSync) S.onSync(); return { ok: true }; }
        return null;
      };
      localStorage.removeItem("sanix_crm_notif_vu");
      const mk = (id, rid, nom) => CLIENTS.push({ id, _rid: rid, nom, statut: "prospect", secteur: "Immobilier", logiciel: "ImmoSuite ERP", phone: "0707904919", email: nom.toLowerCase().replace(/\W/g, "") + "@x.ci", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), interactions: [] });
      mk(997001, "c_r1", "Marc Dupont"); mk(997002, "c_r2", "Société Vieille"); mk(997003, "c_r3", "Adresse Fausse"); mk(997004, "c_r4", "Sans Réponse");
      CLIENTS.find((c) => c.id === 997003).email = "faux@x.ci";
      window.__srv.mails = [
        { id: "a", client_rid: "c_r1", to_email: "m@x.ci", subject: "Suite à notre appel", status: "repondu", sent_at: ago(5), replied_at: ago(1), sent_by: "Awa", relance_apres_jours: 4 },
        { id: "b", client_rid: "c_r2", to_email: "v@x.ci", subject: "Ancienne affaire", status: "repondu", sent_at: ago(24 * 30), replied_at: ago(24 * 20), relance_apres_jours: 4 },
        { id: "c", client_rid: "c_r3", to_email: "faux@x.ci", subject: "Premier contact", status: "echec", body: "Bonjour,\nTexte d'origine à renvoyer.\nCordialement,\nAwa", error: "Non distribué (retour Gmail) : adresse inexistante", sent_at: ago(70), last_checked_at: ago(48), relance_apres_jours: 4 },
        { id: "d", client_rid: "c_r4", to_email: "s@x.ci", subject: "Sans nouvelle", status: "envoye", sent_at: ago(24), relance_apres_jours: 4 }];
    });
    const attendre = async () => { await page.evaluate(() => { _gmail.charge = 0; _gmail.etat = null; return gmailRefresh(true); }); await page.evaluate(() => notifBadgeMaj()); };
    await attendre();

    console.log("▶ Compteur sur la cloche");
    ok(await page.evaluate(() => { const c = document.querySelector(".notif-btn .notif-count"); return !!c && c.textContent === "2"; }), "pastille rouge « 2 » : une réponse récente et un e-mail non distribué (la réponse vieille de 20 jours n'est pas comptée)");
    ok(await page.evaluate(() => (document.querySelector(".notif-btn").getAttribute("aria-label") || "").includes("2 nouvelles")), "lisible par un lecteur d'écran : « 2 nouvelles »");

    console.log("▶ Panneau");
    await page.evaluate(() => document.querySelector(".notif-btn").click()); await page.waitForTimeout(500);
    const pan = await page.evaluate(() => { const p = document.getElementById("notif-panel"); const r = p.getBoundingClientRect(); return { visible: !p.classList.contains("hidden"), t: p.innerText.replace(/\s+/g, " "), dansEcran: r.left >= 0 && r.right <= innerWidth && r.top >= 0, nouveaux: [...p.querySelectorAll('div[role="button"]')].filter((d) => d.style.background.includes("236") || /ECFDF5/i.test(d.getAttribute("style") || "")).length, pos: [...p.querySelectorAll(".notif-rep,.notif-ech")].map((e) => e.className) }; });
    ok(pan.visible && /Marc Dupont a répondu/.test(pan.t) && /Suite à notre appel/.test(pan.t), "un clic sur la cloche ouvre le panneau : « Marc Dupont a répondu » avec l'objet de l'e-mail");
    ok(/E-mail non distribué : Adresse Fausse/.test(pan.t) && /faux@x\.ci/.test(pan.t), "l'e-mail non distribué est signalé avec l'adresse à vérifier");
    ok(!/Société Vieille/.test(pan.t), "une réponse de plus de 14 jours n'encombre pas le panneau");
    ok(pan.pos[0] === "notif-rep", "la réponse (la plus récente) passe avant l'alerte d'adresse");
    ok(/il y a 1 h/.test(pan.t), "heure relative lisible : « il y a 1 h »");
    ok(pan.dansEcran && await page.evaluate(() => document.documentElement.scrollWidth <= 420), "le panneau tient dans l'écran du téléphone, sans faire défiler la page");
    ok(pan.nouveaux === 2, "les deux alertes nouvelles sont surlignées");
    ok(await page.evaluate(() => !document.querySelector(".notif-btn .notif-count")), "ouvrir la cloche efface le compteur");

    console.log("▶ Ouverture d'une fiche et mémoire du « vu »");
    await page.evaluate(() => [...document.querySelectorAll('#notif-panel div[role="button"]')].find((d) => /Marc Dupont a répondu/.test(d.innerText)).click()); await page.waitForTimeout(500);
    ok(await page.evaluate(() => document.getElementById("notif-panel").classList.contains("hidden") && !document.getElementById("modal-client-detail").classList.contains("hidden") && /Marc Dupont/.test(document.getElementById("modal-client-detail").innerText)), "un clic sur la réponse ferme le panneau et ouvre la fiche de Marc Dupont");
    await page.evaluate(() => document.getElementById("modal-client-detail").classList.add("hidden"));
    await page.evaluate(() => document.querySelector(".notif-btn").click()); await page.waitForTimeout(400);
    ok(await page.evaluate(() => { const p = document.getElementById("notif-panel"); return /Marc Dupont a répondu/.test(p.innerText) && ![...p.querySelectorAll('div[role="button"]')].some((d) => /ECFDF5/i.test(d.getAttribute("style") || "")); }), "à la réouverture : les alertes restent listées mais ne sont plus surlignées");
    await page.keyboard.press("Escape"); ok(await page.evaluate(() => document.getElementById("notif-panel").classList.contains("hidden")), "Échap ferme le panneau");
    await page.evaluate(() => document.querySelector(".notif-btn").click()); await page.mouse.click(5, 800); await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.getElementById("notif-panel").classList.contains("hidden")), "un clic à côté ferme le panneau");

    console.log("▶ Une réponse arrive pendant l'utilisation");
    await page.evaluate(() => { const S = window.__srv; S.onSync = () => { const m = S.mails.find((x) => x.id === "d"); m.status = "repondu"; m.replied_at = new Date().toISOString(); }; });
    await page.evaluate(() => { _gmail.sync = 0; return gmailSync(true); }); await page.waitForTimeout(600);
    const toast = await page.evaluate(() => [...document.body.children].filter((e) => e.tagName === "DIV" && e.style.zIndex === "9000").map((e) => e.textContent).join(" | "));
    ok(/Sans Réponse a répondu à votre e-mail/.test(toast), "message à l'écran : « Sans Réponse a répondu à votre e-mail »");
    ok(await page.evaluate(() => { const c = document.querySelector(".notif-btn .notif-count"); return !!c && c.textContent === "1"; }), "le compteur repasse à « 1 » (la nouvelle réponse seulement)");

    console.log("▶ Adresse corrigée : renvoyer le même e-mail");
    ok(await page.evaluate(() => gmailRenvoyables().length === 0), "tant que la fiche garde l'adresse en échec : rien à renvoyer");
    await page.evaluate(() => { CLIENTS.find((c) => c.id === 997003).email = "adresse.corrigee@x.ci"; _gmail.charge = 0; return gmailRefresh(true); });
    ok(await page.evaluate(() => { const r = gmailRenvoyables(); return r.length === 1 && r[0].nouvelle === "adresse.corrigee@x.ci" && r[0].m.id === "c"; }), "adresse de la fiche corrigée : l'e-mail non distribué devient « à renvoyer »");
    await page.evaluate(() => { showClientDetail(997003); }); await page.waitForTimeout(600);
    ok(await page.evaluate(() => [...document.querySelectorAll("#gmail-fiche-host button")].some((b) => /Renvoyer à adresse\.corrigee@x\.ci/.test(b.textContent))), "la fiche propose « ↻ Renvoyer à adresse.corrigee@x.ci »");
    await page.evaluate(() => document.getElementById("modal-client-detail").classList.add("hidden"));
    await page.evaluate(() => { document.getElementById("notif-panel").classList.add("hidden"); document.querySelector(".notif-btn").click(); }); await page.waitForTimeout(400);
    ok(await page.evaluate(() => /Adresse corrigée : renvoyer à Adresse Fausse/.test(document.getElementById("notif-panel").innerText)), "la cloche signale « Adresse corrigée : renvoyer à … »");
    await page.evaluate(() => [...document.querySelectorAll('#notif-panel div[role="button"]')].find((d) => /Adresse corrigée/.test(d.innerText)).click()); await page.waitForTimeout(700);
    const ed = await page.evaluate(() => ({ a: (document.getElementById("cg-a") || {}).value, objet: (document.getElementById("cg-objet") || {}).value, corps: (document.getElementById("cg-corps") || {}).value, bloque: (document.getElementById("cg-envoyer") || {}).disabled, panneau: document.getElementById("notif-panel").classList.contains("hidden") }));
    ok(ed.panneau && ed.a === "adresse.corrigee@x.ci" && ed.objet === "Premier contact" && /Texte d'origine à renvoyer/.test(ed.corps), "un clic ouvre l'éditeur : nouvelle adresse, même objet, même texte (récupéré à la demande)");
    ok(ed.bloque === false, "prêt à envoyer : il reste à cliquer sur « Envoyer maintenant » (rien ne part tout seul)");
    ok(await page.evaluate(() => window._courrierEx[0].id === "renvoi" && window._courrierEx[0].conseille && window._courrierEx.slice(1).every((e) => !e.conseille)), "le renvoi est l'exemple conseillé, les autres modèles restent disponibles");
    await page.evaluate(() => { __srv.envois = []; }); await page.click("#cg-envoyer"); await page.waitForTimeout(800);
    const env = await page.evaluate(() => __srv.envois && __srv.envois[0]);
    ok(env && env.to === "adresse.corrigee@x.ci" && env.subject === "Premier contact" && /Texte d'origine/.test(env.body) && env.client_rid === "c_r3", "envoi : destinataire corrigé, même objet et même texte, rattaché à la bonne fiche");
    ok(await page.evaluate(() => gmailRenvoyables().length === 0), "une fois renvoyé, l'e-mail n'est plus proposé (pas de double envoi)");
    await page.evaluate(() => { CLIENTS.find((c) => c.id === 997003).email = "faux@x.ci"; });
    ok(await page.evaluate(() => gmailRenvoyables().length === 0), "même adresse que celle qui a échoué : jamais proposé");
    await page.evaluate(() => { __srv.mails.push({ id: "z9", client_rid: "c_r1", to_email: "morte@x.ci", subject: "Autre", status: "echec", error: "Non distribué (retour Gmail)", sent_at: __ago(24 * 3) }); CLIENTS.find((c) => c.id === 997001).email = "morte@x.ci"; _gmail.charge = 0; return gmailRefresh(true); });
    ok(await page.evaluate(() => !gmailRenvoyables().some((r) => r.nouvelle === "morte@x.ci")), "nouvelle adresse déjà rejetée par un autre e-mail : jamais proposée");

    console.log("▶ Sans Gmail connecté");
    await page.evaluate(() => { __srv.etat = { connecte: false }; _gmail.etat = { connecte: false }; notifBadgeMaj(); document.getElementById("notif-panel").classList.add("hidden"); });
    ok(await page.evaluate(() => !document.querySelector(".notif-btn .notif-count")), "Gmail non connecté : pas de compteur e-mail");
    await page.evaluate(() => document.querySelector(".notif-btn").click()); await page.waitForTimeout(300);
    ok(await page.evaluate(() => { const t = document.getElementById("notif-panel").innerText; return !/E-MAILS|a répondu/i.test(t) && /Notifications/.test(t); }), "le panneau s'ouvre quand même, avec les autres alertes du CRM seulement");
    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 2).join("|"));
    await page.evaluate(() => { __srv.etat = { connecte: true, email: "sanix@gmail.com" }; _gmail.etat = { connecte: true, email: "sanix@gmail.com" }; localStorage.removeItem("sanix_crm_notif_vu"); document.getElementById("notif-panel").classList.add("hidden"); document.querySelector(".notif-btn").click(); });
    await page.waitForTimeout(500); await page.screenshot({ path: "/tmp/claude-0/-home-user-CRM-SANIX/fda489a8-65a8-578c-bff6-b00bf4b09a64/scratchpad/cloche.png" });
    console.log("\nCloche (réponses Gmail) : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
