/* SANIX CRM — Levée de fonds : état de préparation, éligibilité par type de financeur et simulation.
 *
 * Calculs purs (SanixLevee.calc, testables sans navigateur) + écran « Levée de fonds » (#view-levee, groupe Finance).
 * Les indicateurs sont MESURÉS dans le CRM (commandes, paiements, pipeline, fiche société) et dans le modèle « Financement » : rien n'est saisi à la main
 * sauf les critères de dossier qu'aucun chiffre ne prouve (pacte d'associés, équipe, pitch deck…), cochés par la direction.
 * Les seuils sont des REPÈRES INDICATIFS de bonnes pratiques, modifiables : chaque financeur ou programme fixe les siens, à vérifier dans son règlement.
 * Une donnée non mesurable (historique trop court, champ non renseigné) compte pour 0 et est signalée « à documenter » : jamais d'estimation inventée.
 * Données propres à l'appareil : localStorage « sanix_crm_levee_config » (seulement ce que l'utilisateur a modifié).
 */
(function (G) {
  'use strict';
  const num = (v) => { v = Number(v); return isFinite(v) ? v : 0; };
  const pos = (v) => Math.max(0, num(v));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, num(v)));
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const STATUTS_VENTE = ['confirmee', 'en_cours', 'livree'];
  const RECURRENT = /annuel|mensuel|abonn|saas/i;
  const cleNom = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const monthKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');

  /* ───────────── Mesures : tout ce que le CRM permet de calculer ───────────── */
  /** src : { commandes, config, now, pipelinePondere, modele }. Renvoie des nombres, ou null quand la donnée n'est pas mesurable. */
  function mesurer(src) {
    src = src || {}; const now = src.now ? new Date(src.now) : new Date(), cur = monthKey(now);
    const cm = (src.commandes || []).filter((c) => c && STATUTS_VENTE.indexOf(c.statut) >= 0 && c.date);
    const htDe = (c) => pos(c.htNet) || Math.round(pos(c.ttc) / 1.18);
    const mois = []; for (let i = 12; i >= 1; i--) mois.push({ k: monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)), ht: 0 });
    const idx = {}; mois.forEach((x, i) => { idx[x.k] = i; });
    let ht12 = 0, livre12 = 0, ttcTot = 0, verse = 0, rec = 0, htTot = 0, premiere = null;
    const parClient = {}, parLog = {}, nomLog = {}, payants = {}; let livreTotal = 0;
    cm.forEach((c) => {
      const d = String(c.date).slice(0, 10), k = d.slice(0, 7), ht = htDe(c), ttc = pos(c.ttc) || ht, v = Math.min(ttc, pos(c.acompte)), cl = cleNom(c.client);
      if (!premiere || d < premiere) premiere = d;
      htTot += ht; ttcTot += ttc; verse += v; if (c.statut === 'livree') livreTotal += ht;
      if (c.renouvellement || RECURRENT.test(c.typeLicence || '')) rec += ht;
      parClient[cl] = (parClient[cl] || 0) + ht; if (v > 0) payants[cl] = 1;
      const lg = cleNom(c.logiciel); if (lg && !c.renouvellement) { parLog[lg] = (parLog[lg] || 0) + ht; nomLog[lg] = c.logiciel; }
      if (k >= mois[0].k && k <= cur) { ht12 += ht; if (c.statut === 'livree') livre12 += ht; if (idx[k] !== undefined) mois[idx[k]].ht += ht; }
    });
    const moisAct = premiere ? Math.max(0, Math.round((now - new Date(premiere)) / (30.44 * 864e5) * 10) / 10) : 0;
    const tri = (a) => sum(a, (x) => x.ht), dernier = tri(mois.slice(9)), precedent = tri(mois.slice(6, 9));
    const croissance = moisAct >= 6 && precedent > 0 ? Math.pow(dernier / precedent, 1 / 3) - 1 : null;     // taux mensuel moyen, 3 derniers mois pleins contre les 3 précédents
    const rythme = ht12 > 0 ? ht12 / Math.max(1, moisAct) : 0;                                            // ventes HT par mois depuis la première vente
    const noms = Object.keys(parClient).filter(Boolean), tops = noms.map((k) => parClient[k]).sort((a, b) => b - a), logs = Object.keys(parLog).map((k) => parLog[k]).sort((a, b) => b - a);
    const cfg = src.config || {}, mo = src.modele || {};
    return {
      now: now.toISOString().slice(0, 10), premiere: premiere, livreTotal: livreTotal, topLogicielNom: (Object.keys(parLog).sort((a, b) => parLog[b] - parLog[a])[0] && nomLog[Object.keys(parLog).sort((a, b) => parLog[b] - parLog[a])[0]]) || null, nbCommandes: cm.length, vendu12: ht12, livre12, vendu: htTot, moisAct, rythme, croissance,
      clients: noms.length, clientsPayants: Object.keys(payants).length,
      recurrent: htTot > 0 ? rec / htTot : null, top1: htTot > 0 && tops[0] ? tops[0] / htTot : null, topLogiciel: sum(logs, (x) => x) > 0 ? logs[0] / sum(logs, (x) => x) : null,
      encaisse: ttcTot > 0 ? verse / ttcTot : null, produits: logs.length,
      pipelineMois: rythme > 0 && src.pipelinePondere != null ? pos(src.pipelinePondere) / rythme : null,
      immat: !!(String(cfg.rccm || '').trim() && String(cfg.cc || '').trim()), forme: !!(String(cfg.forme || '').trim() && String(cfg.capital || '').trim()), banque: !!String(cfg.banque || '').trim(),
      modeleValide: !!mo.valide, pointMort: mo.pointMort == null ? null : num(mo.pointMort), besoin: mo.besoin == null ? null : pos(mo.besoin), mensuel: mois,
    };
  }

  /* ───────────── Critères : un indicateur mesuré (ou coché) par ligne, une note explicative chacun ───────────── */
  const SEUILS = {
    livre12: { ok: 20e6, warn: 5e6 }, clients: { ok: 10, warn: 3 }, moisAct: { ok: 12, warn: 6 }, croissance: { ok: 0.10, warn: 0 }, recurrent: { ok: 0.30, warn: 0.10 },
    top1: { ok: 0.40, warn: 0.60 }, topLogiciel: { ok: 0.50, warn: 0.70 }, encaisse: { ok: 0.70, warn: 0.40 }, pointMort: { ok: 36, warn: 60 }, produits: { ok: 3, warn: 2 }, pipelineMois: { ok: 6, warn: 3 },
  };
  const F = {
    m: (n) => (Math.round(num(n) / 1e5) / 10).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M FCFA',
    p: (n) => (num(n) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' %',
    n: (n) => (Math.round(num(n) * 10) / 10).toLocaleString('fr-FR'), mois: (n) => (Math.round(num(n) * 10) / 10).toLocaleString('fr-FR') + ' mois',
  };
  // sens : 'haut' (plus c'est haut, mieux c'est) ou 'bas' ; mes(m) : valeur mesurée ou null ; manuel : coché par la direction
  const CRITERES = [
    { id: 'immat', g: 'Juridique et gouvernance', lib: 'Société immatriculée (RCCM et compte contribuable)', manuel: false, mes: (m) => m.immat, bin: true,
      note: { def: 'La société existe légalement : numéro RCCM et numéro de compte contribuable (NCC) renseignés dans Paramétrage → Entreprise.', pourquoi: 'Aucun investisseur ni banque ne signe avec une entité non immatriculée : c\'est le premier point vérifié.', calcul: 'Lu dans Paramétrage → Entreprise (RCCM et N° CC).' },
      action: 'Renseigner le RCCM et le N° de compte contribuable dans Paramétrage → Entreprise (immatriculer la société d\'abord si ce n\'est pas fait).' },
    { id: 'forme', g: 'Juridique et gouvernance', lib: 'Forme juridique et capital social renseignés', mes: (m) => m.forme, bin: true,
      note: { def: 'Forme (SARL, SAS…) et capital social indiqués.', pourquoi: 'Elle détermine comment un investisseur peut entrer au capital et quels droits il obtient.', calcul: 'Lu dans Paramétrage → Entreprise (forme et capital).' },
      action: 'Renseigner la forme juridique et le capital dans Paramétrage → Entreprise.' },
    { id: 'banque', g: 'Juridique et gouvernance', lib: 'Compte bancaire professionnel', mes: (m) => m.banque, bin: true,
      note: { def: 'La société dispose d\'un compte bancaire à son nom.', pourquoi: 'Les fonds sont versés sur ce compte ; une banque ou un programme d\'appui l\'exige pour décaisser.', calcul: 'Lu dans Paramétrage → Entreprise (banque).' },
      action: 'Ouvrir un compte professionnel au nom de la société et le renseigner dans Paramétrage → Entreprise.' },
    { id: 'pacte', g: 'Juridique et gouvernance', lib: 'Répartition du capital et pacte d\'associés documentés', manuel: true,
      note: { def: 'Qui détient quoi, avec un pacte d\'associés ou des statuts clairs (vesting des fondateurs, décisions importantes).', pourquoi: 'Un capital flou ou un fondateur sans engagement de long terme fait fuir les investisseurs en capital.', calcul: 'Case cochée par la direction.' },
      action: 'Faire rédiger les statuts et un pacte d\'associés (avocat ou notaire) et les ranger dans la data room.' },
    { id: 'compta', g: 'Juridique et gouvernance', lib: 'Comptabilité tenue et états financiers disponibles', manuel: true,
      note: { def: 'Une comptabilité SYSCOHADA à jour, avec au moins un bilan et un compte de résultat.', pourquoi: 'Les banques et la plupart des programmes demandent les états financiers des 1 à 3 dernières années.', calcul: 'Case cochée par la direction.' },
      action: 'Faire arrêter les comptes par un expert-comptable et conserver bilan et compte de résultat.' },
    { id: 'moisAct', g: 'Traction commerciale', lib: 'Ancienneté de l\'activité commerciale', mes: (m) => m.nbCommandes ? m.moisAct : null, sens: 'haut', fmt: F.mois, cle: 'moisAct',
      note: { def: 'Nombre de mois écoulés depuis la première vente enregistrée.', pourquoi: 'Quelques mois de ventes ne prouvent pas que le modèle se répète ; un historique plus long rassure.', calcul: 'Date de la première commande (confirmée, en cours ou livrée) jusqu\'à aujourd\'hui.' },
      action: 'Le temps seul règle ce point : continuer à vendre régulièrement et à enregistrer chaque commande dans le CRM.', temps: true },
    { id: 'livre12', g: 'Traction commerciale', lib: 'Chiffre d\'affaires livré (12 derniers mois, HT)', mes: (m) => m.nbCommandes ? m.livre12 : null, sens: 'haut', fmt: F.m, cle: 'livre12',
      note: { def: 'Ventes dont le logiciel a été livré au client, hors taxes, sur 12 mois glissants.', pourquoi: 'C\'est le chiffre d\'affaires « acquis » : une commande seulement en cours peut encore être annulée, donc un investisseur la compte à part.', calcul: 'Somme du HT des commandes au statut « livrée ».' },
      action: 'Livrer et clôturer les commandes en cours (statut « livrée ») et facturer chaque livraison.', cumul: true },
    { id: 'clients', g: 'Traction commerciale', lib: 'Nombre de clients', mes: (m) => m.nbCommandes ? m.clients : null, sens: 'haut', fmt: F.n, cle: 'clients',
      note: { def: 'Clients distincts ayant une commande confirmée, en cours ou livrée.', pourquoi: 'Plusieurs clients différents montrent que le produit n\'est pas fait pour un seul acheteur.', calcul: 'Noms de client distincts parmi les commandes.' },
      action: 'Signer de nouveaux clients : voir Pipeline et Relances prioritaires.', cumul: true },
    { id: 'croissance', g: 'Traction commerciale', lib: 'Croissance mensuelle des ventes', mes: (m) => m.croissance, sens: 'haut', fmt: F.p, cle: 'croissance',
      note: { def: 'Taux de croissance mensuel moyen des ventes : les 3 derniers mois pleins comparés aux 3 précédents.', pourquoi: 'Les fonds d\'amorçage cherchent une croissance régulière ; 10 % par mois double l\'activité en 7 mois.', calcul: '(ventes des 3 derniers mois pleins ÷ ventes des 3 précédents) puissance 1/3, moins 1. Mesurable seulement avec au moins 6 mois d\'activité.' },
      action: 'Relancer les prospects chauds chaque semaine et suivre les ventes mois par mois ; ce chiffre apparaît quand l\'historique atteint 6 mois.' },
    { id: 'pipelineMois', g: 'Traction commerciale', lib: 'Pipeline pondéré (en mois de ventes)', mes: (m) => m.pipelineMois, sens: 'haut', fmt: F.mois, cle: 'pipelineMois',
      note: { def: 'Valeur du pipeline pondéré par les chances de conclure, exprimée en mois de ventes au rythme actuel.', pourquoi: 'Un pipeline qui couvre plusieurs mois de ventes rend la croissance prévisible.', calcul: 'Pipeline pondéré (CRM) ÷ ventes HT mensuelles moyennes depuis la première vente.' },
      action: 'Alimenter le pipeline : qualifier les prospects, saisir les deals et mettre à jour leurs probabilités.' },
    { id: 'recurrent', g: 'Qualité des revenus', lib: 'Part des revenus récurrents', mes: (m) => m.recurrent, sens: 'haut', fmt: F.p, cle: 'recurrent',
      note: { def: 'Part du chiffre d\'affaires issue d\'abonnements, de maintenance ou de renouvellements.', pourquoi: 'Un revenu qui revient sans nouvelle vente vaut beaucoup plus cher aux yeux d\'un investisseur qu\'une licence vendue une seule fois.', calcul: 'HT des commandes à abonnement (annuel, mensuel, SaaS) et des renouvellements ÷ HT total.' },
      action: 'Proposer des contrats de maintenance ou des abonnements et facturer les renouvellements (module Renouvellements).' },
    { id: 'top1', g: 'Qualité des revenus', lib: 'Poids du premier client', mes: (m) => m.top1, sens: 'bas', fmt: F.p, cle: 'top1',
      note: { def: 'Part du chiffre d\'affaires faite avec votre premier client.', pourquoi: 'Perdre un client qui pèse plus de la moitié du chiffre d\'affaires menace toute l\'entreprise : les investisseurs le regardent de près.', calcul: 'HT du plus gros client ÷ HT total.' },
      action: 'Diversifier : viser plusieurs clients de taille comparable plutôt qu\'un seul gros contrat.' },
    { id: 'topLogiciel', g: 'Qualité des revenus', lib: 'Poids du premier logiciel', mes: (m) => m.topLogiciel, sens: 'bas', fmt: F.p, cle: 'topLogiciel',
      note: { def: 'Part des ventes issue de votre logiciel le plus vendu.', pourquoi: 'Dépendre d\'un seul produit est un risque ; plusieurs produits qui se vendent prouvent une capacité à répéter.', calcul: 'HT du premier logiciel ÷ HT des ventes (renouvellements exclus).' },
      action: 'Pousser un deuxième et un troisième logiciel auprès de clients existants (vente croisée).' },
    { id: 'encaisse', g: 'Qualité des revenus', lib: 'Part du facturé déjà encaissée', mes: (m) => m.encaisse, sens: 'haut', fmt: F.p, cle: 'encaisse',
      note: { def: 'Part du montant TTC des commandes déjà payée (acomptes et règlements).', pourquoi: 'Un chiffre d\'affaires non encaissé ne paie ni les salaires ni les dettes ; les banques regardent surtout cela.', calcul: 'Somme des acomptes ÷ TTC des commandes (confirmées, en cours, livrées).' },
      action: 'Exiger un acompte à la commande et relancer les soldes ; suivre les créances dans Commandes.' },
    { id: 'produits', g: 'Dossier et équipe', lib: 'Produits vendus', mes: (m) => m.nbCommandes ? m.produits : null, sens: 'haut', fmt: F.n, cle: 'produits',
      note: { def: 'Nombre de logiciels différents ayant déjà trouvé au moins un acheteur.', pourquoi: 'Plusieurs produits vendus montrent que l\'entreprise est une plateforme et non un seul projet.', calcul: 'Logiciels distincts dans les commandes.' },
      action: 'Concentrer l\'effort commercial sur 2 à 3 logiciels déjà validés par des clients.' },
    { id: 'modele', g: 'Finances et modèle', lib: 'Modèle de financement validé', mes: (m) => m.modeleValide, bin: true,
      note: { def: 'Le modèle financier à 5 ans (module Financement) est complété et validé par la direction : hypothèses revues, contrôles bloquants levés.', pourquoi: 'Un financeur demande des projections cohérentes avec les chiffres réels ; un modèle « document de travail » n\'est pas remis.', calcul: 'Case « Dossier validé » du module Financement.' },
      action: 'Ouvrir Finance → Financement, corriger les hypothèses et cocher la validation une fois les contrôles passés.' },
    { id: 'pointMort', g: 'Finances et modèle', lib: 'Point mort du plan (en mois)', mes: (m) => m.pointMort, sens: 'bas', fmt: F.mois, cle: 'pointMort', mesNul: 'jamais',
      note: { def: 'Mois à partir duquel le plan de croissance reste rentable (résultat d\'exploitation positif) jusqu\'à la fin.', pourquoi: 'Un financeur veut savoir quand son argent arrête de brûler ; un plan qui ne devient jamais rentable ne se finance pas.', calcul: 'Premier mois du modèle Financement après lequel l\'EBITDA reste positif.' },
      action: 'Revoir les hypothèses du modèle Financement : prix, volume de clients, coûts fixes, recrutements.' },
    { id: 'besoin', g: 'Finances et modèle', lib: 'Besoin de financement chiffré et justifié', mes: (m) => m.besoin, bin: true, binSeuil: 0,
      note: { def: 'Le modèle calcule un montant de financement nécessaire, avec l\'emploi des fonds.', pourquoi: 'Demander « un peu d\'argent » sans montant ni usage ne convainc personne.', calcul: 'Point bas de trésorerie du plan complet (module Financement).' },
      action: 'Lancer la simulation du module Financement pour obtenir le montant et son emploi.' },
    { id: 'deck', g: 'Dossier et équipe', lib: 'Pitch deck prêt (10 à 12 diapositives)', manuel: true,
      note: { def: 'Une présentation courte : problème, solution, marché, traction, modèle économique, équipe, besoin et usage des fonds.', pourquoi: 'C\'est le premier document lu par un investisseur, et souvent le seul.', calcul: 'Case cochée par la direction.' },
      action: 'Préparer le pitch deck à partir des chiffres de ce module (je peux le rédiger avec vous).' },
    { id: 'equipe', g: 'Dossier et équipe', lib: 'Équipe dirigeante identifiée et engagée', manuel: true,
      note: { def: 'Fondateurs et responsables clés nommés, à temps plein, avec leurs compétences.', pourquoi: 'En phase précoce, on investit d\'abord dans les personnes.', calcul: 'Case cochée par la direction.' },
      action: 'Présenter l\'équipe, les rôles manquants et le plan de recrutement dans le dossier.' },
    { id: 'dataroom', g: 'Dossier et équipe', lib: 'Data room rassemblée (statuts, RCCM, comptes, contrats)', manuel: true,
      note: { def: 'Un dossier partagé avec tous les documents juridiques, financiers et commerciaux demandés lors de la vérification.', pourquoi: 'Une vérification lente ou incomplète fait perdre la confiance et le temps de l\'investisseur.', calcul: 'Case cochée par la direction.' },
      action: 'Rassembler statuts, RCCM, comptes, contrats clients et licences dans un dossier partagé.' },
    { id: 'propriete', g: 'Dossier et équipe', lib: 'Propriété du code et des marques sécurisée', manuel: true,
      note: { def: 'La société détient bien le code, les noms et les logos de ses logiciels (cessions signées des développeurs, marques déposées).', pourquoi: 'Un investisseur ne finance pas un produit dont la propriété est contestable.', calcul: 'Case cochée par la direction.' },
      action: 'Faire signer des cessions de droits aux développeurs et déposer les marques principales (OAPI).' },
  ];
  CRITERES.forEach((c) => { c.manuel = !!c.manuel; });

  /* ───────────── Types de financeurs : poids de chaque critère, seuil d'éligibilité, critères bloquants ───────────── */
  const ROUTES = [
    { id: 'angel', lib: 'Business angels (pré-amorçage)', ico: '👼', seuil: 55, bloquants: ['immat', 'deck'],
      desc: 'Particuliers fortunés qui investissent de petits montants au capital, surtout sur la confiance dans l\'équipe et la vision.' },
    { id: 'fonds', lib: 'Fonds d\'amorçage (capital-risque)', ico: '🏦', seuil: 70, bloquants: ['immat', 'livre12', 'pacte'],
      desc: 'Fonds professionnels qui prennent des parts contre une forte croissance ; exigent traction, revenus récurrents et dossier solide.' },
    { id: 'dette', lib: 'Prêt bancaire ou microfinance', ico: '💳', seuil: 65, bloquants: ['immat', 'banque', 'compta', 'encaisse'],
      desc: 'Un prêt à rembourser avec intérêts, sans céder de capital : la banque regarde la capacité à rembourser, donc les encaissements et les comptes.' },
    { id: 'subv', lib: 'Subvention ou programme d\'appui', ico: '🤝', seuil: 60, bloquants: ['immat', 'banque'],
      desc: 'Fonds non remboursables (bailleurs, États, fondations) : exigent une société en règle, des comptes et un impact mesurable.' },
    { id: 'acc', lib: 'Accélérateur ou concours', ico: '🚀', seuil: 50, bloquants: ['deck'],
      desc: 'Programmes qui offrent accompagnement et petits financements : peu de conditions, mais une candidature soignée.' },
  ];
  //                  angel fonds dette subv acc
  const POIDS = {
    immat: [3, 3, 3, 3, 2], forme: [1, 2, 2, 2, 1], banque: [1, 1, 3, 3, 1], pacte: [2, 3, 1, 1, 1], compta: [1, 2, 3, 3, 1],
    moisAct: [1, 2, 2, 2, 1], livre12: [2, 3, 3, 2, 2], clients: [2, 3, 2, 2, 2], croissance: [2, 3, 1, 1, 2], pipelineMois: [1, 2, 1, 1, 2],
    recurrent: [2, 3, 1, 0, 2], top1: [2, 2, 2, 1, 1], topLogiciel: [1, 1, 1, 1, 1], encaisse: [1, 2, 3, 2, 1],
    produits: [1, 2, 1, 2, 2], modele: [2, 2, 2, 2, 1], pointMort: [1, 2, 3, 2, 1], besoin: [2, 2, 2, 2, 1],
    deck: [3, 3, 1, 1, 3], equipe: [2, 3, 1, 1, 2], dataroom: [1, 3, 2, 2, 1], propriete: [1, 2, 1, 1, 1],
  };
  const PTS = { ok: 1, warn: 0.5, ko: 0, na: 0 };

  /** Seuils effectifs : ceux par défaut, surchargés par les modifications de l'utilisateur. */
  const seuils = (ov) => { const s = {}; Object.keys(SEUILS).forEach((k) => { s[k] = Object.assign({}, SEUILS[k], ov && ov[k] || {}); }); return s; };

  function palier(v, S, sens) { if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return 'na'; return sens === 'bas' ? (v <= S.ok ? 'ok' : v <= S.warn ? 'warn' : 'ko') : (v >= S.ok ? 'ok' : v >= S.warn ? 'warn' : 'ko'); }
  /** Statut d'un critère : ok / warn / ko / na (« à documenter »). `man` : critères cochés ; `S` : seuils. */
  function statutCritere(c, m, S, man) {
    if (c.manuel) { const v = !!(man && man[c.id]); return { s: v ? 'ok' : 'na', v: v, texte: v ? 'Confirmé' : 'À confirmer' }; }
    const v = c.mes(m);
    if (c.bin) { const ok = c.binSeuil !== undefined ? v !== null && v > c.binSeuil : !!v; return { s: ok ? 'ok' : 'ko', v: v, texte: ok ? 'Oui' : 'Non' }; }
    if (v === null || v === undefined) return { s: c.mesNul === 'jamais' && m.besoin !== null ? 'ko' : 'na', v: null, texte: c.mesNul === 'jamais' && m.besoin !== null ? 'Jamais rentable' : 'Non mesurable' };
    return { s: palier(v, S[c.cle], c.sens), v: v, texte: c.fmt(v) };
  }
  function evaluer(m, ov, man) {
    const S = seuils(ov); return CRITERES.map((c) => Object.assign({ id: c.id }, statutCritere(c, m, S, man)));
  }
  /** Score d'un type de financeur (0-100), critères bloquants et verdict. */
  function scoreRoute(ev, r) {
    const k = ROUTES.indexOf(r), par = {}; ev.forEach((e) => { par[e.id] = e; });
    let tot = 0, ob = 0; const manques = [];
    CRITERES.forEach((c) => { const w = POIDS[c.id][k], e = par[c.id]; if (!w) return; tot += w; ob += w * PTS[e.s]; if (e.s !== 'ok') manques.push({ id: c.id, s: e.s, poids: w, gain: w * (1 - PTS[e.s]) }); });
    const score = tot > 0 ? Math.round(ob / tot * 100) : 0, bloques = r.bloquants.filter((id) => par[id] && par[id].s !== 'ok');
    const verdict = score >= r.seuil && !bloques.length ? 'eligible' : score >= r.seuil - 15 ? 'proche' : 'non';
    manques.forEach((x) => { x.gain = tot > 0 ? Math.round(x.gain / tot * 1000) / 10 : 0; });
    return { id: r.id, score: score, seuil: r.seuil, bloques: bloques, verdict: verdict, manques: manques.sort((a, b) => b.gain - a.gain), tot: tot };
  }
  const scores = (ev) => ROUTES.map((r) => scoreRoute(ev, r));

  /** Valeur à atteindre pour qu'un critère chiffré passe au vert, et écart actuel. */
  function cible(c, m, S) {
    if (c.manuel || c.bin || !c.cle) return null; const sx = S[c.cle], v = c.mes(m);
    return { objectif: sx.ok, fmt: c.fmt(sx.ok), actuel: v, ecart: v === null || v === undefined ? null : c.sens === 'bas' ? v - sx.ok : sx.ok - v, sens: c.sens };
  }
  /** Délai estimé (mois) pour atteindre l'objectif au rythme actuel : seulement pour les critères qui se cumulent ou qui dépendent du temps. */
  function delai(c, m, S) {
    const t = cible(c, m, S); if (!t || t.ecart === null || t.ecart <= 0) return null;
    if (c.temps) return Math.ceil(t.ecart);
    if (m.moisAct < 3) return null;                              // historique trop court : une extrapolation serait trompeuse
    if (c.id === 'livre12' && m.rythme > 0) return Math.ceil(t.ecart / m.rythme);
    if (c.id === 'clients' && m.moisAct > 0 && m.clients > 0) return Math.ceil(t.ecart / (m.clients / Math.max(1, m.moisAct)));
    return null;
  }

  /** Et si ? Reprend les mesures avec des valeurs modifiées (what) et recalcule tous les scores. */
  function simulerHypothese(m, ov, man, what) {
    const m2 = Object.assign({}, m); Object.keys(what || {}).forEach((k) => { if (what[k] !== null && what[k] !== undefined && what[k] !== '') m2[k] = num(what[k]); });
    return { avant: scores(evaluer(m, ov, man)), apres: scores(evaluer(m2, ov, man)), m: m2 };
  }

  /* ───────────── Simulation de la levée : part cédée, dilution, autonomie ───────────── */
  /** p : { montant, preMoney } ; mod : { besoin, burn (FCFA/mois), associes:[{nom,part}], recommande } ; m : mesures. */
  function montage(p, mod, m) {
    const montant = pos(p.montant), pre = pos(p.preMoney), post = pre + montant, part = post > 0 ? montant / post : 0, alertes = [];
    const as = (mod && mod.associes || []).filter((a) => pos(a.part) > 0), tot = sum(as, (a) => pos(a.part)) || 1;
    const table = as.map((a) => ({ nom: a.nom, avant: pos(a.part) / tot, apres: pos(a.part) / tot * (1 - part) }));
    if (montant > 0) table.push({ nom: 'Nouveaux investisseurs', avant: 0, apres: part });
    const burn = mod && mod.burn > 0 ? mod.burn : 0, runway = burn > 0 ? montant / burn : null, besoin = mod && mod.besoin != null ? pos(mod.besoin) : null;
    if (part > 0.30) alertes.push('Part cédée supérieure à 30 % : au-delà, les fondateurs perdent le contrôle des décisions futures. Un premier tour cède plutôt 10 à 25 %.');
    if (part > 0 && part < 0.05) alertes.push('Part cédée inférieure à 5 % : peu d\'investisseurs s\'intéressent à un ticket aussi faible.');
    if (besoin !== null && montant > 0 && montant < besoin) alertes.push('Le montant est inférieur au besoin de financement du modèle (' + F.m(besoin) + ') : la trésorerie passerait en négatif.');
    if (runway !== null && runway < 12) alertes.push('Autonomie inférieure à 12 mois : la recherche du tour suivant commencerait trop tôt.');
    const ca12 = m && m.vendu12 > 0 ? m.vendu12 : null, rec = m && m.recurrent != null && ca12 ? m.recurrent * ca12 : null;
    return { montant, pre, post, part, table, runway, besoin, manque: besoin !== null ? Math.max(0, besoin - montant) : null, alertes,
      multCA: ca12 && pre > 0 ? pre / ca12 : null, multRec: rec && rec > 0 && pre > 0 ? pre / rec : null };
  }

  /** Plan d'action : critères à améliorer, classés par gain moyen de score sur les types de financeurs, avec les financeurs concernés. */
  function plan(m, ov, man) {
    const ev = evaluer(m, ov, man), S = seuils(ov), sc = scores(ev), res = [];
    CRITERES.forEach((c) => {
      const e = ev.filter((x) => x.id === c.id)[0]; if (e.s === 'ok') return;
      const gains = ROUTES.map((r, i) => { const x = sc[i].manques.filter((q) => q.id === c.id)[0]; return x ? x.gain : 0; });
      const bloque = ROUTES.filter((r, i) => sc[i].bloques.indexOf(c.id) >= 0).map((r) => r.id);
      res.push({ id: c.id, lib: c.lib, g: c.g, s: e.s, texte: e.texte, action: c.action, gain: Math.round(sum(gains, (x) => x) / ROUTES.length * 10) / 10, bloque: bloque, delai: delai(c, m, S), cible: cible(c, m, S) });
    });
    return res.sort((a, b) => (b.bloque.length - a.bloque.length) || (b.gain - a.gain));
  }

  const GLOSSAIRE = [
    ['Pré-money (valorisation avant apport)', 'Valeur de l\'entreprise avant l\'arrivée des nouveaux fonds. Plus elle est élevée, moins vous cédez de parts pour un même montant.'],
    ['Post-money', 'Valeur de l\'entreprise juste après l\'apport : pré-money + montant levé.'],
    ['Part cédée / dilution', 'Pourcentage du capital remis aux investisseurs : montant levé ÷ post-money. Les parts des fondateurs diminuent d\'autant.'],
    ['Autonomie (runway)', 'Nombre de mois pendant lesquels l\'entreprise peut payer ses dépenses avec l\'argent levé, au rythme de consommation prévu.'],
    ['Consommation de trésorerie (burn)', 'Argent dépensé en plus de celui encaissé chaque mois : il s\'agit de la perte de trésorerie mensuelle moyenne.'],
    ['EBITDA / point mort', 'L\'EBITDA est le résultat d\'exploitation avant amortissements et impôts ; le point mort est le mois où il devient durablement positif.'],
    ['Revenu récurrent (MRR/ARR)', 'Revenu qui revient chaque mois ou chaque année sans nouvelle vente : abonnements, maintenance, renouvellements.'],
    ['Concentration', 'Part du chiffre d\'affaires portée par un seul client ou un seul produit : plus elle est forte, plus le risque est grand.'],
    ['Traction', 'Preuve que le marché achète : clients, chiffre d\'affaires, croissance, rétention.'],
    ['Data room', 'Dossier partagé contenant tous les documents qu\'un investisseur vérifie avant de signer (statuts, comptes, contrats, propriété du code).'],
    ['Pacte d\'associés', 'Contrat entre associés qui fixe les règles : décisions importantes, départ d\'un associé, entrée d\'un investisseur, engagement des fondateurs (vesting).'],
    ['Lettre d\'intention / term sheet', 'Document non définitif qui résume les conditions d\'un investissement (montant, valorisation, droits) avant les contrats finaux.'],
  ];


  /* ───────────── Projection à la date de lancement visée ───────────── */
  /** Estime les mesures à la date visée en prolongeant le rythme actuel de ventes (seulement avec 3 mois d'historique : sinon null, jamais d'extrapolation trompeuse). */
  function projeterALaDate(m, dateLancement, ov, man) {
    const d = dateLancement ? new Date(dateLancement + (String(dateLancement).length === 7 ? '-01' : '')) : null, now = new Date(m.now);
    if (!d || isNaN(d) || d <= now) return null;
    const mois = Math.round((d - now) / (30.44 * 864e5) * 10) / 10;
    if (m.moisAct < 3 || !(m.rythme > 0)) return { mois: mois, mesurable: false, scores: null, m2: null };
    const livrePart = m.vendu12 > 0 ? m.livre12 / m.vendu12 : 0;
    const m2 = Object.assign({}, m, { moisAct: m.moisAct + mois, vendu12: m.vendu12 + m.rythme * mois, livre12: m.livre12 + m.rythme * mois * livrePart });
    return { mois: mois, mesurable: true, m2: m2, scores: scores(evaluer(m2, ov, man)), avant: scores(evaluer(m, ov, man)) };
  }

  /* ───────────── Pitch deck : reconstruit à chaque ouverture à partir des chiffres du moment ───────────── */
  const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateFr = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); };
  const duree = (mois) => mois < 2 ? Math.max(1, Math.round(mois * 4.345)) + ' semaines' : Math.round(mois) + ' mois';
  /** data : { societe, m, mod, d (saisies), catalogue:[{nom,cat,prix}], email, sim:{montant,preMoney}, now }. Renvoie { slides:[{id,titre,html}], manques:[{slide,lib}], document(zoom) }. */
  function deck(data) {
    const m = data.m, mod = data.mod, d = data.d || {}, manques = [], cat = data.catalogue || [];
    const ph = (slide, lib) => { manques.push({ slide: slide, lib: lib }); return '<div class="ph"><p>[' + escH(lib) + ']</p></div>'; };
    const phx = (slide, lib) => { manques.push({ slide: slide, lib: lib }); return '<span class="phx">[' + escH(lib) + ']</span>'; };
    const val = (v) => v !== null && v !== undefined && String(v).trim() !== '';
    const cartes = (a) => '<div class="row">' + a.map((c) => '<div class="card">' + c + '</div>').join('') + '</div>';
    const pr = cat.filter((x) => num(x.prix) > 0).map((x) => num(x.prix)), cats = {}; cat.forEach((x) => { const k = x.cat || 'Autres'; (cats[k] = cats[k] || []).push(x.nom); });
    const montant = data.sim && data.sim.montant != null ? num(data.sim.montant) : (mod ? pos(mod.recommande) : 0), pre = data.sim && data.sim.preMoney != null ? num(data.sim.preMoney) : (mod ? pos(mod.preMoney) : 0);
    const mt = montant > 0 ? montage({ montant: montant, preMoney: pre }, mod, m) : null;
    const S = [];
    const add = (id, titre, theme, corps, notes) => S.push({ id: id, titre: titre, theme: theme, html: corps, notes: notes || '' });

    add('cover', 'Couverture', 'dark', '<p class="eyebrow">' + escH((data.societe || 'SANIX').toUpperCase()) + ' · LEVÉE DE FONDS</p><h1>Des logiciels de gestion pour les entreprises ivoiriennes, vendus et suivis par une équipe d’agents IA</h1><p class="lead" style="margin-top:36px">' + (cat.length ? cat.length + ' logiciels métiers · ' : '') + 'normes SYSCOHADA · paiement par Mobile Money</p>');

    add('probleme', 'Le problème', 'light', '<p class="eyebrow">LE PROBLÈME</p><h2>Les PME ont besoin d’outils pensés pour leur réalité</h2><div style="height:36px"></div>' + cartes(['<h3>Des comptes aux normes locales</h3><p>La comptabilité suit le référentiel SYSCOHADA, pas des modèles importés.</p>', '<h3>Des paiements du quotidien</h3><p>Les clients paient par Mobile Money : Wave, Orange Money, MTN.</p>', '<h3>Un réseau qui coupe</h3><p>Le logiciel doit continuer à fonctionner hors connexion.</p>']) + '<div style="height:28px"></div>' + (val(d.sourceProbleme) ? '<p class="note">' + escH(d.sourceProbleme) + '</p>' : ph('Le problème', 'Chiffre à sourcer : part des PME sans logiciel de gestion, avec l’étude citée')));

    add('solution', 'La solution', 'dark', '<p class="eyebrow">LA SOLUTION</p><h2>Un catalogue de logiciels métiers prêts à déployer</h2><div style="height:36px"></div>' + (cat.length ? cartes(['<p class="big">' + cat.length + '</p><h3>logiciels</h3><p>ERP, caisse, CRM, comptabilité, ressources humaines.</p>', '<p class="big">' + Object.keys(cats).length + '</p><h3>secteurs</h3><p>' + escH(Object.keys(cats).slice(0, 5).join(', ')) + '…</p>', pr.length ? '<p class="big">' + (Math.round(Math.min.apply(null, pr) / 1e5) / 10).toLocaleString('fr-FR') + '–' + (Math.round(Math.max.apply(null, pr) / 1e5) / 10).toLocaleString('fr-FR') + ' M</p><h3>FCFA par licence</h3><p>Prix de licence du catalogue.</p>' : '<h3>Prix</h3><p>À renseigner dans le catalogue.</p>']) : ph('La solution', 'Catalogue des logiciels : à renseigner dans le CRM (module Catalogue)')));

    add('produits', 'Le catalogue', 'alt', '<p class="eyebrow">LE CATALOGUE</p><h2>Un logiciel pour chaque métier</h2><div style="height:28px"></div>' + (cat.length ? '<table><tr><th style="width:26%">Secteur</th><th>Logiciels</th></tr>' + Object.keys(cats).sort().map((k) => '<tr><td>' + escH(k) + '</td><td>' + escH(cats[k].join(' · ')) + '</td></tr>').join('') + '</table>' : ph('Le catalogue', 'Catalogue vide dans le CRM')));

    const sem = m.nbCommandes ? duree(m.moisAct) : null, debut = m.premiere ? dateFr(m.premiere) : '', finMes = dateFr(m.now);
    add('traction', 'La traction', 'dark', '<p class="eyebrow">LA TRACTION</p>' + (m.nbCommandes ? '<h2>' + m.nbCommandes + ' commande' + (m.nbCommandes > 1 ? 's' : '') + ' en ' + escH(sem) + '</h2><div style="height:30px"></div>' + cartes(['<p class="big">' + m.nbCommandes + '</p><h3>commandes</h3><p>confirmées, en cours ou livrées</p>', '<p class="big">' + m.clients + '</p><h3>client' + (m.clients > 1 ? 's' : '') + '</h3><p>' + m.clientsPayants + ' ont déjà payé</p>', '<p class="big">' + F.m(m.vendu).replace(' FCFA', '') + '</p><h3>FCFA vendus</h3><p>hors taxes</p>', '<p class="big">' + F.m(m.livreTotal).replace(' FCFA', '') + '</p><h3>FCFA livrés</h3><p>hors taxes</p>']) + '<div style="height:24px"></div><p class="note">Période : du ' + escH(debut) + ' au ' + escH(finMes) + '. « Livré » : logiciel remis au client ; le reste est en cours de déploiement.' + (m.topLogiciel !== null && m.topLogiciel > 0.5 ? ' ' + escH(m.topLogicielNom || 'Un produit') + ' porte ' + Math.round(m.topLogiciel * 100) + ' % des ventes : élargir la base à d’autres produits est notre priorité.' : '') + (m.encaisse !== null ? ' Part déjà encaissée : ' + Math.round(m.encaisse * 100) + ' %.' : '') + '</p>' : '<h2>Premières ventes à venir</h2><div style="height:30px"></div>' + ph('La traction', 'Aucune commande enregistrée dans le CRM')), 'Chiffres du CRM au ' + finMes + ', sans retraitement.');

    add('modele', 'Le modèle économique', 'light', '<p class="eyebrow">LE MODÈLE ÉCONOMIQUE</p><h2>Licence, abonnement et maintenance</h2><div style="height:36px"></div>' + cartes(['<h3>Licence + maintenance</h3><p>Un paiement à l’installation, puis une maintenance annuelle.</p>', '<h3>Abonnement annuel</h3><p>Un revenu qui revient chaque année sans nouvelle vente.</p>', '<h3>Abonnement mensuel</h3><p>Une entrée régulière, adaptée aux plus petites entreprises.</p>']) + '<div style="height:28px"></div>' + (m.recurrent !== null ? '<p class="note">Part du chiffre d’affaires déjà récurrente : <b>' + Math.round(m.recurrent * 100) + ' %</b> (abonnements, maintenance, renouvellements).</p>' : ph('Le modèle économique', 'Part du revenu récurrent : non mesurable, aucune vente enregistrée')));

    add('ia', 'Notre avantage', 'dark2', '<p class="eyebrow">NOTRE AVANTAGE</p><h2>Une équipe d’agents IA prospecte, qualifie et relance</h2><div style="height:36px"></div>' + cartes([val(d.agents) ? '<p class="big">' + escH(d.agents) + '</p><h3>collaborateurs IA</h3><p>Un directeur général, un directeur commercial et des équipes spécialisées.</p>' : '<h3>Collaborateurs IA</h3><p>' + phx('Notre avantage', 'Nombre d’agents IA : à renseigner') + '</p>', '<h3>Ce qu’ils font</h3><p>Prospection, qualification des contacts, e-mails de premier contact, relances et rapports d’activité.</p>', '<h3>Ce qui les encadre</h3><p>Chaque message externe est validé par le président. Budget IA plafonné, adresses vérifiées avant envoi.</p>']));

    add('marche', 'Le marché', 'light', '<p class="eyebrow">LE MARCHÉ</p><h2>Trois cercles chiffrés, avec leurs sources</h2><div style="height:36px"></div><div class="row">' + [['Marché total', d.marcheTotal, 'Nombre d’entreprises concernées en Côte d’Ivoire et dans la zone UEMOA, avec la source'], ['Marché accessible', d.marcheAccessible, 'Entreprises des secteurs du catalogue, dans les villes de déploiement'], ['Part visée', d.marchePart, 'Nombre de clients visés en 3 ans et chiffre d’affaires correspondant']].map((x) => val(x[1]) ? '<div class="card"><h3>' + x[0] + '</h3><p>' + escH(x[1]) + '</p></div>' : '<div class="ph"><h3>' + x[0] + '</h3><p>[' + escH(x[2]) + ']</p></div>' + (manques.push({ slide: 'Le marché', lib: x[0] + ' : ' + x[2] }) && '')).join('') + '</div>');

    add('equipe', 'L’équipe', 'alt', '<p class="eyebrow">L’ÉQUIPE</p><h2>Un fondateur, une équipe IA, les premiers recrutements</h2><div style="height:36px"></div><div class="row"><div class="card"><h3>' + escH(d.fondateur || 'Fondateur') + '</h3><p>Dirigeant de ' + escH(data.societe || 'SANIX') + '.</p>' + (val(d.parcours) ? '<p>' + escH(d.parcours) + '</p>' : '<p>' + phx('L’équipe', 'Parcours et rôle du fondateur') + '</p>') + '</div>' + (val(d.associes) ? '<div class="card"><h3>Associés et recrutements</h3><p>' + escH(d.associes) + '</p></div>' : '<div class="ph"><h3>Associés et recrutements</h3><p>[Associés, répartition du capital, postes à pourvoir grâce à la levée]</p></div>' + (manques.push({ slide: 'L’équipe', lib: 'Associés, répartition du capital et recrutements' }) && '')) + '</div>');

    const emp = [['Produit et technique', d.empProduit], ['Équipe commerciale', d.empCommercial], ['Marketing', d.empMarketing], ['Trésorerie', d.empTreso]];
    const totEmp = sum(emp, (x) => val(x[1]) ? num(x[1]) : 0);
    add('besoin', 'Le besoin', 'dark', '<p class="eyebrow">LE BESOIN</p><h2>Montant recherché et emploi des fonds</h2><div style="height:30px"></div>' + (mt ? '<div class="row"><div class="card"><p class="big">' + F.m(mt.montant).replace(' FCFA', '') + '</p><h3>FCFA à lever</h3><p>pour une valorisation de ' + F.m(mt.pre) + ' avant apport</p></div><div class="card"><p class="big">' + (mt.part * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %</p><h3>du capital cédé</h3><p>valorisation après apport : ' + F.m(mt.post) + '</p></div>' + (mt.runway !== null ? '<div class="card"><p class="big">' + Math.round(mt.runway) + '</p><h3>mois d’autonomie</h3><p>au rythme de consommation prévu</p></div>' : '') + '</div>' : ph('Le besoin', 'Montant à lever : ouvrez Finance → Financement une fois pour calculer le besoin')) + '<div style="height:26px"></div><div class="row">' + emp.map((x) => val(x[1]) ? '<div class="card"><p class="big" style="font-size:64px">' + escH(num(x[1])) + ' %</p><h3>' + x[0] + '</h3></div>' : '<div class="card"><p class="phx">[__ %]</p><h3>' + x[0] + '</h3></div>' + (manques.push({ slide: 'Le besoin', lib: 'Part des fonds : ' + x[0] }) && '')).join('') + '</div>' + (totEmp > 0 && Math.round(totEmp) !== 100 ? '<p class="note" style="margin-top:14px">Attention : la répartition totalise ' + Math.round(totEmp) + ' % (elle doit faire 100 %).</p>' : '') + (val(d.lancement) ? '<p class="note" style="margin-top:14px">Clôture visée : ' + escH(dateFr(d.lancement + (String(d.lancement).length === 7 ? '-01' : ''))) + '.</p>' : ''));

    const an = mod && mod.annees || [];
    add('projections', 'Les projections', 'light', '<p class="eyebrow">LES PROJECTIONS</p><h2>Cinq ans de prévisions, reliées aux chiffres réels</h2><div style="height:28px"></div>' + (an.length ? '<table><tr><th style="width:28%"></th>' + an.map((a) => '<th>An ' + a.an + '</th>').join('') + '</tr><tr><td>Chiffre d’affaires</td>' + an.map((a) => '<td>' + F.m(a.ca) + '</td>').join('') + '</tr><tr><td>Résultat d’exploitation (EBITDA)</td>' + an.map((a) => '<td>' + F.m(a.ebitda) + '</td>').join('') + '</tr><tr><td>Trésorerie en fin d’année</td>' + an.map((a) => '<td>' + F.m(a.tresoFin) + '</td>').join('') + '</tr><tr><td>Clients acquis dans l’année</td>' + an.map((a) => '<td>' + Math.round(a.clients) + '</td>').join('') + '</tr></table><p class="note" style="margin-top:20px">Scénario « ' + escH(mod.scenario || 'réaliste') + ' », issu du modèle Financement.' + (mod.valide ? '' : ' <b>Projection non validée : document de travail.</b>') + (mod.pointMort != null ? ' Point mort au mois ' + (mod.pointMort + 1) + '.' : ' Le plan n’atteint pas la rentabilité sur 5 ans.') + '</p>' : ph('Les projections', 'Ouvrez Finance → Financement une fois : le modèle fournit les 5 années')));

    const tel = val(d.tel) ? d.tel : (val(data.tel) && String(data.tel).replace(/\D/g, '').length > 4 ? data.tel : ''), site = val(d.site) ? d.site : (data.site || '');
    add('contact', 'Contact', 'dark2', '<p class="eyebrow">PARLONS-EN</p><h1>Construisons ensemble l’éditeur de logiciels de gestion des PME ivoiriennes</h1><div style="height:30px"></div><p class="lead">' + escH(data.societe || 'SANIX') + '</p><p class="lead">' + escH([data.email, data.adresse].filter(Boolean).join(' · ')) + '</p>' + (tel ? '<p class="lead">' + escH(tel) + (site ? ' · ' + escH(site) : '') + '</p>' : '<p>' + phx('Contact', 'Téléphone') + (site ? ' · ' + escH(site) : ' ' + phx('Contact', 'Site')) + '</p>'));

    const css = ':root{--d:#0C2A2B;--d2:#123D3E;--l:#F5F2EA;--l2:#EAE6DA;--ink:#10302F;--mute-l:#4C6463;--mute-d:#B8D4D0;--teal:#1FB5A0;--teal-l:#0B7F70;--amber:#F0B54A;--amber-l:#8A5200}*{box-sizing:border-box}body{margin:0;background:#888;font-family:Inter,Arial,sans-serif}.s{width:1280px;height:720px;margin:0 auto 24px;padding:72px 80px 90px;display:flex;flex-direction:column;position:relative;overflow:hidden;page-break-after:always;break-after:page}.dark{background:var(--d);color:var(--l)}.dark2{background:var(--d2);color:var(--l)}.light{background:var(--l);color:var(--ink)}.alt{background:var(--l2);color:var(--ink)}h1,h2,h3{font-family:"Space Grotesk",Arial,sans-serif;margin:0}h1{font-size:56px;line-height:1.1}h2{font-size:42px;line-height:1.1}h3{font-size:24px;margin:0}p{margin:0;font-size:22px;line-height:1.4}.eyebrow{font-size:19px;letter-spacing:.1em;font-weight:600;margin-bottom:18px}.dark .eyebrow,.dark2 .eyebrow{color:var(--teal)}.light .eyebrow,.alt .eyebrow{color:var(--teal-l)}.lead{font-size:26px;color:var(--mute-d)}.light .lead,.alt .lead{color:var(--mute-l)}.row{display:flex;gap:24px}.row>*{flex:1}.card{border-radius:18px;padding:26px;display:flex;flex-direction:column;gap:10px}.dark .card,.dark2 .card{background:rgba(255,255,255,.07);border:2px solid rgba(255,255,255,.14)}.light .card,.alt .card{background:#fff;border:2px solid #D9D3C3}.dark .card p,.dark2 .card p{color:var(--mute-d)}.light .card p,.alt .card p{color:var(--mute-l)}.big{font-family:"Space Grotesk",Arial,sans-serif;font-size:64px!important;line-height:1;font-weight:600}.dark .big,.dark2 .big{color:var(--teal)!important}.light .big,.alt .big{color:var(--teal-l)!important}.note{font-size:18px;line-height:1.4}.dark .note,.dark2 .note{color:var(--mute-d)}.light .note,.alt .note{color:var(--mute-l)}.ph{border:3px dashed var(--amber);border-radius:16px;padding:18px 24px}.ph p,.ph h3,.phx{color:var(--amber);font-weight:600}.light .ph,.alt .ph{border-color:var(--amber-l)}.light .ph p,.light .ph h3,.light .phx,.alt .ph p,.alt .ph h3,.alt .phx,.light .card p.phx,.alt .card p.phx{color:var(--amber-l)}.dark .card p.phx,.dark2 .card p.phx{color:var(--amber)}table{width:100%;border-collapse:collapse;font-size:17px}th,td{border-bottom:1px solid #C9C2AE;padding:7px 10px;text-align:left}.foot{position:absolute;left:80px;right:80px;bottom:30px;display:flex;justify-content:space-between;font-size:15px;opacity:.8}@media print{@page{size:1280px 720px;margin:0}body{background:none}.s{margin:0}}';
    const document_ = (zoom) => '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Pitch deck — ' + escH(data.societe || 'SANIX') + '</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400..700&family=Inter:wght@400;600&display=swap"><style>' + css + (zoom && zoom !== 1 ? '@media screen{.s{zoom:' + zoom + '}}' : '') + '</style></head><body>'
      + S.map((s, i) => '<section class="s ' + s.theme + '" id="' + s.id + '">' + s.html + '<div class="foot"><span>' + escH(data.societe || 'SANIX') + ' · au ' + escH(dateFr(m.now)) + '</span><span>' + (i + 1) + '</span></div></section>').join('') + '</body></html>';
    return { slides: S, manques: manques, document: document_ };
  }

  const calc = { projeterALaDate, deck, mesurer, CRITERES, ROUTES, POIDS, SEUILS, PTS, seuils, palier, statutCritere, evaluer, scoreRoute, scores, cible, delai, simulerHypothese, montage, plan, GLOSSAIRE, F };
  G.SanixLevee = { calc };
  if (typeof module !== 'undefined' && module.exports) module.exports = { calc };
  if (!G.document) return;

  /* ═══════════════════════════════ Écran ═══════════════════════════════ */
  const LSK = 'levee_config';
  const ui = { tab: 'synthese', route: 'angel' };
  let ov = null, mes = null, mod = null, modBrut = null, pipelineP = null;
  const syncEtat = { s: 'attente', at: null, msg: '' };
  let syncT = null;
  const root = () => document.getElementById('view-levee');
  const toast = (msg) => { try { showToast(msg); } catch (e) { /* hors CRM */ } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (Math.round(num(n)) || 0).toLocaleString('fr-FR');
  const VERD = { eligible: ['✅ Éligible', 'badge-success', '#16a34a'], proche: ['🟠 Presque éligible', 'badge-warning', '#d97706'], non: ['⛔ Pas encore éligible', 'badge-danger', '#dc2626'] };
  const ST = { ok: ['✅', '#16a34a', 'Atteint'], warn: ['🟠', '#d97706', 'À renforcer'], ko: ['⛔', '#dc2626', 'Insuffisant'], na: ['❔', '#6b7280', 'À documenter'] };

  function load() { try { const r = localStorage.getItem('sanix_crm_' + LSK); ov = r ? JSON.parse(r) : {}; } catch (e) { ov = {}; } if (!ov || typeof ov !== 'object') ov = {}; ov.manuel = ov.manuel || {}; ov.seuils = ov.seuils || {}; ov.sim = ov.sim || {}; ov.what = ov.what || {}; ov.deck = ov.deck || {}; }
  function persist() { try { if (typeof window.lsSave === 'function') window.lsSave(LSK, ov); else localStorage.setItem('sanix_crm_' + LSK, JSON.stringify(ov)); } catch (e) { toast('⚠️ Enregistrement local impossible'); } planifierSync(); }

  /* — Partage avec l'agent « levée de fonds » : réglages et instantané du modèle enregistrés côté serveur (les agents ne voient pas le navigateur) — */
  function instantane() {
    const sc = scores(evaluer(mes, ov.seuils, ov.manuel));
    return { maj: new Date().toISOString(), pipelinePondere: pipelineP, modele: modBrut, scores: ROUTES.map((r, i) => ({ type: r.id, score: sc[i].score, verdict: sc[i].verdict })) };
  }
  function majStatutSync() {
    const el = document.getElementById('lev-sync'); if (!el) return;
    el.innerHTML = syncEtat.s === 'ok' ? '🤖 Partagé avec l\'agent levée de fonds à ' + esc(syncEtat.at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))
      : syncEtat.s === 'erreur' ? '⚠️ Non partagé avec l\'agent : ' + esc(syncEtat.msg) : '🤖 Partage avec l\'agent en attente…';
  }
  async function pousser() {
    if (typeof window.aisApi !== 'function' || !mes) return;
    try { await window.aisApi('/rest/v1/rpc/levee_enregistrer', { method: 'POST', body: JSON.stringify({ p_config: ov, p_instantane: instantane() }) }); syncEtat.s = 'ok'; syncEtat.at = new Date(); }
    catch (e) { syncEtat.s = 'erreur'; syncEtat.msg = /session|Connectez/i.test(e.message) ? 'connectez l\'agent IA (Pilotage → Directeur IA) pour le partager' : e.message; }
    majStatutSync();
  }
  function planifierSync() { clearTimeout(syncT); syncT = setTimeout(pousser, 1500); }
  /** Nouvel appareil sans réglage local : reprend ceux enregistrés côté serveur. */
  async function tirer() {
    if (typeof window.aisApi !== 'function') return false;
    const vide = !Object.keys(ov.manuel).length && !Object.keys(ov.seuils).length && !Object.keys(ov.sim).length && !Object.keys(ov.what).length && !Object.keys(ov.deck).length;
    if (!vide) return false;
    try {
      const r = await window.aisApi('/rest/v1/levee_etat?select=config&id=eq.1'), c = r && r[0] && r[0].config;
      if (!c || typeof c !== 'object' || !Object.keys(c).length) return false;
      ov = Object.assign({ manuel: {}, seuils: {}, sim: {}, what: {}, deck: {} }, c); try { localStorage.setItem('sanix_crm_' + LSK, JSON.stringify(ov)); } catch (e) { /* stockage local indisponible */ }
      return true;
    } catch (e) { return false; }
  }

  /** Lit le CRM et le modèle Financement : jamais d'écriture dans l'un ou l'autre. */
  function recompute() {
    const g = (f) => { try { return f(); } catch (e) { return undefined; } };
    const fin = G.SanixFinancement && G.SanixFinancement.snapshot && g(() => G.SanixFinancement.snapshot());
    const P = G.SanixPilotage && G.SanixPilotage.calc; let pond = null;
    pipelineP = null;
    if (P) { const k = new Date(); const key = k.getFullYear() + '-' + String(k.getMonth() + 1).padStart(2, '0'); const p = g(() => P.pipeline(g(() => DEALS) || [], key)); if (p) { pond = 0; Object.keys(p).forEach((x) => { pond += p[x].pondere; }); pipelineP = pond; } }
    modBrut = null;
    if (fin && fin.res) {
      const r = fin.res, m12 = r.avec0.mois.slice(0, 12), burn = Math.max(0, -sum(m12, (x) => Math.min(0, x.flux)) / 12);
      modBrut = { besoin: r.besoin, recommande: r.recommande, pointMort: r.avec0.pointMort, valide: !!fin.h.valide, associes: fin.h.associes, burn: burn, preMoney: fin.preMoney, caAn1: r.avec0.annees[0].ca, annees: r.avec0.annees.map((a) => ({ an: a.an, ca: a.ca, ebitda: a.ebitda, tresoFin: a.tresoFin, clients: a.clients })), scenario: ({ prudent: 'prudent', realiste: 'réaliste', ambitieux: 'ambitieux', perso: 'personnalisé' })[fin.h.scenario] || fin.h.scenario };
    }
    mes = mesurer({ commandes: g(() => COMMANDES) || [], config: g(() => CONFIG) || {}, pipelinePondere: pond, modele: modBrut });
    mod = modBrut;
  }

  const cell = (s) => { const x = ST[s.s]; return `<span title="${x[2]}" style="color:${x[1]};font-weight:600">${x[0]} ${esc(s.texte)}</span>`; };
  const stat = (titre, val, sub, color) => `<div class="stat-card ${color || 'blue'}"><div class="stat-label">${esc(titre)}</div><div class="stat-val" style="font-size:20px">${val}</div><div class="stat-label" style="margin-top:4px">${sub || ''}</div></div>`;
  const barre = (v, couleur) => `<div style="height:8px;border-radius:6px;background:rgba(127,127,127,.25);overflow:hidden"><div style="height:100%;width:${clamp(v, 0, 100)}%;background:${couleur}"></div></div>`;
  const note = (t) => `<p class="muted" style="font-size:12px;margin:8px 0">${t}</p>`;
  const evCourant = () => evaluer(mes, ov.seuils, ov.manuel);
  const nomCrit = (id) => CRITERES.filter((c) => c.id === id)[0];

  /* — Synthèse — */
  function tabSynthese() {
    const ev = evCourant(), sc = scores(ev), S = seuils(ov.seuils), pl = plan(mes, ov.seuils, ov.manuel).slice(0, 4), nbOk = ev.filter((e) => e.s === 'ok').length, nbNa = ev.filter((e) => e.s === 'na').length;
    const cartes = ROUTES.map((r, i) => { const s = sc[i], v = VERD[s.verdict]; return `<div class="card" style="margin:0"><div class="card-header" style="margin-bottom:8px"><span class="card-title">${r.ico} ${esc(r.lib)}</span><span class="badge ${v[1]}">${v[0]}</span></div>
      ${barre(s.score, v[2])}<div style="display:flex;justify-content:space-between;font-size:12px;margin:4px 0 8px"><b>${s.score} / 100</b><span class="muted">seuil ${s.seuil}</span></div>
      <p class="muted" style="font-size:12px;margin:0 0 6px">${esc(r.desc)}</p>
      ${s.bloques.length ? `<div style="font-size:12px;color:#dc2626">⛔ À régler d'abord : ${s.bloques.map((id) => esc(nomCrit(id).lib)).join(' ; ')}</div>` : s.manques.length ? `<div style="font-size:12px">Prochain gain : ${esc(nomCrit(s.manques[0].id).lib)} (+${s.manques[0].gain} pts)</div>` : '<div style="font-size:12px;color:#16a34a">Tous les critères sont atteints.</div>'}</div>`; }).join('');
    const best = sc.slice().sort((a, b) => b.score - a.score)[0], bestR = ROUTES.filter((r) => r.id === best.id)[0];
    return `<div class="alert alert-warn" role="note">⚠️ <div>Les seuils sont des <b>repères indicatifs</b> de bonnes pratiques, pas les règles d'un financeur précis : avant toute candidature, comparez avec le règlement du programme visé (onglet Notes).</div></div>
      <div class="stats-grid" style="margin:12px 0">${stat('Chiffre d\'affaires livré (12 mois)', mes.nbCommandes ? F.m(mes.livre12) : '—', mes.nbCommandes ? 'vendu : ' + F.m(mes.vendu12) + ' HT' : 'aucune vente', 'green')}
        ${stat('Clients', mes.nbCommandes ? fmt(mes.clients) : '—', fmt(mes.clientsPayants) + ' ont déjà payé', 'blue')}
        ${stat('Critères atteints', nbOk + ' / ' + ev.length, nbNa ? nbNa + ' à documenter' : 'tout est mesuré', nbOk >= ev.length * 0.7 ? 'green' : 'orange')}
        ${stat('Meilleure voie aujourd\'hui', bestR.ico + ' ' + best.score + ' / 100', esc(bestR.lib), 'purple')}</div>
      <div class="grid-3" style="gap:12px;margin-bottom:16px">${cartes}</div>
      <div class="card"><div class="card-header"><span class="card-title">🎯 Les 4 actions qui font le plus progresser</span></div>${pl.length ? `<ol style="margin:0;padding-left:20px">${pl.map((p) => `<li style="margin:6px 0"><b>${esc(p.lib)}</b> — ${cell({ s: p.s, texte: p.texte })}<br><span class="muted" style="font-size:12px">${esc(p.action)}${p.delai ? ` · délai estimé au rythme actuel : ${p.delai} mois` : ''}</span></li>`).join('')}</ol>` : '<p>Aucune action : tous les critères sont atteints.</p>'}</div>
      ${note('Les montants viennent des commandes du CRM (statuts confirmée, en cours, livrée). Les valeurs non mesurables comptent pour 0 et sont marquées « à documenter ».')}`;
  }

  /* — Indicateurs : chaque ligne avec sa note explicative — */
  function tabIndic() {
    const ev = evCourant(), S = seuils(ov.seuils), grp = {};
    CRITERES.forEach((c, i) => { (grp[c.g] = grp[c.g] || []).push([c, ev[i]]); });
    return Object.keys(grp).map((g) => `<div class="card"><div class="card-header"><span class="card-title">${esc(g)}</span></div>
      ${grp[g].map(([c, e]) => { const t = cible(c, mes, S); return `<details style="border-top:1px solid var(--border);padding:8px 0"><summary style="cursor:pointer;display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap"><span>${esc(c.lib)}</span><span>${cell(e)}${t ? ` <span class="muted" style="font-size:12px">· objectif ${esc(c.sens === 'bas' ? '≤ ' : '≥ ')}${esc(t.fmt)}</span>` : ''}</span></summary>
        <div style="padding:8px 0 4px;font-size:13px"><p style="margin:4px 0"><b>Ce que c'est.</b> ${esc(c.note.def)}</p><p style="margin:4px 0"><b>Pourquoi les financeurs le regardent.</b> ${esc(c.note.pourquoi)}</p><p style="margin:4px 0"><b>Comment il est calculé.</b> ${esc(c.note.calcul)}</p>${e.s !== 'ok' ? `<p style="margin:4px 0"><b>Pour s'améliorer.</b> ${esc(c.action)}</p>` : ''}</div></details>`; }).join('')}</div>`).join('') + note('Cliquez sur une ligne pour lire l\'explication.');
  }

  /* — Éligibilité : matrice critères × financeurs — */
  function tabElig() {
    const ev = evCourant(), sc = scores(ev), S = seuils(ov.seuils);
    const entete = `<tr><th>Critère</th><th>Votre situation</th>${ROUTES.map((r) => `<th title="${esc(r.lib)}" style="text-align:center">${r.ico}</th>`).join('')}</tr>`;
    const lignes = CRITERES.map((c, i) => { const e = ev[i], k = POIDS[c.id];
      const etat = c.manuel ? `<label style="cursor:pointer"><input type="checkbox" data-man="${c.id}" ${ov.manuel[c.id] ? 'checked' : ''}> ${ov.manuel[c.id] ? '✅ Confirmé' : '❔ À confirmer'}</label>` : cell(e);
      return `<tr><td>${esc(c.lib)}<div class="muted" style="font-size:11px">${esc(c.g)}</div></td><td>${etat}</td>${k.map((w, j) => `<td style="text-align:center" title="${w ? 'Poids ' + w + ' sur 3' : 'Non demandé'}${ROUTES[j].bloquants.indexOf(c.id) >= 0 ? ' · condition obligatoire' : ''}">${w ? '●'.repeat(w) : '·'}${ROUTES[j].bloquants.indexOf(c.id) >= 0 ? '<sup>⛔</sup>' : ''}</td>`).join('')}</tr>`; }).join('');
    const pied = `<tr><td colspan="2"><b>Score / verdict</b></td>${sc.map((s) => `<td style="text-align:center"><b>${s.score}</b><div style="font-size:11px">${VERD[s.verdict][0]}</div></td>`).join('')}</tr>`;
    const seuilsUi = Object.keys(SEUILS).map((k) => { const c = CRITERES.filter((x) => x.cle === k)[0]; if (!c) return ''; return `<tr><td>${esc(c.lib)}</td><td><input class="form-input" type="number" step="any" data-seuil="${k}.ok" value="${S[k].ok}" style="width:130px"></td><td><input class="form-input" type="number" step="any" data-seuil="${k}.warn" value="${S[k].warn}" style="width:130px"></td><td class="muted" style="font-size:12px">${c.sens === 'bas' ? 'plus bas = mieux' : 'plus haut = mieux'}${k.indexOf('croissance') === 0 || ['recurrent', 'top1', 'topLogiciel', 'encaisse'].indexOf(k) >= 0 ? ' (0,3 = 30 %)' : ''}</td></tr>`; }).join('');
    return `<div class="card"><div class="card-header"><span class="card-title">🧾 Critères et poids par type de financeur</span></div>
      <div style="overflow:auto"><table class="table" style="width:100%;font-size:13px"><thead>${entete}</thead><tbody>${lignes}${pied}</tbody></table></div>
      ${note('● à ●●● : importance du critère pour ce type de financeur. ⛔ : condition obligatoire (doit être « atteinte »). Légende des colonnes : ' + ROUTES.map((r) => r.ico + ' ' + esc(r.lib)).join(' · '))}
      ${note('Verdict : « éligible » = score au-dessus du seuil ET toutes les conditions obligatoires atteintes ; « presque » = à moins de 15 points du seuil.')}</div>
      <details class="card" id="lev-seuils" ${ui.seuilsOpen ? 'open' : ''}><summary class="card-title" style="cursor:pointer">⚙️ Modifier les seuils (vert / orange)</summary>
      ${note('Adaptez-les au règlement du financeur visé. Colonne « vert » : valeur à atteindre ; colonne « orange » : valeur minimale acceptable.')}
      <div style="overflow:auto"><table class="table" style="width:100%;font-size:13px"><thead><tr><th>Critère</th><th>Vert</th><th>Orange</th><th></th></tr></thead><tbody>${seuilsUi}</tbody></table></div>
      <button class="btn btn-sm" data-act="seuils-defaut">Revenir aux seuils par défaut</button></details>`;
  }

  /* — Simulation : levée + « et si » — */
  function tabSimul() {
    const rc = mod ? mod.recommande : null, pre = ov.sim.preMoney != null ? ov.sim.preMoney : (mod ? mod.preMoney : 0), montant = ov.sim.montant != null ? ov.sim.montant : (rc || 0);
    const W = ov.what, champ = (k, lib, ph, st) => `<label class="form-label" style="font-size:12px">${lib}<input class="form-input" type="number" step="${st || 'any'}" data-what="${k}" value="${W[k] != null ? W[k] : ''}" placeholder="${ph}"></label>`;
    const actuel = (v, f) => v == null ? 'non mesurable' : f(v);
    return `<div class="card"><div class="card-header"><span class="card-title">💰 Simuler la levée</span></div>
      ${mod ? '' : '<div class="alert alert-warn">⚠️ <div>Le modèle Financement n\'est pas encore disponible : ouvrez Finance → Financement une première fois.</div></div>'}
      <div id="lev-ctl" class="grid-3" style="gap:12px">
        <label class="form-label">Montant à lever (FCFA)<input class="form-input" type="number" min="0" step="any" data-sim="montant" value="${Math.round(montant)}"></label>
        <label class="form-label">Valorisation avant apport (FCFA)<input class="form-input" type="number" min="0" step="any" data-sim="preMoney" value="${Math.round(pre)}"></label>
        <div class="muted" style="font-size:12px;align-self:end">Départ : le besoin recommandé par le modèle Financement (${rc != null ? F.m(rc) : '—'}) et sa valorisation automatique (${mod ? F.m(mod.preMoney) : '—'}).</div></div>
      <div id="lev-montage">${blocMontage()}</div></div>
      <div class="card"><div class="card-header"><span class="card-title">🧪 Et si… ? Simuler pour devenir éligible</span></div>
      ${note('Saisissez les valeurs que vous espérez atteindre : les scores de chaque type de financeur se recalculent en direct. Laissez vide pour garder la valeur réelle.')}
      <div id="lev-what" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px">
        ${champ('livre12', 'CA livré 12 mois (FCFA HT) — actuel : ' + actuel(mes.nbCommandes ? mes.livre12 : null, F.m), 'ex. 20000000')}
        ${champ('clients', 'Clients — actuel : ' + actuel(mes.nbCommandes ? mes.clients : null, F.n), 'ex. 10')}
        ${champ('croissance', 'Croissance mensuelle (0,10 = 10 %) — actuel : ' + actuel(mes.croissance, F.p), 'ex. 0.1', '0.01')}
        ${champ('recurrent', 'Part récurrente (0,3 = 30 %) — actuel : ' + actuel(mes.recurrent, F.p), 'ex. 0.3', '0.01')}
        ${champ('top1', 'Poids du 1er client (0,4 = 40 %) — actuel : ' + actuel(mes.top1, F.p), 'ex. 0.35', '0.01')}
        ${champ('encaisse', 'Part encaissée (0,7 = 70 %) — actuel : ' + actuel(mes.encaisse, F.p), 'ex. 0.7', '0.01')}
        ${champ('moisAct', 'Mois d\'activité — actuel : ' + actuel(mes.nbCommandes ? mes.moisAct : null, F.mois), 'ex. 12')}
        ${champ('pipelineMois', 'Pipeline en mois de ventes — actuel : ' + actuel(mes.pipelineMois, F.mois), 'ex. 6')}</div>
      <div id="lev-what-out">${blocWhat()}</div>
      <button class="btn btn-sm" data-act="what-reset" style="margin-top:8px">Effacer la simulation</button></div>`;
  }
  function blocMontage() {
    const x = montage({ montant: ov.sim.montant != null ? ov.sim.montant : (mod ? mod.recommande : 0), preMoney: ov.sim.preMoney != null ? ov.sim.preMoney : (mod ? mod.preMoney : 0) }, mod, mes);
    return `<div class="stats-grid" style="margin:12px 0">${stat('Valorisation après apport', F.m(x.post), 'avant : ' + F.m(x.pre), 'blue')}${stat('Part cédée', (x.part * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %', 'des parts de la société', x.part > 0.30 ? 'red' : 'green')}
      ${stat('Autonomie', x.runway === null ? '—' : F.mois(x.runway), x.runway === null ? 'consommation non calculable' : 'au rythme de ' + F.m(mod.burn) + ' / mois', x.runway !== null && x.runway < 12 ? 'orange' : 'green')}
      ${stat('Valorisation / CA 12 mois', x.multCA === null ? '—' : F.n(x.multCA) + ' ×', x.multRec === null ? 'ventes insuffisantes' : F.n(x.multRec) + ' × le revenu récurrent', 'purple')}</div>
      ${x.alertes.length ? `<div class="alert alert-warn">⚠️ <div><ul style="margin:0;padding-left:18px">${x.alertes.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div></div>` : ''}
      ${x.table.length ? `<table class="table" style="width:100%;font-size:13px;margin-top:8px"><thead><tr><th>Associé</th><th style="text-align:right">Avant</th><th style="text-align:right">Après</th></tr></thead><tbody>${x.table.map((r) => `<tr><td>${esc(r.nom)}</td><td style="text-align:right">${(r.avant * 100).toFixed(1)} %</td><td style="text-align:right">${(r.apres * 100).toFixed(1)} %</td></tr>`).join('')}</tbody></table>` : ''}
      ${x.manque ? note('Écart avec le besoin du modèle : ' + F.m(x.manque) + '.') : ''}`;
  }
  function blocWhat() {
    const r = simulerHypothese(mes, ov.seuils, ov.manuel, ov.what), vide = !Object.keys(ov.what).some((k) => ov.what[k] !== null && ov.what[k] !== '' && ov.what[k] !== undefined);
    return `<table class="table" style="width:100%;font-size:13px;margin-top:12px"><thead><tr><th>Type de financeur</th><th style="text-align:right">Aujourd'hui</th><th style="text-align:right">Avec la simulation</th><th>Verdict</th></tr></thead><tbody>${ROUTES.map((q, i) => { const a = r.avant[i], b = r.apres[i], d = b.score - a.score, v = VERD[b.verdict]; return `<tr><td>${q.ico} ${esc(q.lib)}</td><td style="text-align:right">${a.score}</td><td style="text-align:right"><b>${b.score}</b> ${vide ? '' : `<span style="color:${d > 0 ? '#16a34a' : d < 0 ? '#dc2626' : '#6b7280'}">(${d > 0 ? '+' : ''}${d})</span>`}</td><td>${v[0]}${b.bloques.length ? `<div class="muted" style="font-size:11px">à régler : ${b.bloques.map((id) => esc(nomCrit(id).lib)).join(' ; ')}</div>` : ''}</td></tr>`; }).join('')}</tbody></table>`;
  }

  /* — Plan d'action — */
  function tabPlan() {
    const pl = plan(mes, ov.seuils, ov.manuel);
    return `<div class="card"><div class="card-header"><span class="card-title">🧭 Plan d'action pour devenir éligible</span></div>
      ${pl.length ? `<table class="table" style="width:100%;font-size:13px"><thead><tr><th>#</th><th>À faire</th><th>Situation</th><th>Objectif</th><th>Délai estimé</th><th>Débloque</th></tr></thead><tbody>${pl.map((p, i) => `<tr><td>${i + 1}</td><td><b>${esc(p.lib)}</b><div class="muted" style="font-size:12px">${esc(p.action)}</div></td><td>${cell({ s: p.s, texte: p.texte })}</td><td>${p.cible ? esc((p.cible.sens === 'bas' ? '≤ ' : '≥ ') + p.cible.fmt) : '—'}</td><td>${p.delai ? p.delai + ' mois' : '—'}</td><td>${p.bloque.length ? p.bloque.map((id) => ROUTES.filter((r) => r.id === id)[0].ico).join(' ') + ' <span class="muted" style="font-size:11px">(condition obligatoire)</span>' : `+${p.gain} pts`}</td></tr>`).join('')}</tbody></table>` : '<p>🎉 Tous les critères sont atteints.</p>'}
      ${note('Classement : d\'abord les conditions obligatoires, puis le gain moyen de score. Le délai n\'est donné que pour les critères qui se cumulent (CA livré, clients) ou dépendent du temps, au rythme actuel des ventes : c\'est un ordre de grandeur, pas une promesse.')}</div>`;
  }


  /* — Pitch deck : reconstruit à chaque ouverture à partir des chiffres du moment — */
  function donneesDeck() {
    const g = (f) => { try { return f(); } catch (e) { return undefined; } }, C = g(() => CONFIG) || {};
    const cat = (g(() => LOGICIELS) || []).filter((l) => l && l.actif !== false).map((l) => ({ nom: l.nom, cat: l.cat, prix: l.prixNum }));
    const d = Object.assign({ fondateur: g(() => currentUser.nom) || '' }, ov.deck);
    return { societe: C.raisonSociale, email: C.email, adresse: C.adresse, tel: C.tel, site: C.site, m: mes, mod: mod, d: d, catalogue: cat, sim: { montant: ov.sim.montant, preMoney: ov.sim.preMoney } };
  }
  function blocDeck() {
    const D = deck(donneesDeck()), proj = projeterALaDate(mes, ov.deck.lancement, ov.seuils, ov.manuel);
    const alertes = []; if (!mes.immat) alertes.push('Société non immatriculée dans le CRM (RCCM et compte contribuable) : à régler avant tout envoi.'); if (mod && !mod.valide) alertes.push('Le modèle Financement n\'est pas validé : les projections s\'affichent comme « document de travail ».'); if (!mod) alertes.push('Le modèle Financement n\'est pas encore calculé : ouvrez Finance → Financement une fois.');
    const projHtml = !ov.deck.lancement ? note('Indiquez la date de lancement visée : le module estime vos scores à ce moment-là.')
      : !proj ? note('La date visée doit être dans le futur.')
      : !proj.mesurable ? `<div class="alert alert-warn">⚠️ <div>À ${esc(Math.round(proj.mois * 10) / 10)} mois de la date visée, l\'historique actuel (${esc(F.mois(mes.moisAct))}) est trop court pour estimer : une extrapolation serait trompeuse. Revenez après 3 mois de ventes.</div></div>`
      : `<table class="table" style="width:100%;font-size:13px"><thead><tr><th>Type de financeur</th><th style="text-align:right">Aujourd'hui</th><th style="text-align:right">À la date visée (estimé)</th><th>Verdict estimé</th></tr></thead><tbody>${ROUTES.map((q, i) => { const a = proj.avant[i], b = proj.scores[i], v = VERD[b.verdict]; return `<tr><td>${q.ico} ${esc(q.lib)}</td><td style="text-align:right">${a.score}</td><td style="text-align:right"><b>${b.score}</b></td><td>${v[0]}</td></tr>`; }).join('')}</tbody></table>${note('Estimation : le rythme de ventes actuel (' + F.m(mes.rythme) + ' par mois) prolongé sur ' + (Math.round(proj.mois * 10) / 10) + ' mois ; les critères de dossier cochés sont supposés inchangés. C\'est un ordre de grandeur, pas une promesse.')}`;
    return `${alertes.length ? `<div class="alert alert-warn">⚠️ <div><ul style="margin:0;padding-left:18px">${alertes.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div></div>` : ''}
      <div class="card"><div class="card-header"><span class="card-title">🧭 Que devient mon éligibilité à la date de lancement ?</span></div>${projHtml}</div>
      <div class="card"><div class="card-header"><span class="card-title">📝 À compléter avant diffusion (${D.manques.length})</span></div>${D.manques.length ? `<ul style="margin:0;padding-left:20px;font-size:13px">${D.manques.map((x) => `<li><b>${esc(x.slide)}</b> — ${esc(x.lib)}</li>`).join('')}</ul>` : '<p>✅ Aucun élément manquant : le deck est complet.</p>'}</div>
      <div class="card"><div class="card-header"><span class="card-title">👁️ Aperçu (12 diapositives)</span><button class="btn btn-sm btn-primary" data-act="deck-ouvrir">🖨️ Ouvrir / enregistrer en PDF</button></div>
        <iframe title="Aperçu du pitch deck" id="lev-deck-f" sandbox="allow-same-origin" style="width:100%;height:520px;border:1px solid var(--border);border-radius:8px;background:#888" srcdoc="${escH(D.document(0.5))}"></iframe></div>`;
  }
  function tabDeck() {
    const d = Object.assign({ fondateur: (function () { try { return currentUser.nom; } catch (e) { return ''; } })() }, ov.deck), L = (k, lib, ph, type) => `<label class="form-label" style="font-size:12px">${lib}<input class="form-input" type="${type || 'text'}" data-deck="${k}" value="${esc(d[k] == null ? '' : d[k])}" placeholder="${esc(ph || '')}"></label>`;
    const T = (k, lib, ph) => `<label class="form-label" style="font-size:12px">${lib}<textarea class="form-input" rows="2" data-deck="${k}" placeholder="${esc(ph || '')}">${esc(d[k] == null ? '' : d[k])}</textarea></label>`;
    return `<div class="alert alert-info">ℹ️ <div>Le deck se <b>reconstruit à chaque ouverture</b> à partir des chiffres du moment (commandes, clients, encaissements), de votre simulation (montant, valorisation) et du modèle Financement. Ce que vous saisissez ici sert à compléter ce que le CRM ne sait pas.</div></div>
      <div class="card"><div class="card-header"><span class="card-title">🎤 Éléments du deck</span></div>
      <div id="lev-deck-ctl" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">
        ${L('lancement', 'Date de lancement visée', '', 'month')}${L('agents', 'Nombre d\'agents IA (à mettre à jour)', 'ex. 25')}${L('fondateur', 'Fondateur', 'Nom')}
        ${T('parcours', 'Parcours du fondateur', 'Expérience, rôle')}${T('associes', 'Associés et recrutements prévus', 'Qui, quelle part du capital, quels postes')}${T('sourceProbleme', 'Chiffre de marché sourcé (diapositive Problème)', 'ex. 60 % des PME n\'ont pas de logiciel de gestion (source, année)')}
        ${T('marcheTotal', 'Marché total', 'Nombre d\'entreprises, source')}${T('marcheAccessible', 'Marché accessible', 'Secteurs et villes servis')}${T('marchePart', 'Part visée', 'Clients et CA visés à 3 ans')}
        ${L('empProduit', 'Fonds : produit et technique (%)', '', 'number')}${L('empCommercial', 'Fonds : équipe commerciale (%)', '', 'number')}${L('empMarketing', 'Fonds : marketing (%)', '', 'number')}${L('empTreso', 'Fonds : trésorerie (%)', '', 'number')}
        ${L('tel', 'Téléphone', '+225 …')}${L('site', 'Site web', 'https://…')}</div>
      ${note('Montant, valorisation et part cédée viennent de l\'onglet Simulation ; projections et point mort du module Financement.')}</div>
      <div id="lev-deck-out">${blocDeck()}</div>`;
  }

  /* — Notes — */
  function tabNotes() {
    return `<div class="card"><div class="card-header"><span class="card-title">📖 Comment lire ce module</span></div><div style="font-size:13px">
      <p><b>Mesuré ou coché.</b> Les indicateurs chiffrés sont calculés à partir de vos commandes, de vos paiements, de votre pipeline et de la fiche société ; seuls les critères de dossier qu\'aucun chiffre ne prouve (pacte, équipe, pitch deck…) sont à cocher.</p>
      <p><b>Score.</b> Chaque type de financeur attribue un poids de 0 à 3 à chaque critère. Score = somme des points obtenus (atteint = 1, à renforcer = 0,5, sinon 0) ÷ somme des poids, sur 100. Un critère non mesurable compte pour 0.</p>
      <p><b>Éligible.</b> Score au-dessus du seuil du financeur et toutes ses conditions obligatoires atteintes.</p>
      <p><b>Seuils.</b> Ce sont des repères de bonnes pratiques pour des jeunes entreprises de logiciels en Afrique de l\'Ouest, pas les règles d\'un fonds ou d\'un programme précis : chacun fixe ses propres conditions (montant, secteur, âge de la société, résidence des fondateurs). Lisez le règlement avant de candidater et ajustez les seuils.</p>
      <p><b>Limites.</b> L\'historique de ventes est court : la croissance et la régularité ne sont pas encore mesurables avant 6 mois d\'activité. Les commandes « en cours » ne sont pas encore du chiffre d\'affaires acquis. Vos réglages sont enregistrés sur cet appareil seulement.</p></div></div>
      <div class="card"><div class="card-header"><span class="card-title">🔤 Glossaire</span></div><dl style="margin:0;font-size:13px">${GLOSSAIRE.map((g) => `<dt style="font-weight:600;margin-top:8px">${esc(g[0])}</dt><dd style="margin:2px 0 0">${esc(g[1])}</dd>`).join('')}</dl></div>
      <div class="card"><div class="card-header"><span class="card-title">🗺️ Étapes d'une levée</span></div><ol style="margin:0;padding-left:20px;font-size:13px"><li>Mettre l\'entreprise en règle (immatriculation, comptes, pacte).</li><li>Réunir les preuves de traction (clients, encaissements, récurrent).</li><li>Fixer le besoin et l\'usage des fonds (module Financement).</li><li>Préparer le pitch deck et la data room.</li><li>Cibler les financeurs dont l\'éligibilité est atteinte (onglet Éligibilité).</li><li>Premiers contacts, présentations, lettre d\'intention.</li><li>Vérification (due diligence), pacte, signature, versement.</li></ol></div>`;
  }

  /* — Fiche imprimable — */
  function fiche() {
    const ev = evCourant(), sc = scores(ev), S = seuils(ov.seuils), pl = plan(mes, ov.seuils, ov.manuel), e = esc;
    const w = window.open('', '_blank'); if (!w) { toast('⚠️ Autorisez les fenêtres pop-up pour ouvrir la fiche'); return; }
    const societe = (function () { try { return CONFIG.raisonSociale || 'SANIX'; } catch (x) { return 'SANIX'; } })();
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Éligibilité à une levée de fonds — ${e(societe)}</title><style>body{font:13px/1.45 system-ui,sans-serif;margin:24px;color:#111}h1{font-size:20px}h2{font-size:15px;margin:18px 0 6px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:5px 8px;text-align:left;vertical-align:top}.n{color:#555;font-size:11px}</style></head><body>
      <h1>État de préparation à une levée de fonds — ${e(societe)}</h1><p class="n">Document de travail établi le ${e(mes.now)} à partir des commandes du CRM. Seuils indicatifs, à confronter au règlement de chaque financeur.</p>
      <h2>Éligibilité par type de financeur</h2><table><tr><th>Financeur</th><th>Score</th><th>Verdict</th><th>À régler d'abord</th></tr>${ROUTES.map((r, i) => `<tr><td>${e(r.lib)}</td><td>${sc[i].score} / 100 (seuil ${sc[i].seuil})</td><td>${e(VERD[sc[i].verdict][0])}</td><td>${sc[i].bloques.map((id) => e(nomCrit(id).lib)).join(' ; ') || '—'}</td></tr>`).join('')}</table>
      <h2>Indicateurs</h2><table><tr><th>Critère</th><th>Situation</th><th>Statut</th></tr>${CRITERES.map((c, i) => `<tr><td>${e(c.lib)}</td><td>${e(ev[i].texte)}</td><td>${e(ST[ev[i].s][2])}</td></tr>`).join('')}</table>
      <h2>Plan d'action</h2><ol>${pl.map((p) => `<li><b>${e(p.lib)}</b> — ${e(p.action)}${p.delai ? ' (délai estimé : ' + p.delai + ' mois)' : ''}</li>`).join('') || '<li>Aucune action.</li>'}</ol></body></html>`);
    w.document.close();
  }

  function render() {
    const host = root(); if (!host) return;
    let el = host.querySelector(':scope > #lev-body'); if (!el) { el = document.createElement('div'); el.id = 'lev-body'; host.appendChild(el); }
    const tabs = [['synthese', '📊 Synthèse'], ['indic', '📐 Indicateurs'], ['elig', '✅ Éligibilité'], ['simul', '🧪 Simulation'], ['plan', '🧭 Plan d\'action'], ['deck', '🎤 Pitch deck'], ['notes', '📖 Notes']];
    const corps = ui.tab === 'indic' ? tabIndic() : ui.tab === 'elig' ? tabElig() : ui.tab === 'simul' ? tabSimul() : ui.tab === 'plan' ? tabPlan() : ui.tab === 'deck' ? tabDeck() : ui.tab === 'notes' ? tabNotes() : tabSynthese();
    el.innerHTML = `<div class="ban"><div class="ban-deco"></div><h1 class="page-title">🚀 Levée de fonds</h1><p class="page-sub">Votre niveau de préparation, votre éligibilité par type de financeur et la simulation pour y arriver — départ : vos chiffres réels du CRM</p></div>
      <div class="tabs" role="tablist" style="margin-bottom:16px">${tabs.map((t) => `<div class="tab ${ui.tab === t[0] ? 'active' : ''}" role="tab" tabindex="0" aria-selected="${ui.tab === t[0]}" data-tab="${t[0]}">${t[1]}</div>`).join('')}</div>${corps}
      <div id="lev-sync" class="muted" style="font-size:12px;margin-top:12px"></div>
      <div style="margin-top:12px"><button class="btn btn-sm" data-act="fiche">🖨️ Fiche d'éligibilité (PDF)</button> <button class="btn btn-sm" data-act="vers-financement">🏦 Ouvrir le modèle Financement</button></div>`;
    majStatutSync();
  }
  function bind() {
    const el = root(); if (!el || el.dataset.bound) return; el.dataset.bound = '1';
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tab],[data-act]'); if (!t) return;
      if (t.dataset.tab) { ui.tab = t.dataset.tab; render(); return; }
      const a = t.dataset.act;
      if (a === 'fiche') fiche();
      else if (a === 'vers-financement') { try { navGroup('finance', 'financement'); } catch (x) { try { showView('financement'); } catch (y) { /* hors CRM */ } } }
      else if (a === 'seuils-defaut') { ov.seuils = {}; persist(); recompute(); render(); }
      else if (a === 'deck-ouvrir') { const w = window.open('', '_blank'); if (!w) { toast('⚠️ Autorisez les fenêtres pop-up pour ouvrir le deck'); return; } w.document.write(deck(donneesDeck()).document(0.7)); w.document.close(); }
      else if (a === 'what-reset') { ov.what = {}; persist(); render(); }
    });
    el.addEventListener('toggle', (e) => { if (e.target && e.target.id === 'lev-seuils') ui.seuilsOpen = e.target.open; }, true);
    el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.tab) { e.preventDefault(); ui.tab = e.target.dataset.tab; render(); } });
    el.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.sim) { ov.sim[t.dataset.sim] = t.value === '' ? null : num(t.value); persist(); const o = document.getElementById('lev-montage'); if (o) o.innerHTML = blocMontage(); }
      else if (t.dataset.deck) { ov.deck[t.dataset.deck] = t.value; persist(); const o = document.getElementById('lev-deck-out'); if (o) { const f = document.getElementById('lev-deck-f'), y = f && f.contentWindow ? f.contentWindow.scrollY : 0; o.innerHTML = blocDeck(); const f2 = document.getElementById('lev-deck-f'); if (f2 && y) f2.addEventListener('load', () => { try { f2.contentWindow.scrollTo(0, y); } catch (e) { /* aperçu */ } }); } }
      else if (t.dataset.what) { ov.what[t.dataset.what] = t.value === '' ? null : num(t.value); persist(); const o = document.getElementById('lev-what-out'); if (o) o.innerHTML = blocWhat(); }
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.man) { ov.manuel[t.dataset.man] = t.checked; persist(); render(); }
      else if (t.dataset.seuil) { const p = t.dataset.seuil.split('.'); ov.seuils[p[0]] = Object.assign({}, ov.seuils[p[0]], { [p[1]]: num(t.value) }); persist(); recompute(); render(); }
    });
  }
  G.initLevee = function () { if (!ov) load(); recompute(); bind(); render(); majStatutSync(); tirer().then((ch) => { if (ch) { recompute(); render(); } planifierSync(); }); };
  G.SanixLevee.refresh = function () { const r = root(); if (ov && r && !r.classList.contains('hidden')) { recompute(); render(); } };
})(typeof window !== 'undefined' ? window : globalThis);
