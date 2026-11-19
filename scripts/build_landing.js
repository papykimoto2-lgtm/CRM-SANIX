// Construit les landing pages publiques (une par logiciel) dans landing/ avec le même générateur que le CRM.
// Aucun lien étranger : seuls les liens wa.me (WhatsApp) et tel: sont présents ; aucun chiffre tiré du CRM.
// Usage : node scripts/build_landing.js   (puis committer landing/)
const { chromium } = require("playwright");
const { start } = require("../company/tests/server.js");
const fs = require("fs"), path = require("path");
(async () => {
  const server = await start(4290), browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await require("../tests/helpers/crm_fixture.js").installer(ctx, { sansDonnees: true });
    await ctx.addInitScript(() => { class Chart { constructor() {} update() {} destroy() {} resize() {} static register() {} } Chart.defaults = { font: {}, plugins: { legend: { labels: {} } } }; window.Chart = Chart; });
    const page = await ctx.newPage();
    await page.goto("http://localhost:4290/index.html"); await page.waitForTimeout(1200);
    await page.evaluate(() => { currentUser = USERS.find((u) => u.role === "super_admin"); enterApp(currentUser); }); await page.waitForTimeout(1800);
    const pages = await page.evaluate(() => {
      const r = relanceCfg(), a = waAnalyse(r.tel1);
      return LOGICIELS.filter((l) => l.actif !== false).map((l) => ({
        slug: landingSlug(l.nom), nom: l.nom, icon: l.icon || "", cat: l.cat || "", sub: (lpCopyFor(l) || {}).sub || "",
        html: lpBuildHtml({ logNom: l.nom, log: l, titre: "", offre: "🎁 Offre du mois sur " + l.nom + " : installation et formation de votre équipe offertes", wa: a.num, tel: a.num.slice(3), gerant: r.gerant, publique: true }),
      }));
    });
    const dir = path.join(__dirname, "..", "landing"); fs.mkdirSync(dir, { recursive: true });
    fs.readdirSync(dir).filter((f) => f.endsWith(".html")).forEach((f) => fs.unlinkSync(path.join(dir, f)));
    const E = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[x]));
    pages.forEach((p) => fs.writeFileSync(path.join(dir, p.slug + ".html"), p.html));
    const liste = pages.map((p) => `<a class="c" href="${E(p.slug)}.html"><b>${E(p.icon)} ${E(p.nom)}</b><span>${E(p.cat)}</span><p>${E(p.sub)}</p></a>`).join("");
    fs.writeFileSync(path.join(dir, "index.html"), `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Logiciels de gestion pour PME · SANIX Africa</title><meta name="description" content="Logiciels de gestion pour les entreprises ivoiriennes : ERP, comptabilité SYSCOHADA, RH, caisse et stock, CRM. Démo gratuite."><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#0B1220;color:#E5E7EB;line-height:1.6;padding:34px 18px}.w{max-width:1000px;margin:0 auto}h1{font-size:clamp(26px,5vw,40px);color:#fff;margin-bottom:8px}.l{color:#94A3B8;margin-bottom:24px;max-width:640px}.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}.c{display:block;background:#111827;border:1px solid #1F2937;border-radius:16px;padding:18px;text-decoration:none;color:inherit}.c:hover{border-color:#34D399}.c b{color:#fff;font-size:17px}.c span{display:block;font-size:12px;color:#34D399;margin:2px 0 6px}.c p{font-size:14px;color:#94A3B8}footer{text-align:center;color:#64748B;font-size:13px;margin-top:30px}</style></head><body><div class="w"><h1>Nos logiciels de gestion</h1><p class="l">SANIX Africa conçoit des logiciels pour les entreprises ivoiriennes (normes SYSCOHADA, paiement Mobile Money). Choisissez le vôtre : démo gratuite sur WhatsApp.</p><div class="g">${liste}</div><footer>SANIX Africa · Abidjan, Côte d'Ivoire</footer></div></body></html>`);
    console.log(pages.length + " landing pages construites dans landing/");
  } finally { await browser.close(); server.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
