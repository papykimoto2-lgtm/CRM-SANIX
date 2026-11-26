// Salle de contrôle épurée : scène lisible (panneaux à la demande, aucun chevauchement), accordéon à droite, Jarvis compact. node company/tests/live_epure_test.js
const { launch, newPage, ok } = require("./harness.js");
const box = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.hidden || getComputedStyle(e).display === "none") return null; const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; }, sel);
(async () => {
  const { server, browser, port } = await launch(4305);
  try {
    for (const [w, h] of [[1366, 768], [1093, 614]]) {
      const { page, errors } = await newPage(browser, { w, h });
      await page.goto(`http://localhost:${port}/company/live.html?debug=1&fast=1`); await page.waitForSelector("#live:not([hidden])"); await page.waitForTimeout(2200);
      console.log(`▶ ${w}×${h}`);
      ok(!(await box(page, "#workflow-panel")) && !(await box(page, "#workfloor-panel")), "scène libre : panneaux Workflow et Opérations fermés par défaut");
      ok(!!(await box(page, "#ov-bar")), "barre de panneaux (Workflow, Opérations, Légende) présente");
      const acc = await page.evaluate(() => ["business-panel", "finance-panel", "whatsapp-panel", "performance-panel", "ops-panel", "bi-panel", "forecast-panel", "executive-panel"].map((id) => document.getElementById(id).classList.contains("collapsed")));
      ok(acc.every(Boolean), "panneaux de droite repliés par défaut (accordéon)");
      await page.evaluate(() => document.querySelector("#business-panel .panel-head").click()); await page.waitForTimeout(150);
      ok(!(await page.evaluate(() => document.getElementById("business-panel").classList.contains("collapsed"))), "clic sur l'en-tête : panneau déplié");
      await page.click("[data-c=focus]"); await page.waitForTimeout(400); await page.click("[data-c=relations]"); await page.waitForTimeout(1000);
      const f = await box(page, "#relations-filters"), cv = await box(page, "#relations-canvas");
      ok(f && cv && cv.t >= f.b - 1, `réseau relationnel sous les filtres (${Math.round(f.b)} ≤ ${Math.round(cv.t)}) : aucun agent masqué`);
      await page.click("[data-ov=workfloor]"); await page.waitForTimeout(300);
      const o = await box(page, "#workfloor-panel"), bar = await box(page, "#ov-bar");
      ok(o && o.t >= f.b - 1, "panneau Opérations ouvert sous les filtres, sans les recouvrir");
      ok(!(await box(page, "#workflow-panel")), "un seul panneau ouvert à la fois");
      await page.keyboard.press("Escape"); await page.waitForTimeout(150);
      ok(!(await box(page, "#workfloor-panel")), "Échap ferme le panneau");
      const lines = await page.evaluate(() => [...document.querySelectorAll("#jv-log .ln")].filter((e) => getComputedStyle(e).display !== "none").length);
      ok(lines <= 1, "Jarvis : un seul message visible au repos (" + lines + ")");
      ok(!(await box(page, ".legend")) && !(await box(page, "#relations-legend")), "légendes masquées jusqu'à la demande");
      await page.click("[data-ov=legend]"); await page.waitForTimeout(200);
      ok(!!(await box(page, "#relations-legend")), "bouton Légende : légende affichée");
      ok(errors.length === 0, "aucune erreur JavaScript (" + errors.join(" | ").slice(0, 120) + ")"); await page.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log("\nTOUT EST OK");
})().catch((e) => { console.error(e.message); process.exit(1); });
