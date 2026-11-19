// Construit les démos interactives (une par logiciel) dans demo/ à partir du catalogue. Usage : node scripts/build_demos.js (puis committer demo/)
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const { demoHtml } = require("./demo_template.js");
const fs = require("fs"), path = require("path"), commun = require("./pages_commun.js");
(async () => {
  const server = await start(4292), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("../tests/helpers/crm_fixture.js").installer(ctx, { sansDonnees: true });
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage();
    await page.goto("http://localhost:4292/index.html"); await page.waitForTimeout(1200);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1800);
    const cfg = commun.config(), a = await page.evaluate((t) => waAnalyse(t), cfg.whatsapp);
    if (!a.ok) throw new Error("Numéro WhatsApp invalide dans scripts/pages.config.json : " + cfg.whatsapp);
    const logs = await page.evaluate((a) => { return LOGICIELS.filter((l) => l.actif !== false).map((l) => ({ slug: landingSlug(l.nom), wa: a.num, log: { nom: l.nom, icon: l.icon, color: l.color, cat: l.cat, modules: l.modules } })); }, a);
    const dir = path.join(commun.racine(), "demo"); fs.mkdirSync(dir, { recursive: true });
    fs.readdirSync(dir).filter((f) => f.endsWith(".html")).forEach((f) => fs.unlinkSync(path.join(dir, f)));
    logs.forEach((x) => fs.writeFileSync(path.join(dir, x.slug + ".html"), demoHtml(x.log, x)));
    const E = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    fs.writeFileSync(path.join(dir, "index.html"), `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Démos en ligne · SANIX Africa</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0B1220;color:#E5E7EB;padding:34px 18px}.w{max-width:1000px;margin:0 auto}h1{color:#fff;margin-bottom:8px}p{color:#94A3B8;margin-bottom:20px}.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}a{display:block;background:#111827;border:1px solid #1F2937;border-radius:14px;padding:16px;color:#fff;text-decoration:none;font-weight:700}a:hover{border-color:#34D399}small{display:block;color:#34D399;font-weight:400;margin-top:3px}</style></head><body><div class="w"><h1>Essayez nos logiciels en ligne</h1><p>Démos interactives avec des données fictives : sans compte, rien n'est enregistré.</p><div class="g">${logs.map((x) => `<a href="${E(x.slug)}.html">${E(x.log.icon || "")} ${E(x.log.nom)}<small>${E(x.log.cat || "")}</small></a>`).join("")}</div></div></body></html>`);
    commun.ecrireManifeste(logs.map((x) => x.slug));
    console.log(logs.length + " démos construites dans demo/");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
