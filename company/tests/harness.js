// Harnais commun : serveur statique (CSP réelle de vercel.json), Chromium (SwiftShader), faux Supabase + jeu de données réel.
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const { start } = require("./server.js");
const HERE = __dirname, OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const FAKE = fs.readFileSync(path.join(HERE, "fakesb.js"), "utf8");
const CORS = { "Access-Control-Allow-Origin": "*" };
const GL = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl"];
exports.OUT = OUT; exports.HERE = HERE;
exports.launch = async (port) => ({ server: await start(port), browser: await chromium.launch({ args: GL }), port });
exports.ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
exports.newPage = async (browser, { w = 1440, h = 900, mobile = false, reduced = false, fixture = null, init = null, block = [] } = {}) => {
  const FIX = fixture ?? fs.readFileSync(path.join(HERE, "fixture.json"), "utf8");
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("dialog", (d) => { errors.push("DIALOG: " + d.message()); d.dismiss(); });
  await ctx.addInitScript({ content: `window.__FIX = ${FIX};` + (init ?? "") + FAKE });
  await ctx.addInitScript(() => localStorage.setItem("sanix_crm_supabase_config", JSON.stringify({ url: "https://demo.supabase.co", key: "eyJhbGciOiJIUzI1NiJ9." + btoa(JSON.stringify({ role: "anon" })) + ".sig" })));
  for (const pattern of block) await ctx.route(pattern, (r) => r.abort());   // ressources indisponibles (repli)
  await ctx.route("https://cdn.jsdelivr.net/**", (r) => {
    const u = r.request().url();
    if (u.includes("supabase-js")) return r.fulfill({ status: 200, contentType: "text/javascript", headers: CORS, body: "/* fake: défini par addInitScript */" });
    return r.fulfill({ status: 404, body: "" });
  });
  return { page, errors, ctx };
};
/** Ouvre le bureau et attend que tous les avatars existent. */
exports.openOffice = async (page, port, qs = "debug=1") => {
  await page.goto(`http://localhost:${port}/company/?${qs}`);
  await page.waitForSelector("#app:not([hidden])");
  await page.waitForFunction(() => window.__vc?.office && window.__vc.office.stats().avatars >= window.__vc.agents.filter((a) => a.etat !== "archive").length && window.__vc.office.stats().queued === 0, null, { timeout: 20000 });
  await page.waitForTimeout(400);
};
