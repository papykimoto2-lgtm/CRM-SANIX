// SANIX CRM Pro : renouvellements et maintenance dans l'écran Après-vente (échéances, relance, facture en brouillon, prolongation, encaissement). node renouvellements_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };

(async () => {
  const server = await start(4422), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4422/index.html"); await page.waitForTimeout(1200);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(2000);

    console.log("▶ Jeu d'essai : quatre licences");
    await page.evaluate(() => {
      window.open = () => ({ closed: false, focus() {} });                                      // WhatsApp : fenêtre simulée
      const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
      const lg = LOGICIELS.find((l) => l.nom === "ImmoSuite ERP") ? "ImmoSuite ERP" : LOGICIELS[0].nom;
      window.__lg = lg; window.__prix = (LOGICIELS.find((l) => l.nom === lg) || {}).prixNum;
      CLIENTS.push({ id: 90001, nom: "TEST MAINT SA", phone: "07 07 11 22 33", email: "t@t.ci", statut: "client", logiciel: lg, valeur: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      const L = (id, client, type, extra) => Object.assign({ id, key: "SANIX-TEST-" + id, client, logiciel: lg, type, postes: 1, statut: "active", env: "production", createdAt: new Date().toISOString() }, extra);
      LICENCES.push(L("t_maint30", "TEST MAINT SA", "Perpetuelle", { debut: iso(-335) }));                    // maintenance dans 30 jours
      LICENCES.push(L("t_expire", "TEST EXPIRE", "Annuelle", { debut: iso(-390), fin: iso(-25), renouvMontant: 500000 }));   // abonnement échu depuis 25 jours
      LICENCES.push(L("t_loin", "TEST LOIN", "Perpetuelle", { debut: iso(-30) }));                            // maintenance dans 335 jours
      LICENCES.push(L("t_sans", "TEST SANS", "Perpetuelle", { debut: iso(-335), maintNon: true }));           // sans maintenance
      saveStore("licences"); saveStore("clients");
    });
    const cnt = () => page.evaluate(() => ({ cmd: COMMANDES.length, ren: COMMANDES.filter((c) => c.renouvellement).length, lic: LICENCES.length, ctr: CONTRATS.length }));
    const avant = await cnt();
    await page.evaluate(() => navigate("apresvente", null)); await page.waitForTimeout(700);

    console.log("▶ Échéancier");
    const rows = await page.locator("#av-renew > div").count();
    const txt = await page.locator("#av-renew").innerText();
    ok(txt.includes("TEST MAINT SA") && txt.includes("TEST EXPIRE"), "maintenance J-30 et abonnement échu listés");
    ok(!txt.includes("TEST LOIN") && !txt.includes("TEST SANS"), "échéance lointaine et « sans maintenance » absentes");
    ok(/🔧 Maintenance/.test(txt) && /échue depuis 25 j/.test(txt) && /dans 30 j/.test(txt), "type et jours restants affichés");
    ok(await page.evaluate(() => { const e = SanixRenouv.echeances(LICENCES, LOGICIELS, { cfg: renouvCfg() }).find((x) => x.licId === "t_maint30"); return e.montantHT === Math.round(window.__prix * 0.12); }), "montant de maintenance = 12 % du prix du catalogue");
    ok(txt.includes("500 000") || txt.includes("500 000"), "montant saisi sur la licence utilisé pour l'abonnement");
    const kp = await page.locator("#av-kpis").innerText();
    ok(/À renouveler \(60 j\)\s*\n?\s*\d+/.test(kp) && /À relancer/.test(kp) && /À encaisser/.test(kp), "indicateurs : à renouveler, à relancer, à encaisser");
    ok((await page.locator("#av-avenir").innerText()).includes("Total à renouveler"), "revenu récurrent attendu sur 12 mois");

    console.log("▶ Facture de renouvellement préparée automatiquement");
    const apres = await cnt();
    ok(apres.ren - avant.ren === 2, "deux factures en brouillon créées (maintenance J-30, abonnement échu) : " + (apres.ren - avant.ren));
    const f = await page.evaluate(() => COMMANDES.find((c) => c.licId === "t_maint30"));
    ok(f.statut === "brouillon" && f.renouvellement && f.typeLicence === "Maintenance" && f.ttc === Math.round(f.htNet * 1.18) && /^REN-/.test(f.ref) && f.id.startsWith("renouv_t_maint30_"), "brouillon de maintenance : TVA 18 %, référence REN-, identifiant dérivé " + f.ref);
    await page.evaluate(() => { renouvAuto(); renouvAuto(); initApresVente(); }); await page.waitForTimeout(200);
    ok((await cnt()).ren === apres.ren, "relancer le calcul ne crée aucun doublon");
    ok(apres.lic === avant.lic && apres.ctr === avant.ctr, "ni nouvelle licence ni nouveau contrat créés par ces factures");
    ok(await page.evaluate(() => { _notifications = []; buildNotifications(); return _notifications.some((n) => n.ico === "🔁" && /TEST MAINT SA/.test(n.msg) && n.module === "apresvente"); }), "notification « maintenance à relancer »");
    ok(await page.evaluate(() => { updateSidebarNotifications(); const b = document.getElementById("sb-cmd-badge"); return COMMANDES.filter((c) => !c.renouvellement && (c.statut === "brouillon" || c.statut === "confirmee")).length === +b.textContent || b.style.display === "none"; }), "les factures de renouvellement ne gonflent pas le badge des commandes");

    console.log("▶ Relance par palier");
    const ligne = page.locator("#av-renew > div", { hasText: "TEST MAINT SA" });
    await ligne.locator('button:has-text("Relancer")').click(); await page.waitForTimeout(300);
    const r1 = await page.evaluate(() => ({ rel: LICENCES.find((l) => l.id === "t_maint30").relances, inter: CLIENTS.find((c) => c.id === 90001).interactions }));
    ok(r1.rel.length === 1 && r1.rel[0].palier === "j30" && r1.rel[0].canal === "whatsapp" && r1.inter.some((i) => i.type === "Relance renouvellement"), "relance J-30 enregistrée sur la licence et sur le client");
    ok((await page.locator("#av-renew > div", { hasText: "TEST MAINT SA" }).innerText()).includes("relancé J-30"), "« relancé J-30 le … » affiché");
    ok(await page.evaluate(() => SanixRenouv.echeances(LICENCES, LOGICIELS, { cfg: renouvCfg() }).find((x) => x.licId === "t_maint30").relanceDue === false), "plus de relance proposée pour ce palier");
    await page.evaluate(() => renouvRelancer("t_expire", "tel")); await page.waitForTimeout(150);
    ok(await page.evaluate(() => LICENCES.find((l) => l.id === "t_expire").relances[0].canal === "telephone"), "relance téléphonique notée");

    console.log("▶ Facture imprimable");
    await ligne.locator('button:has-text("Facture")').click(); await page.waitForTimeout(300);
    ok(await page.locator("#fac-choix").count() === 1, "le choix de facture (avec/sans TVA) s'ouvre sur la facture de renouvellement");
    await page.evaluate(() => document.getElementById("fac-choix").remove());

    console.log("▶ Renouvellement confirmé");
    const finAvant = await page.evaluate(() => SanixRenouv.echeances(LICENCES, LOGICIELS, { cfg: renouvCfg() }).find((x) => x.licId === "t_maint30"));
    await page.locator("#av-renew > div", { hasText: "TEST MAINT SA" }).locator('button:has-text("Renouvelé")').click(); await page.waitForTimeout(400);
    const c1 = await page.evaluate(() => ({ l: LICENCES.find((l) => l.id === "t_maint30"), o: COMMANDES.find((c) => c.licId === "t_maint30") }));
    ok(c1.o.statut === "confirmee" && c1.l.maintFin === finAvant.finPrevue && c1.l.renouvellements.length === 1 && c1.l.renouvellements[0].cmdId === c1.o.id, "facture confirmée, fin de maintenance repoussée de 12 mois : " + c1.l.maintFin);
    ok(!(await page.locator("#av-renew").innerText()).includes("TEST MAINT SA"), "l'échéance sort de la liste");
    ok((await page.locator("#av-encaisser").innerText()).includes("TEST MAINT SA"), "elle apparaît dans « à encaisser »");
    const ap2 = await cnt(); ok(ap2.lic === avant.lic && ap2.ctr === avant.ctr, "toujours aucune licence ni contrat créés");
    await page.evaluate(() => { renouvAuto(); }); ok((await cnt()).ren === ap2.ren, "pas de nouvelle facture après le renouvellement");

    console.log("▶ Encaissement (journal des paiements)");
    await page.locator("#av-encaisser > div", { hasText: "TEST MAINT SA" }).locator('button:has-text("Payé")').click(); await page.waitForTimeout(300);
    ok(await page.locator("#pay-ov").count() === 1 && await page.locator("#pay-montant").inputValue() === String(await page.evaluate(() => COMMANDES.find((c) => c.licId === "t_maint30").ttc)), "« Payé » ouvre la fenêtre de paiement : montant proposé = reste dû");
    await page.selectOption("#pay-mode", "mobile_money"); await page.fill("#pay-ref", "WAVE-123"); await page.click("#pay-ok"); await page.waitForTimeout(300);
    const o2 = await page.evaluate(() => COMMANDES.find((c) => c.licId === "t_maint30"));
    ok(o2.acompte === o2.ttc && o2.solde === 0 && o2.paiements.length === 1 && o2.paiements[0].mode === "mobile_money" && o2.paiements[0].ref === "WAVE-123" && o2.paiements[0].date === await page.evaluate(() => _ajd()), "paiement enregistré avec sa date, son mode et sa référence");
    ok(!(await page.locator("#av-encaisser").innerText()).includes("TEST MAINT SA"), "il quitte la liste « à encaisser »");

    console.log("▶ Modèle financier");
    await page.evaluate(() => navigate("financement", null)); await page.waitForTimeout(600);
    await page.click('[data-tab="traction"]'); await page.waitForTimeout(300);
    const trac = await page.locator("#fin-body").innerText();
    ok(trac.includes("Renouvellements et maintenance facturés") && !trac.includes("Aucun revenu récurrent"), "Traction : renouvellements facturés signalés, plus d'alerte « aucun revenu récurrent »");
    ok(await page.evaluate(() => { const t = SanixFinancement.calc.analyserTraction(COMMANDES, {}); return t.renouv.n >= 1 && !t.parLogiciel.some((p) => p.n === 0) && t.tous.commandes === COMMANDES.filter((c) => !c.renouvellement && ["confirmee", "en_cours", "livree"].includes(c.statut)).length; }), "les renouvellements ne comptent pas comme de nouvelles commandes");

    console.log("▶ Suppression d'un brouillon : pas recréé");
    await page.evaluate(() => navigate("apresvente", null)); await page.waitForTimeout(400);
    await page.evaluate(() => { const o = COMMANDES.find((c) => c.licId === "t_expire"); deleteCommande(o.id); renouvAuto(); });
    ok(await page.evaluate(() => !COMMANDES.some((c) => c.licId === "t_expire")), "facture supprimée volontairement : non recréée");

    console.log("▶ Fiche licence");
    await page.evaluate(() => openLicenceModal("t_loin")); await page.waitForTimeout(200);
    ok(await page.locator("#lic-maintfin").isVisible() && await page.locator("#lic-maintnon").isVisible() && await page.locator("#lic-renouvmontant").isVisible(), "champs : fin de maintenance, sans maintenance, montant du renouvellement");
    await page.fill("#lic-maintfin", "2026-12-15"); await page.fill("#lic-renouvmontant", "123000"); await page.evaluate(() => saveLicence());
    const l = await page.evaluate(() => LICENCES.find((x) => x.id === "t_loin")); ok(l.maintFin === "2026-12-15" && l.renouvMontant === 123000 && l.maintNon === false, "fin de maintenance et montant enregistrés");
    await page.evaluate(() => navigate("apresvente", null)); await page.waitForTimeout(400);
    ok((await page.locator("#av-renew").innerText()).includes("TEST LOIN") && (await page.locator("#av-renew").innerText()).includes("123"), "l'échéance saisie apparaît avec son montant");
    await page.evaluate(() => { openLicenceModal("t_loin"); document.getElementById("lic-maintnon").checked = true; saveLicence(); initApresVente(); });
    ok(!(await page.locator("#av-renew").innerText()).includes("TEST LOIN"), "« sans maintenance » retire l'échéance");

    console.log("▶ Persistance");
    await page.reload(); await page.waitForTimeout(1200);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1800);
    ok(await page.evaluate(() => { const l = LICENCES.find((x) => x.id === "t_maint30"); return l && l.renouvellements && l.renouvellements.length === 1 && COMMANDES.some((c) => c.licId === "t_maint30" && c.statut === "confirmee"); }), "renouvellement conservé après rechargement");

    ok(errors.length === 0, "aucune erreur JavaScript " + errors.slice(0, 3).join(" | "));
    console.log("\nRenouvellements et maintenance : TOUT EST OK");
  } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser.close(); server.close && server.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }
})();
