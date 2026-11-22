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
    console.log("▶ Vue 3D");
    ok(await page.evaluate(() => !!document.querySelector("#stage3d canvas") && window.__live.view3d?.state().kind === "3d"), "rendu 3D actif (Three.js)");
    ok(await page.evaluate(() => window.__live.view3d.nodes().length >= 20), "une sphère par agent (" + await page.evaluate(() => window.__live.view3d.nodes().length) + ")");
    const d0 = await page.evaluate(() => window.__live.view3d.debug().cam), box = await page.locator("#stage3d").boundingBox(), cx = box.x + box.width * .5, cy = box.y + box.height * .25;
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 160, cy + 20, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(500);
    const d1 = await page.evaluate(() => window.__live.view3d.debug().goal); ok(Math.abs(d1.theta - d0.theta) > .1, "glisser fait tourner la scène");
    await page.mouse.move(cx, cy); await page.mouse.wheel(0, -400); await page.waitForTimeout(400);
    const d2 = await page.evaluate(() => window.__live.view3d.debug().goal); ok(d2.r < d1.r, "la molette zoome");
    await page.click('#ctl [data-c="out"]'); await page.waitForTimeout(300); ok((await page.evaluate(() => window.__live.view3d.debug().goal.r)) > d2.r, "bouton zoom arrière");
    await page.click('#ctl [data-c="reset"]'); await page.waitForTimeout(300);
    const tid = await page.evaluate(() => { const n = window.__live.view3d.nodes().find((x) => x.st === "run") ?? window.__live.view3d.nodes()[1]; return n.id; });
    await page.evaluate((id) => window.__live.view3d.focus(id), tid); await page.waitForTimeout(1200);
    const sp = await page.evaluate((id) => window.__live.view3d.screenOf(id), tid);
    await page.mouse.move(box.x + sp.x, box.y + sp.y); await page.waitForTimeout(250); ok(await page.locator("#tip").isVisible(), "info-bulle au survol d'un agent");
    ok(await page.locator("#detail").isVisible(), "focus sur un agent : fiche affichée");
    await page.mouse.click(box.x + sp.x, box.y + sp.y); await page.waitForTimeout(300); ok(await page.locator("#detail").isHidden(), "clic sur l'agent sélectionné : désélection");
    await page.mouse.click(box.x + sp.x, box.y + sp.y); await page.waitForTimeout(1000); ok(await page.locator("#detail").isVisible(), "clic sur un agent : fiche et caméra");
    console.log("▶ Jarvis (voix et dialogue)");
    ok(await page.locator("#jarvis").isVisible(), "assistant Jarvis affiché");
    const ask = (t) => page.evaluate((x) => window.__jarvis.ask(x), t);
    ok(/agents? travaill/.test(await ask("Jarvis, situation")), "« situation » : bilan chiffré");
    ok(/fiches? créées? aujourd/.test(await ask("combien de fiches aujourd'hui")), "« combien de fiches »");
    ok(/AutoGarage Pro : 1 mission/.test(await ask("où en est AutoGarage")), "avancement d'un logiciel");
    const z0 = await page.evaluate(() => window.__live.view3d.debug().goal.r); await ask("zoom avant"); ok((await page.evaluate(() => window.__live.view3d.debug().goal.r)) < z0, "commande vocale « zoom avant »");
    await ask("vue d'ensemble"); await ask("montre le directeur"); await page.waitForTimeout(300); ok(await page.evaluate(() => !!window.__live.view3d.selected), "commande « montre <agent> » : caméra sur l'agent");
    const r = await ask("planifie une réunion avec le partenaire"); ok(/transmette au directeur/.test(r) && await page.evaluate(() => !!window.__jarvis.pending()), "demande inconnue : proposition de transmission (pas d'envoi sans confirmation)");
    await page.evaluate(() => { window.__sent = 0; const o = window.__FIX; }); 
    await ask("non"); ok(await page.evaluate(() => window.__jarvis.pending() === null), "« non » annule la transmission");
    await page.fill("#jv-in", "où en est angel"); await page.press("#jv-in", "Enter"); await page.waitForTimeout(200); ok((await page.locator("#jv-log .ln").count()) >= 2, "saisie clavier prise en compte");
    await page.screenshot({ path: require("./harness.js").OUT + "/live_3d.png" });
    console.log("▶ Repli 2D");
    const p2 = await ctx.newPage(); await p2.goto(`http://localhost:${port}/company/live.html?debug=1&fast=1&2d`); await p2.waitForSelector("#live:not([hidden])"); await p2.waitForFunction(() => window.__live.nodes().length > 0); await p2.waitForTimeout(1200);
    const px = await p2.evaluate(() => { const c = document.getElementById("net"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) n++; return n; });
    ok(px > 500, "?2d : réseau dessiné sur le canevas (" + px + " points)"); await p2.close();
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
