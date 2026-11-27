// SANIX CRM Pro : module Terrain (feuille de route, arrivée GPS, résultat → fiche prospect, supervision, performance). node tests/terrain_e2e_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4434), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, geolocation: { latitude: 5.3, longitude: -4.0, accuracy: 15 }, permissions: ["geolocation"] });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = [], appels = [];
    page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4434/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    // Session opérateur et API simulées (le vrai serveur est testé en SQL : terrain_sql_test.sh)
    await page.evaluate(() => {
      const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
      const jwt = "x." + b64({ sub: "00000000-0000-0000-0000-0000000000c1" }) + ".y";
      aisSession = () => ({ t: jwt, exp: Date.now() + 3e6, email: "awa@test" });
      window.__appels = []; let etat = "planifiee";
      const T = () => ({ id: "t1", commercial: "00000000-0000-0000-0000-0000000000c1", nom: "Awa", jour: new Date().toISOString().slice(0, 10), titre: "Marcory matin", zone: "Marcory", statut: etat, rapport: null,
        etapes: [{ id: "e1", ordre: 1, client_rid: "95001", nom: "Garage Alpha", adresse: "Marcory", lat: 5.3, lng: -4.0, statut: "a_visiter" }, { id: "e2", ordre: 2, client_rid: "95002", nom: "Hôtel Beta", adresse: "Zone 4", lat: null, lng: null, statut: "a_visiter" }] });
      window.aisApi = async (path, opt) => {
        const n = path.split("/").pop().split("?")[0], a = opt && opt.body ? JSON.parse(opt.body) : {}; window.__appels.push([n, a]);
        if (n === "terrain_profils") return [{ user_id: "x", mobilite: "moto", geoloc_consent_at: "2026-11-01T00:00:00Z", objectif_visites_jour: 8 }];
        if (n === "terrain_equipe") throw new Error("Réservé à la direction");
        if (n === "terrain_feuille") return [T()];
        if (n === "terrain_demarrer") { etat = "en_cours"; return { ok: true }; }
        if (n === "terrain_position") return { ok: true };
        if (n === "terrain_arrivee") return { ok: true, presence_verifiee: true, distance_m: 4, position_prospect_fixee: false };
        if (n === "terrain_resultat") return { ok: true, client_rid: "95001", nom: "Garage Alpha", statut: a.p_statut, issue: a.p_issue, presence_verifiee: true };
        if (n === "terrain_kpi") return [{ commercial: "c1", nom: "Awa", mobilite: "moto", objectif: 8, tournees: 2, terminees: 2, etapes: 10, visites: 8, absents: 1, refus: 1, rdv: 3, devis: 1, ventes: 1, valeur_fcfa: 900000, km: 14.2, jours_actifs: 2, visites_par_jour: 4, duree_visite_min: 22, presence_pct: 88, taux_realisation_pct: 80, score: 72 }];
        return {};
      };
      CLIENTS.push({ id: 95001, nom: "Garage Alpha", statut: "prospect", ville: "Marcory", phone: "0701020304", logiciel: "SANIX CRM Pro", interactions: [] });
      navigate("terrain", null);
    });
    await page.waitForTimeout(700);
    const txt = () => page.evaluate(() => document.getElementById("view-terrain").innerText.replace(/\s+/g, " "));
    console.log("▶ Entrée directe du menu");
    await page.evaluate(() => navigate("dashboard", null)); await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.getElementById("view-terrain").classList.contains("hidden")), "hors Terrain : écran masqué");
    await page.evaluate(() => document.getElementById("sb-terrain-item").click()); await page.waitForTimeout(600);
    ok(await page.evaluate(() => !document.getElementById("view-terrain").classList.contains("hidden") && document.getElementById("sb-terrain-item").classList.contains("active")), "« Prospection terrain » ouvre Terrain et s'allume");
    ok(await page.evaluate(() => !document.querySelector('.sb-item[data-grp="trouver"]').classList.contains("active")), "le groupe « Prospects & Clients » ne s'allume pas en double");
    console.log("▶ Ma journée");
    let t = await txt();
    ok(t.includes("Marcory matin") && t.includes("Garage Alpha") && t.includes("Hôtel Beta") && t.includes("non géolocalisé"), "feuille de route : tournée et prospects, dont un non géolocalisé");
    ok(!t.includes("Supervision"), "commercial : pas d'onglet Supervision");
    ok(t.includes("Démarrer la tournée") && !t.includes("Je suis arrivé"), "avant le départ : bouton Démarrer seulement");
    await page.click("#view-terrain button:has-text(\"Démarrer la tournée\")"); await page.waitForTimeout(700);
    ok(await page.evaluate(() => __appels.some((a) => a[0] === "terrain_demarrer")), "démarrage appelé côté serveur");
    t = await txt();
    ok(t.includes("Position partagée avec la direction") && t.includes("Je suis arrivé"), "en cours : bandeau de suivi et actions d'arrivée");
    await page.waitForTimeout(800);
    ok(await page.evaluate(() => __appels.some((a) => a[0] === "terrain_position" && Math.abs(a[1].p_lat - 5.3) < 0.01)), "position GPS transmise pendant la tournée");
    await page.evaluate(() => { }); await page.click("#view-terrain button:has-text(\"Je suis arrivé\") >> nth=0"); await page.waitForTimeout(2500); 
    ok(await page.evaluate(() => __appels.some((a) => a[0] === "terrain_arrivee" && a[1].p_etape === "e1" && a[1].p_precision === 15)), "arrivée : position et précision envoyées");
    await page.click("#view-terrain button:has-text(\"Résultat\") >> nth=0"); await page.waitForTimeout(300);
    await page.selectOption("#tr-issue", "devis"); await page.fill("#tr-val", "450000"); await page.fill("#tr-note", "Décideur rencontré, devis demandé");
    await page.click("#tr-modale button:has-text(\"Enregistrer\")"); await page.waitForTimeout(700);
    ok(await page.evaluate(() => __appels.some((a) => a[0] === "terrain_resultat" && a[1].p_issue === "devis" && a[1].p_valeur === 450000)), "résultat envoyé avec issue et montant");
    const inter = await page.evaluate(() => CLIENTS.find((c) => c.id === 95001).interactions.map((i) => i.type + "|" + i.note));
    ok(inter.some((x) => x.startsWith("Visite terrain|") && x.includes("Devis demandé")), "interaction « Visite terrain » ajoutée à la fiche du prospect en base");
    console.log("▶ Installation par QR code");
    await page.click("#view-terrain button:has-text(\"QR code\")"); await page.waitForTimeout(400);
    ok(await page.evaluate(() => !!document.querySelector("#tr-qr svg")), "QR code affiché");
    ok(await page.evaluate(() => document.getElementById("tr-modale").innerText.includes("?page=terrain&source=qr")), "le QR ouvre l'écran Terrain (page=terrain)");
    ok(await page.evaluate(() => [...document.querySelectorAll("#tr-modale a")].some((a) => a.href.startsWith("https://wa.me/?text="))), "partage WhatsApp du lien");
    await page.click("#tr-modale button:has-text(\"Fermer\")"); await page.waitForTimeout(200);
    console.log("▶ Performance");
    await page.click("#view-terrain button:has-text(\"Performance\")"); await page.waitForTimeout(600);
    t = await txt();
    ok(t.includes("Awa") && t.includes("72") && t.includes("Présence vérifiée : 88 %") && t.includes("Visites/jour : 4"), "indicateurs du commercial et score");
    ok(!t.includes("Export Excel"), "export réservé à la direction");
    console.log("▶ Planification depuis la base");
    await page.click("#view-terrain button:has-text(\"Ma journée\")"); await page.waitForTimeout(400);
    await page.evaluate(() => { document.getElementById("view-terrain").querySelector("[onclick*=formulairePlanif]").click(); }); await page.waitForTimeout(900);
    ok(await page.evaluate(() => document.querySelectorAll("#tp-liste input[type=checkbox]").length) > 0, "liste des prospects de la base proposée");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors[0] : ""));
    console.log("OK");
  } finally { await browser.close(); server.close && server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
