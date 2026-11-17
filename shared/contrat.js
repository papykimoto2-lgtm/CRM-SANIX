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


  /* ───── Formes de licence ─────
     utilisation  : le client utilise le logiciel pour ses propres activités (le modèle en 14 articles ci-dessus) ;
     exploitation : un partenaire commercialise ou exploite le logiciel auprès de ses propres clients, selon un périmètre défini ;
     exclusive    : un partenaire bénéficie d'une exclusivité définie sur un territoire, un marché ou un secteur.
     Les deux modèles « partenaire » protègent le code source, la commercialisation, les revenus, les clients, les évolutions et la résiliation, et prévoient les conditions
     d'hébergement, de disponibilité, de sauvegarde, de réversibilité et de données personnelles. Ce sont des modèles de départ : à faire relire par un juriste. */
  var FORMES = {
    utilisation:  { cle: "utilisation",  ico: "👤", court: "Utilisation",              lib: "Licence d'utilisation",             contrepartie: "CLIENT",     sousTitre: "Licence d'exploitation de logiciel",
                    desc: "Le client utilise le logiciel pour ses propres activités." },
    exploitation: { cle: "exploitation", ico: "🤝", court: "Exploitation commerciale", lib: "Licence d'exploitation commerciale", contrepartie: "PARTENAIRE", sousTitre: "Licence d'exploitation commerciale",
                    desc: "Le partenaire commercialise ou exploite le logiciel auprès de ses propres clients, selon un périmètre défini." },
    exclusive:    { cle: "exclusive",    ico: "⭐", court: "Exclusive",                lib: "Licence exclusive",                  contrepartie: "PARTENAIRE", sousTitre: "Licence exclusive",
                    desc: "Un partenaire bénéficie d'une exclusivité définie sur un territoire, un marché ou un secteur." }
  };
  function forme(cle) { return FORMES[cle] || FORMES.utilisation; }

  var PARTIES = function (titre) {
    return [
      titre, "", "ENTRE LES SOUSSIGNÉS :", "",
      "{concedant}, ci-après dénommée « LE CONCÉDANT ».", "", "D'UNE PART,", "", "ET", "",
      "{partenaire}, société [forme juridique], dont le siège social est situé à {adresse_partenaire}, immatriculée au RCCM sous le numéro [Numéro], représentée par {representant_partenaire}, agissant en qualité de [Fonction], ci-après dénommée « LE PARTENAIRE ».",
      "", "D'AUTRE PART.", "", "Les parties conviennent de ce qui suit :", ""
    ];
  };
  var CONFIDENTIALITE = ["Les parties s'engagent à préserver la confidentialité des informations techniques, commerciales, financières et stratégiques échangées dans le cadre du présent contrat.", "Cette obligation demeure applicable après la fin du contrat."];
  var RESPONSABILITE = [
    "Chaque partie répond de ses propres obligations contractuelles.",
    "Le Concédant ne répond pas des engagements pris par le Partenaire envers ses clients au-delà de ce que prévoient le présent contrat et la documentation officielle du logiciel.",
    "Le Concédant ne saurait être tenu responsable des dommages résultant notamment :",
    "* D'une mauvaise utilisation du logiciel.", "* D'une intervention non autorisée.", "* D'une défaillance d'un équipement ou service tiers.", "* D'une indisponibilité imputable à un prestataire externe.",
    "Cette limitation ne s'applique pas aux responsabilités auxquelles la loi interdit de déroger."
  ];
  var FIN = ["", "FAIT À {ville}, LE {date}", "", "LE CONCÉDANT", "{concedant_nom}", "Nom :", "Signature et cachet :", "", "LE PARTENAIRE", "{partenaire}", "Nom :", "Signature et cachet :"];

  /** Articles du modèle « partenaire » ; l'exclusivité ajoute un article d'objectifs et remplace le périmètre. */
  function articlesPartenaire(excl) {
    var A = [];
    A.push(["OBJET DU CONTRAT", [
      "Le présent contrat a pour objet de définir les conditions dans lesquelles le Concédant autorise le Partenaire à commercialiser et à exploiter, auprès de ses propres clients et dans le périmètre défini ci-après, le logiciel dénommé :",
      "{logiciel}",
      "Le Partenaire ne devient en aucun cas propriétaire du logiciel : il bénéficie d'un droit de commercialisation et d'exploitation, dans les limites du présent contrat."]]);
    A.push(["PROPRIÉTÉ INTELLECTUELLE ET CODE SOURCE", [
      "Le logiciel, son architecture, son code source, ses bases de données structurantes, ses interfaces, ses algorithmes, sa documentation technique et ses évolutions demeurent la propriété exclusive du Concédant.",
      "Le code source n'est en aucun cas remis au Partenaire. Le présent contrat ne constitue pas une cession de propriété intellectuelle.",
      "Le Partenaire s'interdit notamment :",
      "* De copier, décompiler, procéder à une ingénierie inverse ou extraire le code source, sauf disposition légale contraire.",
      "* De modifier, adapter ou faire développer par un tiers des éléments du logiciel sans autorisation écrite du Concédant.",
      "* De déposer, à son nom, une marque, un nom de domaine ou un droit portant sur le logiciel ou sur les signes distinctifs du Concédant.",
      "* De supprimer ou d'altérer les mentions de propriété intellectuelle.",
      "* De revendiquer la propriété du logiciel ou de ses composants."]]);
    A.push(excl
      ? ["PÉRIMÈTRE ET EXCLUSIVITÉ", [
          "La licence est accordée à titre exclusif, personnel et non cessible, pour le territoire suivant : {territoire}, et pour le marché ou secteur suivant : [Marché / secteur].",
          "Pendant la durée du contrat, le Concédant s'interdit de désigner un autre partenaire ou distributeur pour commercialiser le logiciel sur ce périmètre. Il conserve le droit de poursuivre sa relation avec les clients déjà existants à la date de signature : [Liste des clients réservés ou « aucun »].",
          "Le Partenaire s'interdit, sur ce périmètre, de commercialiser un logiciel concurrent du logiciel objet du présent contrat, sauf accord écrit du Concédant.",
          "L'exclusivité ne s'étend pas au-delà de ce périmètre. Toute extension fera l'objet d'un avenant."]]
      : ["PÉRIMÈTRE DE LA LICENCE", [
          "La licence est accordée à titre non exclusif, personnel et non cessible, pour le territoire suivant : {territoire}, et pour le marché ou secteur suivant : [Marché / secteur].",
          "Le Partenaire peut proposer à ses clients des licences d'utilisation du logiciel, dans les conditions prévues au présent contrat.",
          "Le Concédant reste libre de commercialiser le logiciel lui-même ou par l'intermédiaire d'autres partenaires.",
          "Toute extension du périmètre fera l'objet d'un avenant."]]);
    if (excl) A.push(["OBJECTIFS ET MAINTIEN DE L'EXCLUSIVITÉ", [
      "En contrepartie de l'exclusivité, le Partenaire s'engage à atteindre l'objectif minimal suivant : [Objectif minimal annuel : nombre de licences ou chiffre d'affaires].",
      "Si cet objectif n'est pas atteint, le Concédant peut, après mise en demeure restée sans effet pendant trente (30) jours, convertir la licence en licence non exclusive ou résilier le contrat.",
      "Le Partenaire rend compte de son activité au Concédant selon la périodicité suivante : [Périodicité]."]]);
    A.push(["DURÉE", [
      "Le présent contrat est conclu pour [une durée de 12 mois renouvelable / une durée indéterminée / autre].",
      "Il prend effet à compter de sa date de signature.",
      "Les conditions de renouvellement sont définies entre les parties."]]);
    A.push(["CONDITIONS FINANCIÈRES ET REDEVANCES", [
      "En contrepartie du droit de commercialisation, le Partenaire s'engage à verser au Concédant :",
      "* Pour chaque licence vendue : {redevance}.",
      "* Droit d'entrée éventuel : [Montant] FCFA.",
      "* Maintenance et assistance de second niveau : [Conditions].",
      "Les sommes dues sont réglées selon les modalités suivantes : [Échéancier / délai de paiement].",
      "Le Partenaire transmet au Concédant, [chaque mois / chaque trimestre], un état des licences vendues. Le Concédant peut contrôler ces états sur pièces.",
      "Tout retard de paiement autorise le Concédant à suspendre la fourniture des licences et de l'assistance, après mise en demeure restée sans effet pendant quinze (15) jours."]]);
    A.push(["CONDITIONS DE COMMERCIALISATION", [
      "Le Partenaire commercialise le logiciel sous sa responsabilité, dans le respect de la loi et des conditions tarifaires minimales fixées par le Concédant.",
      "Il s'interdit de prendre, au nom du Concédant, des engagements, garanties ou promesses non prévus par le présent contrat ou par la documentation officielle du logiciel.",
      "Chaque client final accepte les conditions d'utilisation du Concédant ; le contrat avec le client final est conclu [au nom du Concédant / au nom du Partenaire, dans le respect des conditions d'utilisation du Concédant].",
      "Le Partenaire n'utilise la dénomination, la marque et les supports du logiciel que dans les conditions approuvées par le Concédant."]]);
    A.push(["CLIENTS ET PORTEFEUILLE CLIENTS", [
      "Le Partenaire communique au Concédant l'identité des clients finaux auxquels il vend une licence, afin d'assurer l'activation, la maintenance et la traçabilité des licences.",
      "Les clients finaux ainsi apportés sont [rattachés au Partenaire pour la durée du contrat / des clients communs aux deux parties]. Les règles de gestion du portefeuille clients sont les suivantes : [Règles].",
      "Chaque partie s'interdit de détourner à son profit exclusif les clients de l'autre apportés dans le cadre du présent contrat, pendant sa durée et pendant [Durée] après son terme."]]);
    A.push(["ÉVOLUTIONS ET DÉVELOPPEMENTS SPÉCIFIQUES", [
      "Les mises à jour et améliorations génériques du logiciel demeurent la propriété exclusive du Concédant, y compris lorsqu'elles résultent de suggestions du Partenaire.",
      "Les développements spécifiques demandés par le Partenaire ou par ses clients font l'objet d'un devis et d'un avenant écrits ; sauf disposition contraire de cet avenant, ils restent la propriété du Concédant, le Partenaire ou le client final disposant d'un droit d'usage."]]);
    A.push(["MAINTENANCE ET ASSISTANCE", [
      "Le Partenaire assure l'assistance de premier niveau auprès de ses clients (prise en charge, qualification et résolution des demandes courantes).",
      "Le Concédant assure, selon les conditions convenues, la maintenance corrective, les mises à jour techniques et l'assistance de second niveau."]]);
    A.push(["HÉBERGEMENT, DISPONIBILITÉ, SAUVEGARDE, RÉVERSIBILITÉ ET DONNÉES PERSONNELLES", [
      "Lorsque le logiciel est fourni en mode hébergé ou synchronisé (SaaS), les conditions suivantes s'appliquent :",
      "* Hébergement : [Hébergeur et lieu d'hébergement].",
      "* Disponibilité : [Niveau de disponibilité et plages de maintenance].",
      "* Sauvegarde : [Fréquence et durée de conservation des sauvegardes].",
      "* Réversibilité : à la fin du contrat, les données des clients finaux sont restituées dans un format exploitable, dans un délai de [Délai] jours.",
      "* Données personnelles : chaque partie respecte la réglementation applicable en matière de protection des données à caractère personnel. Le Concédant agit [en qualité de sous-traitant / de responsable de traitement] et met en œuvre des mesures de sécurité appropriées ; les modalités détaillées font l'objet d'une annexe."]]);
    A.push(["CONFIDENTIALITÉ", CONFIDENTIALITE]);
    A.push(["LIMITATION DE RESPONSABILITÉ", RESPONSABILITE]);
    A.push(["RÉSILIATION ET FIN DU CONTRAT", [
      "En cas de manquement grave à ses obligations par l'une des parties, le contrat pourra être résilié après mise en demeure restée sans effet pendant trente (30) jours, sauf urgence ou disposition légale contraire.",
      "À la fin du contrat, quelle qu'en soit la cause, le Partenaire cesse de commercialiser le logiciel et de se prévaloir de sa qualité de partenaire du Concédant. Il ne peut en aucun cas s'approprier le logiciel, son code, sa documentation ni ses évolutions.",
      "Les licences déjà vendues à des clients finaux demeurent valables dans les conditions prévues à leur contrat ; leur maintenance est assurée [par le Concédant / selon les modalités suivantes : …] pendant une période de transition de [Durée].",
      "Les sommes restant dues demeurent exigibles."]]);
    A.push(["INDÉPENDANCE DES PARTIES", [
      "Le présent contrat ne crée aucune relation de société, de partenariat capitalistique, de mandat général ou de relation de travail entre les parties.",
      "Le Partenaire agit en son nom et pour son compte : il n'est ni mandataire, ni agent, ni salarié du Concédant. Chaque partie conserve son indépendance juridique et commerciale."]]);
    A.push(["DROIT APPLICABLE ET RÈGLEMENT DES LITIGES", [
      "Le présent contrat est soumis au droit applicable en République de Côte d'Ivoire, notamment aux textes pertinents de l'OAPI et aux dispositions applicables du droit OHADA.",
      "Tout différend fera prioritairement l'objet d'une tentative de règlement amiable.",
      "À défaut d'accord, les juridictions compétentes de Côte d'Ivoire seront saisies, sous réserve des règles impératives de compétence."]]);
    A.push(["DISPOSITIONS FINALES", [
      "Toute modification du présent contrat devra faire l'objet d'un avenant écrit signé par les deux parties.",
      "Le présent contrat est établi en deux exemplaires originaux."]]);
    return A;
  }
  function modelePartenaire(excl) {
    var L = PARTIES(excl ? "CONTRAT DE LICENCE EXCLUSIVE DE LOGICIEL" : "CONTRAT DE LICENCE D'EXPLOITATION COMMERCIALE DE LOGICIEL");
    articlesPartenaire(excl).forEach(function (a, i) {
      L.push("ARTICLE " + (i + 1) + " – " + a[0]); a[1].forEach(function (l) { L.push(l); }); L.push("");
    });
    L.pop();
    return L.concat(FIN).join("\n");
  }
  var MODELES = { utilisation: MODELE, exploitation: modelePartenaire(false), exclusive: modelePartenaire(true) };
  /** Modèle de contrat selon la forme de licence (utilisation par défaut). */
  function modele(cle) { return MODELES[cle] || MODELE; }

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

  var API = { MODELE: MODELE, MODELES: MODELES, modele: modele, FORMES: FORMES, forme: forme, corps: corps, concedant: concedant, duree: duree, remplir: remplir, restants: restants, enHtml: enHtml };
  G.SanixContrat = API; if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
