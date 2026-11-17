// SANIX CRM Pro : contrat de licence (modèle complet, remplissage, passages à compléter, aucune mention de société non renseignée). node contrat_test.js
const C = require("../shared/contrat.js");
const ok = (c, m) => { if (!c) throw new Error("ÉCHEC : " + m); console.log("  ✓ " + m); };
const base = { nom: "SANIX Africa Division Technologies", adresse: "Abidjan, Côte d'Ivoire", representant: "Cyrille KESIE" };

console.log("▶ Modèle");
ok((C.MODELE.match(/^ARTICLE \d+ – /gm) || []).length === 14, "le modèle comporte les 14 articles");
ok(/ARTICLE 14 – DISPOSITIONS FINALES/.test(C.MODELE) && /FAIT À \{ville\}, LE \{date\}/.test(C.MODELE) && /Signature et cachet/.test(C.MODELE), "il se termine par les dispositions finales, le lieu, la date et les signatures");
ok(!/société de droit ivoirien/i.test(C.MODELE), "le modèle n'affirme nulle part que le Concédant est une « société de droit ivoirien »");

console.log("▶ Identité du Concédant (aucune mention non renseignée)");
let c = C.concedant(base);
ok(c.startsWith("SANIX AFRICA DIVISION TECHNOLOGIES, dont le siège est situé à Abidjan, Côte d'Ivoire, représentée par Cyrille KESIE"), "sans forme, capital ni RCCM : seulement le nom, le siège et le représentant");
ok(!/société|capital|RCCM/i.test(c), "aucun mot « société », « capital » ou « RCCM » n'apparaît tant que ces champs sont vides");
ok(/agissant en qualité de \[Fonction\]$/.test(c), "la fonction inconnue reste entre crochets à compléter");
c = C.concedant({ ...base, forme: "SARL", capital: "1000000", rccm: "CI-ABJ-2026-B-12345" });
ok(/société SARL au capital de 1000000 FCFA, immatriculée au RCCM sous le numéro CI-ABJ-2026-B-12345/.test(c), "avec forme, capital et RCCM renseignés : ils apparaissent");
ok(C.concedant({ ...base, capital: "500000" }).includes("au capital de 500000 FCFA") && !/société/.test(C.concedant({ ...base, capital: "500000" })), "capital seul : mentionné sans inventer de forme juridique");
ok(/\[Adresse\]/.test(C.concedant({ nom: "X" })) && /\[Nom du représentant\]/.test(C.concedant({ nom: "X" })), "adresse ou représentant absents : crochets à compléter");

console.log("▶ Durée selon le type de licence");
ok(C.duree("Perpetuelle") === "une durée indéterminée" && C.duree("Annuelle") === "une durée de 12 mois", "perpétuelle → durée indéterminée ; annuelle → 12 mois");
ok(/^\[une durée/.test(C.duree("")) && /^\[une durée/.test(C.duree("Autre")), "type inconnu : choix laissé à compléter");

console.log("▶ Remplissage");
const v = { concedant: c, concedant_nom: "SANIX AFRICA", licencie: "Clinique Alpha", adresse_licencie: "Cocody", representant_licencie: "Dr Alpha", logiciel: "MediCore Suite", duree: C.duree("Perpetuelle"), total: "1 500 000", maintenance: "60 000 FCFA par mois", ville: "Abidjan", date: "17/11/2026" };
const t = C.remplir(C.MODELE, v);
ok(!/\{[a-z_]+\}/.test(t), "toutes les variables connues sont remplies (aucune accolade ne reste)");
ok(/Clinique Alpha, société \[forme juridique\], dont le siège social est situé à Cocody/.test(t) && /représentée par Dr Alpha/.test(t), "le Licencié est rempli avec le nom, l'adresse et le représentant de la fiche");
ok(/Frais initiaux de licence : 1 500 000 FCFA HT\./.test(t) && /Frais de maintenance : 60 000 FCFA par mois\./.test(t), "montants repris du catalogue et de la fiche");
ok(/FAIT À Abidjan, LE 17\/11\/2026/.test(t), "lieu et date");
ok(C.remplir("{inconnu} {logiciel}", { logiciel: "X" }) === "{inconnu} X", "une variable inconnue n'est pas supprimée : elle sera signalée");

console.log("▶ Passages à compléter");
const r = C.restants(t);
ok(r.includes("[forme juridique]") && r.includes("[Numéro]") && r.includes("[Fonction]") && r.includes("[Territoire]") && r.includes("[Échéancier]") && r.includes("[non exclusif / exclusif]"), "les passages que le CRM ne peut pas connaître sont listés : " + r.join(", "));
ok(C.restants("A {x} B [Montant]").join() === "[Montant],{x}", "crochets et variables inconnues sont détectés");
ok(C.restants("Tableau [1]").length === 0, "un chiffre entre crochets n'est pas un passage à compléter");

console.log("▶ HTML");
const h = C.enHtml(t);
ok((h.html.match(/<h3 class="ar">/g) || []).length === 14 && /<h2 class="ct">CONTRAT DE LICENCE D'EXPLOITATION DE LOGICIEL<\/h2>/.test(h.html), "titre et 14 articles mis en forme");
ok(h.nbRestants === (h.html.match(/<mark class="ph">/g) || []).length && h.nbRestants >= 6, "chaque passage à compléter est surligné (" + h.nbRestants + ")");
ok((h.html.match(/<div class="li">• /g) || []).length >= 25, "les listes sont mises en puces");
const x = C.enHtml(C.remplir("{licencie} [a]b", { licencie: "<script>alert(1)</script> & Cie" }));
ok(!/<script>/.test(x.html) && /&lt;script&gt;/.test(x.html), "le nom d'un client est échappé : aucun HTML injecté dans le contrat");
console.log("\nContrat : tous les contrôles passent.");
