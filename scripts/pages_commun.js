// Réglages et sorties communs aux générateurs de pages publiques (landing/ et demo/).
// Réglages : scripts/pages.config.json — « whatsapp » (numéro qui reçoit les demandes), « gerant », « offre » {texte, fin: AAAA-MM-JJ}.
// Une offre n'est publiée que si son texte ET sa date de fin sont renseignés : le compte à rebours s'arrête à cette date.
// Sorties : racine du dépôt, ou le dossier PAGES_OUT (utilisé par les tests pour comparer avec ce qui est publié).
const fs = require("fs"), path = require("path");
const racine = () => process.env.PAGES_OUT ? path.resolve(process.env.PAGES_OUT) : path.join(__dirname, "..");
function config() {
  const c = JSON.parse(fs.readFileSync(path.join(__dirname, "pages.config.json"), "utf8")), o = c.offre || {};
  return { whatsapp: String(c.whatsapp || ""), gerant: String(c.gerant || ""), offre: o.texte && /^\d{4}-\d{2}-\d{2}$/.test(o.fin || "") ? { texte: String(o.texte), fin: o.fin } : null };
}
function ecrireManifeste(slugs) {
  const f = path.join(racine(), "shared", "pages_publiques.js"); fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, "// Généré par scripts/build_landing.js et scripts/build_demos.js : logiciels qui ont une page publique (landing/ et demo/). Ne pas modifier à la main.\nwindow.PAGES_PUBLIQUES = " + JSON.stringify(slugs.slice().sort()) + ";\n");
}
module.exports = { racine, config, ecrireManifeste };
