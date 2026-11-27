// Fiche prospect : bouton « Plein écran » (ouverture, sortie par le bouton et par Échap, maintien après rafraîchissement). node company/tests/fiche_plein_ecran_test.js
const { launch, newPage, ok } = require("./harness.js");
const OUT = process.env.SHOT_DIR || null;
(async () => {
  const { server, browser, port } = await launch(4309);
  try {
    for (const [name, w, h, mobile] of [["bureau", 1366, 768, false], ["mobile", 360, 780, true]]) {
      const { page, errors } = await newPage(browser, { w, h, mobile });
      await page.goto(`http://localhost:${port}/company/live.html?debug=1&fast=1`); await page.waitForSelector("#live:not([hidden])"); await page.waitForTimeout(2200);
      console.log(`▶ ${name} ${w}×${h}`);
      await page.evaluate(() => { const L = window.__live; L.D.prospectSel = { id: "p-test", entreprise: "CADIC HOME DEVELOPPEMENT", ville: "Cocody", stage: "premier_contact", secteur: "Immobilier", email: "infos@cadicgroup.com", telephone: "0707000001", score: 54, budget_estime: 4000000, produits_recommandes: ["immosuite"], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; document.querySelector("#detail").hidden = false; L.renderDetail(); });
      await page.waitForSelector("#prospect-fullscreen");
      ok(await page.locator("#prospect-fullscreen").isVisible(), "bouton « Plein écran » présent dans la fiche");
      const box0 = await page.evaluate(() => { const b = document.querySelector("#detail").getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; });
      await page.click("#prospect-fullscreen"); await page.waitForTimeout(200);
      const r = await page.evaluate(() => { const e = document.querySelector("#detail"), b = e.getBoundingClientRect(); return { full: e.classList.contains("prospect-full"), w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.left), y: Math.round(b.top), label: document.querySelector("#prospect-fullscreen").textContent, vw: innerWidth, vh: innerHeight }; });
      ok(r.full && r.h >= r.vh - 2 && r.y === 0, `plein écran : fiche sur toute la hauteur (${box0.join("×")} → ${r.w}×${r.h}) : ${r.label}`);
      if (OUT) await page.screenshot({ path: `${OUT}/fiche_${name}.png` });
      await page.evaluate(() => window.__live.renderDetail()); await page.waitForTimeout(100);
      ok(await page.evaluate(() => document.querySelector("#detail").classList.contains("prospect-full")), "maintenu après un rafraîchissement de la fiche");
      await page.keyboard.press("Escape"); await page.waitForTimeout(150);
      ok(!(await page.evaluate(() => document.querySelector("#detail").classList.contains("prospect-full"))), "Échap : sortie du plein écran");
      await page.click("#prospect-fullscreen"); await page.click("#prospect-fullscreen"); await page.waitForTimeout(100);
      ok(!(await page.evaluate(() => document.querySelector("#detail").classList.contains("prospect-full"))), "le bouton bascule");
      await page.click("#prospect-fullscreen"); await page.click("#prospect-detail-close"); await page.waitForTimeout(150);
      ok(await page.evaluate(() => !document.querySelector("#detail").classList.contains("prospect-full") && !document.body.classList.contains("prospect-full-open")), "fermer la fiche quitte le plein écran");
      ok(errors.filter((e) => !/favicon|Failed to load resource/.test(e)).length === 0, "aucune erreur console : " + errors.slice(0, 2).join(" | "));
      await page.context().close();
    }
  } finally { await browser.close(); server.close?.(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
