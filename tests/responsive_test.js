// Affichage mobile et tablette : aucun écran ne doit déborder de la largeur de l'appareil (contenu rogné ou décalé, comme sur l'écran Messagerie d'un téléphone).
// Contrôle des principaux écrans en 360 et 390 px (téléphones) et 768 et 820 px (tablettes). Les éléments qui défilent volontairement (onglets, tableaux dans un conteneur défilant) sont ignorés.
// node tests/responsive_test.js
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const VIEWS = ["dashboard", "clients", "messagerie", "marketing", "planning", "rapports", "commandes", "logiciels", "equipe", "commissions", "comptabilite", "financement", "parametres", "users", "licences"];
const SIZES = [[360, 740], [390, 844], [768, 1024], [820, 1180]];
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) process.exitCode = 1; };
(async () => {
  const server = await start(4296), browser = await chromium.launch();
  try {
    for (const [w, h] of SIZES) {
      console.log(`▶ ${w}×${h}`);
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 600 });
      await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
      await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
      await require("./helpers/crm_fixture.js").installer(ctx, {});
      const page = await ctx.newPage(); await page.goto("http://localhost:4296/index.html"); await page.waitForTimeout(900);
      await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1300);
      const mauvais = [];
      for (const v of VIEWS) {
        const r = await page.evaluate(async (v) => {
          navigate(v, null); await new Promise((r) => setTimeout(r, 450));
          const vw = document.documentElement.clientWidth, root = document.getElementById("view-" + v) || document.body;
          const defile = (e) => { for (let a = e.parentElement; a && a !== root.parentElement; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === "auto" || o === "scroll") return true; } return false; };
          const over = [...root.querySelectorAll("*")].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > vw + 2 || b.left < -2) && getComputedStyle(e).position !== "fixed" && !defile(e); })
            .slice(0, 3).map((e) => e.tagName + (e.id ? "#" + e.id : "") + ":" + Math.round(e.getBoundingClientRect().right));
          return { sw: document.documentElement.scrollWidth, vw, over };
        }, v);
        if (r.sw > r.vw + 2 || r.over.length) mauvais.push(v + " " + JSON.stringify(r));
      }
      ok(mauvais.length === 0, `${VIEWS.length} écrans sans débordement${mauvais.length ? " — " + mauvais.join(" ; ") : ""}`);
      await ctx.close();
    }
  } finally { await browser.close(); server.close && server.close(); }
  if (!process.exitCode) console.log("\nTOUT EST OK");
})().catch((e) => { console.error(e); process.exit(1); });
