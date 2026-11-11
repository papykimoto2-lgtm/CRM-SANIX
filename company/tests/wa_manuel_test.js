// WhatsApp en mode manuel (sans clé d'API) dans le bureau : messages approuvés à envoyer à la main, lien wa.me prérempli, confirmation, abandon, saisie de la réponse. node wa_manuel_test.js
const { launch, newPage, ok, loadFixture } = require("./harness.js");

(async () => {
  const { server, browser } = await launch(4177);
  try {
    const FX = loadFixture(), now = new Date().toISOString();
    const base = { stage: "enregistre", opt_out: false };
    FX.ai_prospects.push({ ...base, id: "p-wa-1", entreprise: "Ferme <img src=x onerror=window.__XSS=1> Test", decideur: "M. Koné", telephone: "07 08 24 13 36", phone_norm: "2250708241336", whatsapp: null },
      { ...base, id: "p-wa-2", entreprise: "Élevage Sans Numéro", decideur: null, telephone: null, phone_norm: null, whatsapp: null },
      { ...base, id: "p-wa-3", entreprise: "Ferme Déjà Contactée", decideur: null, telephone: "+225 01 53 53 18 98", phone_norm: "2250153531898", whatsapp: null });
    FX.ai_messages = [
      { id: 101, prospect_id: "p-wa-1", canal: "whatsapp", sens: "sortant", auteur: "agent", contenu: "Bonjour M. Koné,\nAvicoSuite suit vos lots & votre rentabilité.", statut: "a_envoyer", meta: {}, created_at: now },
      { id: 102, prospect_id: "p-wa-2", canal: "whatsapp", sens: "sortant", auteur: "agent", contenu: "Bonjour, présentation AvicoSuite.", statut: "a_envoyer", meta: {}, created_at: now },
      { id: 103, prospect_id: "p-wa-3", canal: "whatsapp", sens: "sortant", auteur: "agent", contenu: "Premier message", statut: "envoye", meta: { mode: "manuel", envoye_le: now }, created_at: now },
      { id: 104, prospect_id: "p-wa-3", canal: "whatsapp", sens: "sortant", auteur: "agent", contenu: "Envoyé par l'API (ne doit pas figurer)", statut: "envoye", meta: {}, created_at: now },
    ];
    const { page, errors } = await newPage(browser, { fixture: JSON.stringify(FX) });
    await page.goto("http://localhost:4177/company/");
    await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(800);
    const calls = (n) => page.evaluate((nn) => window.__CALLS.filter((c) => c.rpc === nn), n);
    const body = async () => (await page.locator("#main").innerText()).replace(/[  ]/g, " ");

    console.log("▶ Validations : section « WhatsApp à envoyer »");
    await page.click("#tabs button[data-id=valid]"); await page.waitForTimeout(400);
    ok((await body()).includes("WhatsApp à envoyer (2)"), "deux messages en attente d'envoi manuel");
    ok(await page.evaluate(() => window.__XSS === undefined), "nom d'entreprise malveillant : échappé, rien d'exécuté");
    const a = page.locator('[data-wa="101"] a');
    const href = await a.getAttribute("href");
    ok(href === "https://wa.me/2250708241336?text=" + encodeURIComponent("Bonjour M. Koné,\nAvicoSuite suit vos lots & votre rentabilité."), "lien wa.me : numéro à 10 chiffres complété par 225, message encodé (retours à la ligne et « & » compris)");
    ok((await a.getAttribute("target")) === "_blank" && /noopener/.test(await a.getAttribute("rel")), "le lien s'ouvre dans un nouvel onglet, sans accès à la fenêtre d'origine");
    ok((await page.locator('[data-wa="102"] a').count()) === 0 && (await page.locator('[data-wa="102"]').innerText()).includes("aucun numéro WhatsApp"), "prospect sans numéro : pas de lien, mention claire");
    ok(!(await body()).includes("ne doit pas figurer"), "seuls les messages envoyés à la main sont proposés pour la saisie d'une réponse");
    ok((await page.locator("#tabs button[data-id=valid] .badge").innerText()).trim() >= "2", "pastille de l'onglet : messages à envoyer comptés");

    console.log("▶ Confirmation, abandon, réponse");
    await page.click('[data-wa="101"] button[data-act="wa-sent"]'); await page.waitForTimeout(250);
    await page.fill("#ask-t", "envoyé depuis mon mobile"); await page.click('#ask button[type=submit]'); await page.waitForTimeout(500);
    let c = (await calls("ai_wa_marquer_envoye")).at(-1);
    ok(c && c.args.p_id === 101 && c.args.p_note === "envoyé depuis mon mobile", "« J'ai envoyé » : fonction serveur appelée avec l'identifiant du message et la note");
    ok((await body()).includes("WhatsApp à envoyer (1)") && (await page.locator('[data-wa="101"]').count()) === 0, "le message disparaît de la file d'envoi");
    await page.click('[data-wa="102"] button[data-act="wa-cancel"]'); await page.waitForTimeout(250);
    await page.fill("#ask-t", "numéro absent"); await page.click('#ask button[type=submit]'); await page.waitForTimeout(500);
    c = (await calls("ai_wa_annuler")).at(-1);
    ok(c && c.args.p_id === 102 && c.args.p_motif === "numéro absent", "« Ne pas envoyer » : abandon avec motif");
    ok((await body()).includes("WhatsApp à envoyer (0)") && (await body()).includes("Aucun message en attente d'envoi"), "file vide : message explicite");
    await page.click('button[data-act="wa-reply"][data-prospect="p-wa-1"]'); await page.waitForTimeout(250);
    await page.fill("#ask-t", "Oui, envoyez-moi la démo"); await page.click('#ask button[type=submit]'); await page.waitForTimeout(500);
    c = (await calls("ai_wa_reponse")).at(-1);
    ok(c && c.args.p_prospect === "p-wa-1" && c.args.p_texte === "Oui, envoyez-moi la démo", "réponse du prospect saisie et transmise");
    await page.click('button[data-act="wa-reply"][data-prospect="p-wa-3"]'); await page.waitForTimeout(250);
    await page.click("#ask-no"); await page.waitForTimeout(300);
    ok((await calls("ai_wa_reponse")).length === 1, "annuler la saisie n'envoie rien");
    ok(errors.filter((e) => !/Failed to load resource|favicon/.test(e)).length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.slice(0, 3).join(" | ") : ""));
    console.log("\nWhatsApp manuel : TOUT EST OK");
  } finally { await browser.close(); server.close && server.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
