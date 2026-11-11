// Bureau du Président sur téléphone (texte agrandi) : la conversation doit rester lisible, suggestions et saisie ne la réduisent pas à une bande. node mobile_chat_test.js
const { launch, newPage, ok, loadFixture } = require("./harness.js");

(async () => {
  const { server, browser } = await launch(4179);
  try {
    const FX = loadFixture(), now = new Date().toISOString();
    FX.ai_executive_messages = [
      { id: 1, role: "president", contenu: "Où en est le pilote ?", created_at: now, meta: {} },
      { id: 2, role: "directeur", contenu: "Les fiches produit d'ImmoSuite et d'AluExpert sont vides : sans elles, impossible d'écrire un message conforme. ".repeat(4), created_at: now, meta: {} },
    ];
    for (const zoom of [1, 1.4]) {
      console.log(`▶ Téléphone 360 × 740, texte ×${zoom}`);
      const { page, errors } = await newPage(browser, { w: 360, h: 740, mobile: true, fixture: JSON.stringify(FX) });
      await page.goto("http://localhost:4179/company/"); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(700);
      await page.evaluate((z) => { document.documentElement.style.zoom = z; }, zoom); await page.waitForTimeout(200);   // texte agrandi comme sur le téléphone de la direction
      await page.click("#tabs button[data-id=exec]"); await page.waitForTimeout(600);
      const m = await page.evaluate(() => { const r = document.querySelector("#msgs").getBoundingClientRect(), q = document.querySelector(".quick").getBoundingClientRect(); return { h: r.height, vh: innerHeight, qh: q.height, w: r.width, vw: innerWidth }; });
      console.log("   conversation", Math.round(m.h), "px sur", Math.round(m.vh), "· suggestions", Math.round(m.qh), "px");
      ok(m.h >= m.vh * 0.4, "la conversation occupe au moins 40 % de la hauteur de l'écran");
      ok(m.qh <= m.vh * 0.16, "les suggestions tiennent sur une ligne défilante (≤ 16 % de l'écran)");
      ok(m.w <= m.vw + 1, "aucun débordement horizontal");
      const last = await page.evaluate(() => { const e = document.querySelector("#msgs"); return e.scrollHeight - e.scrollTop - e.clientHeight; });
      ok(last < 4, "la conversation est défilée sur le dernier message");
      ok(errors.length === 0, "aucune erreur JavaScript (" + errors.join(" | ") + ")");
      await page.close();
    }
    console.log("\nChat mobile : TOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
