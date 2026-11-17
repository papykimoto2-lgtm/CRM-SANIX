/* SANIX CRM — Contrat de licence d'exploitation de logiciel : le modèle complet (14 articles) et son remplissage à partir de la fiche du client et des réglages.
   Moteur sans interface (testable sous Node). Il ne devine rien : ce que le CRM ne sait pas reste entre [crochets] et est signalé pour être complété avant signature.
   Rien n'affirme que l'entreprise est une société : la forme juridique, le capital et le RCCM n'apparaissent que s'ils sont renseignés dans les réglages. */
(function (G) {
  "use strict";
  var MODELE = [
    "CONTRAT DE LICENCE D'EXPLOITATION DE LOGICIEL",
    "",
    "ENTRE LES SOUSSIGNÉS :",
    "",
    "{concedant}, ci-après dénommée « LE CONCÉDANT ».",
    "",
    "D'UNE PART,",
    "",
    "ET",
    "",
    "{licencie}, société [forme juridique], dont le siège social est situé à {adresse_licencie}, immatriculée au RCCM sous le numéro [Numéro], représentée par {representant_licencie}, agissant en qualité de [Fonction], ci-après dénommée « LE LICENCIÉ ».",
    "",
    "D'AUTRE PART.",
    "",
    "Les parties conviennent de ce qui suit :",
    "",
    "ARTICLE 1 – OBJET DU CONTRAT",
    "Le présent contrat a pour objet de définir les conditions dans lesquelles le Concédant accorde au Licencié une licence d'utilisation et d'exploitation du logiciel dénommé :",
    "{logiciel}",
    "Cette licence autorise le Licencié à utiliser le logiciel dans le cadre de ses activités professionnelles, conformément aux conditions définies dans le présent contrat.",
    "",
    "ARTICLE 2 – PROPRIÉTÉ INTELLECTUELLE",
    "Le logiciel, son architecture, son code source, ses bases de données structurantes, ses interfaces, ses algorithmes, sa documentation technique et ses évolutions demeurent la propriété exclusive du Concédant, sous réserve des droits de tiers et des éléments appartenant au Licencié.",
    "Le présent contrat ne constitue en aucun cas une cession de propriété intellectuelle.",
    "Le Licencié s'interdit notamment :",
    "* De vendre ou céder le logiciel à un tiers sans autorisation écrite.",
    "* De reproduire ou commercialiser le code source.",
    "* De procéder à une décompilation ou une ingénierie inverse non autorisée par la loi.",
    "* De supprimer les mentions de propriété intellectuelle.",
    "* De revendiquer la propriété du logiciel ou de ses composants appartenant au Concédant.",
    "",
    "ARTICLE 3 – ÉTENDUE DE LA LICENCE",
    "La licence accordée comprend :",
    "* Le droit d'utiliser le logiciel.",
    "* Le droit d'accès aux fonctionnalités souscrites.",
    "* Le droit d'exploitation dans le cadre des activités autorisées.",
    "* Le droit d'accès aux mises à jour selon les modalités convenues.",
    "* Le droit d'utiliser la documentation utilisateur.",
    "La licence est accordée à titre [non exclusif / exclusif], pour le territoire suivant : [Territoire].",
    "Toute extension du périmètre d'exploitation devra faire l'objet d'un avenant.",
    "",
    "ARTICLE 4 – DURÉE",
    "Le présent contrat est conclu pour {duree}.",
    "Il prend effet à compter de sa date de signature.",
    "Les conditions de renouvellement sont définies entre les parties.",
    "",
    "ARTICLE 5 – CONDITIONS FINANCIÈRES",
    "En contrepartie de la licence, le Licencié s'engage à verser au Concédant :",
    "* Frais initiaux de licence : {total} FCFA HT.",
    "* Redevance périodique : [Montant] FCFA.",
    "* Frais de maintenance : {maintenance}.",
    "* Prestations complémentaires : selon devis accepté.",
    "Les modalités de paiement sont les suivantes : [Échéancier].",
    "",
    "ARTICLE 6 – MAINTENANCE ET ASSISTANCE",
    "Le Concédant assure, selon les conditions commerciales convenues :",
    "* La maintenance corrective.",
    "* Les mises à jour techniques.",
    "* L'assistance à l'utilisation.",
    "* La correction des anomalies relevant du logiciel.",
    "* L'accompagnement technique convenu.",
    "Les développements spécifiques feront l'objet d'une facturation distincte, sauf disposition contraire.",
    "",
    "ARTICLE 7 – OBLIGATIONS DU LICENCIÉ",
    "Le Licencié s'engage à :",
    "* Utiliser le logiciel conformément à sa destination.",
    "* Respecter les droits de propriété intellectuelle.",
    "* Assurer la confidentialité de ses identifiants.",
    "* Ne pas permettre un accès non autorisé.",
    "* Régler les sommes dues.",
    "* Signaler les dysfonctionnements constatés.",
    "",
    "ARTICLE 8 – CONFIDENTIALITÉ",
    "Les parties s'engagent à préserver la confidentialité des informations techniques, commerciales, financières et stratégiques échangées dans le cadre du présent contrat.",
    "Cette obligation demeure applicable après la fin du contrat.",
    "",
    "ARTICLE 9 – DONNÉES ET SÉCURITÉ",
    "Les données métiers introduites par le Licencié demeurent sous le contrôle et selon les droits du Licencié.",
    "Le Concédant s'engage à mettre en œuvre les mesures de sécurité convenues pour protéger les données hébergées ou traitées dans le cadre du service.",
    "Les modalités d'accès, de sauvegarde, de restitution et de suppression des données seront précisées dans une annexe technique.",
    "",
    "ARTICLE 10 – LIMITATION DE RESPONSABILITÉ",
    "Chaque partie répond de ses propres obligations contractuelles.",
    "Le Concédant ne saurait être tenu responsable des dommages résultant notamment :",
    "* D'une mauvaise utilisation du logiciel.",
    "* D'une intervention non autorisée.",
    "* D'une défaillance d'un équipement ou service tiers.",
    "* D'une indisponibilité imputable à un prestataire externe.",
    "Cette limitation ne s'applique pas aux responsabilités auxquelles la loi interdit de déroger.",
    "",
    "ARTICLE 11 – RÉSILIATION",
    "En cas de manquement grave à ses obligations par l'une des parties, le contrat pourra être résilié après mise en demeure restée sans effet pendant trente (30) jours, sauf urgence ou disposition légale contraire.",
    "À la fin du contrat, le Licencié devra cesser toute utilisation non autorisée du logiciel.",
    "Les conditions de restitution des données et de règlement des sommes restant dues demeurent applicables.",
    "",
    "ARTICLE 12 – INDÉPENDANCE DES PARTIES",
    "Le présent contrat ne crée aucune relation de société, de partenariat capitalistique, de mandat général ou de relation de travail entre les parties.",
    "Chaque partie conserve son indépendance juridique et commerciale.",
    "",
    "ARTICLE 13 – DROIT APPLICABLE ET RÈGLEMENT DES LITIGES",
    "Le présent contrat est soumis au droit applicable en République de Côte d'Ivoire, notamment aux textes pertinents de l'OAPI et aux dispositions applicables du droit OHADA.",
    "Tout différend fera prioritairement l'objet d'une tentative de règlement amiable.",
    "À défaut d'accord, les juridictions compétentes de Côte d'Ivoire seront saisies, sous réserve des règles impératives de compétence.",
    "",
    "ARTICLE 14 – DISPOSITIONS FINALES",
    "Toute modification du présent contrat devra faire l'objet d'un avenant écrit signé par les deux parties.",
    "Le présent contrat est établi en deux exemplaires originaux.",
    "",
    "FAIT À {ville}, LE {date}",
    "",
    "LE CONCÉDANT",
    "{concedant_nom}",
    "Nom :",
    "Signature et cachet :",
    "",
    "LE LICENCIÉ",
    "{licencie}",
    "Nom :",
    "Signature et cachet :"
  ].join("\n");

  var s = function (v) { return v == null ? "" : String(v).trim(); };

  /** Identité du Concédant : le nom, puis la forme juridique / le capital / le RCCM SEULEMENT s'ils sont renseignés, puis le siège et le représentant. */
  function concedant(o) {
    o = o || {}; var leg = [];
    if (s(o.forme)) leg.push("société " + s(o.forme) + (s(o.capital) ? " au capital de " + s(o.capital) + " FCFA" : ""));
    else if (s(o.capital)) leg.push("au capital de " + s(o.capital) + " FCFA");
    if (s(o.rccm)) leg.push("immatriculée au RCCM sous le numéro " + s(o.rccm));
    return s(o.nom).toUpperCase() + (leg.length ? ", " + leg.join(", ") : "") + ", dont le siège est situé à " + (s(o.adresse) || "[Adresse]")
      + ", représentée par " + (s(o.representant) || "[Nom du représentant]") + ", agissant en qualité de " + (s(o.fonction) || "[Fonction]");
  }

  /** Durée selon le type de licence du catalogue. */
  function duree(typeLicence) {
    var t = s(typeLicence);
    return /perp/i.test(t) ? "une durée indéterminée" : /annu/i.test(t) ? "une durée de 12 mois" : "[une durée de 12 mois / une durée indéterminée / autre]";
  }

  /** Remplace {nom} pour les variables connues ; les autres restent telles quelles (pour être signalées). */
  function remplir(texte, vars) {
    return String(texte == null ? "" : texte).replace(/\{([a-z_]+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vars || {}, k) && vars[k] != null ? String(vars[k]) : m; });
  }

  /** Passages à compléter : [entre crochets] et {variables} inconnues. */
  function restants(texte) {
    var t = String(texte == null ? "" : texte), out = [];
    (t.match(/\[[^\]\n]{2,}\]/g) || []).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    (t.match(/\{[a-z_]+\}/g) || []).forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
    return out;
  }

  /** Texte → HTML : titre, articles, puces, passages à compléter surlignés. `esc` échappe le HTML (fourni par le CRM). */
  function enHtml(texte, esc) {
    esc = esc || function (x) { return String(x).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    var n = 0, out = [], premiere = true;
    String(texte == null ? "" : texte).split("\n").forEach(function (l) {
      var e = esc(l).replace(/\[[^\]\n]{2,}\]/g, function (m) { n++; return '<mark class="ph">' + m + "</mark>"; });
      if (!l.trim()) out.push('<div class="bl"></div>');
      else if (premiere) { premiere = false; out.push('<h2 class="ct">' + e + "</h2>"); }
      else if (/^ARTICLE \d+/.test(l)) out.push('<h3 class="ar">' + e + "</h3>");
      else if (/^\* /.test(l)) out.push('<div class="li">• ' + e.slice(2) + "</div>");
      else if (/^(D'UNE PART,|D'AUTRE PART\.|ET)$/.test(l.trim())) out.push('<p class="c">' + e + "</p>");
      else out.push("<p>" + e + "</p>");
    });
    return { html: out.join(""), nbRestants: n };
  }

  /** Texte du contrat SANS les deux blocs de signature finaux : la page officielle porte déjà ses lignes de signature, le tampon et le QR code. */
  function corps(texte) {
    var t = String(texte == null ? "" : texte), i = t.search(/\nLE CONCÉDANT\s*\n/);
    return i >= 0 ? t.slice(0, i).replace(/\s+$/, "") : t.replace(/\s+$/, "");
  }

  var API = { MODELE: MODELE, corps: corps, concedant: concedant, duree: duree, remplir: remplir, restants: restants, enHtml: enHtml };
  G.SanixContrat = API; if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
