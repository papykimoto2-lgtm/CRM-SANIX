// SANIX CRM Pro : Messagerie commerciale (ciblage par canal, raisons d'exclusion, message incomplet, plafond Gmail, historique). node messagerie_test.js
const M = require("../shared/messagerie.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + (JSON.stringify(a) === JSON.stringify(b) ? "" : " — obtenu " + JSON.stringify(a) + ", attendu " + JSON.stringify(b)));

// Qualité des coordonnées simulée : le moteur ne la calcule pas, le CRM la lui donne.
const Q = { mobile: { tel: { ok: true, kind: "mobile", num: "2250700000001" }, em: { ok: false }, wa: true }, fixe: { tel: { ok: false, kind: "fixe" }, em: { ok: false }, wa: false }, inval: { tel: { ok: false, kind: "invalide" }, em: { ok: false }, wa: false } };
const base = (o) => Object.assign({ statut: "prospect", logiciel: "ImmoSuite ERP", secteur: "Immobilier", phone: "0700000001", email: "", adresse: "Abidjan, Cocody" }, o);
const fiches = [
  base({ id: 1, nom: "Alpha" }),                                                       // mobile, sans e-mail
  base({ id: 2, nom: "Bêta", phone: "21000000", email: "beta@exemple.ci" }),            // fixe, e-mail correct
  base({ id: 3, nom: "Gamma", phone: "", email: "gamma@exemple.ci" }),                  // sans téléphone, e-mail correct
  base({ id: 4, nom: "Delta", phone: "12", email: "delta@exemple.ci" }),                // numéro invalide
  base({ id: 5, nom: "Epsilon", email: "epsilon@exemple.ci", wa: "non" }),              // mobile mais « pas sur WhatsApp »
  base({ id: 6, nom: "Zêta", email: "ko", logiciel: "MediCore Suite", secteur: "Santé" }), // e-mail invalide
  base({ id: 7, nom: "Êta", phone: "", email: "rebond@exemple.ci" }),                   // e-mail déjà revenu en erreur
  base({ id: 8, nom: "Thêta", statut: "client", email: "theta@exemple.ci" }),
  base({ id: 9, nom: "Iota", email: "iota@exemple.ci" })
];
const qualite = (c) => {
  const tel = !c.phone ? { ok: false, kind: "vide" } : c.phone === "21000000" ? Q.fixe.tel : c.phone === "12" ? Q.inval.tel : Q.mobile.tel;
  const mail = /^[^@\s]+@[^@\s]+\.[a-z]+$/.test(c.email || "");
  return { tel, em: { ok: mail, principal: mail ? c.email : "" }, wa: tel.ok, mail };
};
const ctx = { qualite, morte: (e) => e === "rebond@exemple.ci", recent: (c) => c.id === 9 };
const etape = (c) => (c.id === 5 ? 2 : 0);
const noms = (r) => r.retenus.map((x) => x.c.nom);

console.log("▶ WhatsApp");
let r = M.cibler(fiches, "wa", { statut: "prospect" }, ctx, etape);
eq(noms(r), ["Alpha", "Zêta", "Iota"], "seuls les prospects avec un vrai mobile et sans refus WhatsApp sont retenus (Epsilon « pas sur WhatsApp » exclu ; l'e-mail invalide de Zêta ne gêne pas WhatsApp)");
ok(r.retenus[0].cible === "2250700000001", "la cible est le numéro prêt pour WhatsApp (225 + 10 chiffres)");
eq([r.exclus.fixe.length, r.exclus.sans_numero.length, r.exclus.numero_invalide.length, r.exclus.pas_whatsapp.length], [1, 2, 1, 1], "exclus : 1 fixe, 2 sans numéro, 1 invalide, 1 « pas sur WhatsApp »");
ok(r.total === 8 && r.nbExclus === 5, "8 prospects examinés (le client est écarté), 5 exclus");

r = M.cibler(fiches, "wa", { statut: "prospect" }, Object.assign({}, ctx, { desinscrit: (num) => num === "2250700000001" }), etape);
ok(r.retenus.length === 0 && r.exclus.desinscrit.length === 3, "désinscrits (STOP) : exclus de WhatsApp avec leur raison");
ok(M.RAISONS.desinscrit.indexOf("STOP") >= 0, "raison « STOP » en français courant");

console.log("▶ E-mail");
r = M.cibler(fiches, "email", { statut: "prospect" }, ctx, etape);
eq(noms(r), ["Bêta", "Gamma", "Delta", "Epsilon", "Iota"], "e-mail : tout prospect avec une adresse valide non rejetée");
ok(r.exclus.email_rebond.length === 1 && r.exclus.email_invalide.length === 1 && r.exclus.sans_email.length === 1, "exclus : adresse rejetée, adresse invalide, adresse absente — chacun avec sa raison");
ok(M.RAISONS.email_rebond.indexOf("revenu en erreur") >= 0, "les raisons sont en français courant");

console.log("▶ Filtres");
eq(noms(M.cibler(fiches, "email", { statut: "tous" }, ctx, etape)).includes("Thêta"), true, "« Prospects et clients » inclut les clients");
eq(noms(M.cibler(fiches, "email", { statut: "client" }, ctx, etape)), ["Thêta"], "« Clients » seulement");
eq(noms(M.cibler(fiches, "email", { statut: "prospect", logiciel: "MediCore Suite" }, ctx, etape)), [], "filtre logiciel : le seul prospect MediCore a une adresse invalide");
eq(noms(M.cibler(fiches, "email", { statut: "prospect", etape: "2" }, ctx, etape)), ["Epsilon"], "filtre étape 2");
eq(noms(M.cibler(fiches, "email", { statut: "prospect", etape: "0" }, ctx, etape)).includes("Epsilon"), false, "filtre étape 0 (la valeur 0 est bien un filtre, pas « tous »)");
eq(noms(M.cibler(fiches, "email", { statut: "prospect", texte: "COCODY" }, ctx, etape)).length, 5, "recherche sans accent ni casse (adresse)");
eq(noms(M.cibler(fiches, "email", { statut: "prospect", texte: "bet" }, ctx, etape)), ["Bêta"], "recherche « bet » trouve « Bêta »");
r = M.cibler(fiches, "email", { statut: "prospect", joursSansContact: 7 }, ctx, etape);
ok(!noms(r).includes("Iota") && r.exclus.deja_contacte.length === 1, "contacté récemment : exclu, avec sa raison");

console.log("▶ Message prêt à partir ?");
eq(M.manques("Bonjour Alpha, je suis Cyrille."), [], "message complet : rien ne manque");
eq(M.manques("Bonjour {prenom}, voici {logiciel}"), ["{prenom}", "{logiciel}"], "mots entre accolades non remplis détectés");
eq(M.manques("Montant : [montant HT / TTC]"), ["[montant HT / TTC]"], "passage entre crochets à compléter détecté");
eq(M.manques("Appelez le +225 XX XX XX XX"), ["XX XX"], "faux numéro « XX XX » détecté");
eq(M.manques("{a} {a}"), ["{a}"], "chaque manque n'est listé qu'une fois");
eq(M.manques("Tableau [1]"), [], "un chiffre entre crochets n'est pas un passage à compléter");
eq(M.separerObjet("Objet : Démo\n\nBonjour"), { objet: "Démo", corps: "Bonjour" }, "« Objet : » séparé du corps");
eq(M.separerObjet("Bonjour"), { objet: "", corps: "Bonjour" }, "sans objet : corps intact");

console.log("▶ Plafond Gmail");
const now = Date.parse("2026-11-17T12:00:00Z"), h = (x) => new Date(now - x * 36e5).toISOString();
const mails = [{ sent_at: h(1), status: "envoye" }, { sent_at: h(5), status: "repondu" }, { sent_at: h(30), status: "envoye" }, { sent_at: h(2), status: "echec" }];
ok(M.resteGmail(mails, now, 100) === 98, "98 restants : 2 envoyés sur 24 h ; l'échec et l'envoi vieux de 30 h ne comptent pas");
ok(M.resteGmail([], now, 100) === 100 && M.resteGmail(new Array(120).fill({ sent_at: h(1), status: "envoye" }), now, 100) === 0, "jamais négatif");
eq(M.lot(40, 25), { partent: 25, restent: 15 }, "40 à envoyer, 25 possibles : 25 partent, 15 restent");
eq(M.lot(10, 0), { partent: 0, restent: 10 }, "plafond atteint : rien ne part");

console.log("▶ Historique");
const l = M.ligneHistorique({ canal: "WhatsApp", mode: "wa", statut: "ouvert", client_id: 3, nom: "Gamma", extrait: "Bonjour\n\n   Gamma  " + "x".repeat(200), commercial: "Admin" });
ok(l.extrait.length <= 90 && !/\n/.test(l.extrait), "extrait nettoyé et limité à 90 caractères");
let hist = []; for (let i = 0; i < 520; i++) hist = M.ajouter(hist, M.ligneHistorique({ canal: "Email", mode: "gmail", statut: "envoye", nom: "N" + i }), 500);
ok(hist.length === 500 && hist[0].nom === "N519", "500 envois conservés, le plus récent en tête");
ok(M.resume({ retenus: [1, 2], nbExclus: 3, total: 5 }, "wa") === "2 joignables par WhatsApp · 3 exclus sur 5", "phrase de synthèse");
console.log("\nTous les contrôles passent.");
