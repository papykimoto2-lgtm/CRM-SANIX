// Paginateur partagé (shared/pager.js) : tableaux, listes, cartes. node pager_test.js
const { chromium } = require("playwright");
const { start } = require("../../company/tests/server.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };

(async () => {
  const server = await start(4210), browser = await chromium.launch();
  try {
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
    await page.goto("http://localhost:4210/shared/tests/pager.html");
    const rows = (n, id = "t1", pre = "Ligne") => page.evaluate(([n, id, pre]) => { document.getElementById(id).innerHTML = Array.from({ length: n }, (_, i) => `<tr><td>${pre} ${i + 1}</td></tr>`).join(""); }, [n, id, pre]);
    const cards = (n) => page.evaluate((n) => { document.getElementById("cards").innerHTML = Array.from({ length: n }, (_, i) => `<div class="c">Carte ${i + 1}</div>`).join("") + '<div class="drop">zone</div>'; }, n);
    const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const shown = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.getAttribute("data-pg") !== "off").map((e) => e.textContent), sel);
    const barOf = (id) => page.evaluate((id) => { const a = document.getElementById(id); let el = a.closest("table") || a; while (el.parentElement && /auto|scroll/.test(getComputedStyle(el.parentElement).overflowX)) el = el.parentElement; const b = el.nextElementSibling; return b && b.classList.contains("sx-pager") ? { hidden: b.hidden, text: b.innerText.replace(/\s+/g, " ").trim(), count: document.querySelectorAll(".sx-pager").length, cur: b.querySelector("[aria-current]")?.textContent ?? null, role: b.getAttribute("aria-label") } : null; }, id);

    console.log("▶ Tableau : pages");
    await rows(120); await settle();
    let s = await shown("#t1 tr");
    ok(s.length === 25 && s[0] === "Ligne 1" && s[24] === "Ligne 25", "120 lignes : 25 affichées (page 1)");
    let b = await barOf("t1");
    ok(b && !b.hidden && /1–25 sur 120/.test(b.text) && b.role === "Pagination" && b.cur === "1", "barre : « 1–25 sur 120 », navigation étiquetée, page courante marquée");
    await page.click('#tbl1 + .sx-pager button[data-p="3"]'); s = await shown("#t1 tr");
    ok(s[0] === "Ligne 51" && s.length === 25, "page 3 : lignes 51 à 75");
    ok(/51–75 sur 120/.test((await barOf("t1")).text) && (await barOf("t1")).cur === "3", "info et page courante mises à jour");
    await page.click('#tbl1 + .sx-pager button[data-a="next"]'); await page.click('#tbl1 + .sx-pager button[data-a="next"]');
    s = await shown("#t1 tr"); ok(s[0] === "Ligne 101" && s.length === 20, "dernière page : 20 lignes (101–120)");
    ok(await page.locator('#tbl1 + .sx-pager button[data-a="next"]').isDisabled(), "« Suivant » désactivé sur la dernière page");
    await page.click('#tbl1 + .sx-pager button[data-a="prev"]'); ok((await shown("#t1 tr"))[0] === "Ligne 76", "« Précédent » : page 4");

    console.log("▶ Nombre de lignes");
    await page.selectOption("#tbl1 + .sx-pager select", "50"); await settle();
    ok((await shown("#t1 tr")).length === 50 && /1–50 sur 120/.test((await barOf("t1")).text), "50 lignes par page : retour page 1");
    ok((await page.evaluate(() => localStorage.getItem("sanix_pg_size"))) === "50", "choix mémorisé");
    await rows(80, "t2"); await settle();
    ok((await shown("#t2 tr")).length === 50 && (await barOf("t2")) && !(await barOf("t2")).hidden, "le choix s'applique aux autres tableaux (cadre défilant : barre placée après le cadre)");

    console.log("▶ Rendu de l'application (remplacement du contenu)");
    await page.selectOption("#tbl1 + .sx-pager select", "10"); await settle();
    await page.click('#tbl1 + .sx-pager button[data-p="3"]');
    await rows(22); await settle();
    ok((await barOf("t1")).cur === "3" && (await shown("#t1 tr")).length === 2, "contenu remplacé : page conservée (3), 2 lignes sur 22");
    await rows(8); await settle();
    ok((await barOf("t1")).hidden && (await shown("#t1 tr")).length === 8, "8 lignes : barre masquée, tout est affiché");
    await rows(120); await settle();
    ok((await shown("#t1 tr")).length === 10, "à nouveau 120 lignes : 10 par page");
    await page.selectOption("#tbl1 + .sx-pager select", "25"); await settle();

    console.log("▶ Filtre de l'application (style.display)");
    await page.evaluate(() => document.querySelectorAll("#t1 tr").forEach((r, i) => { if (i >= 15) r.style.display = "none"; })); await settle();
    s = await shown("#t1 tr");
    ok(s.filter((x) => x).length >= 15 && (await barOf("t1")).hidden, "15 lignes restantes après filtre : barre masquée");
    ok((await page.evaluate(() => [...document.querySelectorAll("#t1 tr")].filter((r) => r.style.display !== "none" && r.getAttribute("data-pg") !== "off").length)) === 15, "seules les lignes non filtrées sont visibles");
    await page.evaluate(() => document.querySelectorAll("#t1 tr").forEach((r) => { r.style.display = ""; })); await settle();
    ok((await shown("#t1 tr")).length === 25 && !(await barOf("t1")).hidden, "filtre levé : pagination rétablie (25 par page)");

    console.log("▶ reveal()");
    await rows(120); await settle();
    ok(await page.evaluate(() => window.SanixPager.reveal(document.querySelector("#t1 tr:nth-child(100)"))), "reveal renvoie vrai");
    s = await shown("#t1 tr"); ok(s.includes("Ligne 100") && (await barOf("t1")).cur === "4", "la ligne 100 devient visible (page 4)");

    console.log("▶ Mode « Afficher plus »");
    await cards(50); await settle();
    ok((await shown("#cards .c")).length === 20, "50 cartes : 20 affichées");
    ok(await page.evaluate(() => document.querySelector("#cards .drop").getAttribute("data-pg") !== "off"), "l'élément hors sélecteur (zone de dépôt) n'est jamais masqué");
    b = await barOf("cards"); ok(/Afficher 20 de plus/.test(b.text) && /30 restants/.test(b.text), "bouton « Afficher 20 de plus · 30 restants »");
    await page.click('#cards + .sx-pager button[data-a="more"]'); ok((await shown("#cards .c")).length === 40, "+20 : 40 cartes");
    await page.click('#cards + .sx-pager button[data-a="more"]'); await settle();
    ok((await shown("#cards .c")).length === 50 && (await barOf("cards")).hidden, "tout affiché : barre masquée");
    await cards(50); await settle();
    ok((await shown("#cards .c")).length === 50, "l'état d'un conteneur à identifiant survit au re-rendu");
    await page.evaluate(() => { document.getElementById("cards").innerHTML = ""; }); await cards(70); await settle();
    await page.evaluate(() => { document.getElementById("cards").innerHTML = ""; }); await settle();
    await page.evaluate(() => { const c = document.getElementById("cards"); c.setAttribute("data-pg-size", "20"); });
    await page.evaluate(() => { const el = document.createElement("div"); el.id = "cards2"; el.setAttribute("data-paginate", "more"); el.setAttribute("data-pg-item", ".c"); el.setAttribute("data-pg-size", "20"); el.innerHTML = Array.from({ length: 80 }, (_, i) => `<div class="c">N${i + 1}</div>`).join(""); document.body.appendChild(el); }); await settle();
    ok(await page.evaluate(() => window.SanixPager.reveal(document.querySelector("#cards2 .c:nth-child(45)"))) && (await shown("#cards2 .c")).length === 45, "reveal déplie la liste jusqu'à l'élément (45)");

    console.log("▶ Tailles propres au conteneur");
    await page.evaluate(() => { document.getElementById("grid").innerHTML = Array.from({ length: 40 }, (_, i) => `<div>Case ${i + 1}</div>`).join(""); }); await settle();
    ok((await shown("#grid > div")).length === 9 && /1–9 sur 40/.test((await barOf("grid")).text), "grille : 9 par page");
    ok((await page.locator("#grid + .sx-pager select option").allTextContents()).join() === "9,18,36", "choix propres : 9, 18, 36");
    await page.selectOption("#grid + .sx-pager select", "18"); await settle();
    ok((await shown("#grid > div")).length === 18 && (await page.evaluate(() => localStorage.getItem("sanix_pg_size"))) === "25", "18 par page, sans modifier le choix global");

    console.log("▶ Exclusion, barre unique, impression");
    await rows(100, "t3"); await settle();
    ok((await shown("#t3 tr")).length === 100, "data-paginate=\"off\" : tout est affiché");
    await page.evaluate(() => { document.getElementById("tbl1").innerHTML = '<thead><tr><th>Nom</th></tr></thead><tbody id="t1b">' + Array.from({ length: 60 }, (_, i) => `<tr><td>Z${i + 1}</td></tr>`).join("") + "</tbody>"; }); await settle();
    ok(await page.evaluate(() => document.querySelectorAll("#tbl1 + .sx-pager").length === 1 && document.querySelectorAll(".sx-pager").length <= 5), "tableau reconstruit : une seule barre (pas de doublon orphelin)");
    await rows(120, "t1b", "L");
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint"))); await settle();
    ok((await shown("#t1b tr")).length === 120, "impression : toutes les lignes sont affichées");
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint"))); await settle();
    ok((await shown("#t1b tr")).length === 25, "après impression : pagination rétablie");

    console.log("▶ Performance");
    const ms = await page.evaluate(async () => { const t0 = performance.now(); document.getElementById("t1b").innerHTML = Array.from({ length: 5000 }, (_, i) => `<tr><td>P${i}</td></tr>`).join(""); await Promise.resolve(); await new Promise((r) => requestAnimationFrame(r)); return performance.now() - t0; });
    ok(ms < 1500 && (await shown("#t1b tr")).length === 25, `5 000 lignes : rendu + pagination en ${Math.round(ms)} ms, 25 lignes affichées`);
    ok(errors.length === 0, `aucune erreur JS (${errors.join(" | ")})`);
    console.log("\nTOUT EST OK");
  } catch (e) { console.error("\n" + e.message); process.exitCode = 1; }
  await browser.close(); server.close();
})();
