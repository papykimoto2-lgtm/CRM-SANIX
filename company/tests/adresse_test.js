// Statut de l'adresse e-mail affiché sur les prospects. node adresse_test.js
const { launch, newPage, ok, loadFixture } = require("./harness.js");
(async () => {
  const { server, browser } = await launch(4185);
  try {
    const FX = loadFixture();
    FX.ai_prospects.push({ ...FX.ai_prospects[0], id: "00000000-0000-4000-8000-0000000000aa", entreprise: "TROISIEME SARL" });
    FX.ai_prospects.forEach((p, i) => { p.email = `contact${i}@exemple.ci`; p.email_statut = ["invalide", "a_confirmer", "verifiee"][i % 3]; });
    const { page, errors } = await newPage(browser, { fixture: JSON.stringify(FX) });
    await page.goto("http://localhost:4185/company/"); await page.waitForSelector("#app:not([hidden])"); await page.waitForTimeout(600);
    await page.click("#tabs button[data-id=sales]"); await page.waitForTimeout(600);
    await page.click("[data-sales-view=prospects], [data-view=prospects]").catch(() => {});
    const t = await page.locator("#main").innerText();
    ok(t.includes("adresse invalide"), "adresse invalide signalée sur la fiche");
    ok(t.includes("adresse à confirmer"), "adresse à confirmer signalée");
    ok(t.includes("adresse confirmée"), "adresse confirmée signalée");
    ok(errors.length === 0, "aucune erreur (" + errors.join(" | ") + ")");
  } finally { await browser.close(); server.close(); }
  console.log("\nTOUT EST OK");
})().catch((e) => { console.error(e.message); process.exit(1); });
