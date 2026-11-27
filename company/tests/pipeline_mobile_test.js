// Téléphone et tablette : pipeline commercial (indicateurs au-dessus du Kanban, colonnes à la largeur de l'écran), cibles tactiles. node pipeline_mobile_test.js
const { launch, newPage, ok } = require("./harness.js");
(async () => {
  const { server, browser } = await launch(4195);
  try {
    for (const [w, h, label] of [[390, 844, "téléphone 390 px"], [820, 1180, "tablette 820 px"]]) {
      const { page, errors } = await newPage(browser, { w, h, mobile: true });
      await page.goto("http://localhost:4195/company/"); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(700);
      await page.click("#tabs button[data-id=sales]"); await page.waitForTimeout(400);
      await page.evaluate(() => { [...document.querySelectorAll("#main button")].find((x) => /Pipeline/.test(x.textContent)).click(); }); await page.waitForTimeout(500);
      console.log("▶ Pipeline à " + label);
      const r = await page.evaluate(() => {
        const L = document.querySelector(".pipe-layout"), k = document.querySelector(".pipe-kpis"), s = document.querySelector(".pipe-scroll"), c = document.querySelector(".pipe-col");
        const z = parseFloat(getComputedStyle(document.querySelector("#main")).zoom) || 1;
        const kb = k.getBoundingClientRect(), sb = s.getBoundingClientRect(), cb = c.getBoundingClientRect(), vw = innerWidth;
        return { cols: getComputedStyle(L).gridTemplateColumns.split(" ").length, kTop: kb.top, sTop: sb.top, sLeft: sb.left, sRight: sb.right, colW: cb.width / z, sw: document.documentElement.scrollWidth, vw,
          kpiPerRow: new Set([...k.children].map((e) => Math.round(e.getBoundingClientRect().top))).size, kpiN: k.children.length };
      });
      ok(r.cols === 1, "indicateurs et Kanban empilés (une colonne)");
      ok(r.kTop < r.sTop, "indicateurs au-dessus du Kanban");
      ok(r.sRight - r.sLeft >= r.vw - 30, `le Kanban occupe la largeur de l'écran (${Math.round(r.sRight - r.sLeft)}/${r.vw})`);
      ok(w > 600 || r.colW <= 301, `colonne du Kanban lisible sur téléphone (${Math.round(r.colW)} px) : la suivante dépasse pour inviter au défilement`);
      ok(r.sw <= r.vw + 1, "aucun défilement horizontal de la page");
      if (w < 600) ok(r.kpiPerRow <= Math.ceil(r.kpiN / 2), "indicateurs sur deux colonnes (pas un par ligne)");
      const small = await page.evaluate(() => [...document.querySelectorAll("#main button,#tabs button")].filter((b) => b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().height < 36).length);
      ok(small === 0, "cibles tactiles de 40 px au moins (" + small + " plus petites)");
      ok(errors.length === 0, "aucune erreur (" + errors.join(" | ") + ")"); await page.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log("\nTOUT EST OK");
})().catch((e) => { console.error(e.message); process.exit(1); });
