// Téléphone : les tableaux de l'onglet Commercial deviennent des cartes lisibles, sans colonne coupée. node tableaux_mobile_test.js
const { launch, newPage, ok } = require("./harness.js");
(async () => {
  const { server, browser } = await launch(4180);
  try {
    for (const [w, label] of [[390, "390 px"], [360, "360 px"]]) {
      const { page, errors } = await newPage(browser, { w, h: 800, mobile: true });
      await page.goto("http://localhost:4180/company/"); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(600);
      await page.click("#tabs button[data-id=sales]"); await page.waitForTimeout(500);
      console.log("▶ Commercial à " + label);
      ok((await page.locator("table.tbl[data-etiquete]").count()) > 0, "tableau étiqueté pour le mobile");
      const r = await page.evaluate(() => {
        const t = document.querySelector("table.tbl[data-etiquete]"), row = t.querySelector("tbody tr"), td = row.querySelector("td[data-label]");
        const b = row.getBoundingClientRect();
        return { thHidden: getComputedStyle(t.querySelector("thead")).display === "none", left: Math.round(b.left), right: Math.round(b.right), vw: innerWidth, label: td?.dataset.label, before: getComputedStyle(td, "::before").content, sw: document.documentElement.scrollWidth };
      });
      ok(r.thHidden, "en-têtes masqués, intitulés repris dans chaque cellule (« " + r.label + " »)");
      ok(r.left >= 0 && r.right <= r.vw, `la carte tient dans l'écran (${r.left}→${r.right} / ${r.vw})`);
      ok(r.sw <= r.vw + 1, "aucun défilement horizontal de la page");
      ok(errors.length === 0, "aucune erreur (" + errors.join(" | ") + ")"); await page.close();
    }
    const { page } = await newPage(browser, { w: 1440, h: 900 });
    await page.goto("http://localhost:4180/company/"); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(500);
    await page.click("#tabs button[data-id=sales]"); await page.waitForTimeout(500);
    ok(await page.evaluate(() => getComputedStyle(document.querySelector("table.tbl thead")).display !== "none"), "ordinateur : tableau classique conservé");
  } finally { await browser.close(); server.close(); }
  console.log("\nTOUT EST OK");
})().catch((e) => { console.error(e.message); process.exit(1); });
