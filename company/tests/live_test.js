// Salle de contrôle (live.html) : affichage en direct des agents, missions, actions, santé. Faux Supabase + jeu de données réel (harness commun).
// node company/tests/live_test.js
const { launch, ok, newPage } = require("./harness.js");
(async () => {
  const { server, browser, port } = await launch(4297);
  try {
    const init = `
      const A = window.__FIX.ai_agents, now = Date.now(), iso = (m) => new Date(now - m * 60000).toISOString(), hunter = A.find((a) => a.code === "ia_wa_1") ?? A[A.length - 1];
      window.__FIX.ai_agent_tasks.push({ id: "11111111-0000-4000-8000-000000000001", parent_id: null, agent_id: hunter.id, donneur_agent_id: null, type: "tache", statut: "en_cours", priorite: 1, produit: "autogarage", titre: "Prospection AutoGarage Pro — garages : Abidjan", objectifs: ["Créer jusqu'à 20 nouvelles fiches"], started_at: iso(12), updated_at: iso(1), created_at: iso(30), executions: 1 });
      for (let i = 0; i < 4; i++) window.__FIX.ai_actions.unshift({ id: 100 + i, agent: "abonnement", action: "abonnement_prospect_cree", agent_id: hunter.id, task_id: "11111111-0000-4000-8000-000000000001", payload: { entreprise: "Garage Test " + i }, ok: true, at: iso(i + 1) });
      window.__FIX.ai_prospects.push(...[0, 1, 2, 3].map((i) => ({ id: "22222222-0000-4000-8000-00000000000" + i, entreprise: "Garage Test " + i, ville: "Abidjan", produits_recommandes: ["autogarage"], telephone: "+225 07 00 00 00 0" + i, email: null, source_url: "https://exemple.ci/garages", created_at: iso(i + 1), stage: "enregistre" })));`;
    const { page, errors, ctx } = await newPage(browser, { w: 1600, h: 900, init });
    await page.goto(`http://localhost:${port}/company/live.html?debug=1&fast=1`);
    await page.waitForSelector("#live:not([hidden])"); await page.waitForFunction(() => document.querySelectorAll("#missions .mis").length > 0); await page.waitForTimeout(1500);
    console.log("▶ Salle de contrôle");
    ok(await page.locator("#gate").isHidden(), "écran affiché avec la session du Bureau");
    ok((await page.locator(".kpi").count()) === 6, "6 indicateurs");
    ok(Number(await page.locator("#k-today").textContent()) >= 4, "fiches créées aujourd'hui comptées depuis la base (" + await page.locator("#k-today").textContent() + ")");
    ok(await page.locator("#missions .mis.run").count() >= 1, "mission en cours mise en évidence");
    ok((await page.locator("#missions").innerText()).includes("fiches créées"), "progression de la mission en fiches créées");
    ok((await page.locator("#feed .it").count()) >= 4 && (await page.locator("#feed").innerText()).includes("nouvelle fiche"), "flux d'actions");
    const score = Number(await page.locator(".gauge b").textContent()); ok(score >= 0 && score <= 100, "indice de santé 0-100 (" + score + ")");
    ok((await page.locator("#ticker .f").count()) >= 4, "bandeau des nouvelles fiches");
    const px = await page.evaluate(() => { const c = document.getElementById("net"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++; return n; });
    ok(px > 500, "réseau dessiné sur le canevas (" + px + " points)");
    ok(await page.evaluate(() => window.__live.nodes().length >= 20), "un point lumineux par agent");
    const pos = await page.evaluate(() => { const n = window.__live.nodes().find((x) => x.st === "run") ?? window.__live.nodes()[0], r = document.getElementById("net").getBoundingClientRect(); return { x: r.left + n.x, y: r.top + n.y, st: n.st }; });
    await page.mouse.move(pos.x, pos.y); await page.waitForTimeout(200); ok(await page.locator("#tip").isVisible(), "info-bulle au survol d'un agent");
    await page.mouse.click(pos.x, pos.y); await page.waitForTimeout(200); ok(await page.locator("#detail").isVisible(), "fiche de l'agent au clic");
    console.log("▶ Temps réel");
    await page.evaluate(() => { const a = window.__FIX.ai_agents.find((x) => x.code === "ia_wa_1") ?? window.__FIX.ai_agents.at(-1); window.__FIX.ai_actions.unshift({ id: 999, agent: "abonnement", action: "abonnement_prospect_cree", agent_id: a.id, task_id: null, payload: { entreprise: "Garage Nouveau Direct" }, ok: true, at: new Date().toISOString() }); });
    await page.waitForFunction(() => document.querySelector("#feed .it.new")?.textContent.includes("Garage Nouveau Direct"), null, { timeout: 8000 });
    ok(true, "une nouvelle action apparaît dans le flux sans recharger la page");
    await page.screenshot({ path: require("./harness.js").OUT + "/live_desktop.png" });
    console.log("▶ Tablette et mobile");
    for (const [w, h] of [[820, 1180], [390, 844]]) {
      await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(600);
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2), `${w}×${h} : pas de débordement horizontal`);
      await page.screenshot({ path: require("./harness.js").OUT + `/live_${w}.png`, fullPage: false });
    }
    console.log("▶ Ouverture depuis le Bureau");
    const bureau = await ctx.newPage(); await bureau.goto(`http://localhost:${port}/company/?debug=1`); await bureau.waitForSelector("#app:not([hidden])");
    const [popup] = await Promise.all([ctx.waitForEvent("page"), bureau.click("#open-live")]);
    await popup.waitForSelector("#live:not([hidden])", { timeout: 8000 }); ok(true, "le bouton « Salle de contrôle » ouvre la fenêtre en direct");
    const bad = errors.filter((e) => !/WebGL|swiftshader|GPU/i.test(e)); ok(bad.length === 0, "aucune erreur dans la console" + (bad.length ? " : " + bad.slice(0, 2).join(" | ") : ""));
    console.log("\nTOUT EST OK");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
