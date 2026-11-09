const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };
exports.start = (port) => new Promise((res) => {
  const s = http.createServer((req, rsp) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end("404"); return; }
    const h = { "Content-Type": MIME[path.extname(f)] ?? "application/octet-stream" };
    for (const rule of vercel.headers) if (new RegExp("^" + rule.source.replace(/\(\.\*\)/g, ".*") + "$").test(p)) for (const x of rule.headers) h[x.key] = x.value;
    rsp.writeHead(200, h); fs.createReadStream(f).pipe(rsp);
  }).listen(port, () => res(s));
});
