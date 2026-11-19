// Pages publiques (landing/, demo/) et liste shared/pages_publiques.js : à jour avec le générateur et le catalogue. node pages_sync_test.js
// Régénère tout dans un dossier temporaire et compare avec ce qui est publié : un écart signifie « relancez scripts/build_landing.js et scripts/build_demos.js ».
const { execFileSync } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const racine = path.join(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pages-"));
try {
  const env = { ...process.env, PAGES_OUT: tmp };
  execFileSync("node", [path.join(racine, "scripts", "build_landing.js")], { env, stdio: "pipe" });
  execFileSync("node", [path.join(racine, "scripts", "build_demos.js")], { env, stdio: "pipe" });
  const liste = (d) => fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".html")).sort() : [];
  let total = 0; const ecarts = [];
  for (const dossier of ["landing", "demo"]) {
    const neufs = liste(path.join(tmp, dossier)), publies = liste(path.join(racine, dossier));
    if (JSON.stringify(neufs) !== JSON.stringify(publies)) ecarts.push(dossier + " : liste de fichiers différente");
    for (const f of neufs) { total++; if (!fs.existsSync(path.join(racine, dossier, f)) || fs.readFileSync(path.join(tmp, dossier, f), "utf8") !== fs.readFileSync(path.join(racine, dossier, f), "utf8")) ecarts.push(dossier + "/" + f); }
  }
  const m = "shared/pages_publiques.js";
  if (fs.readFileSync(path.join(tmp, m), "utf8") !== fs.readFileSync(path.join(racine, m), "utf8")) ecarts.push(m);
  ok(total > 30, total + " pages régénérées");
  ok(ecarts.length === 0, "pages publiées = pages régénérées depuis le catalogue (écarts : " + ecarts.slice(0, 4).join(", ") + ") — relancez les deux scripts de construction");
  console.log("\nTOUT EST OK");
} catch (e) { console.error(e.message); process.exit(1); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
