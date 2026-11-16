// Jeu d'essai FICTIF pour les tests du CRM : le code livré ne contient plus aucune donnée client ni aucun compte.
// Noms, numéros et montants sont inventés (numéros 07 00 00 xx xx). Le compte de test utilise l'ancien format d'empreinte
// (SHA-256 + sel fixe) pour vérifier aussi la conversion automatique vers PBKDF2 à la connexion.
const crypto = require("crypto");
const SALT = "sanix_africa_2025_crm";
const ADMIN = { login: "admin", email: "admin@test.ci", nom: "Admin Test", pass: "MotDePasse-Test-2026" };
const hashLegacy = (p) => crypto.createHash("sha256").update(p + SALT).digest("hex");
const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };

function donnees(o) {
  o = o || {};
  const now = new Date().toISOString(), tel = (n) => "07 00 " + String(Math.floor(n / 100) % 100).padStart(2, "0") + " " + String(n % 100).padStart(2, "0") + " " + String((n * 7) % 100).padStart(2, "0");
  const groupes = [["Immobilier", "ImmoSuite ERP", 750000, 95], ["Santé", "MediCore Suite", 550000, 173], ["Livraison", "Angel's Livraison", 600000, 30], ["Industrie", "Sanix AluExpert ERP", 600000, 213]];
  const clients = []; let id = 1;
  groupes.forEach(([secteur, logiciel, valeur, n]) => { for (let i = 1; i <= (o.prospects === undefined ? n : Math.round(n * o.prospects / 511)); i++, id++) clients.push({ id, nom: (secteur === "Immobilier" && i % 8 === 0 ? "VILLA IMMOBILIER " : `PROSPECT ${secteur.toUpperCase()} `) + String(i).padStart(3, "0"), phone: tel(id), email: i % 3 ? "" : `contact${id}@exemple.ci`, secteur, logiciel, statut: "prospect", commercial: "", valeur, adresse: i % 2 ? `Abidjan, Cocody, rue ${i}` : "", lat: i % 4 ? null : 5.3 + i / 1000, lng: i % 4 ? null : -4 - i / 1000, notes: "Données fictives de test", created_at: now, updated_at: now }); });
  const vendus = [["Client Alpha SARL", "ImmoSuite ERP", 4000000, 1250000, "livree"], ["Client Bêta Industrie", "Sanix AluExpert ERP", 700000, 500000, "livree"], ["Client Gamma Services", "ImmoSuite ERP", 5000000, 1000000, "confirmee"], ["Client Delta Négoce", "Sanix AluExpert ERP", 300000, 100000, "livree"],
    ["Client Epsilon Agro", "MediCore Suite", 1200000, 1200000, "livree"], ["Client Zêta Transport", "Angel's Livraison", 635000, 600000, "confirmee"], ["Client Êta Agro", "Menko Agro", 450000, 450000, "livree"],
    ["Client Thêta Ferme", "AviNest Pro", 70000, 50000, "livree"]];       // ancien nom de produit : absent du catalogue (cas « commande sans logiciel du catalogue »)
  vendus.forEach(([nom, logiciel, ttc], i) => clients.push({ id: id++, nom, phone: tel(900 + i), email: "", secteur: "Autre", logiciel, statut: "client", commercial: "", valeur: ttc, adresse: "Abidjan", created_at: now, updated_at: now }));
  const commandes = vendus.map(([client, logiciel, ttc, acompte, statut], i) => ({ id: "cmd_t" + (i + 1), ref: "CMD-2026-" + String(i + 1).padStart(3, "0"), client, date: i % 2 ? "2026-11-16" : "2026-11-12", logiciel, typeLicence: "Perpetuelle",
    htBrut: Math.round(ttc / 1.18), remise: 0, htNet: Math.round(ttc / 1.18), tva: ttc - Math.round(ttc / 1.18), ttc, acompte, solde: ttc - acompte, sansTva: false, commercial: "", statut, presId: "", notes: "Fictif" }));
  return { clients, commandes };
}

/** Installe le jeu d'essai dans le navigateur avant le chargement de la page (une seule fois : ne réécrit rien si des comptes existent déjà). */
async function installer(ctx, o) {
  const d = donnees(o), compte = { id: 1, nom: ADMIN.nom, login: ADMIN.login, email: ADMIN.email, phone: "", role: "super_admin", hash: hashLegacy(ADMIN.pass), actif: true, lastLogin: null, init: "AT", color: "#0e7490" };
  await ctx.addInitScript(({ d, compte, sansCompte, sansDonnees }) => {
    if (localStorage.getItem("sanix_crm_users_data") !== null || localStorage.getItem("sanix_crm_fixture_v1")) return;
    localStorage.setItem("sanix_crm_fixture_v1", "1");
    if (!sansCompte) localStorage.setItem("sanix_crm_users_data", JSON.stringify([compte]));
    if (!sansDonnees) { localStorage.setItem("sanix_crm_clients", JSON.stringify(d.clients)); localStorage.setItem("sanix_crm_commandes", JSON.stringify(d.commandes)); }
  }, { d, compte, sansCompte: !!(o && o.sansCompte), sansDonnees: !!(o && o.sansDonnees) });
}
module.exports = { installer, donnees, ADMIN, hashLegacy };
