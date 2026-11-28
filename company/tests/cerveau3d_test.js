// Cerveau 3D de la mémoire active : rotation continue à 360°, zoom (boutons, molette), rotation au glisser, pause/reprise. node company/tests/cerveau3d_test.js
const { launch, newPage, ok, loadFixture } = require("./harness.js");
(async () => {
  const { server, browser, port } = await launch(4315);
  try {
    const { page, errors } = await newPage(browser, { fixture: JSON.stringify(loadFixture()) });
    await page.goto(`http://localhost:${port}/company/live.html?debug=1&fast=1`); await page.waitForSelector("#live:not([hidden])"); await page.waitForTimeout(2200);
    await page.click('#ctl button[data-c="relations"]'); await page.waitForTimeout(600);
    await page.selectOption("#relations-mode", "memory"); await page.waitForTimeout(1800);
    const st = () => page.evaluate(() => window.__brain3d?.()?.state?.() ?? null);
    const s0 = await st();
    if (!s0) { console.log("  ⚠ WebGL indisponible dans ce navigateur de test : le cerveau 3D n'a pas pu démarrer (repli 2D)."); process.exit(2); }
    console.log("▶ Rotation");
    await page.waitForTimeout(1500); const s1 = await st();
    const d = ((s1.yaw - s0.yaw) + 2 * Math.PI) % (2 * Math.PI);
    ok(d > 0.05 && d < 3, `rotation automatique : le cerveau tourne seul (Δ ${d.toFixed(2)} rad en ~1,5 s)`);
    console.log("▶ Zoom");
    await page.click('[data-rel-camera="in"]'); await page.waitForTimeout(300); const z1 = await st();
    ok(z1.scale > s1.scale * 1.15, `bouton ＋ : le cerveau grossit (${s1.scale.toFixed(2)} → ${z1.scale.toFixed(2)})`);
    await page.click('[data-rel-camera="out"]'); await page.click('[data-rel-camera="out"]'); await page.waitForTimeout(300); const z2 = await st();
    ok(z2.scale < z1.scale * .8, `bouton − : le cerveau rétrécit (${z1.scale.toFixed(2)} → ${z2.scale.toFixed(2)})`);
    const box = await page.locator("#relations-canvas").boundingBox();
    await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5); await page.mouse.wheel(0, -400); await page.waitForTimeout(300); const z3 = await st();
    ok(z3.scale > z2.scale, `molette : zoom avant (${z2.scale.toFixed(2)} → ${z3.scale.toFixed(2)})`);
    console.log("▶ Rotation manuelle");
    await page.click('[data-rel-camera="reset"]'); await page.waitForTimeout(300); const r0 = await st();
    ok(Math.abs(r0.scale - .79) < .02, "recentrer (⌂) : zoom d'origine rétabli");
    await page.mouse.move(box.x + 8, box.y + box.height - 8); await page.mouse.down(); await page.mouse.move(box.x + 160, box.y + box.height - 40, { steps: 8 }); await page.waitForTimeout(100);
    const m1 = await st(); await page.mouse.up();
    ok(Math.abs(m1.yaw - r0.yaw) > .3 || Math.abs(m1.pitch - r0.pitch) > .05, "glisser sur le fond : le cerveau pivote");
    await page.click('[data-rel-camera="spin"]'); await page.waitForTimeout(200); const a0 = await st(); await page.waitForTimeout(1200); const a1 = await st();
    ok(a0.autoRotate === false && Math.abs(a1.yaw - a0.yaw) < .001, "bouton ⟳ : la rotation automatique s'arrête");
    await page.click('[data-rel-camera="spin"]'); await page.waitForTimeout(200); const b0 = await st(); await page.waitForTimeout(1200); const b1 = await st();
    ok(b0.autoRotate === true && Math.abs(b1.yaw - b0.yaw) > .02, "bouton ⟳ : la rotation reprend");
    ok(errors.filter((e) => !/favicon|Failed to load resource/.test(e)).length === 0, "aucune erreur console : " + errors.slice(0, 2).join(" | "));
  } finally { await browser.close(); server.close?.(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
