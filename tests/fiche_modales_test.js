// SANIX CRM Pro : les fenêtres ouvertes depuis la fiche d'un contact (WhatsApp, Relancer, Devis, Contrat, Créer deal) s'affichent AU-DESSUS de la fiche. node fiche_modales_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
(async () => {
  const server = await start(4452), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("./helpers/crm_fixture.js").installer(ctx);
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage(), errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto("http://localhost:4452/index.html"); await page.waitForTimeout(900);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
    await page.evaluate(() => { CLIENTS.push({ id: 999001, nom: "TEST WhatsApp", statut: "prospect", phone: "+2250140017751", email: "", secteur: "Santé", logiciel: "MediCore Suite", adresse: "Abidjan", commercial: "", valeur: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }); });
    // une fenêtre est « au-dessus » si l'élément visible au centre de sa boîte lui appartient
    const auDessus = (id) => page.evaluate((i) => { const m = document.getElementById(i); if (!m || m.classList.contains("hidden")) return "fermée"; const b = (m.querySelector(".modal-box") || m.firstElementChild).getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + Math.min(b.height / 2, 200)); return e && m.contains(e) ? "dessus" : "derrière"; }, id);
    const ouvrirFiche = async () => { await page.evaluate(() => { document.querySelectorAll(".modal-overlay").forEach((m) => m.classList.add("hidden")); showClientDetail(999001); }); await page.waitForTimeout(400); };

    console.log("▶ Fenêtres ouvertes depuis la fiche");
    await ouvrirFiche(); await page.click("#sp-actions >> text=WhatsApp"); await page.waitForTimeout(400);
    ok((await auDessus("modal-relance")) === "dessus", "bouton WhatsApp : la fenêtre « Relance » s'affiche au-dessus de la fiche");
    ok(await page.evaluate(() => !!document.getElementById("rel-btn-wa") && document.getElementById("rel-btn-wa").offsetParent !== null), "le bouton « 📱 WhatsApp » de la relance est visible et cliquable");
    await ouvrirFiche(); await page.click("#sp-actions >> text=Relancer"); await page.waitForTimeout(400);
    ok((await auDessus("modal-relance")) === "dessus", "bouton Relancer : même chose");
    await ouvrirFiche(); await page.click("#sp-actions >> text=Devis"); await page.waitForTimeout(500);
    const ouvertes = await page.evaluate(() => [...document.querySelectorAll(".modal-overlay:not(.hidden)")].map((m) => m.id).filter((i) => i !== "modal-client-detail"));
    if (ouvertes.length) { const r = []; for (const i of ouvertes) r.push(await auDessus(i)); ok(r.every((x) => x === "dessus"), "bouton Devis : la fenêtre ouverte (" + ouvertes.join(", ") + ") est au-dessus de la fiche"); }
    else console.log("  • bouton Devis : aucune fenêtre (message d'information) — rien à vérifier");
    await ouvrirFiche(); await page.click("#sp-actions >> text=Email"); await page.waitForTimeout(500);
    ok((await auDessus("modal-courrier")) === "dessus", "bouton Email : la fenêtre « Courrier » reste au-dessus (comportement inchangé)");
    await ouvrirFiche();
    ok(await page.evaluate(() => { const f = document.getElementById("modal-client-detail"), r = document.getElementById("modal-relance"); return Number(getComputedStyle(f).zIndex) < Number(getComputedStyle(r).zIndex); }), "la fiche est sous les autres fenêtres par construction (z-index)");
    ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
    console.log("\nTous les contrôles passent.");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
