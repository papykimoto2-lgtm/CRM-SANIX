// Garde-fou : tout module de la plateforme SANIX AI (company/*.js, ES modules) et tout script partagé (shared/*.js)
// doit être syntaxiquement valide. Une seule erreur (ex. const déclarée deux fois) fait tomber l'écran en noir.
// `node --check` seul ne détecte pas ces erreurs sur un module : on force le mode module. node tests/esm_syntaxe_test.js
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const racine = path.join(__dirname, "..");
const lister = (dir) => fs.readdirSync(path.join(racine, dir)).filter((f) => f.endsWith(".js")).map((f) => path.join(dir, f));
const cibles = [...lister("company").map((f) => ({ f, module: true })), ...lister("shared").map((f) => ({ f, module: false }))];
let ko = 0;
for (const { f, module } of cibles) {
  const src = fs.readFileSync(path.join(racine, f));
  const r = module ? spawnSync("node", ["--input-type=module", "--check"], { input: src, encoding: "utf8" }) : spawnSync("node", ["--check", path.join(racine, f)], { encoding: "utf8" });
  if (r.status !== 0) { ko++; console.error("  ✗ " + f + "\n    " + String(r.stderr).split("\n").filter(Boolean).slice(0, 4).join("\n    ")); }
}
if (!cibles.length) { console.error("ÉCHEC : aucun fichier à vérifier"); process.exit(1); }
if (ko) { console.error(`\nÉCHEC : ${ko} fichier(s) avec une erreur de syntaxe`); process.exit(1); }
console.log(`  ✓ ${cibles.length} fichiers JavaScript syntaxiquement valides (company : modules, shared : scripts)`);
