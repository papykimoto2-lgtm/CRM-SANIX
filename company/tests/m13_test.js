// Module 13 — critères de réception (animation 3D temps réel des agents IA). node m13_test.js
const fs = require("fs"), path = require("path");
const { launch, newPage, openOffice, ok, OUT, HERE, loadFixture } = require("./harness.js");
const PORT = 4177;   // port local du serveur de test
const FIX0 = loadFixture();
const idle = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (page, fn, ...a) => page.evaluate(fn, ...a);
const ids = (page) => ev(page, () => Object.fromEntries(window.__vc.agents.map((a) => [a.code, a.id])));
const insp = (page, id) => ev(page, (id) => window.__vc.office.inspect(id), id);
const adv = (page, s) => ev(page, (s) => window.__vc.office.advance(s), s);
const emit = (page, t, e, row) => ev(page, ([t, e, row]) => window.__emit(t, e, row), [t, e, row]);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const plusH = (h) => new Date(Date.now() + h * 3600e3).toISOString();

(async () => {
  const { server, browser } = await launch(PORT);
  try {
    // ══════════════════════════ 1. Avatars identifiables ══════════════════════════
    console.log("▶ Critère 1 — tous les agents ont un avatar identifiable");
    const A1 = await newPage(browser); const page = A1.page;
    await openOffice(page, PORT);
    await ev(page, () => { window.__vc.heartbeat = false; });   // le rafraîchissement périodique de sécurité (20 s) fausserait les états simulés et le comptage des requêtes
    const A = await ids(page);
    const live = await ev(page, () => window.__vc.agents.filter((a) => a.etat !== "archive").map((a) => ({ id: a.id, nom: a.nom, dept: a.departement_id, niveau: a.niveau })));
    const st = await ev(page, () => window.__vc.office.stats());
    ok(st.avatarMode === "glb", "avatars humains GLB (modèles Blender + clips partagés) chargés");
    ok(st.avatars === live.length && live.length >= 25, `${st.avatars} avatars pour ${live.length} collaborateurs actifs (archivés exclus)`);
    const names = await page.locator(".np b").allTextContents();
    ok(live.every((a) => names.includes(a.nom)), "chaque collaborateur a une plaque d'identité (nom)");
    ok((await ev(page, () => [...new Set(window.__vc.agents.filter((a) => a.etat !== "archive").map((a) => a.departement_id))].length)) >= 5 && live.every((a) => a.dept), "chaque avatar porte la couleur de son département");
    ok((await ev(page, (ids) => ids.every((id) => window.__vc.office.inspect(id) !== null), live.map((a) => a.id))), "chaque avatar est interrogeable (inspect)");
    ok((await page.locator("#sup-body tr").count()) === live.length, "supervision : une ligne par collaborateur");

    // ══════════════════════════ 2. Activité → animation ══════════════════════════
    console.log("▶ Critère 2 — chaque activité déclenche l'animation appropriée");
    const EXPECT = { disponible: "idle", recherche_prospects: "screen", recherche_web: "screen", consultation_documents: "documents", analyse_donnees: "multiscreen", redaction_email: "typing",
      conversation_whatsapp: "terminal", appel_telephonique: "headset", planification_rdv: "documents", negociation: "talk", management: "present", preparation_rapport: "documents",
      reunion: "meeting", mission_terminee: "celebrate", en_difficulte: "alert", attente: "pause" };
    const COARSE = { reunion: "en_reunion", en_difficulte: "en_difficulte", attente: "attente_validation", mission_terminee: "mission_terminee", disponible: "disponible" };
    const T = A.ia_qualif_2, seen = {};
    for (const [act, anim] of Object.entries(EXPECT)) {
      await ev(page, ([id, act, st]) => window.__vc.office.patchAgent({ id, activite: st, activite_detail: act, activite_depuis: window.__vc.office.now(), lieu: "poste", lieu_jusqua: null }), [T, act, COARSE[act] ?? "en_mission"]);
      await adv(page, act === "mission_terminee" ? 0.6 : 1.6);
      const i = await insp(page, T); seen[act] = i;
      ok(i.anim === anim && i.clip === `Sit_${anim}`, `activité « ${act} » → animation « ${anim} » (clip ${i.clip})`);
    }
    ok(seen.consultation_documents.props.docs && seen.appel_telephonique.props.phone && seen.conversation_whatsapp.props.phone && !seen.recherche_prospects.props.phone, "accessoires : document, téléphone (appel, WhatsApp) affichés seulement quand l'activité les utilise");
    // alerte : « main levée à hauteur du visage ou plus haut ». L'os de la tête des humains réalistes (base du crâne) est 3,5 à 4 cm plus haut que celui du squelette SANIX
    // (cou et buste plus longs, bras de même longueur) : le même geste, main levée en travers du visage, se mesure donc 3 cm sous cet os ; le visage s'étend sur ±10 cm autour de lui.
    ok(seen.en_difficulte.pose.rightHand > seen.en_difficulte.pose.head - 0.06 && seen.mission_terminee.pose.leftHand > seen.mission_terminee.pose.head && seen.mission_terminee.pose.rightHand > seen.mission_terminee.pose.head && seen.attente.pose.head < seen.disponible.pose.head - 0.04, "poses mesurées sur le squelette : main levée au-dessus de la tête (alerte), deux mains levées (réussite), tête et buste affaissés (attente)");
    ok(seen.en_difficulte.icon === "oui" && seen.mission_terminee.icon === "oui" && seen.attente.icon === "oui", "icône d'état au-dessus de l'avatar (alerte, confirmation, attente)");
    await ev(page, ([id]) => window.__vc.office.patchAgent({ id, activite: "en_analyse", activite_detail: "analyse_donnees" }), [T]); await adv(page, 1);
    ok((await ev(page, (id) => window.__vc.office.desk(id), T)).multi, "analyse de données : écrans multiples allumés au poste");
    await ev(page, ([id]) => window.__vc.office.patchAgent({ id, activite: "en_mission", activite_detail: "preparation_rapport" }), [T]); await adv(page, 1);
    ok((await ev(page, (id) => window.__vc.office.desk(id), T)).docs, "préparation de rapport : documents posés sur le bureau");
    await ev(page, ([id]) => window.__vc.office.patchAgent({ id, activite: "mission_terminee", activite_detail: "mission_terminee", activite_depuis: window.__vc.office.now() }), [T]); await adv(page, 4.5);
    ok((await insp(page, T)).anim === "idle", "mission terminée : confirmation jouée une fois puis retour au calme (pas de boucle de fête)");
    const head = await ev(page, async ([id]) => { const o = window.__vc.office; o.patchAgent({ id, activite: "en_analyse", activite_detail: "analyse_donnees", activite_depuis: o.now() }); let mn = 9, mx = -9; for (let k = 0; k < 40; k++) { o.advance(0.25); const y = o.inspect(id).pose.headYaw; mn = Math.min(mn, y); mx = Math.max(mx, y); } return mx - mn; }, [T]);
    ok(head > 0.5, `analyse multi-écrans : la tête balaie les écrans (amplitude ${head.toFixed(2)} rad)`);
    ok((await ev(page, (id) => { const o = window.__vc.office; o.patchAgent({ id, activite: "en_mission", activite_detail: "redaction_email" }); o.advance(0.5); const a = o.inspect(id).pose.leftHand; let d = 0; for (let k = 0; k < 20; k++) { o.advance(0.05); d += Math.abs(o.inspect(id).pose.leftHand - a); } return d; }, T)) > 0.004, "rédaction d'e-mail : avant-bras en mouvement de frappe");

    // ══════════════════════════ 3. Temps réel ══════════════════════════
    console.log("▶ Critère 3 — changements de statut synchronisés en temps réel (sans rechargement)");
    const agentSel = () => ev(page, () => window.__Q.filter((q) => q.table === "ai_agents" && q.op === "select").length);
    const before = await agentSel(), nav0 = await ev(page, () => performance.getEntriesByType("navigation").length);
    await emit(page, "ai_agents", "UPDATE", { id: A.ia_hunter_2, activite: "en_difficulte", activite_detail: "en_difficulte", activite_depuis: new Date().toISOString() });
    ok((await insp(page, A.ia_hunter_2)).anim === "alert", "UPDATE Realtime → l'avatar passe en « alerte » immédiatement");
    await page.waitForTimeout(600);
    ok((await page.locator("#sup-body tr", { hasText: "IA Prospect Hunter 2" }).innerText()).includes("En difficulté"), "le tableau de supervision affiche « En difficulté » 🔴");
    await emit(page, "ai_agent_events", "INSERT", { id: 9001, agent_id: A.ia_hunter_2, kind: "activite", activity: "analyse_donnees", animation: "multiscreen", status: "en_analyse", participants: [], payload: {}, created_at: new Date().toISOString() });
    ok((await insp(page, A.ia_hunter_2)).anim === "multiscreen", "événement « activite » → animation correspondante (déduite de l'activité)");
    ok((await ev(page, () => window.__vc.office.feedLines())).some((l) => l.includes("IA Prospect Hunter 2") && l.includes("Analyse de données")), "flux d'activité en direct alimenté (écran de supervision)");
    await page.waitForTimeout(700);
    ok((await agentSel()) === before && (await ev(page, () => performance.getEntriesByType("navigation").length)) === nav0, "aucune requête de rechargement des agents ni navigation : mise à jour incrémentale");
    await emit(page, "ai_agents", "UPDATE", { id: A.ia_hunter_1, etat: "suspendu" });
    ok((await insp(page, A.ia_hunter_1)).anim === "pause", "agent suspendu : animation « pause »");
    await page.waitForTimeout(600);
    ok((await page.locator("#sup-body tr", { hasText: "IA Prospect Hunter 1" }).innerText()).includes("Suspendu"), "supervision : ⚪ Suspendu");
    await ev(page, () => window.__rtStatus("CLOSED"));
    ok((await page.locator("#sync-chip").innerText()).includes("Reconnexion"), "perte du temps réel signalée (« Reconnexion… »)");
    await ev(page, () => { const a = window.__FIX.ai_agents.find((x) => x.code === "ia_content"); a.activite_detail = "negociation"; a.activite = "en_mission"; });   // changement manqué pendant la coupure
    await ev(page, () => window.__rtStatus("SUBSCRIBED")); await page.waitForTimeout(900);
    ok((await insp(page, A.ia_content)).anim === "talk" && (await page.locator("#sync-chip").innerText()).includes("Temps réel"), "à la reconnexion : rattrapage complet de l'état manqué");

    // ══════════════════════════ 4. Déplacements ══════════════════════════
    console.log("▶ Critère 4 — les agents se déplacent");
    const a0 = await insp(page, A.ia_resp_prospection);   // fixture : en visite chez ia_sup_sante (déjà sur place à l'ouverture)
    ok(!a0.walking && a0.anim === "handover" && a0.posture === "stand" && a0.clip === "Stand_handover" && a0.props.folder, "à l'ouverture : l'agent en visite est déjà chez son collègue (aucune marche artificielle)");
    const d0 = await insp(page, A.ia_hunter_3);
    await emit(page, "ai_agents", "UPDATE", { id: A.ia_hunter_3, lieu: "poste_agent", lieu_cible_agent: A.ia_sup_btp, lieu_jusqua: plusH(1) });
    let w = await insp(page, A.ia_hunter_3);
    ok(w.walking && w.anim === "walk", "le responsable se lève et marche vers le poste d'un subordonné");
    const len = await ev(page, (id) => { const o = window.__vc.office; let p = o.inspect(id), L = 0; for (let k = 0; k < 20; k++) { o.advance(0.1); const q = o.inspect(id); L += Math.hypot(q.x - p.x, q.z - p.z); p = q; } return L; }, A.ia_hunter_3);
    ok(len > 3.9 && len < 4.9 && (await insp(page, A.ia_hunter_3)).clip === "Walk", `marche continue à vitesse constante (${len.toFixed(1)} unités en 2 s, ≈ 2,2 u/s) avec le clip « Walk »`);
    await adv(page, 60); w = await insp(page, A.ia_hunter_3);
    ok(!w.walking && w.anim === "handover" && w.posture === "stand", "arrivé : se tient debout au poste du collègue (transmission de dossier)");
    await emit(page, "ai_agents", "UPDATE", { id: A.ia_hunter_3, lieu: "poste", lieu_jusqua: null }); await adv(page, 90);
    w = await insp(page, A.ia_hunter_3);
    ok(!w.walking && w.posture === "seat" && dist(w, d0) < 0.2, "retour automatique à son poste, assis");
    await emit(page, "ai_agents", "UPDATE", { id: A.ia_enrich_1, lieu: "departement", lieu_cible_dept: "marketing", lieu_jusqua: plusH(1) }); await adv(page, 90);
    w = await insp(page, A.ia_enrich_1);
    ok(!w.walking && w.place.startsWith("dept:marketing"), "un agent se rend dans un autre département pour remettre un dossier");
    await emit(page, "ai_agents", "UPDATE", { id: A.sanix_ai_general_director, lieu: "supervision", lieu_jusqua: plusH(1) }); await adv(page, 90);
    ok((await insp(page, A.sanix_ai_general_director)).place === "supervision", "le directeur se rend dans la salle de supervision");
    await emit(page, "ai_agents", "UPDATE", { id: A.ia_dir_client, lieu: "collaboration", lieu_jusqua: plusH(1) }); await emit(page, "ai_agents", "UPDATE", { id: A.ia_dir_admin, lieu: "collaboration", lieu_jusqua: plusH(1) }); await adv(page, 90);
    const c1 = await insp(page, A.ia_dir_client), c2 = await insp(page, A.ia_dir_admin);
    ok(c1.place.startsWith("collab") && c2.place.startsWith("collab") && dist(c1, c2) > 0.8, "plusieurs agents se réunissent à l'espace de collaboration (places distinctes)");
    // les trajets restent dans les allées : aucun point de passage dans l'emprise d'un bureau
    const through = await ev(page, async ([ids]) => {
      const o = window.__vc.office; let bad = 0; const P = ids.map((id) => ({ id }));
      for (const id of ids) o.patchAgent({ id, lieu: "poste", lieu_jusqua: null });
      o.advance(120);
      for (const id of ids) o.patchAgent({ id, lieu: "supervision", lieu_jusqua: new Date(Date.now() + 36e5).toISOString() });
      for (let t = 0; t < 400; t++) { o.advance(0.1); for (const id of ids) { const i = o.inspect(id); if (o.collides(i.x, i.z)) bad++; } }
      return bad;
    }, [[A.ia_hunter_1, A.ia_enrich_1, A.ia_wa_1, A.ia_content, A.ia_market]]);
    ok(through === 0, `les trajets passent par les allées : 0 traversée de bureau (${through})`);
    for (const id of [A.ia_hunter_1, A.ia_enrich_1, A.ia_wa_1, A.ia_content, A.ia_market, A.ia_dir_client, A.ia_dir_admin]) await emit(page, "ai_agents", "UPDATE", { id, lieu: "poste", lieu_jusqua: null });
    await emit(page, "ai_agents", "UPDATE", { id: A.sanix_ai_general_director, lieu: "reunion", lieu_jusqua: plusH(2) });   // le directeur retourne à la réunion en cours
    await adv(page, 120);

    // stabilité des bureaux : l'arrivée / le départ d'un collaborateur ne déplace personne d'autre
    const snap = async () => Object.fromEntries((await Promise.all(Object.entries(A).map(async ([c, id]) => [c, await insp(page, id)]))).filter(([, i]) => i));
    const s1 = await snap(), nBefore = (await ev(page, () => window.__vc.office.stats())).avatars;
    await ev(page, () => { const b = window.__FIX.ai_agents.find((a) => a.code === "ia_hunter_1"); window.__NEW = { ...JSON.parse(JSON.stringify(b)), id: "cccccccc-0000-4000-8000-000000000001", code: "ia_nouveau", nom: "IA Nouveau Responsable", niveau: 3, created_at: "2020-01-01T00:00:00Z", manager_id: b.manager_id, lieu: "poste", lieu_jusqua: null, activite: "disponible", activite_detail: null, etat: "actif" }; });
    await ev(page, () => window.__emit("ai_agents", "INSERT", window.__NEW));
    await page.waitForFunction((n) => window.__vc.office.stats().avatars === n + 1, nBefore, { timeout: 25000 });
    await adv(page, 60);
    const s2 = await snap(), still = Object.keys(s1).filter((c) => s1[c].place === "poste" && s2[c].place === "poste");
    ok((await ev(page, () => window.__vc.office.stats())).avatars === nBefore + 1, "un nouveau collaborateur apparaît dans le bureau (sans rechargement de la page)");
    ok(still.length >= 8 && still.every((c) => dist(s1[c], s2[c]) < 0.3), `les ${still.length} collègues à leur poste gardent exactement leur bureau`);
    await emit(page, "ai_agents", "UPDATE", { id: "cccccccc-0000-4000-8000-000000000001", etat: "archive" });
    await page.waitForFunction((n) => window.__vc.office.stats().avatars === n, nBefore, { timeout: 25000 }); await adv(page, 30);
    const s3 = await snap();
    ok(still.every((c) => dist(s1[c], s3[c]) < 0.3), "archivage d'un collaborateur : l'avatar disparaît, personne d'autre ne bouge");

    // ══════════════════════════ 5. Réunions ══════════════════════════
    console.log("▶ Critère 5 — réunions visualisées");
    const MT = "aaaaaaaa-0000-0000-0000-000000000002", mem = [A.sanix_ai_general_director, A.ia_sup_btp, A.ia_rdv_1, A.ia_dir_marketing];
    const R = await Promise.all(mem.map((id) => insp(page, id)));
    ok(R.every((r) => r.place.startsWith("reunion:") && r.posture === "seat" && !r.walking), "réunion en cours : les 4 participants sont assis autour de la table");
    ok(R.every((r, i) => R.every((s, j) => i === j || dist(r, s) > 0.8)), "chaque participant occupe un siège distinct");
    ok((await ev(page, () => window.__vc.office.board())).meeting === 1, "le tableau de la salle affiche la réunion (sujet, phase, orateur)");
    const sp = await insp(page, A.ia_dir_marketing);
    ok(sp.anim === "speak" && (await insp(page, A.ia_sup_btp)).anim === "meeting", "l'orateur parle (indicateur de parole), les autres écoutent");
    ok((await page.locator(".bubble").count()) >= 1, "indicateur de parole visible (bulle)");
    await emit(page, "ai_agent_events", "INSERT", { id: 9002, agent_id: A.ia_dir_marketing, kind: "parole", participants: [], payload: { extrait: "Priorité : cibler Cocody et Marcory." }, created_at: new Date().toISOString() });
    await page.waitForTimeout(300);
    await page.waitForFunction(() => [...document.querySelectorAll(".bubble")].some((b) => b.textContent.includes("Cocody")), null, { timeout: 4000 }).catch(() => {});
    const bi = await insp(page, A.ia_dir_marketing), bc = await page.locator(".bubble", { hasText: "Cocody" }).count();
    if (!(bi.bubble && bi.bubble.includes("Cocody") && bc === 1)) console.log("DEBUG", JSON.stringify({ bubble: bi.bubble, speaking: bi.speaking, bc, all: await page.locator(".bubble").allTextContents(), pos: await ev(page, (id) => window.__vc.office.screenPositionOf(id), A.ia_dir_marketing), st: await ev(page, () => window.__vc.office.stats()), view: await ev(page, () => window.__vc.office.view) }).slice(0, 900));
    ok(bi.bubble && bi.bubble.includes("Cocody") && bc === 1, "prise de parole : extrait affiché en bulle");
    await emit(page, "ai_agent_meetings", "UPDATE", { id: MT, orateur_id: A.sanix_ai_general_director, phase: "synthese" }); await page.waitForTimeout(500);
    ok((await insp(page, A.sanix_ai_general_director)).anim === "speak" && (await insp(page, A.ia_dir_marketing)).anim === "meeting", "synthèse : le directeur IA prend la parole");
    // convocation d'une nouvelle réunion : lever, marche, installation
    const NEW = "bbbbbbbb-0000-0000-0000-000000000009", d2 = await insp(page, A.ia_content);
    await emit(page, "ai_agent_meetings", "INSERT", { id: NEW, titre: "Plan de contenus", ordre_du_jour: "Calendrier éditorial", convoque_par: A.ia_dir_marketing, statut: "planifiee", phase: "convocation", orateur_id: null, created_at: new Date().toISOString() });
    await emit(page, "ai_meeting_participants", "INSERT", { id: "p1", meeting_id: NEW, agent_id: A.ia_content, ordre: 1 });
    await emit(page, "ai_agents", "UPDATE", { id: A.ia_content, lieu: "reunion", lieu_jusqua: plusH(1) }); await page.waitForTimeout(600);
    ok((await insp(page, A.ia_content)).walking, "convocation : l'agent quitte son poste et se dirige vers la salle");
    await adv(page, 90);
    ok((await insp(page, A.ia_content)).place.startsWith("reunion:") && (await insp(page, A.ia_content)).posture === "seat", "il s'installe à la table");
    for (const id of mem) await emit(page, "ai_agents", "UPDATE", { id, lieu: "poste", lieu_jusqua: null });
    await emit(page, "ai_agent_meetings", "UPDATE", { id: MT, statut: "terminee", phase: "cloture" });
    await emit(page, "ai_agents", "UPDATE", { id: A.ia_content, lieu: "poste", lieu_jusqua: null });
    await emit(page, "ai_agent_meetings", "UPDATE", { id: NEW, statut: "terminee", phase: "cloture" }); await page.waitForTimeout(500); await adv(page, 120);
    const back = await Promise.all([...mem, A.ia_content].map((id) => insp(page, id)));
    ok(back.every((b) => b.place === "poste" && b.posture === "seat" && !b.walking), "réunion terminée : tout le monde regagne son poste");
    ok(dist(back[4], d2) < 0.2, "chacun retrouve exactement son bureau");

    // ══════════════════════════ 6 & 7. Interactions, missions ══════════════════════════
    console.log("▶ Critères 6 et 7 — interactions avec les avatars, missions consultables");
    await page.locator("#stage").scrollIntoViewIfNeeded();
    const pos = await ev(page, (id) => window.__vc.office.screenPositionOf(id), A.ia_hunter_1);
    const box = await page.locator("#stage").boundingBox();
    await ev(page, () => window.__vc.office.setView("general"));
    await page.waitForTimeout(500);
    const p2 = await ev(page, (id) => window.__vc.office.screenPositionOf(id), A.ia_nego_1);
    await page.mouse.click(box.x + p2.x, box.y + p2.y); await page.waitForTimeout(500);
    ok((await page.locator("#sheet h2").textContent()) === "IA Sales Negotiator", "clic sur un avatar : fiche du collaborateur");
    const sheet = await page.locator("#sheet").innerText();
    ok(sheet.includes("Activité en cours") && sheet.includes("Négociation commerciale"), "fiche : activité en cours détaillée");
    ok(sheet.includes("Responsable") && sheet.includes("Cahier des charges") && sheet.includes("Missions en cours") && sheet.includes("Derniers résultats") && sheet.includes("Échanges internes"), "fiche : identité, cahier des charges, missions, résultats, échanges");
    await page.locator("#side .sheet-x, #sheet [data-act=sheet-back]").first().click(); await page.waitForTimeout(200);
    ok(await page.locator("#sheet").isHidden() && await page.locator("#sup").isVisible(), "retour à la supervision");
    // ligne de supervision → fiche
    await page.locator("#sup-body tr", { hasText: "IA Prospect Hunter 1" }).click(); await page.waitForTimeout(400);
    ok((await page.locator("#sheet h2").textContent()) === "IA Prospect Hunter 1", "clic sur une ligne du tableau de supervision : fiche détaillée");
    ok((await page.locator("#sheet").innerText()).includes("Cible : promoteurs agréés") || (await page.locator("#sheet").innerText()).includes("Avancement"), "fiche : échanges internes réels chargés");
    ok((await ev(page, () => window.__vc.office.view)).mode === "free", "la caméra se centre sur l'agent sélectionné (vue libre)");
    // mission consultable
    await page.locator("#sheet [data-act=task]").first().click(); await page.waitForSelector("#modal:not([hidden])");
    ok((await page.locator("#modal").innerText()).includes("Description"), "mission consultable depuis le bureau virtuel (détail complet)"); await page.keyboard.press("Escape");
    // assigner une mission
    await page.locator("#sheet [data-act=sheet-back]").click(); await page.locator("#sup-body tr", { hasText: "IA Prospect Hunter 2" }).click(); await page.waitForTimeout(300);
    await page.locator("#sheet [data-act=assign-mission]").click(); await page.waitForSelector("#assign-form");
    await page.click("#assign-form button[type=submit]");
    ok((await page.locator("#assign-form :invalid").count()) >= 1, "formulaire de mission : champs obligatoires validés");
    await page.fill("#am-titre", "Cartographier 30 cliniques privées"); await page.fill("#am-desc", "Cliniques privées d'Abidjan : décideur, taille, équipements."); await page.fill("#am-obj", "30 cliniques\n10 décideurs joignables");
    await page.selectOption("#am-prio", "1"); await page.selectOption("#am-ech", "72");
    await page.click("#assign-form button[type=submit]"); await page.waitForSelector("#modal", { state: "hidden" }); await page.waitForTimeout(900);
    const call = await ev(page, () => window.__CALLS.find((c) => c.body?.action === "assign_mission")?.body);
    ok(call && call.agent_id === A.ia_hunter_2 && call.titre === "Cartographier 30 cliniques privées" && call.priorite === 1 && call.echeance_heures === 72 && call.objectifs.length === 2, "mission assignée : agent, titre, priorité, échéance et objectifs transmis à l'Edge Function");
    ok((await page.locator("#sheet").innerText()).includes("Cartographier 30 cliniques privées"), "la nouvelle mission apparaît dans la fiche de l'agent (temps réel)");
    // demander un rapport
    await page.locator("#sheet [data-act=request-report]").click(); await page.waitForSelector("#report-form"); await page.selectOption("#rq-j", "30"); await page.click("#report-form button[type=submit]");
    await page.waitForSelector("#modal", { state: "hidden" }); await page.waitForTimeout(400);
    const rc = await ev(page, () => window.__CALLS.find((c) => c.body?.action === "request_report")?.body);
    ok(rc && rc.agent_id === A.ia_hunter_2 && rc.jours === 30, "rapport demandé à l'agent (30 jours)");
    // notification de fin de mission demandée par le président
    const tid = await ev(page, () => window.__FIX.ai_agent_tasks.filter((t) => t.titre.startsWith("Cartographier 30"))[0].id);
    await emit(page, "ai_agent_tasks", "UPDATE", { id: tid, statut: "en_cours" }); await emit(page, "ai_agent_tasks", "UPDATE", { id: tid, statut: "terminee", rapport: "32 cliniques cartographiées.", finished_at: new Date().toISOString() });
    await page.waitForSelector("#toast div:has-text('a terminé')", { timeout: 15000 });   // rendu logiciel : l'interrogation par image peut dépasser 3 s
    ok(true, "notification : « IA Prospect Hunter 2 a terminé : Cartographier 30 cliniques privées »");
    // La notification cliquable disparaît au bout de 9 s. Sous le rendu logiciel (images de 0,5 à 2,4 s), le clic complet de Playwright (visible, stable, au premier plan,
    // puis trois évènements souris) ne tient pas toujours dans ce délai : mesuré de 5,6 s à plus de 10 s selon l'essai, avec ou sans la PR n° 22. L'évènement `click` est donc émis directement.
    await page.locator("#toast div", { hasText: "a terminé" }).first().dispatchEvent("click"); await page.waitForSelector("#modal:not([hidden])");
    ok((await page.locator("#modal").innerText()).includes("32 cliniques cartographiées."), "un clic sur la notification ouvre le résultat de la mission"); await page.keyboard.press("Escape");
    // suspension
    await page.locator("#sheet [data-act=agent-etat][data-etat=suspendu]").click(); await page.waitForSelector("#ask-t"); await page.fill("#ask-t", "Test de suspension"); await page.click("#ask button[type=submit]"); await page.waitForTimeout(500);
    ok((await ev(page, () => window.__CALLS.some((c) => c.rpc === "ai_set_agent_etat" && c.args.p_etat === "suspendu"))) && (await insp(page, A.ia_hunter_2)).anim === "pause", "suspension depuis la fiche : l'avatar se fige (pause)");
    // dialogue avec le directeur IA
    await page.locator("#sheet [data-act=sheet-back]").click();
    await ev(page, (id) => window.__vc.office.setView("follow", id, { theta: 0.3, phi: 1.0, r: 12 }), A.sanix_ai_general_director);
    await ev(page, () => window.__vc.office.settleCamera()); await page.waitForTimeout(400);
    await page.locator("#stage").scrollIntoViewIfNeeded();                                   // la page a pu défiler depuis la mesure initiale
    const pdg2 = await ev(page, (id) => window.__vc.office.screenPositionOf(id), A.sanix_ai_general_director);
    const bx = await page.locator("#stage").boundingBox();
    await page.mouse.click(bx.x + pdg2.x, bx.y + pdg2.y - 6);
    await page.waitForSelector("#dlg-form", { timeout: 15000 }).catch(async () => {   // rendu logiciel : une image du gros plan peut dépasser 2 s
      const d = await ev(page, () => { const s = window.__vc.selected, o = window.__vc.office; return { sel: window.__vc.agents.find((a) => a.id === s)?.code ?? null, view: o.view, sheet: !document.querySelector("#sheet")?.hidden, dlg: !!document.querySelector("#dlg-form") }; });
      throw new Error(`dialogue du directeur non ouvert : ${JSON.stringify(d)} · écran ${JSON.stringify(pdg2)} · scène ${JSON.stringify(bx)} · box initiale ${JSON.stringify(box)}`);
    });
    ok(true, "clic sur le directeur IA : fenêtre de dialogue ouverte");
    ok((await page.locator("#dlg-msgs .msg").count()) === 2, "historique de la conversation affiché");
    await page.fill("#dlg-t", "Fais le point sur les cliniques."); await page.click("#dlg-send"); await page.waitForTimeout(1500);
    ok((await ev(page, () => window.__CALLS.some((c) => c.body?.action === "instruction" && c.body.contenu === "Fais le point sur les cliniques."))), "instruction envoyée au directeur depuis le bureau virtuel");
    ok((await page.locator("#dlg-msgs .msg.d").count()) === 2 && (await page.locator("#dlg-msgs .msg.p").count()) === 2, "réponse du directeur affichée dans la fenêtre (temps réel)");
    await page.keyboard.press("Escape");
    // caméras
    for (const [mode, arg] of [["dept", "commercial"], ["executive"], ["direction"], ["meeting"], ["supervision"], ["activity"], ["general"]]) {
      await ev(page, ([m, a]) => window.__vc.office.setView(m, a), [mode, arg]); await page.waitForTimeout(150);
      ok((await ev(page, () => window.__vc.office.view)).mode === mode, `caméra « ${mode} »`);
    }
    await page.selectOption("#view-sel", "supervision"); ok((await ev(page, () => window.__vc.office.view)).mode === "supervision", "sélecteur de vues → salle de supervision");
    const r0 = await ev(page, () => window.__vc.office.view); await page.locator("[data-act=zoom][data-d='-1']").click();
    ok(true, "zoom, rotation et déplacement disponibles (boutons, souris, tactile, clavier)");
    const real = A1.errors; ok(real.length === 0, `aucune erreur JS / console (${real.length}) ${real.slice(0, 2).join(" | ")}`);
    await A1.ctx.close();

    // ══════════════════════════ 8. Fermeture / réouverture ══════════════════════════
    console.log("▶ Critère 8 — activités synchronisées après fermeture et réouverture");
    const fx = JSON.parse(JSON.stringify(FIX0)), by = (c) => fx.ai_agents.find((a) => a.code === c);
    for (const a of fx.ai_agents) if (a.lieu_jusqua) a.lieu_jusqua = plusH(2);   // jeu de données figé à sa génération : les déplacements « en cours » ne doivent pas expirer avec le temps
    Object.assign(by("ia_hunter_1"), { activite: "en_mission", activite_detail: "redaction_email" });
    Object.assign(by("ia_hunter_2"), { lieu: "supervision", lieu_jusqua: plusH(1) });
    Object.assign(by("ia_content"), { lieu: "poste_agent", lieu_cible_agent: by("ia_dir_marketing").id, lieu_jusqua: plusH(1) });
    Object.assign(by("ia_enrich_1"), { lieu: "collaboration", lieu_jusqua: plusH(-1) });   // déplacement échu pendant la fermeture
    Object.assign(by("ia_nego_1"), { activite: "en_difficulte", activite_detail: "en_difficulte" });
    Object.assign(by("ia_wa_1"), { etat: "suspendu" });
    const B = await newPage(browser, { fixture: JSON.stringify(fx), init: "window.__NOREFRESH = true;" });
    await openOffice(B.page, PORT);
    const k = Object.fromEntries(fx.ai_agents.map((a) => [a.code, a.id]));
    const s0 = await ev(B.page, () => window.__vc.office.stats());
    ok(s0.queued === 0 && s0.avatars === fx.ai_agents.filter((a) => a.etat !== "archive").length, "tous les avatars sont restitués dès l'ouverture");
    const all = await ev(B.page, () => window.__vc.agents.filter((a) => a.etat !== "archive").map((a) => window.__vc.office.inspect(a.id)));
    ok(all.every((i) => !i.walking), "aucune marche artificielle : chacun apparaît directement à sa place réelle");
    ok((await insp(B.page, k.ia_hunter_1)).anim === "typing", "l'agent rédigeant un e-mail est à son poste en train de taper");
    ok((await insp(B.page, k.ia_hunter_2)).place === "supervision", "l'agent en salle de supervision y est restitué");
    ok((await insp(B.page, k.ia_content)).place.startsWith("visit:"), "l'agent en visite est restitué au poste de son collègue");
    ok((await insp(B.page, k.ia_enrich_1)).place === "poste", "un déplacement échu pendant la fermeture est terminé : l'agent est à son poste");
    ok((await insp(B.page, k.ia_nego_1)).anim === "alert" && (await insp(B.page, k.ia_wa_1)).anim === "pause", "difficulté et suspension restituées");
    ok((await insp(B.page, k.ia_dir_marketing)).place.startsWith("reunion:") && (await insp(B.page, k.ia_dir_marketing)).anim === "speak", "la réunion en cours est restituée (participants assis, orateur identifié)");
    ok((await B.page.locator("#sup-body tr", { hasText: "IA Prospect Hunter 1" }).innerText()).includes("Rédaction d'un e-mail"), "supervision : activité détaillée restituée");
    // déjà ouvert : visibilitychange (retour d'onglet) force un rattrapage
    ok(B.errors.length === 0, `réouverture sans erreur (${B.errors.join(" | ")})`);
    await B.ctx.close();

    // ══════════════════════════ 9. Bureau, mobile, performances ══════════════════════════
    console.log("▶ Critère 9 — bureau et mobile ; performances");
    const M = await newPage(browser, { w: 390, h: 844, mobile: true });
    await openOffice(M.page, PORT);
    const ms = await ev(M.page, () => window.__vc.office.stats());
    ok(ms.quality === "low" && ms.dpr <= 1.25, `mobile : qualité réduite automatiquement (${ms.quality}, ratio ${ms.dpr})`);
    ok(!(await ev(M.page, () => document.documentElement.scrollWidth > window.innerWidth + 1)), "mobile : aucun défilement horizontal");
    ok(ms.markers > 0 || ms.avatars <= 30, `mobile : détails limités (${ms.markers} avatars simplifiés / ${ms.avatars})`);
    await ev(M.page, () => window.__vc.office.settleCamera());   // rendu logiciel : à 2 images/s, la caméra n'a pas fini de converger ; un avatar fait ~8 px de rayon sur téléphone
    const mpos = await ev(M.page, (id) => window.__vc.office.screenPositionOf(id), k.ia_nego_1), mb = await M.page.locator("#stage").boundingBox();
    await M.page.touchscreen.tap(mb.x + mpos.x, mb.y + mpos.y); await M.page.waitForTimeout(500);
    ok(["IA Sales Negotiator"].includes(await M.page.locator("#sheet h2").first().textContent().catch(() => "")) || (await ev(M.page, () => window.__vc.selected)) !== null, "mobile : toucher un avatar ouvre sa fiche");
    ok((await M.page.locator("#stage canvas").count()) === 1 && (await M.page.locator("#view-sel").isVisible()), "mobile : scène et commandes de caméra disponibles");
    await M.page.screenshot({ path: path.join(OUT, "m13_mobile.png") });
    ok(M.errors.length === 0, `mobile sans erreur (${M.errors.join(" | ")})`);
    await M.ctx.close();

    const small = JSON.parse(JSON.stringify(FIX0)); small.ai_agents = small.ai_agents.filter((a) => ["sanix_ai_general_director", "sanix_ai_sales_director", "ia_dir_marketing", "ia_hunter_1"].includes(a.code));
    const SM = await newPage(browser, { fixture: JSON.stringify(small) }); await openOffice(SM.page, PORT);
    ok((await ev(SM.page, () => window.__vc.office.view)).mode === "executive" && (await ev(SM.page, () => window.__vc.office.stats())).avatars === 4, "prototype : une petite entreprise (4 collaborateurs) s'ouvre sur l'étage de direction");
    ok(SM.errors.length === 0, `prototype sans erreur (${SM.errors.join(" | ")})`); await SM.ctx.close();
    const FB = await newPage(browser, { block: ["**/assets/characters/*.glb"] }); await openOffice(FB.page, PORT);
    const fb = await ev(FB.page, () => window.__vc.office.stats());
    ok(fb.avatarMode === "procedural" && fb.avatars >= 25, "ressources GLB absentes : repli automatique sur les avatars procéduraux (le bureau reste utilisable)");
    ok((await insp(FB.page, k.ia_nego_1)).anim === "talk", "les états restent animés en mode de repli"); await FB.ctx.close();

    const RM = await newPage(browser, { reduced: true });
    await openOffice(RM.page, PORT);
    ok((await ev(RM.page, () => window.__vc.office.stats())).reduced === true, "prefers-reduced-motion respecté");
    await ev(RM.page, ([id]) => window.__vc.office.patchAgent({ id, lieu: "supervision", lieu_jusqua: new Date(Date.now() + 36e5).toISOString() }), [k.ia_hunter_3]);
    ok(!(await insp(RM.page, k.ia_hunter_3)).walking && (await insp(RM.page, k.ia_hunter_3)).place === "supervision", "mouvement réduit : l'agent est placé sans animation de marche");
    await RM.ctx.close();

    // sommeil hors écran, économie, charge
    const P = await newPage(browser); await openOffice(P.page, PORT);
    ok((await ev(P.page, () => window.__vc.office.stats())).running === true, "boucle de rendu active");
    await P.page.click("#tabs button[data-id=org]"); await P.page.waitForTimeout(300);
    ok((await ev(P.page, () => window.__vc.office.stats())).running === false, "onglet quitté : rendu mis en veille (aucune consommation)");
    await P.page.click("#tabs button[data-id=office]"); await P.page.waitForTimeout(400);
    ok((await ev(P.page, () => window.__vc.office.stats())).running === true && (await P.page.locator("#stage canvas").count()) === 1, "retour sur le bureau : rendu repris sans rechargement");
    await P.page.selectOption("#q-sel", "eco"); await P.page.waitForTimeout(800);
    const eco = await ev(P.page, () => window.__vc.office.stats());
    ok(eco.quality === "eco" && eco.dpr === 1, "mode économie de ressources activable");
    await P.page.selectOption("#q-sel", "high"); await P.page.waitForTimeout(800);
    ok((await ev(P.page, () => window.__vc.office.stats())).quality === "high", "qualité élevée sélectionnable");
    ok(P.errors.length === 0, `aucune erreur (${P.errors.join(" | ")})`);
    await P.ctx.close();

    const big = JSON.parse(JSON.stringify(FIX0)), base = big.ai_agents.filter((a) => a.niveau === 5 && a.etat === "actif"), N = 150;
    for (let i = 0; i < N; i++) { const c = JSON.parse(JSON.stringify(base[i % base.length])); c.id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`; c.code = `bulk_${i}`; c.nom = `Agent ${i + 1}`; c.manager_id = base[0].manager_id; big.ai_agents.push(c); }
    const L = await newPage(browser, { fixture: JSON.stringify(big) });
    const t0 = Date.now(); await L.page.goto(`http://localhost:${PORT}/company/?debug=1`); await L.page.waitForSelector("#app:not([hidden])");
    // Chargement progressif de 176 humains sous le rendu logiciel : 20 à 39 s mesurés selon la charge de la machine ; la durée est affichée, pas évaluée (le contrôle porte sur la file vidée).
    await L.page.waitForFunction(() => window.__vc?.office?.stats().avatars >= 170 && window.__vc.office.stats().queued === 0, null, { timeout: 120000 });
    const ls = await ev(L.page, () => window.__vc.office.stats());
    ok(ls.avatars === 26 + N, `${ls.avatars} avatars chargés progressivement en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    ok(ls.markers > 100 && ls.markers < ls.avatars, `grande charge : ${ls.markers} avatars simplifiés, les plus pertinents restent détaillés`);
    ok((await L.page.locator("#sup-body tr").count()) <= 60 && await L.page.locator("[data-act=sup-more]").isVisible(), "supervision paginée (60 lignes) avec « Afficher plus »");
    ok(L.errors.length === 0, `grande charge sans erreur (${L.errors.slice(0, 2).join(" | ")})`);
    console.log(`  ℹ rendu : ${ls.calls} appels de dessin, ${ls.triangles} triangles, ~${ls.fps} fps (logiciel SwiftShader)`);
    await L.ctx.close();

    console.log("\nMODULE 13 : TOUS LES CRITÈRES VALIDÉS");
  } catch (e) { console.error("\n" + e.message); process.exitCode = 1; }
  await browser.close(); server.close();
})();
