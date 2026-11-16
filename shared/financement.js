/* SANIX CRM — Financement : modèle financier à 5 ans pour présenter un besoin de financement à des financeurs.
 *
 * Calculs purs (SanixFinancement.calc, testables sans navigateur) + écran « Financement » (#view-financement, groupe Finance).
 * Point de départ : les chiffres réels du CRM (commandes, pipeline, clients), lus sans jamais être modifiés. Tout le reste est une
 * hypothèse de la direction, modifiable : les valeurs initiales sont indicatives et doivent être validées avant toute remise à un financeur.
 * Données : localStorage « sanix_crm_fin_config » (uniquement ce que l'utilisateur a modifié) — propre à l'appareil, non synchronisée.
 *
 * Modèle : simulation mensuelle sur 60 mois, deux plans :
 *   - « sans » : l'activité actuelle, sans embauche ni campagne financée, croissance limitée par les moyens ;
 *   - « avec » : le plan complet (embauches financées, campagnes), croissance accélérée.
 * Le besoin de financement est le point bas de trésorerie du plan complet sans apport. Chaque option (capital, dette, subvention, mix)
 * est dimensionnée pour couvrir ce besoin, puis comparée : trésorerie, résultats, part cédée, rendement investisseur, capacité de remboursement.
 */
(function (G) {
  'use strict';
  const N = 60, ANNEES = 5;
  const SCEN = { prudent: [30, 25, 20, 15], realiste: [60, 50, 40, 30], ambitieux: [100, 80, 60, 40] };
  const SCEN_LABEL = { prudent: 'Prudent', realiste: 'Réaliste', ambitieux: 'Ambitieux' };
  const OPT_LABEL = { capital: 'Levée en capital', dette: 'Prêt / dette', subvention: 'Subvention', mix: 'Mix' };

  const num = (v) => { v = Number(v); return isFinite(v) ? v : 0; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const pos = (v) => Math.max(0, num(v));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, num(v)));
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);

  /* ───────────── Logiciels : mode de vente, frais initiaux, maintenance ───────────── */
  const MODES = { perpetuelle: 'Licence + maintenance', annuelle: 'Abonnement annuel', mensuelle: 'Abonnement mensuel' };
  const MODE_CATALOGUE = { Perpetuelle: 'perpetuelle', Annuelle: 'annuelle', Mensuelle: 'mensuelle', SaaS: 'mensuelle' };
  /** Un enregistrement par logiciel du catalogue. Part des ventes : ce qui a réellement été vendu. Prix : celui du catalogue (la maintenance se calcule sur le prix de la
   *  licence, pas sur des factures qui peuvent inclure d'autres prestations) ; le prix moyen réellement facturé est conservé à titre de comparaison. */
  function produitsDefaut(base) {
    const cat = (base && base.logiciels) || [], ventes = {}; ((base && base.ventesLogiciel) || []).forEach((v) => { ventes[v.cle] = v; });
    const vend = cat.map((l) => ventes[cle(l.nom)]), tot = sum(vend, (v) => v ? v.n : 0);
    return cat.map((l, i) => {
      const v = vend[i], observe = v && v.n > 0 ? Math.round(v.ht / v.n) : 0, prix = Math.round(pos(l.prixNum));
      return { id: String(l.id || 'p' + i), nom: l.nom, mode: MODE_CATALOGUE[l.typeLicence] || 'perpetuelle', prixLicence: prix, prixMensuel: Math.round(pos(l.prixMensuel)), prixAnnuel: Math.round(pos(l.prixMensuel) * 10),
        initial: Math.round(prix * 0.2), maintPct: 0, part: tot > 0 && v ? Math.round(v.n / tot * 1000) / 10 : 0, catalogue: prix, observe, vendus: v ? v.n : 0 };
    });
  }
  /** Liste des logiciels du CRM, sur laquelle on applique les seules modifications faites dans le modèle (champ par champ, par identifiant).
   *  Un logiciel ajouté ou un prix changé au catalogue est donc repris ; un champ que vous avez modifié garde votre valeur ; une modification
   *  sur un logiciel supprimé du catalogue est ignorée. */
  function fusionProduits(defauts, edits) {
    edits = edits || {};
    return (defauts || []).map((p) => Object.assign({}, p, edits[p.id] || {}));
  }
  /** Modifications (champ par champ) qui font passer de `avant` à `apres` : [{ id, champ, valeur }]. */
  function diffProduits(avant, apres) {
    const out = []; (apres || []).forEach((p) => { const q = (avant || []).filter((x) => x.id === p.id)[0]; if (!q) return; Object.keys(p).forEach((k) => { if (JSON.stringify(p[k]) !== JSON.stringify(q[k])) out.push({ id: p.id, champ: k, valeur: p[k] }); }); });
    return out;
  }
  /** Ancien format (liste complète figée) → modifications par champ, par différence avec le catalogue actuel. */
  function editsDepuisListe(liste, defauts) {
    const edits = {}; diffProduits(defauts, liste).forEach((d) => { if (['catalogue', 'observe', 'vendus', 'nom'].indexOf(d.champ) >= 0) return; (edits[d.id] = edits[d.id] || {})[d.champ] = d.valeur; });
    return edits;
  }
  /** Logiciels qui entrent dans le calcul (part des ventes > 0), parts ramenées à 1. Sans logiciel renseigné : un produit moyen reprenant les anciennes hypothèses. */
  function produitsActifs(h) {
    const L = (h.produits || []).filter((p) => pos(p.part) > 0), tot = sum(L, (p) => pos(p.part));
    if (!L.length) return [{ id: 'moyen', nom: 'Licence moyenne', mode: 'perpetuelle', prixLicence: pos(h.prixLicence), prixAnnuel: 0, prixMensuel: 0, initial: pos(h.servicesPct) / 100 * pos(h.prixLicence), maintPct: pos(h.maintenancePct), part: 1, legacy: true }];
    return L.map((p) => Object.assign({}, p, { part: pos(p.part) / tot }));
  }
  const valeurAnnuelle = (p) => p.mode === 'annuelle' ? pos(p.prixAnnuel) : 12 * pos(p.prixMensuel);   // redevance d'un abonné sur un an

  /* ───────────── Hypothèses ───────────── */
  /** Valeurs initiales : tirées du CRM quand il contient la donnée, sinon exemples indicatifs à adapter. */
  function defauts(base) {
    base = base || {};
    const nb = Math.round(pos(base.commandes12m));
    return {
      produits: produitsDefaut(base),                                    // un enregistrement par logiciel (catalogue du CRM) ; vide = un « produit moyen » unique (ancien comportement)
      valide: false,                                                       // cochée par l'utilisateur : retire la mention « document de travail » des exports
      scenario: 'realiste', croiss: SCEN.realiste.slice(), croissSans: [10, 10, 10, 10],
      clientsAn1: nb > 0 ? nb : 12,                                         // nouveaux clients la 1re année (commandes des 12 derniers mois)
      prixLicence: pos(base.prixMoyen) > 0 ? Math.round(base.prixMoyen) : 1500000,   // HT par nouveau client
      hausseAn: 3, maintenancePct: 0, retentionPct: 85, servicesPct: 20, delaiEncaissement: 1,
      baseInstallee: Math.round(pos(base.caTotal)),                          // CA HT cumulé déjà vendu : assiette de la maintenance
      maintDelaiMois: 12,                                                    // la 1re année de maintenance est incluse dans la licence : elle n'est facturée qu'à partir du 12e mois
      baseAgeMois: base.ageBaseMois != null ? Math.round(pos(base.ageBaseMois)) : 12,   // ancienneté moyenne (pondérée) des ventes déjà faites, lue dans le CRM : la base installée n'entre en maintenance qu'à son 1er anniversaire
      imfOn: false,                                                          // impôt minimum forfaitaire (0,5 % du CA TTC, de 3 à 35 M par an, même en perte) : sert au seul mode « IS sur le résultat » ; les régimes réel simplifié et réel normal l'appliquent d'office
      regime: 'auto', ticOn: true, cgaOn: false,                              // régime d'imposition (automatique selon le CA TTC de l'année), secteur TIC (IS à 30 % au lieu de 25 %), adhésion à un centre de gestion agréé (taux réduits)
      regimeConfirme: false,                                                  // à cocher quand l'expert-comptable a confirmé le régime et le taux d'IS : sans cela le dossier affiche un avertissement
      debutActivite: '2026-06',                                              // début d'activité : sert aux libellés « depuis le début » quand l'historique fait moins de 12 mois
      directsPct: 4, commissionPct: pos(base.commissionDefaut) > 0 ? pos(base.commissionDefaut) : 10,
      // Infrastructure technique (tarifs publics en dollars, convertis au taux ci-dessous) et intelligence artificielle
      usdFcfa: pos(base.usdFcfa) > 0 ? pos(base.usdFcfa) : 595, fraisPaiementPct: 3,                     // taux du 13/11/2026 (BCEAO : 593,5) ; frais de change et de carte (estimation)
      supabaseFixeUsd: 25, supabaseProjetUsd: 10, projetsBase: 1, projetParClient: true, clientsDepart: Math.round(pos(base.clientsFactures)),   // Pro : 25 $ avec le 1er projet, puis 10 $ par projet (compute Micro)
      vercelSiegeUsd: 20, githubSiegeUsd: 4, githubSeuil: 3,                                              // Vercel Pro par poste technique ; GitHub Team à partir de 3 postes (gratuit en dessous)
      iaMensuelUsd: 200, iaCroissanceAn: 25,                                                              // Anthropic : consommation mensuelle des agents (plafond de gouvernance : 400 $/mois)
      marketingPct: 8, marketingMin: 250000, marketingBoost: 400000,
      fixesMensuels: 700000, chargesSocialesPct: 20, augmentationSalairesPct: 4, impotPct: 25, tresoDepart: 0,
      postes: [   // plan échelonné : on part de l'équipe actuelle et on n'ajoute un poste que lorsque les ventes le paient (la date est un point de contrôle, pas une obligation)
        { id: 'p1', nom: 'Équipe actuelle (à renseigner)', nb: 1, cout: 500000, debut: 0, finance: false },
        { id: 'p2', nom: 'Commercial (1er poste financé)', nb: 1, cout: 300000, debut: 3, finance: true, acquisition: true },
        { id: 'p3', nom: 'Développeur', nb: 1, cout: 450000, debut: 9, finance: true, tech: true },
        { id: 'p4', nom: 'Support & déploiement', nb: 1, cout: 300000, debut: 15, finance: true }
      ],
      investissements: [],                                                 // décaissements ponctuels : { id, nom, mois (0-59), montant HT, duree (années d'amortissement, 0 = non amorti), finance }. Vide tant que vous ne les saisissez pas.
      baseRetraitee: false,                                                // base du modèle : exclut les clients marqués « partie liée »
      associes: [{ id: 'a1', nom: 'Fondateur(s) et associés actuels', part: 100 }], esopPct: 0,   // tour de table actuel ; pool d'intéressement en % après l'apport
      margeSecuritePct: 20, partCapital: 50, partDette: 30, partSubvention: 20,
      preMoney: null, multEntree: 2, multSortie: 2.5, taux: 12, dureeMois: 60, differeMois: 12
    };
  }

  /** Investissements saisis, normalisés : montant positif, mois entier de 0 à 59, durée d'amortissement en mois (linéaire, au moins 1 mois ; 0 = non amorti). Les lignes sans montant sont ignorées. */
  function investissementsActifs(h) {
    return (h.investissements || []).map((i) => ({ id: i.id, nom: i.nom, montant: pos(i.montant), mois: clamp(Math.round(num(i.mois)), 0, 1e6), mAmort: pos(i.duree) > 0 ? Math.max(1, Math.round(pos(i.duree) * 12)) : 0, finance: i.finance !== false }))
      .filter((i) => i.montant > 0 && i.mois < N);                         // un achat au-delà des 60 mois du plan n'existe pas dans le plan
  }

  /* ───────────── Régime d'imposition (DGI Côte d'Ivoire, CGI : barème 2025) ─────────────
     Selon le chiffre d'affaires annuel TTC : ≤ 5 M taxe communale de l'entreprenant (2,5 %) ; 5 à 50 M taxe d'État de l'entreprenant (5 %, 4 % si centre de gestion agréé) ;
     50 à 200 M micro-entreprise RME (6 %, 4 % si centre de gestion agréé ou expert-comptable conventionné) ; 200 à 500 M réel simplifié (IS + impôt minimum de 3 M) ; au-delà réel normal (IS + IMF de 3 à 35 M).
     Les trois premiers sont des impôts sur le chiffre d'affaires qui remplacent l'IS. IS : 25 %, 30 % pour le secteur des TIC (art. 51 du CGI). */
  const FORFAIT = {
    tcu: { lib: 'Taxe communale de l\'entreprenant (TCU)', taux: () => 0.025 },
    tee: { lib: 'Taxe d\'État de l\'entreprenant (TEE)', taux: (h) => h.cgaOn ? 0.04 : 0.05 },
    rme: { lib: 'Régime des micro-entreprises (RME)', taux: (h) => h.cgaOn ? 0.04 : 0.06 }
  };
  const REGIMES = { is: 'IS sur le résultat (ancien comportement, sans impôt minimum sauf option)', auto: 'Automatique selon le chiffre d\'affaires de l\'année', tcu: FORFAIT.tcu.lib, tee: FORFAIT.tee.lib, rme: FORFAIT.rme.lib, rsi: 'Réel simplifié (RSI) : IS + impôt minimum 3 M', rni: 'Réel normal (RNI) : IS + IMF de 3 à 35 M' };
  const tauxIS = (h) => h.ticOn ? 30 : pos(h.impotPct);
  /** Régime applicable pour un chiffre d'affaires annuel TTC. */
  function regimePourCA(caTtc) { return caTtc <= 5e6 ? 'tcu' : caTtc <= 50e6 ? 'tee' : caTtc <= 200e6 ? 'rme' : caTtc <= 500e6 ? 'rsi' : 'rni'; }
  /** Régime de chaque année du plan : forcé par l'utilisateur, ou déduit du CA TTC de l'année (le CGI retient le CA de l'année précédente : approximation à confirmer). */
  function regimesAnnuels(h, m) {
    const rg = REGIMES[h.regime] && h.regime !== 'is' ? h.regime : 'is';
    return Array.from({ length: ANNEES }, (_, y) => rg === 'auto' ? regimePourCA(sum(m.slice(y * 12, y * 12 + 12), (x) => x.ca) * 1.18) : rg);
  }

  /* ───────────── Simulation mensuelle ───────────── */
  /** plan : 'sans' | 'avec'. fin : { equity, subvention, dette: { montant, taux, duree, differe } } — tout versé au mois 0. */
  function simuler(h, plan, fin) {
    fin = fin || {};
    const avec = plan === 'avec', g = avec ? h.croiss : h.croissSans;
    const rm = Math.pow(clamp(h.retentionPct, 0, 100) / 100, 1 / 12);
    const delai = Math.round(clamp(h.delaiEncaissement, 0, 6));
    const cs = 1 + pos(h.chargesSocialesPct) / 100;

    // 1. Ventes : nouveaux clients, licences, maintenance sur la base installée (qui s'érode), services
    // Maintenance : la 1re année est incluse dans la licence ; elle est facturée à partir de l'anniversaire (délai en mois, au moins 1 : 0 ou 1 = dès le mois suivant la vente, ancien comportement).
    // Les clients qui partent avant l'anniversaire ne renouvellent pas : le montant qui entre en maintenance est réduit par la rétention.
    const dEff = Math.max(1, Math.round(clamp(h.maintDelaiMois, 0, 36))), debutBase = Math.max(0, Math.round(clamp(h.maintDelaiMois, 0, 36)) - Math.round(pos(h.baseAgeMois)));
    const prods = produitsActifs(h), bi = prods.map((p) => debutBase === 0 ? pos(h.baseInstallee) * p.part : 0), abon = prods.map(() => 0), m = [];
    const entrants = prods.map((p) => { const a = new Array(N + dEff + 3).fill(0); if (debutBase > 0) a[debutBase] = pos(h.baseInstallee) * p.part * Math.pow(rm, debutBase); return a; }); let parc = pos(h.clientsDepart);
    for (let t = 0; t < N; t++) {
      const y = Math.floor(t / 12);
      let ny = pos(h.clientsAn1); for (let k = 0; k < y; k++) ny *= 1 + clamp(g[k], -100, 1000) / 100;
      const n = ny / 12, haus = Math.pow(1 + num(h.hausseAn) / 100, y);
      let lic = 0, maint = 0, serv = 0, abo = 0, comm = 0; const pr = [];
      prods.forEach((p, i) => {
        const np = n * p.part, ini = np * pos(p.initial) * haus; let l = 0, mt = 0, ab = 0;
        if (p.mode === 'perpetuelle') {                                  // licence payée une fois ; maintenance annuelle sur la base installée, qui s'érode
          l = np * pos(p.prixLicence) * haus; bi[i] += entrants[i][t]; mt = pos(p.maintPct) / 100 / 12 * bi[i]; bi[i] = bi[i] * rm; entrants[i][t + dEff] += l * Math.pow(rm, dEff - 1); comm += l;
        } else {                                                          // abonnement : dès la signature, tant que le client reste (rétention)
          abon[i] = abon[i] * rm + np; ab = abon[i] * valeurAnnuelle(p) / 12 * haus; comm += np * valeurAnnuelle(p) * haus;   // commission sur la 1re année, à la signature
        }
        lic += l; maint += mt; serv += ini; abo += ab; pr.push({ id: p.id, clients: np, lic: l, serv: ini, maint: mt, abo: ab });
      });
      parc = parc * rm + n;                                              // clients hébergés en fin de mois (les clients perdus quittent le parc)
      m.push({ t, y, clients: n, parc, lic, maint, serv, abo, comm, prod: pr, ca: lic + maint + serv + abo });
    }

    // 2. Coûts, impôt, financement, trésorerie
    const d = fin.dette && pos(fin.dette.montant) > 0 ? fin.dette : null;
    const dur = d ? Math.max(1, Math.round(num(d.duree))) : 1, dif = d ? clamp(Math.round(num(d.differe)), 0, dur - 1) : 0;
    const tm = d ? pos(d.taux) / 100 / 12 : 0, amort = d ? pos(d.montant) / (dur - dif) : 0;
    const actif = (p, t) => (avec || !p.finance) && t >= num(p.debut);
    const coutPoste = (p, y) => pos(p.nb) * pos(p.cout) * cs * Math.pow(1 + num(h.augmentationSalairesPct) / 100, y);
    // Ouverture du bilan simplifié : la société n'a que de la trésorerie et des créances clients (à remplacer par le bilan réel).
    const eq0 = num(h.tresoDepart) + delai * m[0].ca, apports = pos(fin.equity) + pos(fin.subvention);
    const invs = investissementsActifs(h).filter((i) => avec || !i.finance);      // un investissement « financé » n'existe que dans le plan financé
    const regimeAn = regimesAnnuels(h, m);
    let reste = 0, pool = 0, treso = num(h.tresoDepart), cumRes = 0, immo = 0, isAn = 0;
    for (let t = 0; t < N; t++) {
      const r = m[t], y = r.y;
      r.directs = pos(h.directsPct) / 100 * r.ca;
      r.commissions = pos(h.commissionPct) / 100 * r.comm;
      // Coûts techniques en dollars → FCFA (taux + frais de paiement). Supabase : abonnement + un projet par client si c'est le choix d'architecture.
      r.sieges = 1 + sum(h.postes, (p) => p.tech && actif(p, t) ? pos(p.nb) : 0);
      const projets = pos(h.projetsBase) + (h.projetParClient ? r.parc : 0), kUsd = pos(h.usdFcfa) * (1 + pos(h.fraisPaiementPct) / 100);
      r.supa = (projets > 0 ? pos(h.supabaseFixeUsd) + Math.max(0, projets - 1) * pos(h.supabaseProjetUsd) : 0) * kUsd;
      r.vercel = r.sieges * pos(h.vercelSiegeUsd) * kUsd;
      r.github = r.sieges >= pos(h.githubSeuil) ? r.sieges * pos(h.githubSiegeUsd) * kUsd : 0;
      r.infra = r.supa + r.vercel + r.github;
      r.ia = pos(h.iaMensuelUsd) * Math.pow(1 + num(h.iaCroissanceAn) / 100, y) * kUsd;
      r.mkt = Math.max(pos(h.marketingPct) / 100 * r.ca, pos(h.marketingMin)) + (avec ? pos(h.marketingBoost) : 0);
      r.sal = sum(h.postes, (p) => actif(p, t) ? coutPoste(p, y) : 0);
      r.salAcq = sum(h.postes, (p) => p.acquisition && actif(p, t) ? coutPoste(p, y) : 0);
      r.effectif = sum(h.postes, (p) => actif(p, t) ? pos(p.nb) : 0);
      r.fixes = pos(h.fixesMensuels);
      r.opex = r.directs + r.commissions + r.ia + r.infra + r.mkt + r.sal + r.fixes;
      r.ebitda = r.ca - r.opex;
      r.capex = sum(invs, (i) => i.mois === t ? i.montant : 0);                                         // décaissement du mois
      r.dotation = sum(invs, (i) => i.mAmort > 0 && t >= i.mois && t < i.mois + i.mAmort ? i.montant / i.mAmort : 0);   // amortissement linéaire dès le mois d'achat
      r.recu = m[Math.max(0, t - delai)].ca;                                // encaissement décalé ; avant le mois 0 : régime établi
      let inflow = 0;
      if (t === 0) { inflow = pos(fin.equity) + pos(fin.subvention) + (d ? pos(d.montant) : 0); reste = d ? pos(d.montant) : 0; }
      let interet = 0, princ = 0;
      if (t >= 1 && reste > 1e-9) {
        interet = reste * tm;
        if (t > dif && t <= dur) princ = t === dur ? reste : Math.min(reste, amort);
        reste -= princ;
      }
      const ebt = r.ebitda - r.dotation - interet; let impot = 0;                  // l'amortissement réduit le résultat imposable
      const rg = regimeAn[Math.floor(t / 12)], forf = FORFAIT[rg];
      r.regime = rg;
      if (forf) { impot = forf.taux(h) * r.ca * 1.18; r.forfait = impot; }          // impôt sur le chiffre d'affaires TTC (TCU, TEE, RME) : remplace l'IS, ni report ni déficit
      else {
        if (ebt < 0) pool += -ebt; else { const use = Math.min(pool, ebt); pool -= use; impot = tauxIS(h) / 100 * (ebt - use); }
        if (h.imfOn || rg === 'rsi' || rg === 'rni') { isAn += impot; if (t % 12 === 11) { const caTtc = sum(m.slice(t - 11, t + 1), (x) => x.ca) * 1.18, imf = clamp(0.005 * caTtc, 3e6, 35e6); const sup = Math.max(0, imf - isAn); impot += sup; r.imf = sup; isAn = 0; } }     // IMF : impôt dû au moins égal au minimum, même en perte (0,5 % du CA TTC, de 3 à 35 M)
      }
      r.interet = interet; r.princ = princ; r.impot = impot; r.inflow = inflow;
      r.flux = r.recu - r.opex - impot - interet - princ + inflow - r.capex;
      treso += r.flux; r.treso = treso;
      cumRes += r.ebitda - r.dotation - interet - impot;
      immo += r.capex - r.dotation; r.immo = immo;                              // immobilisations nettes en fin de mois
      r.fExpl = r.recu - r.opex - impot; r.fInv = -r.capex; r.fFin = inflow - interet - princ;
      let cre = 0; for (let j = t - delai + 1; j <= t; j++) cre += m[Math.max(j, 0)].ca;      // ventes pas encore encaissées en fin de mois
      r.creances = cre; r.detteFin = reste; r.cap = eq0 + apports + cumRes;
    }
    const annees = [];
    for (let y = 0; y < ANNEES; y++) {
      const s = m.slice(y * 12, y * 12 + 12), f = (k) => sum(s, (x) => x[k]);
      const a = { an: y + 1, clients: f('clients'), lic: f('lic'), maint: f('maint'), serv: f('serv'), abo: f('abo'), ca: f('ca'), directs: f('directs'), commissions: f('commissions'),
        ia: f('ia'), infra: f('infra'), supa: f('supa'), vercel: f('vercel'), github: f('github'), mkt: f('mkt'), sal: f('sal'), fixes: f('fixes'), opex: f('opex'), ebitda: f('ebitda'), capex: f('capex'), dotation: f('dotation'), interet: f('interet'), princ: f('princ'), impot: f('impot'),
        flux: f('flux'), fExpl: f('fExpl'), fInv: f('fInv'), fFin: f('fFin'), salAcq: f('salAcq'), tresoFin: s[11].treso };
      a.resultatNet = a.ebitda - a.dotation - a.interet - a.impot; a.margeEbitda = a.ca > 0 ? a.ebitda / a.ca : 0;
      const L = s[11]; a.parcFin = L.parc; a.effectif = L.effectif; a.arr = (L.maint + L.abo) * 12; a.creances = L.creances;
      a.produits = prods.map((p, i) => { const q = (k) => sum(s, (x) => x.prod[i][k]), o = { id: p.id, nom: p.nom, mode: p.mode, clients: q('clients'), lic: q('lic'), serv: q('serv'), maint: q('maint'), abo: q('abo') }; o.recurrent = o.maint + o.abo; o.total = o.lic + o.serv + o.recurrent; return o; });
      a.bilan = { tresorerie: L.treso, creances: L.creances, immo: L.immo, actif: L.treso + L.creances + L.immo, capitaux: L.cap, dette: L.detteFin, passif: L.cap + L.detteFin };
      annees.push(a);
    }
    let min = Infinity, moisMin = 0; m.forEach((x) => { if (x.treso < min) { min = x.treso; moisMin = x.t; } });
    // Point mort : premier mois à partir duquel l'EBITDA reste positif jusqu'à la fin (null s'il n'est jamais atteint durablement)
    let pointMort = null; for (let t = N - 1; t >= 0 && m[t].ebitda > 0; t--) pointMort = t;
    return { plan, mois: m, annees, tresoMin: min, moisMin, tresoFin: m[N - 1].treso, detteRestante: reste, pointMort };
  }

  /** Compte d'exploitation prévisionnel des n premiers mois d'un plan simulé (12 par défaut). Charges en négatif ; chaque ligne : { lib, v: [n valeurs], total, gras }. */
  function compteExploitation(sim, n) {
    n = clamp(Math.round(num(n)) || 12, 1, N); const m = sim.mois.slice(0, n);
    const L = (lib, f, gras) => { const v = m.map(f); return { lib, v, total: sum(v, (x) => x), gras: !!gras }; };
    const k = (key) => (x) => x[key], neg = (key) => (x) => -x[key], avantImpot = (x) => x.ebitda - x.dotation - x.interet;
    return { n, lignes: [
      L('Licences perpétuelles', k('lic')), L('Frais initiaux et services', k('serv')), L('Maintenance', k('maint')), L('Abonnements', k('abo')), L('Chiffre d\'affaires', k('ca'), true),
      L('Coûts directs', neg('directs')), L('Commissions', neg('commissions')), L('Salaires et charges sociales', neg('sal')), L('Marketing', neg('mkt')), L('Charges fixes', neg('fixes')),
      L('Infrastructure technique', neg('infra')), L('Intelligence artificielle (Anthropic)', neg('ia')), L('Total des charges d\'exploitation', neg('opex'), true),
      L('Excédent brut d\'exploitation (EBITDA)', k('ebitda'), true), L('Dotations aux amortissements', neg('dotation')), L('Résultat d\'exploitation', (x) => x.ebitda - x.dotation, true),
      L('Charges financières (intérêts)', neg('interet')), L('Résultat avant impôt', avantImpot, true), L('Impôts (IS, minimum forfaitaire ou impôt sur le CA)', neg('impot')), L('Résultat net', (x) => avantImpot(x) - x.impot, true)] };
  }

  /** Tableau des immobilisations et plan d'amortissement (linéaire) : par investissement et par année, acquisitions, dotation, cumul des amortissements, valeur brute et valeur nette comptable.
   *  plan : 'avec' (tous les investissements) ou 'sans' (seulement ceux déjà engagés). */
  function tableauImmobilisations(h, plan) {
    const L = investissementsActifs(h).filter((i) => plan !== 'sans' || !i.finance);
    const lignes = L.map((i) => {
      const annees = []; let cumul = 0;
      for (let y = 0; y < ANNEES; y++) {
        let dot = 0; for (let t = y * 12; t < y * 12 + 12; t++) if (i.mAmort > 0 && t >= i.mois && t < i.mois + i.mAmort) dot += i.montant / i.mAmort;
        cumul += dot; const acquis = i.mois <= y * 12 + 11, brut = acquis ? i.montant : 0;
        annees.push({ an: y + 1, acquisitions: i.mois >= y * 12 && i.mois <= y * 12 + 11 ? i.montant : 0, dotation: dot, cumul: acquis ? cumul : 0, brut, vnc: brut - (acquis ? cumul : 0) });
      }
      return { id: i.id, nom: i.nom, mois: i.mois, montant: i.montant, duree: i.mAmort / 12, taux: i.mAmort > 0 ? 1200 / i.mAmort : 0, finance: i.finance, annees };
    });
    const total = []; for (let y = 0; y < ANNEES; y++) { const f = (k) => sum(lignes, (l) => l.annees[y][k]); total.push({ an: y + 1, acquisitions: f('acquisitions'), dotation: f('dotation'), cumul: f('cumul'), brut: f('brut'), vnc: f('vnc') }); }
    return { lignes, total };
  }

  /* ───────────── Dimensionnement et indicateurs par option ───────────── */
  function structure(h, opt, X) {
    const dette = (mt) => ({ montant: mt, taux: h.taux, duree: h.dureeMois, differe: h.differeMois });
    if (opt === 'capital') return { equity: X };
    if (opt === 'dette') return { dette: dette(X) };
    if (opt === 'subvention') return { subvention: X };
    const tot = pos(h.partCapital) + pos(h.partDette) + pos(h.partSubvention) || 1;
    return { equity: X * pos(h.partCapital) / tot, dette: dette(X * pos(h.partDette) / tot), subvention: X * pos(h.partSubvention) / tot };
  }

  /** Montant total minimal qui maintient la trésorerie du plan complet ≥ 0 (méthode de la sécante : le service de la dette augmente le besoin), puis marge de sécurité. */
  function dimensionner(h, opt) {
    const sim = (X) => simuler(h, 'avec', structure(h, opt, X));
    let s0 = sim(0), x0 = 0, X = 0, viable = true;
    if (s0.tresoMin < -0.5) {
      let x1 = -s0.tresoMin, s1 = sim(x1);
      for (let i = 0; i < 40 && s1.tresoMin < -0.5; i++) {
        const slope = (s1.tresoMin - s0.tresoMin) / (x1 - x0);
        if (!(slope > 1e-9)) { viable = false; break; }
        x0 = x1; s0 = s1; x1 = x1 - s1.tresoMin / slope; s1 = sim(x1);
      }
      if (s1.tresoMin < -0.5) viable = false;
      X = x1;
    }
    let montant = X * (1 + pos(h.margeSecuritePct) / 100), s = sim(montant);
    if (viable && s.tresoMin < -0.5) { let lo = X, hi = montant; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (sim(mid).tresoMin >= -0.5) lo = mid; else hi = mid; } montant = lo; s = sim(montant); }   // avec une dette, plus d'apport = plus de remboursements : on plafonne la marge
    return { opt, label: OPT_LABEL[opt], xMin: X, montant, struct: structure(h, opt, montant), sim: s, viable };
  }

  const preMoney = (h, caAn1) => (num(h.preMoney) > 0 ? num(h.preMoney) : Math.max(1, Math.round(pos(h.multEntree) * caAn1)));

  function indicateurs(h, d) {
    const s = d.sim, a = s.annees, last = a[ANNEES - 1], out = { tresoMin: s.tresoMin, moisMin: s.moisMin, tresoFin: s.tresoFin, ca5: last.ca, ebitda5: last.ebitda,
      resultatCumule: sum(a, (x) => x.resultatNet), alertes: [] };
    const eq = pos(d.struct.equity);
    if (eq > 0) {
      const pre = preMoney(h, a[0].ca), part = eq / (pre + eq), valeur = pos(h.multSortie) * last.ca + s.tresoFin - s.detteRestante, produit = part * Math.max(0, valeur), moic = produit / eq;
      out.equity = { montant: eq, preMoney: pre, postMoney: pre + eq, part, valeurSortie: valeur, produit, moic, tri: moic > 0 ? Math.pow(moic, 1 / ANNEES) - 1 : -1 };
      if (part > 0.49) out.alertes.push('Part cédée supérieure à 49 % : perte du contrôle de la société.');
      if (moic < 2) out.alertes.push('Rendement investisseur faible (moins de 2 fois la mise sur 5 ans) : peu attractif pour un fonds.');
    }
    const dm = d.struct.dette ? pos(d.struct.dette.montant) : 0;
    if (dm > 0) {
      const dscr = a.filter((x) => x.interet + x.princ > 0).map((x) => (x.fExpl + x.fInv) / (x.interet + x.princ));     // flux disponible : exploitation encaissée après impôt, moins investissements
      out.dette = { montant: dm, totalInterets: sum(a, (x) => x.interet), dscrMin: dscr.length ? Math.min.apply(null, dscr) : null, restant: s.detteRestante };
      if (out.dette.dscrMin !== null && out.dette.dscrMin < 1.2) out.alertes.push('Capacité de remboursement insuffisante (flux disponible / service de la dette < 1,2) : un prêteur refusera probablement.');
    }
    if (d.opt === 'subvention' || pos(d.struct.subvention) > 0) out.alertes.push('Dépend de la disponibilité d\'un programme d\'appui : montant et conditions à vérifier auprès de l\'organisme.');
    if (!d.viable) out.alertes.push('Ce montage ne couvre pas le besoin : le service de la dette absorbe plus que l\'apport.');
    return out;
  }

  /** Comparaison complète. */
  function comparer(h) {
    const sans = simuler(h, 'sans', {}), avec0 = simuler(h, 'avec', {});
    const besoin = Math.max(0, -avec0.tresoMin), options = ['capital', 'dette', 'subvention', 'mix'].map((o) => { const d = dimensionner(h, o); d.ind = indicateurs(h, d); return d; });
    return { sans, avec0, besoin, recommande: besoin * (1 + pos(h.margeSecuritePct) / 100), options, emplois: emplois(h, avec0, besoin) };
  }

  /** Où va l'argent : dépenses cumulées du plan complet jusqu'au point bas de trésorerie, et part couverte par les ventes. */
  function emplois(h, avec0, besoin) {
    if (!(besoin > 0)) return null;
    const s = avec0.mois.slice(0, avec0.moisMin + 1), f = (k) => sum(s, (x) => x[k]);
    const salFin = sum(s, (x) => sum(h.postes, (p) => p.finance && x.t >= num(p.debut) ? pos(p.nb) * pos(p.cout) * (1 + pos(h.chargesSocialesPct) / 100) * Math.pow(1 + num(h.augmentationSalairesPct) / 100, x.y) : 0));
    const lignes = [
      ['Salaires des embauches financées', salFin], ['Salaires de l\'équipe actuelle', f('sal') - salFin], ['Marketing et campagnes', f('mkt')],
      ['Charges fixes', f('fixes')], ['Investissements (matériel, développement, autres)', f('capex')], ['Infrastructure technique (Supabase, Vercel, GitHub)', f('infra')], ['Intelligence artificielle (Anthropic)', f('ia')], ['Coûts directs et commissions', f('directs') + f('commissions')], ['Impôts', f('impot')]
    ].filter((l) => l[1] > 0.5);
    const depenses = sum(lignes, (l) => l[1]), recu = f('recu');
    return { mois: avec0.moisMin + 1, lignes, depenses, recu, tresoDepart: num(h.tresoDepart), besoin };
  }

  /* ───────────── Traction : chiffres réels du CRM ───────────── */
  const FORMES = { sarl: 1, sa: 1, sas: 1, sasu: 1, ste: 1, societe: 1, ets: 1, etablissement: 1, etablissements: 1, entreprise: 1, cie: 1, ei: 1, gie: 1 };
  /** Clé de rapprochement d'un client : sans accents, majuscules, ponctuation ni forme juridique, pour que « SARL Alpha », « Alpha S.A.R.L. » et « Société Alpha » ne fassent qu'un seul client. */
  const cle = (n) => { const brut = String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim(), t = brut.split(' ').filter((x) => x && !FORMES[x]); return t.length ? t.join(' ') : brut; };
  const RECURRENT = /annuel|mensuel|abonn|saas/i;
  /** Facturé, encaissé, créances par client ; concentration ; part récurrente ; vue retraitée sans les parties liées.
   *  cmds : { client, date, statut, typeLicence, htNet, ttc, acompte } ; o : { liens: { <cle client>: { lie, nature } }, now } */
  function analyserTraction(cmds, o) {
    o = o || {}; const liens = o.liens || {}, now = o.now ? new Date(o.now) : new Date(), statuts = o.statuts || ['confirmee', 'en_cours', 'livree'];
    const dm = new Date(now.getFullYear(), now.getMonth() - 11, 1), depuis = dm.getFullYear() + "-" + String(dm.getMonth() + 1).padStart(2, "0"), jours = (d) => Math.floor((now - new Date(d)) / 864e5);
    const rows = {}, pls = {}, ages = { j30: 0, j90: 0, plus: 0 };
    const renouv = { n: 0, ht: 0, ttc: 0, encaisse: 0, creance: 0 };      // renouvellements et maintenance facturés : revenu récurrent, pas de nouvelles ventes
    (cmds || []).filter((c) => c && c.renouvellement && statuts.indexOf(c.statut) >= 0).forEach((c) => { const ttc = pos(c.ttc) || pos(c.htNet), verse = Math.min(ttc, pos(c.acompte)); renouv.n++; renouv.ht += pos(c.htNet); renouv.ttc += ttc; renouv.encaisse += verse; renouv.creance += ttc - verse; });
    (cmds || []).filter((c) => c && !c.renouvellement && statuts.indexOf(c.statut) >= 0).forEach((c) => {
      const k = cle(c.client), lien = liens[k] || {};
      const r = rows[k] || (rows[k] = { cle: k, client: c.client || '—', n: 0, factureHT: 0, factureTTC: 0, encaisse: 0, creance: 0, ht12: 0, n12: 0, recurrent: 0, derniere: null, plusAncienne: null, natPay: 0, lie: !!lien.lie, nature: !!lien.nature });
      const ht = pos(c.htNet), ttc = pos(c.ttc) || ht, verse = Math.min(ttc, pos(c.acompte)), reste = ttc - verse, d = String(c.date || '').slice(0, 10);
      const pk = cle(c.logiciel); if (pk) { const pl = pls[pk] || (pls[pk] = { cle: pk, nom: c.logiciel, n: 0, ht: 0 }); pl.n++; pl.ht += ht; }
      r.n++; r.factureHT += ht; r.factureTTC += ttc; r.encaisse += verse; r.creance += reste;
      if (Array.isArray(c.paiements)) r.natPay += Math.min(verse, c.paiements.filter((q) => q && q.mode === 'nature').reduce((t, q) => t + pos(q.montant), 0));     // règlements en nature saisis dans le journal des paiements
      if (RECURRENT.test(c.typeLicence || '')) r.recurrent += ht;
      if (d && (!r.derniere || d > r.derniere)) r.derniere = d;
      if (d.slice(0, 7) >= depuis) { r.ht12 += ht; r.n12++; }
      if (reste > 0 && d) { if (!r.plusAncienne || d < r.plusAncienne) r.plusAncienne = d; const j = jours(d); if (j <= 30) ages.j30 += reste; else if (j <= 90) ages.j90 += reste; else ages.plus += reste; }
    });
    const lignes = Object.keys(rows).map((k) => rows[k]).sort((a, b) => b.factureHT - a.factureHT);
    const tot = (L) => { const t = { clients: L.length, commandes: sum(L, (r) => r.n), factureHT: sum(L, (r) => r.factureHT), factureTTC: sum(L, (r) => r.factureTTC), encaisse: sum(L, (r) => r.encaisse), encaisseMon: sum(L, (r) => r.nature ? 0 : r.encaisse - r.natPay), creance: sum(L, (r) => r.creance), ht12: sum(L, (r) => r.ht12), n12: sum(L, (r) => r.n12), recurrent: sum(L, (r) => r.recurrent) };
      t.taux = t.factureTTC > 0 ? t.encaisseMon / t.factureTTC : 0; /* part du facturé encaissée EN ARGENT */ t.partRecurrent = t.factureHT > 0 ? t.recurrent / t.factureHT : 0; t.prixMoyen = t.n12 ? t.ht12 / t.n12 : (t.commandes ? t.factureHT / t.commandes : 0); return t; };
    const tous = tot(lignes), retraite = tot(lignes.filter((r) => !r.lie)), nature = lignes.filter((r) => r.nature);
    const parLogiciel = Object.keys(pls).map((k) => pls[k]).sort((a, b) => b.ht - a.ht);
    return { lignes, tous, retraite, ages, depuis, parLogiciel, renouv, topLogiciel: tous.factureHT > 0 && parLogiciel[0] ? parLogiciel[0].ht / tous.factureHT : 0,
      top1: tous.factureHT > 0 && lignes[0] ? lignes[0].factureHT / tous.factureHT : 0, top2: tous.factureHT > 0 ? sum(lignes.slice(0, 2), (r) => r.factureHT) / tous.factureHT : 0,
      partLies: tous.factureHT > 0 ? sum(lignes.filter((r) => r.lie), (r) => r.factureHT) / tous.factureHT : 0, nbLies: lignes.filter((r) => r.lie).length,
      encaisseNature: sum(nature, (r) => r.encaisse) + sum(lignes.filter((r) => !r.nature), (r) => r.natPay), encaisseMonetaire: tous.encaisse - sum(nature, (r) => r.encaisse) - sum(lignes.filter((r) => !r.nature), (r) => r.natPay) };
  }

  /* ───────────── Économie unitaire et indicateurs par année ───────────── */
  /** Marge d'un client d'un logiciel : 1re vente, revenu récurrent annuel, valeur sur 5 ans (avant coût d'acquisition). y : année de la vente (indexation des prix). */
  function unitProduit(h, p, y) {
    const d = pos(h.directsPct) / 100, c = pos(h.commissionPct) / 100, ret = clamp(h.retentionPct, 0, 100) / 100, haus = Math.pow(1 + num(h.hausseAn) / 100, y);
    const heberg = (h.projetParClient ? pos(h.supabaseProjetUsd) : 0) * 12 * pos(h.usdFcfa) * (1 + pos(h.fraisPaiementPct) / 100);
    const ini = pos(p.initial) * haus, sub = p.mode !== 'perpetuelle', prix = sub ? valeurAnnuelle(p) * haus : pos(p.prixLicence) * haus;
    const recBrut = sub ? prix : prix * pos(p.maintPct) / 100;                      // revenu récurrent annuel d'un client (maintenance ou redevance)
    const margeInit = sub ? ini * (1 - d) - c * prix : prix * (1 - d - c) + ini * (1 - d), net = recBrut * (1 - d) - heberg;
    let ltv = margeInit; for (let k = sub ? 0 : Math.ceil(Math.max(1, pos(h.maintDelaiMois)) / 12); k < ANNEES; k++) ltv += net * Math.pow(ret, k);   // abonnement : payé dès la 1re année ; maintenance : à partir de la 2e
    return { prix, initial: ini, recBrut, recNet: net, heberg, margeInit, ltv };
  }
  /** Pour chaque année : marge brute, revenu récurrent, coût d'acquisition d'un client (marketing + équipe d'acquisition ; les commissions
   *  sont déjà dans la marge), valeur d'un client sur 5 ans moyenne pondérée par logiciel, rapport, délai de retour. */
  function economieUnitaire(h, sim) {
    const prods = produitsActifs(h);
    return sim.annees.map((a, y) => {
      const n = a.clients; let margeInit = 0, rec = 0, mAn = 0, ltv = 0, heberg = 0;
      prods.forEach((p) => { const u = unitProduit(h, p, y); margeInit += p.part * u.margeInit; rec += p.part * u.recBrut; mAn += p.part * (u.recNet + u.heberg); ltv += p.part * u.ltv; heberg = u.heberg; });
      const mNet = mAn - heberg, cac = n > 0 ? (a.mkt + a.salAcq) / n : null, ltvCac = cac ? ltv / cac : null;
      const retour = cac === null ? null : (margeInit >= cac ? 0 : (mNet > 0 ? (cac - margeInit) / (mNet / 12) : null));
      return { an: a.an, clients: n, ca: a.ca, margeBrute: a.ca > 0 ? (a.ca - a.directs - a.commissions - a.infra) / a.ca : 0, arr: a.arr, partRecurrente: a.ca > 0 ? (a.maint + a.abo) / a.ca : 0,
        margeInit, maintenance: rec, heberg, maintNette: mNet, ltv, cac, ltvCac, retour, effectif: a.effectif, caParSalarie: a.effectif > 0 ? a.ca / a.effectif : null };
    });
  }
  /** Contrat type de chaque logiciel vendu (année 1) : prix, frais initiaux, revenu récurrent par client, hébergement, valeur sur 5 ans, part des ventes. */
  function contratsParLogiciel(h) {
    return produitsActifs(h).map((p) => Object.assign({ id: p.id, nom: p.nom, mode: p.mode, part: p.part, maintPct: p.maintPct, legacy: !!p.legacy }, unitProduit(h, p, 0)));
  }

  /** Contrôles avant diffusion : ce qu'un financeur rejetterait d'emblée. Tant qu'un contrôle bloquant échoue, le dossier ne peut pas être « validé » et le PDF porte la mention « non prêt à diffuser ». */
  function controlesDossier(h, res) {
    const out = [], mix = res.options[3];
    if (res.avec0.pointMort === null) out.push({ id: 'rentabilite', bloquant: true, msg: 'Le plan n\'atteint pas la rentabilité (EBITDA positif durable) sur 5 ans.' });
    if (!mix.viable) out.push({ id: 'viable', bloquant: true, msg: 'Le montage retenu (mix capital / dette / subvention) ne couvre pas le besoin : le service de la dette absorbe plus que l\'apport.' });
    const part = mix.ind.equity ? mix.ind.equity.part : 0, esop = clamp(h.esopPct, 0, 30) / 100;
    if (part + esop >= 0.99) out.push({ id: 'capital', bloquant: true, msg: 'Part cédée à l\'investisseur + pool d\'intéressement ≈ 100 % : il ne reste presque rien aux associés actuels (valorisation avant apport trop faible).' });
    else if (part > 0.49) out.push({ id: 'controle', bloquant: true, msg: 'Part cédée à l\'investisseur de ' + (part * 100).toFixed(0) + ' % (> 49 %) : les associés actuels perdent le contrôle de la société. Fixez une valorisation avant apport réaliste.' });
    if (!h.regimeConfirme) out.push({ id: 'regime', bloquant: true, msg: 'Le régime d\'imposition et le taux d\'IS ne sont pas confirmés par un expert-comptable (cochez la confirmation dans les hypothèses une fois la vérification faite).' });
    return out;
  }

  /** Tour de table avant / après un apport en capital (`part` : part de l'investisseur, 0 à 1). Le pool d'intéressement est prélevé sur l'ensemble. */
  function tourDeTable(h, part) {
    const as = (h.associes || []).filter((x) => pos(x.part) > 0), tot = sum(as, (x) => pos(x.part)) || 1, esop = clamp(h.esopPct, 0, 30) / 100, s = clamp(part, 0, 0.99);
    const rows = as.map((x) => ({ nom: x.nom, avant: pos(x.part) / tot, apres: pos(x.part) / tot * Math.max(0, 1 - s - esop) }));
    if (s > 0) rows.push({ nom: 'Nouvel investisseur', avant: 0, apres: s });
    if (esop > 0) rows.push({ nom: 'Pool d\'intéressement', avant: 0, apres: esop });
    return rows;
  }

  /* ───────────── Pistes d'optimisation ───────────── */
  const parProduits = (h, fn) => Array.isArray(h.produits) ? h.produits.map((p) => Object.assign({}, p, fn(p))) : h.produits;
  /** Tous les prix (licences, abonnements, frais initiaux) multipliés par f. */
  const scalePrix = (h, f) => ({ prixLicence: pos(h.prixLicence) * f, produits: parProduits(h, (p) => ({ prixLicence: p.prixLicence * f, prixAnnuel: p.prixAnnuel * f, prixMensuel: p.prixMensuel * f, initial: p.initial * f })) });
  const reporte = (h, k) => h.postes.map((p) => p.finance ? Object.assign({}, p, { debut: Math.min(59, num(p.debut) + k) }) : p);
  /** Chaque levier renvoie les hypothèses modifiées (clés de premier niveau). `arbitrer` : le modèle ne baisse pas la croissance en contrepartie, à vérifier. */
  const LEVIERS = [
    { id: 'clients', cat: 'Ventes', lib: 'Gagner plus de clients', test: '+25 % de nouveaux clients la 1re année', f: (h) => ({ clientsAn1: h.clientsAn1 * 1.25 }), note: 'Dépend de votre capacité commerciale et de la demande : à confirmer avec votre pipeline.' },
    { id: 'prix', cat: 'Ventes', lib: 'Augmenter le prix des licences', test: '+15 % du prix moyen', f: (h) => scalePrix(h, 1.15), note: 'Vérifier ce que vos clients acceptent de payer et les prix de vos concurrents.' },
    { id: 'maintenance', cat: 'Ventes', lib: 'Développer les contrats de maintenance', test: '+5 points de maintenance annuelle', f: (h) => ({ maintenancePct: h.maintenancePct + 5, produits: parProduits(h, (p) => p.mode === 'perpetuelle' ? { maintPct: p.maintPct + 5 } : {}) }), note: 'Revenu récurrent : c\'est ce que les financeurs valorisent le plus.' },
    { id: 'retention', cat: 'Ventes', lib: 'Mieux fidéliser les clients', test: '+5 points de rétention', f: (h) => ({ retentionPct: Math.min(100, h.retentionPct + 5) }), note: 'Suivi après-vente, renouvellements : l\'onglet « Après-vente » du CRM sert à cela.' },
    { id: 'services', cat: 'Ventes', lib: 'Facturer plus d\'installation et de formation', test: '+10 points des licences', f: (h) => ({ servicesPct: h.servicesPct + 10, produits: parProduits(h, (p) => ({ initial: p.initial + 0.1 * (p.mode === 'perpetuelle' ? p.prixLicence : valeurAnnuelle(p)) })) }), note: 'Marge généralement bonne, mais mobilise du temps de l\'équipe.' },
    { id: 'embauches', cat: 'Coûts', lib: 'Recruter moins de monde', test: '−30 % de l\'effectif à recruter', f: (h) => ({ postes: h.postes.map((p) => p.finance ? Object.assign({}, p, { nb: p.nb * 0.7 }) : p) }), arbitrer: true, note: 'Le modèle ne réduit pas la croissance en contrepartie : vérifiez que vos objectifs de ventes restent tenables avec moins de monde.' },
    { id: 'etaler', cat: 'Coûts', lib: 'Étaler les recrutements', test: 'recruter 6 mois plus tard', f: (h) => ({ postes: reporte(h, 6) }), arbitrer: true, note: 'Le modèle ne retarde pas la croissance en contrepartie : à ajuster si les recrues conditionnent les ventes.' },
    { id: 'marketing', cat: 'Coûts', lib: 'Calibrer les campagnes financées', test: '−50 % du budget de campagnes', f: (h) => ({ marketingBoost: h.marketingBoost * 0.5 }), arbitrer: true, note: 'Moins de campagnes peut ralentir la prospection : le modèle ne le compense pas.' },
    { id: 'fixes', cat: 'Coûts', lib: 'Réduire les charges fixes', test: '−10 % des charges fixes', f: (h) => ({ fixesMensuels: h.fixesMensuels * 0.9 }), note: 'Loyer, abonnements, déplacements : le gain est immédiat et sans effet sur les ventes.' },
    { id: 'directs', cat: 'Coûts', lib: 'Réduire les coûts directs', test: '−3 points du chiffre d\'affaires', f: (h) => ({ directsPct: Math.max(0, h.directsPct - 3) }), note: 'Hébergement, outils tiers : renégocier ou mutualiser.' },
    { id: 'hebergement', cat: 'Coûts', lib: 'Regrouper les clients sur moins de projets Supabase', test: '−50 % du coût d\'hébergement par client', f: (h) => ({ supabaseProjetUsd: h.supabaseProjetUsd * 0.5 }), note: 'Un projet par client coûte 10 $ par mois chacun ; héberger plusieurs clients ensemble (multi-locataire) divise ce coût, au prix d\'un travail technique.' },
    { id: 'ia', cat: 'Coûts', lib: 'Réduire la consommation d\'intelligence artificielle', test: '−40 % de la consommation Anthropic', f: (h) => ({ iaMensuelUsd: h.iaMensuelUsd * 0.6 }), arbitrer: true, note: 'Modèle moins cher pour les agents d\'exécution, cache des instructions, plafonds : la qualité des réponses est à surveiller.' },
    { id: 'delai', cat: 'Trésorerie', lib: 'Encaisser plus vite', test: '1 mois de délai en moins', f: (h) => ({ delaiEncaissement: Math.max(0, h.delaiEncaissement - 1) }), note: 'Acomptes à la commande, facturation à la livraison : agit sur la trésorerie, pas sur la rentabilité.' }
  ];
  const patcher = (h, l) => Object.assign({}, h, l.f(h));
  /** Résultats clés du plan de croissance sans apport (ce qu'il faut améliorer). */
  function evaluer(h) {
    const s = simuler(h, 'avec', {}), a5 = s.annees[ANNEES - 1];
    return { ebitda5: a5.ebitda, ca5: a5.ca, pointMort: s.pointMort, besoin: Math.max(0, -s.tresoMin), tresoFin: s.tresoFin, resultatCumule: sum(s.annees, (x) => x.resultatNet) };
  }
  /** Plus petite valeur de `cle` (clientsAn1, prixLicence) qui rend le plan durablement rentable ; null si hors de portée. */
  function seuil(h, cle) {
    const v0 = pos(h[cle]), ok = (v) => simuler(Object.assign({}, h, { [cle]: v }), 'avec', {}).pointMort !== null;
    if (!(v0 > 0)) return null;
    if (ok(v0)) return { valeur: v0, facteur: 1, deja: true };
    let hi = v0 * 2, i = 0; while (!ok(hi) && i < 8) { hi *= 2; i++; }
    if (!ok(hi)) return null;
    let lo = v0; for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
    return { valeur: hi, facteur: hi / v0, deja: false };
  }
  /** Facteur minimal sur tous les prix qui rend le plan durablement rentable (quand les logiciels sont renseignés, il n'y a plus un prix unique). */
  function seuilPrix(h) {
    const ok = (f) => simuler(Object.assign({}, h, scalePrix(h, f)), 'avec', {}).pointMort !== null;
    if (ok(1)) return { valeur: null, facteur: 1, deja: true };
    let hi = 2, i = 0; while (!ok(hi) && i < 8) { hi *= 2; i++; }
    if (!ok(hi)) return null;
    let lo = 1; for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
    return { valeur: null, facteur: hi, deja: false };
  }
  /** Teste chaque levier seul, cherche les seuils d'équilibre, puis enchaîne les leviers (le plus utile d'abord) jusqu'à la rentabilité et l'autofinancement. */
  function optimiser(h) {
    const base = evaluer(h);
    const leviers = LEVIERS.filter((l) => !same(l.f(h), Object.keys(l.f(h)).reduce((o, k) => { o[k] = h[k]; return o; }, {}))).map((l) => {
      const m = evaluer(patcher(h, l));
      return { id: l.id, cat: l.cat, lib: l.lib, test: l.test, note: l.note, arbitrer: !!l.arbitrer, m, dEbitda5: m.ebitda5 - base.ebitda5, dBesoin: m.besoin - base.besoin, dTreso: m.tresoFin - base.tresoFin, rentable: m.pointMort !== null };
    }).sort((a, b) => b.dTreso - a.dTreso);
    // Enchaînement : d'abord les leviers sans contrepartie cachée (ventes, charges, encaissements) ; ceux « à arbitrer » (recrutements, campagnes)
    // seulement si cela ne suffit pas, car le modèle ne réduit pas la croissance en retour.
    let cur = h, mcur = base; const etapes = [], used = {};
    const fini = () => mcur.pointMort !== null && mcur.besoin < 0.5;
    [false, true].forEach((phase) => {
      for (let i = 0; i < 8 && !fini(); i++) {
        let best = null;
        LEVIERS.forEach((l) => {
          if (used[l.id] || !!l.arbitrer !== phase || !leviers.some((x) => x.id === l.id)) return;
          const h2 = patcher(cur, l), m = evaluer(h2), gain = m.tresoFin - mcur.tresoFin;
          if (!best || gain > best.gain) best = { l, h2, m, gain };
        });
        if (!best || best.gain <= 0) break;
        used[best.l.id] = 1; cur = best.h2; mcur = best.m; etapes.push({ id: best.l.id, lib: best.l.lib, test: best.l.test, arbitrer: !!best.l.arbitrer, m: best.m });
      }
    });
    return { base, leviers, seuils: { clients: seuil(h, 'clientsAn1'), prix: (h.produits || []).some((p) => pos(p.part) > 0) ? seuilPrix(h) : seuil(h, 'prixLicence') }, combine: { etapes, final: mcur, h: cur, rentable: mcur.pointMort !== null, autofinance: mcur.besoin < 0.5 } };
  }

  const calc = { regimePourCA, REGIMES, FORFAIT, tauxIS, controlesDossier, compteExploitation, tableauImmobilisations, investissementsActifs, N, ANNEES, SCEN, SCEN_LABEL, OPT_LABEL, MODES, LEVIERS, produitsDefaut, fusionProduits, diffProduits, editsDepuisListe, produitsActifs, contratsParLogiciel, scalePrix, seuilPrix, cle, analyserTraction, economieUnitaire, tourDeTable, evaluer, optimiser, seuil, defauts, simuler, structure, dimensionner, indicateurs, comparer, emplois, preMoney };
  G.SanixFinancement = { calc };
  if (typeof module !== 'undefined' && module.exports) module.exports = { calc };
  if (!G.document) return;

  /* ───────────── Écran (navigateur) ───────────── */
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (Math.round(num(n)) || 0).toLocaleString('fr-FR');          // jamais « -0 »
  const fmtM = (n) => { const r = Math.round(num(n) / 1e5) / 10; return (r === 0 ? 0 : r).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M'; };
  const dec1 = (x) => num(x).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  /** Nombre de mois d'activité depuis `debutActivite` (AAAA-MM), mois courant inclus ; null si non renseigné. */
  const moisActivite = () => { const m = /^(\d{4})-(\d{2})/.exec(h && h.debutActivite || ''); if (!m) return null; const n = new Date(); return Math.max(1, (n.getFullYear() - +m[1]) * 12 + n.getMonth() - (+m[2] - 1) + 1); };
  const lib12 = () => { const n = moisActivite(); return n !== null && n < 12 ? 'depuis le début d\'activité (' + n + ' mois)' : '12 derniers mois'; };
  const pct = (x, d) => (num(x) * 100).toLocaleString('fr-FR', { maximumFractionDigits: d == null ? 0 : d }) + ' %';
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const monthKey = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1);
  const LSK = 'fin_config';
  const ui = { tab: 'synthese' };
  let ov = null, h = null, base = null, res = null;
  const root = () => document.getElementById('view-financement');
  const toast = (m) => { try { showToast(m); } catch (e) { /* hors CRM */ } };
  const visible = () => { const r = root(); return !!(r && !r.classList.contains('hidden')); };

  function crm() {
    const g = (f) => { try { return f(); } catch (e) { return undefined; } };
    const P = G.SanixPilotage && G.SanixPilotage.calc, deals = g(() => DEALS) || [], cl = g(() => CLIENTS) || [], nowKey = monthKey(new Date());
    const T = analyserTraction(g(() => COMMANDES) || [], { liens: (ov && ov.liens) || {} }), B = ov && ov.baseRetraitee ? T.retraite : T.tous;
    let pond = 0, brut = 0;
    if (P) { const p = P.pipeline(deals, nowKey); Object.keys(p).forEach((k) => { pond += p[k].pondere; brut += p[k].brut; }); }
    const taux = g(() => G.SanixPilotage.store.usdFcfa()) || 0;
    let wHt = 0, wAge = 0; const auj = new Date();
    (g(() => COMMANDES) || []).forEach((c) => { if (!c || c.renouvellement || ['confirmee', 'en_cours', 'livree'].indexOf(c.statut) < 0 || !c.date) return; const dt = new Date(c.date); if (isNaN(dt)) return; const ht = pos(c.htNet) || pos(c.ttc); wHt += ht; wAge += ht * Math.max(0, (auj - dt) / (864e5 * 30.4375)); });
    const ageBaseMois = wHt > 0 ? wAge / wHt : null;       // ancienneté moyenne des ventes, pondérée par le montant
    const logiciels = (g(() => LOGICIELS) || []).filter((l) => l && l.actif !== false).map((l) => ({ id: l.id, nom: l.nom, typeLicence: l.type_licence, prixNum: l.prixNum, prixMensuel: l.prixMensuel }));
    const cles = {}; logiciels.forEach((l) => { cles[cle(l.nom)] = 1; });
    const sansLogiciel = T.parLogiciel.filter((v) => !cles[v.cle]);                 // ventes dont le nom ne correspond à aucun logiciel du catalogue
    return { ageBaseMois, traction: T, logiciels, ventesLogiciel: T.parLogiciel, sansLogiciel, clientsFactures: T.tous.clients, usdFcfa: taux, caTotal: B.factureHT, ca12m: B.ht12, commandes12m: B.n12, commandesTotal: B.commandes, prixMoyen: B.prixMoyen,
      pipelinePondere: pond, pipelineBrut: brut, prospects: cl.filter((c) => c && c.statut === 'prospect').length, clients: cl.filter((c) => c && c.statut === 'client').length,
      produits: (g(() => LOGICIELS) || []).filter((l) => l && l.actif !== false).length,
      commissionDefaut: num(g(() => CONFIG.commissionDefaut)), societe: g(() => CONFIG.raisonSociale) || 'SANIX', devise: g(() => CONFIG.devise) || 'FCFA' };
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function load() { try { const r = localStorage.getItem('sanix_crm_' + LSK); ov = r ? JSON.parse(r) : {}; } catch (e) { ov = {}; } if (!ov || typeof ov !== 'object') ov = {}; }
  function persist() { try { if (typeof window.lsSave === 'function') window.lsSave(LSK, ov); else localStorage.setItem('sanix_crm_' + LSK, JSON.stringify(ov)); } catch (e) { toast('⚠️ Enregistrement local impossible'); } }
  function recompute() {
    base = crm(); const d = defauts(base);
    if (Array.isArray(ov.produits)) { ov.produitsEdits = editsDepuisListe(ov.produits, d.produits); delete ov.produits; persist(); }   // ancien format : liste complète figée
    if (ov.liens) { const nl = {}; let ch = false; Object.keys(ov.liens).forEach((k) => { const k2 = cle(k); if (k2 !== k) ch = true; nl[k2] = Object.assign({}, nl[k2], ov.liens[k]); }); if (ch) { ov.liens = nl; persist(); } }   // anciennes clés « alpha sarl » → « alpha »
    h = Object.assign(d, clone(ov)); h.produits = fusionProduits(d.produits, ov.produitsEdits); res = comparer(h);
  }
  /** Modifie une hypothèse (chemin « croiss.0 », « clientsAn1 »…) et ne mémorise que ce que l'utilisateur a touché. */
  function edit(path, val) {
    const parts = path.split('.'), top = parts[0];
    if (top !== 'valide' && ov.valide) ov.valide = false;                    // toute modification d'hypothèse retire la validation
    if (!(top in ov)) ov[top] = clone(h[top]);
    let o = ov; for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = val; persist(); recompute();
  }
  function editInv(id, field, val) {
    ov.valide = false;
    if (!('investissements' in ov)) ov.investissements = clone(h.investissements);
    const i = ov.investissements.filter((x) => x.id === id)[0]; if (!i) return; i[field] = val; persist(); recompute();
  }
  function editPoste(id, field, val) {
    ov.valide = false;
    if (!('postes' in ov)) ov.postes = clone(h.postes);
    const p = ov.postes.filter((x) => x.id === id)[0]; if (!p) return; p[field] = val; persist(); recompute();
  }

  /** On ne mémorise que ce que vous avez changé, logiciel par logiciel et champ par champ : le reste suit le catalogue et les ventes du CRM. */
  function editProduit(id, field, val) {
    ov.valide = false;
    ov.produitsEdits = ov.produitsEdits || {}; ov.produitsEdits[id] = Object.assign({}, ov.produitsEdits[id], { [field]: val }); persist(); recompute();
  }
  function editLien(k, f, v) { ov.valide = false; ov.liens = ov.liens || {}; ov.liens[k] = Object.assign({}, ov.liens[k], { [f]: !!v }); persist(); recompute(); }
  function editAssocie(id, field, val) {
    ov.valide = false;
    if (!('associes' in ov)) ov.associes = clone(h.associes);
    const a = ov.associes.filter((x) => x.id === id)[0]; if (!a) return; a[field] = val; persist(); recompute();
  }

  /* — éléments d'interface — */
  const stat = (titre, val, sub, color) => `<div class="stat-card ${color || 'blue'}"><div class="stat-label">${esc(titre)}</div><div class="stat-val" style="font-size:20px">${val}</div><div class="stat-label" style="margin-top:4px">${sub || ''}</div></div>`;
  const field = (label, key, val, o) => { o = o || {}; return `<label class="form-label" style="margin:0">${esc(label)}${o.hint ? ` <span class="muted" style="font-weight:400">${esc(o.hint)}</span>` : ''}<input class="form-input" type="${o.text ? 'text' : 'number'}" ${o.text ? '' : `step="${o.step || 'any'}"`} ${o.min != null ? `min="${o.min}"` : ''} data-k="${key}" value="${val == null ? '' : o.text ? esc(val) : num(val)}" ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} style="margin-top:4px"></label>`; };
  const note = (t) => `<p class="page-sub" style="margin:4px 0 12px">${t}</p>`;

  function courbe(series, w, hh) {
    const all = series.reduce((a, s) => a.concat(s.v), []), mn = Math.min.apply(null, all.concat(0)), mx = Math.max.apply(null, all.concat(1)), pl = 8, pr = 8, pt = 10, pb = 18;
    const X = (i) => pl + (w - pl - pr) * i / (N - 1), Y = (v) => pt + (hh - pt - pb) * (1 - (v - mn) / (mx - mn || 1)), zero = Y(0);
    let svg = `<svg viewBox="0 0 ${w} ${hh}" width="100%" style="max-width:${w}px" role="img" aria-label="Trésorerie cumulée sur 60 mois"><line x1="${pl}" x2="${w - pr}" y1="${zero}" y2="${zero}" stroke="var(--border)" stroke-width="1"/>`;
    for (let y = 1; y <= ANNEES; y++) svg += `<text x="${X(y * 12 - 1)}" y="${hh - 4}" font-size="10" fill="var(--muted)" text-anchor="end">An ${y}</text>`;
    series.forEach((s) => { svg += `<polyline fill="none" stroke="${s.c}" stroke-width="2.2" ${s.d ? 'stroke-dasharray="5 4"' : ''} points="${s.v.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ')}"/>`; });
    return svg + '</svg>';
  }
  const legende = (series) => '<div class="flex gap-4" style="flex-wrap:wrap;font-size:12px;margin-top:6px">' + series.map((s) => `<span><span style="display:inline-block;width:18px;height:3px;background:${s.c};vertical-align:middle;margin-right:6px"></span>${esc(s.n)}</span>`).join('') + '</div>';
  const moisLabel = (t) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + t); return MOIS[d.getMonth()] + ' ' + d.getFullYear(); };

  /* — onglet Synthèse : commandes de simulation + résultats — */
  function controles() {
    return `<div class="card" style="margin-bottom:16px" id="fin-ctl"><div class="card-header"><span class="card-title">🎛️ Simulation en direct</span><span class="badge badge-muted">Modifiez, les résultats se recalculent</span></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
        <label class="form-label" style="margin:0">Scénario de croissance<select class="form-input" data-scen style="margin-top:4px">${Object.keys(SCEN_LABEL).map((k) => `<option value="${k}" ${h.scenario === k ? 'selected' : ''}>${SCEN_LABEL[k]} (${SCEN[k].join(' / ')} %)</option>`).join('')}</select></label>
        ${field('Nouveaux clients, année 1', 'clientsAn1', h.clientsAn1, { min: 0, hint: base.commandes12m ? '(CRM : ' + base.commandes12m + ')' : '' })}
        ${field('Prix moyen HT par licence', 'prixLicence', h.prixLicence, { min: 0, hint: base.prixMoyen ? '(CRM : ' + fmt(base.prixMoyen) + ')' : '' })}
        ${field('Marge de sécurité (%)', 'margeSecuritePct', h.margeSecuritePct, { min: 0 })}
        ${field('Capital (%)', 'partCapital', h.partCapital, { min: 0, hint: 'mix' })}${field('Dette (%)', 'partDette', h.partDette, { min: 0, hint: 'mix' })}${field('Subvention (%)', 'partSubvention', h.partSubvention, { min: 0, hint: 'mix' })}
        ${field('Valorisation avant apport', 'preMoney', ov.preMoney, { min: 0, ph: 'auto : ' + fmtM(preMoney(h, res.avec0.annees[0].ca)) })}
      </div></div>`;
  }

  function out() {
    const r = res, a0 = r.avec0, sans = r.sans, ca5s = sans.annees[ANNEES - 1].ca, ca5a = a0.annees[ANNEES - 1].ca;
    const mix = r.options[3], series = [{ n: 'Sans financement (activité actuelle)', v: sans.mois.map((x) => x.treso), c: '#8b93a8' }, { n: 'Plan de croissance sans apport', v: a0.mois.map((x) => x.treso), c: '#c62828', d: 1 }, { n: 'Plan financé (mix)', v: mix.sim.mois.map((x) => x.treso), c: 'var(--primary)' }];
    const pm = a0.pointMort, an5 = a0.annees[ANNEES - 1];
    let html = pm === null
      ? `<div class="alert alert-danger" role="alert">⛔ <div><b>Dans ces hypothèses, le plan n'est pas rentable à l'année 5</b> (EBITDA ${fmtM(an5.ebitda)} ${esc(base.devise)}). Un financeur ne s'engagera pas : l'apport ne ferait que financer des pertes. Revoyez les ventes (nombre de clients, prix, maintenance) ou les coûts (équipe, marketing) dans « Hypothèses ».</div></div>`
      : `<div class="alert alert-info" role="status">✅ <div>Rentabilité (EBITDA positif de façon durable) atteinte à partir de <b>${moisLabel(pm)}</b>, soit au mois ${pm + 1} du plan.</div></div>`;
    html += `<div class="stats-grid">${stat('Besoin de financement', r.besoin > 0 ? fmt(r.besoin) + ' ' + base.devise : 'Aucun', r.besoin > 0 ? 'Point bas de trésorerie : ' + moisLabel(a0.moisMin) : 'Le plan s\'autofinance', r.besoin > 0 ? 'orange' : 'green')}
      ${stat('À lever (avec marge de ' + fmt(h.margeSecuritePct) + ' %)', fmt(r.recommande) + ' ' + base.devise, 'Montant recommandé', 'blue')}
      ${stat('CA année 5', fmtM(ca5a) + ' ' + base.devise, 'Sans financement : ' + fmtM(ca5s) + ' · ×' + (ca5s > 0 ? dec1(ca5a / ca5s) : '–'), 'green')}
      ${stat('EBITDA année 5', fmtM(an5.ebitda) + ' ' + base.devise, 'Marge : ' + pct(an5.margeEbitda) + (pm === null ? ' · pas rentable' : ''), pm === null ? 'orange' : 'purple')}</div>`;
    html += `<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">📉 Trésorerie cumulée sur 5 ans</span></div>${courbe(series, 860, 230)}${legende(series)}
      ${r.besoin > 0 ? note('Sans apport, la trésorerie du plan de croissance descend à <b>' + fmt(a0.tresoMin) + ' ' + esc(base.devise) + '</b> en ' + moisLabel(a0.moisMin) + ' : c\'est le besoin à financer.') : ''}</div>`;
    html += '<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">⚖️ Comparaison des options de financement</span></div><div style="overflow-x:auto"><table class="client-table" style="min-width:640px"><thead><tr><th></th>' + r.options.map((o) => `<th style="text-align:right">${esc(o.label)}</th>`).join('') + '</tr></thead><tbody>';
    const row = (lib, f) => `<tr><td>${lib}</td>${r.options.map((o) => `<td style="text-align:right">${f(o)}</td>`).join('')}</tr>`;
    html += row('Montant à lever', (o) => '<b>' + fmtM(o.montant) + '</b>' + (o.viable ? '' : '<br><span class="badge badge-warning">Non viable</span>')) + row('Trésorerie minimale', (o) => `<span style="${o.ind.tresoMin < -0.5 ? 'color:var(--danger)' : ''}">${fmtM(o.ind.tresoMin)}</span>`) + row('Trésorerie année 5', (o) => `<span style="${o.ind.tresoFin < 0 ? 'color:var(--danger)' : ''}">${fmtM(o.ind.tresoFin)}</span>`)
      + row('Résultat net cumulé 5 ans', (o) => fmtM(o.ind.resultatCumule)) + row('Part du capital cédée', (o) => o.ind.equity ? pct(o.ind.equity.part, 1) : '–')
      + row('Rendement investisseur (×)', (o) => o.ind.equity ? dec1(o.ind.equity.moic) + ' × · TRI ' + pct(o.ind.equity.tri) : '–')
      + row('Intérêts payés', (o) => o.ind.dette ? fmtM(o.ind.dette.totalInterets) : '–') + row('Capacité de remboursement', (o) => o.ind.dette && o.ind.dette.dscrMin != null ? dec1(o.ind.dette.dscrMin) + ' ×' : '–')
      + `<tr><td>Points d'attention</td>${r.options.map((o) => `<td style="text-align:left;font-size:11px;vertical-align:top;min-width:150px">${o.ind.alertes.length ? o.ind.alertes.map((x) => '⚠️ ' + esc(x)).join('<br>') : '<span style="color:var(--success)">✓ Aucun</span>'}</td>`).join('')}</tr></tbody></table></div>
      ${note('Le <b>mix</b> répartit le montant selon les parts réglées ci-dessus. Le rendement investisseur suppose une sortie à l\'année 5 à ' + h.multSortie + ' × le CA (hypothèse modifiable dans « Hypothèses »).')}</div>`;
    if (r.emplois) {
      const e = r.emplois;
      html += `<div class="card"><div class="card-header"><span class="card-title">🧭 Utilisation des fonds</span><span class="badge badge-primary">Jusqu'au point bas : ${e.mois} mois</span></div><table class="client-table"><tbody>${e.lignes.map((l) => `<tr><td>${esc(l[0])}</td><td style="text-align:right">${fmt(l[1])}</td><td style="text-align:right;width:70px">${pct(l[1] / e.depenses)}</td></tr>`).join('')}
        <tr><td><b>Dépenses cumulées</b></td><td style="text-align:right"><b>${fmt(e.depenses)}</b></td><td></td></tr><tr><td>moins : encaissements sur la période</td><td style="text-align:right">− ${fmt(e.recu)}</td><td></td></tr>
        ${e.tresoDepart ? `<tr><td>moins : trésorerie de départ</td><td style="text-align:right">− ${fmt(e.tresoDepart)}</td><td></td></tr>` : ''}<tr><td><b>= Besoin de financement</b></td><td style="text-align:right"><b>${fmt(e.besoin)}</b></td><td></td></tr></tbody></table></div>`;
    }
    return html;
  }

  function tabSynthese() { return controles() + '<div id="fin-out">' + out() + '</div>'; }

  /* — onglet Hypothèses — */
  function tabHyp() {
    const prodsOn = (h.produits || []).some((p) => pos(p.part) > 0);
    const c = base, bloc = (titre, corps) => `<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">${titre}</span></div>${corps}</div>`;
    const grid = (x) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">${x}</div>`;
    const an = (k, lab) => [0, 1, 2, 3].map((i) => field(lab + ' — année ' + (i + 2) + ' (%)', k + '.' + i, h[k][i])).join('');
    const poste = (p) => `<tr><td><input class="form-input" data-p="${esc(p.id)}" data-f="nom" value="${esc(p.nom)}"></td><td><input class="form-input" type="number" min="0" style="width:64px" data-p="${esc(p.id)}" data-f="nb" value="${num(p.nb)}"></td>
      <td><input class="form-input" type="number" min="0" style="width:110px" data-p="${esc(p.id)}" data-f="cout" value="${num(p.cout)}"></td><td><input class="form-input" type="number" min="0" max="59" style="width:64px" data-p="${esc(p.id)}" data-f="debut" value="${num(p.debut)}"></td>
      <td style="text-align:center"><input type="checkbox" data-p="${esc(p.id)}" data-f="finance" ${p.finance ? 'checked' : ''}></td><td style="text-align:center"><input type="checkbox" data-p="${esc(p.id)}" data-f="acquisition" ${p.acquisition ? 'checked' : ''}></td><td style="text-align:center"><input type="checkbox" data-p="${esc(p.id)}" data-f="tech" ${p.tech ? 'checked' : ''}></td><td><button class="btn btn-outline btn-sm" data-act="poste-del" data-id="${esc(p.id)}" aria-label="Supprimer ce poste">🗑</button></td></tr>`;
    return `<div class="alert alert-warn" role="note">⚠️ Les valeurs initiales sont <b>indicatives</b> : seuls le nombre de clients, le prix moyen, la base installée et la commission viennent du CRM. Vérifiez chaque hypothèse avant de remettre le dossier à un financeur.</div>
      ${bloc('📊 Point de départ (lu dans le CRM)', `<div class="stats-grid" style="margin:0">${stat('CA HT réalisé, ' + (moisActivite() !== null && moisActivite() < 12 ? 'depuis le début (' + moisActivite() + ' mois)' : '12 mois'), fmtM(c.ca12m), c.commandes12m + ' commandes', 'blue')}${stat('CA HT cumulé', fmtM(c.caTotal), c.commandesTotal + ' commandes', 'green')}${stat('Pipeline pondéré', fmtM(c.pipelinePondere), 'Brut : ' + fmtM(c.pipelineBrut), 'orange')}${stat('Clients actifs', c.clients, c.produits + ' produits au catalogue', 'purple')}</div>`)}
      ${bloc('📦 Logiciels et contrats', tabLogiciels())}
      ${bloc('🚀 Ventes', (prodsOn ? note('⚠️ Le prix, la maintenance et les frais initiaux sont réglés <b>logiciel par logiciel</b> (bloc ci-dessus) : les champs « Prix moyen », « Maintenance » et « Services » ci-dessous ne servent que si aucun logiciel n\'a de part des ventes.') : '') + grid(field('Début d\'activité (AAAA-MM)', 'debutActivite', h.debutActivite, { text: true }) + field('Nouveaux clients, année 1', 'clientsAn1', h.clientsAn1) + field('Prix moyen HT par licence', 'prixLicence', h.prixLicence) + field('Hausse annuelle des prix (%)', 'hausseAn', h.hausseAn) + field('Maintenance (% de la base installée / an)', 'maintenancePct', h.maintenancePct) + field('Maintenance : facturée à partir de … mois après la vente (1re année incluse)', 'maintDelaiMois', h.maintDelaiMois, { min: 0 }) + field('Ancienneté moyenne de la base installée (mois)', 'baseAgeMois', h.baseAgeMois, { min: 0, hint: base.ageBaseMois != null ? '(CRM : ' + Math.round(base.ageBaseMois) + ')' : '' }) + field('Rétention des clients (% / an)', 'retentionPct', h.retentionPct) + field('Services : installation, formation (% des licences)', 'servicesPct', h.servicesPct) + field('Base installée (CA HT déjà vendu)', 'baseInstallee', h.baseInstallee) + field('Délai d\'encaissement (mois)', 'delaiEncaissement', h.delaiEncaissement, { min: 0 })) + '<h4 style="margin:14px 0 8px;font-size:13px">Croissance du nombre de nouveaux clients — avec financement</h4>' + grid(an('croiss', 'Croissance')) + '<h4 style="margin:14px 0 8px;font-size:13px">Sans financement (l\'activité actuelle, limitée par les moyens)</h4>' + grid(an('croissSans', 'Croissance')))}
      ${bloc('💸 Coûts', grid(field('Autres coûts directs (% du CA) : outils tiers, paiement', 'directsPct', h.directsPct) + field('Commissions (% des licences)', 'commissionPct', h.commissionPct) + field('Marketing (% du CA)', 'marketingPct', h.marketingPct) + field('Marketing minimum (par mois)', 'marketingMin', h.marketingMin) + field('Campagnes financées (par mois)', 'marketingBoost', h.marketingBoost) + field('Charges fixes (par mois)', 'fixesMensuels', h.fixesMensuels) + field('Charges sociales (%)', 'chargesSocialesPct', h.chargesSocialesPct) + field('Augmentation annuelle des salaires (%)', 'augmentationSalairesPct', h.augmentationSalairesPct) + field('Impôt sur les sociétés (%) : 25 % ; 30 % si secteur TIC (case ci-dessous)', 'impotPct', h.impotPct) + field('Trésorerie actuelle', 'tresoDepart', h.tresoDepart)) + `<div class="form-group" style="margin-top:12px"><label class="form-label">Régime d'imposition (barème DGI, chiffre d'affaires TTC)</label><select class="form-input" data-k="regime">${Object.keys(REGIMES).map((k) => `<option value="${k}" ${h.regime === k ? 'selected' : ''}>${esc(REGIMES[k])}</option>`).join('')}</select><div class="muted" style="font-size:11.5px;margin-top:4px">≤ 5 M : taxe communale 2,5 % · 5 à 50 M : taxe d'État de l'entreprenant 5 % · 50 à 200 M : micro-entreprise (RME) 6 % · 200 à 500 M : réel simplifié (IS + minimum 3 M) · au-delà : réel normal (IS + IMF de 3 à 35 M). En mode automatique, le régime est recalculé chaque année sur le chiffre d'affaires TTC de l'année.</div></div><label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:13px;margin-top:10px"><input type="checkbox" data-k="ticOn" ${h.ticOn ? 'checked' : ''} style="margin-top:3px"><span><b>Entreprise du secteur des technologies de l'information et de la communication (TIC)</b> : IS à 30 % au lieu de 25 % (art. 51 du CGI). Un éditeur de logiciels est en principe concerné : à confirmer.</span></label><label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:13px;margin-top:10px"><input type="checkbox" data-k="cgaOn" ${h.cgaOn ? 'checked' : ''} style="margin-top:3px"><span><b>Adhérent d'un centre de gestion agréé ou suivi par un expert-comptable conventionné</b> : taux réduits de 4 % (TEE et RME).</span></label><label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:13px;margin-top:10px"><input type="checkbox" data-k="imfOn" ${h.imfOn ? 'checked' : ''} style="margin-top:3px"><span>Impôt minimum forfaitaire (IMF) en mode « IS sur le résultat » : 0,5 % du CA TTC, de 3 à 35 M, dû même en perte. Les régimes réel simplifié et réel normal l'appliquent d'office.</span></label><label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:13px;margin-top:10px"><input type="checkbox" data-k="regimeConfirme" ${h.regimeConfirme ? 'checked' : ''} style="margin-top:3px"><span><b>Régime d'imposition et taux confirmés par mon expert-comptable.</b> Sans cette confirmation, le dossier ne peut pas être validé.</span></label>`)}
      ${bloc('☁️ Infrastructure technique et intelligence artificielle', note('Tarifs publics en dollars (consultés le 16/11/2026), convertis en FCFA avec le taux et les frais ci-dessous. Supabase : abonnement Pro avec le 1er projet, puis un tarif par projet supplémentaire. Vercel et GitHub : par poste technique.') + grid(field('Taux : 1 dollar en FCFA', 'usdFcfa', h.usdFcfa, { min: 0 }) + field('Frais de change et de carte (%)', 'fraisPaiementPct', h.fraisPaiementPct, { min: 0 }) + field('Supabase Pro : abonnement ($/mois)', 'supabaseFixeUsd', h.supabaseFixeUsd, { min: 0 }) + field('Supabase : par projet supplémentaire ($/mois)', 'supabaseProjetUsd', h.supabaseProjetUsd, { min: 0 }) + field('Projets internes (CRM, IA…)', 'projetsBase', h.projetsBase, { min: 0 }) + field('Clients déjà hébergés', 'clientsDepart', h.clientsDepart, { min: 0, hint: base.clientsFactures ? '(CRM : ' + base.clientsFactures + ')' : '' }) + field('Vercel Pro : par poste technique ($/mois)', 'vercelSiegeUsd', h.vercelSiegeUsd, { min: 0 }) + field('GitHub Team : par poste ($/mois)', 'githubSiegeUsd', h.githubSiegeUsd, { min: 0 }) + field('GitHub Team à partir de … postes', 'githubSeuil', h.githubSeuil, { min: 1 }) + field('Anthropic : consommation des agents ($/mois)', 'iaMensuelUsd', h.iaMensuelUsd, { min: 0 }) + field('Anthropic : hausse par an (%)', 'iaCroissanceAn', h.iaCroissanceAn, { min: 0 })) + `<label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:13px;margin-top:12px"><input type="checkbox" data-k="projetParClient" ${h.projetParClient ? 'checked' : ''} style="margin-top:3px"><span><b>Un projet Supabase par client</b> (votre organisation actuelle fonctionne ainsi). Décochez si vous prévoyez d'héberger plusieurs clients ensemble : le coût d'hébergement ne grandit alors plus avec chaque client.</span></label>`)}
      ${bloc('👥 Équipe', note('Coût mensuel brut par personne. « Financé » : poste créé grâce au financement (absent du scénario sans financement). « Début » : mois de prise de poste (0 = déjà en place). « Acquisition » : poste commercial ou marketing, compté dans le coût d\'acquisition d\'un client. « Technique » : poste qui utilise Vercel et GitHub (vous comptez déjà pour un poste).') + `<div style="overflow-x:auto"><table class="client-table" style="min-width:560px"><thead><tr><th>Poste</th><th>Nombre</th><th>Coût mensuel</th><th>Début (mois)</th><th>Financé</th><th title="Compte dans le coût d'acquisition d'un client">Acquisition</th><th title="Poste technique : compte pour Vercel et GitHub">Technique</th><th></th></tr></thead><tbody>${h.postes.map(poste).join('')}</tbody></table></div><button class="btn btn-outline btn-sm" data-act="poste-add" style="margin-top:10px">+ Ajouter un poste</button>`)}
      ${bloc('🏗️ Investissements', blocInvestissements())}
      ${bloc('🧾 Capital actuel', note('Répartition du capital avant l\'apport, en %. Sert au tour de table : dilution des associés après l\'entrée d\'un investisseur.') + `<div style="overflow-x:auto"><table class="client-table" style="min-width:420px"><thead><tr><th>Associé</th><th>Part (%)</th><th></th></tr></thead><tbody>${h.associes.map((x) => `<tr><td><input class="form-input" data-a="${esc(x.id)}" data-f="nom" value="${esc(x.nom)}"></td><td><input class="form-input" type="number" min="0" max="100" style="width:90px" data-a="${esc(x.id)}" data-f="part" value="${num(x.part)}"></td><td><button class="btn btn-outline btn-sm" data-act="associe-del" data-id="${esc(x.id)}" aria-label="Supprimer cet associé">🗑</button></td></tr>`).join('')}</tbody></table></div><button class="btn btn-outline btn-sm" data-act="associe-add" style="margin:10px 0 12px">+ Ajouter un associé</button>` + grid(field('Pool d\'intéressement après l\'apport (% du capital)', 'esopPct', h.esopPct, { min: 0 })))}
      ${bloc('🏦 Conditions de financement', grid(field('Valorisation avant apport (vide = automatique)', 'preMoney', ov.preMoney, { min: 0 }) + field('Multiple d\'entrée (× CA année 1)', 'multEntree', h.multEntree) + field('Multiple de sortie (× CA année 5)', 'multSortie', h.multSortie) + field('Taux du prêt (% / an)', 'taux', h.taux) + field('Durée du prêt (mois)', 'dureeMois', h.dureeMois, { min: 1 }) + field('Différé de remboursement (mois)', 'differeMois', h.differeMois, { min: 0 })))}
      <button class="btn btn-outline btn-sm" data-act="reset">↺ Revenir aux valeurs initiales</button>`;
  }

  /* — onglet Projections — */
  /** Tableau du tour de table avant / après un apport en capital seul et après le mix. */
  function tourHtml(cls) {
    const eqC = res.options[0].ind.equity, eqM = res.options[3].ind.equity;
    if (!eqC && !eqM) return '<p class="page-sub" style="margin:0">Aucun apport en capital nécessaire : le tour de table ne change pas.</p>';
    const rc = tourDeTable(h, eqC ? eqC.part : 0), rm = tourDeTable(h, eqM ? eqM.part : 0), noms = []; rc.concat(rm).forEach((r) => { if (noms.indexOf(r.nom) < 0) noms.push(r.nom); });
    const val = (R, n, k) => { const r = R.filter((x) => x.nom === n)[0]; return r ? pct(r[k], 1) : '–'; };
    return `<table class="${cls}"><thead><tr><th></th><th style="text-align:right">Avant</th><th style="text-align:right">Après levée en capital seule</th><th style="text-align:right">Après mix</th></tr></thead><tbody>${noms.map((n) => `<tr><td>${esc(n)}</td><td style="text-align:right">${val(rc.length >= rm.length ? rc : rm, n, 'avant')}</td><td style="text-align:right">${val(rc, n, 'apres')}</td><td style="text-align:right">${val(rm, n, 'apres')}</td></tr>`).join('')}
      <tr style="font-weight:700"><td>Valorisation après apport</td><td></td><td style="text-align:right">${eqC ? fmtM(eqC.postMoney) : '–'}</td><td style="text-align:right">${eqM ? fmtM(eqM.postMoney) : '–'}</td></tr></tbody></table>`;
  }

  function tabTraction() {
    const T = base.traction, A = T.tous, R = T.retraite, d = esc(base.devise);
    if (!T.lignes.length) return '<div class="alert alert-warn" role="note">⚠️ Aucune commande confirmée, en cours ou livrée dans le CRM : il n\'y a pas encore de chiffres réels à présenter.</div>';
    const flags = [];
    if (A.taux < 0.6) flags.push(`Seuls <b>${pct(A.taux)}</b> du facturé sont encaissés : il faudra expliquer les créances (${fmtM(A.creance)} ${d}).`);
    if (T.ages.plus > 0) flags.push(`${fmtM(T.ages.plus)} ${d} de créances ont <b>plus de 90 jours</b>.`);
    if (T.top1 > 0.4) flags.push(`Le premier client pèse <b>${pct(T.top1)}</b> du facturé et les deux premiers ${pct(T.top2)} : forte dépendance.`);
    if (A.recurrent === 0 && !(T.renouv && T.renouv.ht > 0)) flags.push('<b>Aucun revenu récurrent</b> enregistré : toutes les commandes sont des licences ponctuelles, la maintenance n\'est pas facturée dans le CRM (onglet Après-vente : factures de renouvellement).');
    if (T.nbLies > 0) flags.push(`<b>${pct(T.partLies)}</b> du facturé vient de clients marqués « partie liée » : à présenter séparément.`);
    if (T.encaisseNature > 0) flags.push(`${fmt(T.encaisseNature)} ${d} de règlements « en nature » (marqués ou enregistrés comme tels dans le journal des paiements) : non monétaires.`);
    if (T.topLogiciel > 0.5 && T.parLogiciel[0]) flags.push(`Un seul logiciel, <b>${esc(T.parLogiciel[0].nom)}</b>, représente <b>${pct(T.topLogiciel)}</b> du facturé : forte dépendance à un produit.`);
    if ((base.sansLogiciel || []).length) flags.push(`<b>${base.sansLogiciel.reduce((t, v) => t + v.n, 0)} commande(s)</b> portent un nom de logiciel absent du catalogue (${base.sansLogiciel.map((v) => '« ' + esc(v.nom) + ' »').join(', ')}) : elles ne comptent pas dans la répartition des ventes du modèle.`);
    if (A.clients < 10) flags.push(`Seulement <b>${A.clients} clients</b> facturés : la traction reste faible pour un fonds.`);
    const lignes = T.lignes.map((r) => `<tr><td>${esc(r.client)}${r.lie ? ' <span class="badge badge-warning">liée</span>' : ''}${r.nature ? ' <span class="badge badge-muted">en nature</span>' : ''}</td><td style="text-align:right">${r.n}</td><td style="text-align:right">${fmt(r.factureHT)}</td><td style="text-align:right">${fmt(r.encaisse)}</td><td style="text-align:right;${r.creance > 0 ? 'color:var(--danger)' : ''}">${fmt(r.creance)}</td><td style="text-align:right">${r.factureTTC > 0 ? pct(r.encaisse / r.factureTTC) : '–'}</td>
      <td style="text-align:center"><input type="checkbox" data-lien="${esc(r.cle)}" data-f="lie" ${r.lie ? 'checked' : ''} aria-label="Partie liée : ${esc(r.client)}"></td><td style="text-align:center"><input type="checkbox" data-lien="${esc(r.cle)}" data-f="nature" ${r.nature ? 'checked' : ''} aria-label="Règlement en nature : ${esc(r.client)}"></td></tr>`).join('');
    const cmp = (lib, f) => `<tr><td>${lib}</td><td style="text-align:right">${f(A)}</td><td style="text-align:right">${f(R)}</td></tr>`;
    return `<div class="alert alert-info" role="note">🔎 <div><b>Ce qu'un financeur lit en premier.</b> Voici vos chiffres réels, tels que le CRM les enregistre : ce qui est facturé, ce qui est réellement encaissé, ce qui reste dû. Marquez les clients liés à vous ou à vos associés : ils seront présentés à part.</div></div>
      <div class="stats-grid">${stat('Facturé HT', fmtM(A.factureHT) + ' ' + d, A.commandes + ' commandes · ' + A.clients + ' clients', 'blue')}${stat('Encaissé', pct(A.taux), fmtM(A.encaisse) + ' sur ' + fmtM(A.factureTTC) + ' TTC', A.taux < 0.6 ? 'orange' : 'green')}${stat('Créances clients', fmtM(A.creance) + ' ' + d, 'dont plus de 90 jours : ' + fmtM(T.ages.plus), T.ages.plus > 0 ? 'orange' : 'green')}${stat('Concentration', pct(T.top1) + ' · ' + pct(T.top2), 'premier client · deux premiers', T.top1 > 0.4 ? 'orange' : 'green')}</div>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">🚩 Points qu'un financeur va relever</span></div>${flags.length ? '<ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.8">' + flags.map((f) => '<li>' + f + '</li>').join('') + '</ul>' : '<p class="page-sub" style="margin:0">✅ Aucun point d\'alerte sur ces critères.</p>'}</div>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">👥 Détail par client</span><span class="badge badge-muted">Montants en ${d}</span></div><div style="overflow-x:auto"><table class="client-table" style="min-width:720px"><thead><tr><th>Client</th><th style="text-align:right">Commandes</th><th style="text-align:right">Facturé HT</th><th style="text-align:right">Encaissé</th><th style="text-align:right">Créance</th><th style="text-align:right">Taux</th><th style="text-align:center">Partie liée</th><th style="text-align:center">En nature</th></tr></thead><tbody>${lignes}
        <tr style="font-weight:700"><td>Total</td><td style="text-align:right">${A.commandes}</td><td style="text-align:right">${fmt(A.factureHT)}</td><td style="text-align:right">${fmt(A.encaisse)}</td><td style="text-align:right">${fmt(A.creance)}</td><td style="text-align:right">${pct(A.taux)}</td><td></td><td></td></tr></tbody></table></div>
        ${note('Montants encaissés = paiements enregistrés dans le journal des paiements des commandes. Les commandes en brouillon ou annulées sont exclues. « En nature » : règlement qui n\'est pas en argent (terrain, matériel…).')}</div>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">⚖️ Tous les clients ou hors parties liées</span></div><table class="client-table"><thead><tr><th></th><th style="text-align:right">Tous</th><th style="text-align:right">Hors parties liées</th></tr></thead><tbody>${cmp('Clients', (x) => x.clients)}${cmp('Facturé HT', (x) => fmtM(x.factureHT))}${cmp('Facturé HT, ' + lib12(), (x) => fmtM(x.ht12))}${cmp('Commandes, ' + lib12(), (x) => x.n12)}${cmp('Prix moyen HT', (x) => fmtM(x.prixMoyen))}${cmp('Créances', (x) => fmtM(x.creance))}${cmp('Part récurrente', (x) => pct(x.partRecurrent))}</tbody></table>
        ${T.renouv && T.renouv.n ? `<div style="font-size:12px;margin-top:8px">🔁 <b>Renouvellements et maintenance facturés</b> : ${T.renouv.n} facture${T.renouv.n > 1 ? 's' : ''}, ${fmtM(T.renouv.ht)} ${d} HT, dont ${fmtM(T.renouv.encaisse)} encaissés et ${fmtM(T.renouv.creance)} à encaisser (TTC). Ils ne sont pas comptés comme de nouvelles ventes.</div>` : ''}
        <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:13px;margin-top:12px"><input type="checkbox" data-k="baseRetraitee" ${h.baseRetraitee ? 'checked' : ''} style="margin-top:3px"><span><b>Partir de la base hors parties liées</b> pour le modèle (nombre de clients, prix moyen, base installée). Plus prudent, et plus crédible pour un financeur.</span></label></div>
      <div class="card"><div class="card-header"><span class="card-title">⏳ Ancienneté des créances</span></div><div class="stats-grid" style="margin:0">${stat('Moins de 30 jours', fmtM(T.ages.j30), '', 'green')}${stat('De 31 à 90 jours', fmtM(T.ages.j90), '', 'orange')}${stat('Plus de 90 jours', fmtM(T.ages.plus), '', T.ages.plus > 0 ? 'orange' : 'green')}</div></div>`;
  }

  function tabIndic() {
    const U = calc.economieUnitaire(h, res.avec0), col = (v, bon, ok) => v == null ? '–' : `<span style="color:var(--${bon ? 'success' : ok ? 'warning' : 'danger'})">`;
    const rowI = (lib, f, bold) => `<tr style="${bold ? 'font-weight:700' : ''}"><td>${lib}</td>${U.map((u) => `<td style="text-align:right;white-space:nowrap">${f(u)}</td>`).join('')}</tr>`;
    const lc = (u) => u.ltvCac == null ? '–' : `<span style="color:var(--${u.ltvCac >= 3 ? 'success' : u.ltvCac >= 1 ? 'warning' : 'danger'})">${dec1(u.ltvCac)} ×</span>`;
    const rt = (u) => u.retour == null ? '–' : u.retour > 60 ? '<span style="color:var(--danger)">&gt; 60 mois (non significatif)</span>' : u.retour === 0 ? '<span style="color:var(--success)">immédiat</span>' : `<span style="color:var(--${u.retour <= 12 ? 'success' : u.retour <= 24 ? 'warning' : 'danger'})">${Math.round(u.retour)} mois</span>`;
    const A5 = res.avec0.annees, cT = (lib, k, bold) => `<tr style="${bold ? 'font-weight:700' : ''}"><td>${lib}</td>${A5.map((a) => `<td style="text-align:right;white-space:nowrap">${fmt(k === 'tech' ? a.infra + a.ia : a[k])}</td>`).join('')}</tr>`;
    const u5 = U[ANNEES - 1], u1 = U[0], lect = [];
    if (u1.heberg > 0 && u1.maintenance > 0 && u1.heberg > 0.4 * u1.maintenance) lect.push(`L'hébergement d'un client coûte <b>${fmt(u1.heberg)} ${esc(base.devise)} par an</b>, soit <b>${pct(u1.heberg / u1.maintenance)}</b> de la maintenance qu'il paie (${fmt(u1.maintenance)}). Un projet Supabase par client est le principal poste qui grandit avec votre clientèle : regrouper les clients le réduirait.`);
    if (u1.ltvCac != null && u1.ltvCac < 3) lect.push(`Valeur d'un client / coût d'acquisition de <b>${dec1(u1.ltvCac)} ×</b> la 1re année : en dessous du repère de 3 ×, chaque client rapporte peu au regard de ce qu'il coûte à conquérir.`);
    if (u5.partRecurrente < 0.3) lect.push(`Le revenu récurrent ne pèse que <b>${pct(u5.partRecurrente)}</b> du chiffre d'affaires à l'année 5 : les financeurs valorisent surtout le récurrent.`);
    if (u1.retour != null && u1.retour > 12) lect.push(`Délai de retour sur le coût d'acquisition de <b>${u1.retour > 60 ? 'plus de 60 mois' : Math.round(u1.retour) + ' mois'}</b> : au-delà de 12 mois, la croissance consomme beaucoup de trésorerie.`);
    if (!lect.length) lect.push('Les indicateurs unitaires sont dans les repères usuels.');
    return `${note('Calculés sur le plan de croissance. <b>Repères usuels du capital-risque</b> (à adapter au marché local) : valeur d\'un client ≥ 3 × son coût d\'acquisition, retour en moins de 12 mois, revenu récurrent dominant.')}
      <div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">📐 Indicateurs par année</span></div><div style="overflow-x:auto"><table class="client-table" style="min-width:560px"><thead><tr><th></th>${U.map((u) => `<th style="text-align:right">An ${u.an}</th>`).join('')}</tr></thead><tbody>
      ${rowI('Nouveaux clients', (u) => u.clients.toLocaleString('fr-FR', { maximumFractionDigits: 1 }))}${rowI('Chiffre d\'affaires', (u) => fmtM(u.ca), true)}${rowI('Marge brute', (u) => pct(u.margeBrute))}${rowI('Revenu récurrent annualisé', (u) => fmtM(u.arr))}${rowI('Part du revenu récurrent', (u) => pct(u.partRecurrente))}
      ${rowI('Coût d\'acquisition d\'un client', (u) => u.cac == null ? '–' : fmt(u.cac))}${rowI('Valeur d\'un client sur 5 ans', (u) => fmt(u.ltv))}${rowI('Valeur client / coût d\'acquisition', lc, true)}${rowI('Délai de retour', rt, true)}${rowI('Effectif', (u) => u.effectif.toLocaleString('fr-FR', { maximumFractionDigits: 1 }))}${rowI('CA par salarié', (u) => u.caParSalarie == null ? '–' : fmtM(u.caParSalarie))}</tbody></table></div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">📦 Contrat type par logiciel</span><span class="badge badge-muted">Par client, année 1</span></div><div style="overflow-x:auto"><table class="client-table" style="min-width:760px"><thead><tr><th>Logiciel</th><th>Mode</th><th style="text-align:right">Part</th><th style="text-align:right">Prix</th><th style="text-align:right">Frais initiaux</th><th style="text-align:right">Récurrent / an</th><th style="text-align:right">Hébergement / an</th><th style="text-align:right">Marge récurrente nette / an</th><th style="text-align:right">Valeur sur 5 ans</th></tr></thead><tbody>
      ${calc.contratsParLogiciel(h).map((c) => `<tr><td><b>${esc(c.nom)}</b></td><td style="font-size:12px">${c.mode === 'perpetuelle' ? 'Licence + maintenance ' + fmt(c.maintPct) + ' %' : c.mode === 'annuelle' ? 'Abonnement annuel' : 'Abonnement mensuel'}</td><td style="text-align:right">${pct(c.part)}</td><td style="text-align:right;white-space:nowrap">${fmt(c.prix)}</td><td style="text-align:right;white-space:nowrap">${fmt(c.initial)}</td><td style="text-align:right;white-space:nowrap">${fmt(c.recBrut)}</td><td style="text-align:right;white-space:nowrap">${fmt(c.heberg)}</td><td style="text-align:right;white-space:nowrap;color:var(--${c.recNet > 0 ? 'success' : 'danger'})">${fmt(c.recNet)}</td><td style="text-align:right;white-space:nowrap"><b>${fmt(c.ltv)}</b></td></tr>`).join('')}</tbody></table></div>
      ${note('Marge récurrente nette = revenu récurrent moins coûts directs et hébergement du client. Valeur sur 5 ans = marge de la 1re vente (frais initiaux et licence, moins commission) plus la marge récurrente ; elle se compare au coût d\'acquisition ci-dessus.')}</div>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">☁️ Coûts techniques par année</span><span class="badge badge-muted">${esc(base.devise)} · 1 $ = ${fmt(h.usdFcfa)}</span></div><div style="overflow-x:auto"><table class="client-table" style="min-width:560px"><thead><tr><th></th>${U.map((u) => `<th style="text-align:right">An ${u.an}</th>`).join('')}</tr></thead><tbody>
      ${cT('Supabase (bases de données)', 'supa')}${cT('Vercel (hébergement des applications)', 'vercel')}${cT('GitHub (code)', 'github')}${cT('Anthropic (intelligence artificielle)', 'ia')}${cT('Total technique', 'tech', true)}
      <tr><td>Part du chiffre d'affaires</td>${A5.map((a) => `<td style="text-align:right">${a.ca > 0 ? pct((a.infra + a.ia) / a.ca) : '–'}</td>`).join('')}</tr><tr><td>Clients hébergés en fin d'année</td>${A5.map((a) => `<td style="text-align:right">${a.parcFin.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</td>`).join('')}</tr>
      <tr><td>Hébergement d'un client, par an</td>${U.map((u) => `<td style="text-align:right">${fmt(u.heberg)}</td>`).join('')}</tr><tr><td>Maintenance facturée à un client, par an</td>${U.map((u) => `<td style="text-align:right">${fmt(u.maintenance)}</td>`).join('')}</tr></tbody></table></div></div>
      <div class="card"><div class="card-header"><span class="card-title">🔎 Lecture</span></div><ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.8">${lect.map((l) => '<li>' + l + '</li>').join('')}</ul>
      ${note('Coût d\'acquisition = marketing + salaires des postes cochés « Acquisition » (onglet Hypothèses), divisés par les nouveaux clients ; les commissions sont déjà déduites de la marge. Valeur d\'un client = marge de la 1re vente + maintenance des 4 années suivantes avec la rétention choisie.')}</div>`;
  }

  /** Tableau des logiciels : mode de vente, prix, frais initiaux, maintenance, part des ventes. */
  function tabLogiciels() {
    const P = h.produits || [];
    if (!P.length) return note('Aucun logiciel au catalogue du CRM : le modèle utilise un produit moyen (champs « Ventes » ci-dessous).');
    const tot = sum(P, (p) => pos(p.part)), champ = { perpetuelle: 'prixLicence', annuelle: 'prixAnnuel', mensuelle: 'prixMensuel' };
    const lignes = P.slice().sort((a, b) => (pos(b.part) - pos(a.part)) || (b.vendus - a.vendus)).map((p) => {
      const f = champ[p.mode] || 'prixLicence', sub = p.mode !== 'perpetuelle';
      return `<tr style="${pos(p.part) > 0 ? '' : 'opacity:.62'}"><td style="min-width:170px"><b>${esc(p.nom)}</b>${p.vendus ? `<div class="muted" style="font-size:11px">${p.vendus} vendu(s) · facturé en moyenne ${fmt(p.observe)}${p.catalogue > 0 && Math.abs(p.observe / p.catalogue - 1) > 0.5 ? ' <span class="badge badge-warning" title="Le prix moyen facturé s\'écarte de plus de 50 % du prix du catalogue : la facture contient-elle autre chose que la licence ?">⚠️ écart catalogue</span>' : ''}</div>` : ''}</td>
        <td><select class="form-input" data-prod="${esc(p.id)}" data-f="mode" style="min-width:170px">${Object.keys(MODES).map((k) => `<option value="${k}" ${p.mode === k ? 'selected' : ''}>${MODES[k]}</option>`).join('')}</select></td>
        <td><input class="form-input" type="number" min="0" style="width:120px" data-prod="${esc(p.id)}" data-f="${f}" value="${num(p[f])}" aria-label="Prix de ${esc(p.nom)}"></td>
        <td><input class="form-input" type="number" min="0" style="width:110px" data-prod="${esc(p.id)}" data-f="initial" value="${num(p.initial)}" aria-label="Frais initiaux de ${esc(p.nom)}"></td>
        <td><input class="form-input" type="number" min="0" max="100" style="width:70px" data-prod="${esc(p.id)}" data-f="maintPct" value="${num(p.maintPct)}" ${sub ? 'disabled title="Comprise dans la redevance"' : ''} aria-label="Maintenance de ${esc(p.nom)}"></td>
        <td><input class="form-input" type="number" min="0" max="100" step="any" style="width:80px" data-prod="${esc(p.id)}" data-f="part" value="${num(p.part)}" aria-label="Part des ventes de ${esc(p.nom)}"></td></tr>`;
    }).join('');
    const sans = base.sansLogiciel || [], alerte = sans.length ? `<div class="alert alert-warn" role="note">⚠️ <div><b>${sans.reduce((t, v) => t + v.n, 0)} commande(s) (${fmtM(sum(sans, (v) => v.ht))} ${esc(base.devise)}) ne correspondent à aucun logiciel du catalogue</b> : ${sans.map((v) => '« ' + esc(v.nom) + ' »').join(', ')}. Elles ne comptent pas dans la répartition des ventes ci-dessous. Si vous avez renommé un logiciel, le nom des anciennes commandes ne suit pas : corrigez-le dans les commandes ou dans le catalogue.</div></div>` : '';
    return alerte + note('Pour chaque logiciel : <b>comment il est vendu</b>, son <b>prix</b> (licence : une fois ; abonnement annuel : par an ; abonnement mensuel : par mois), les <b>frais initiaux de mise en exploitation</b> facturés au client, la <b>maintenance</b> annuelle (licence perpétuelle seulement) et la <b>part des nouveaux clients</b> qu\'il représente. Les valeurs de départ viennent de votre catalogue et de vos ventes réelles ; les prix d\'abonnement et les frais initiaux sont des <b>points de départ à fixer</b>.')
      + `<div style="overflow-x:auto"><table class="client-table" style="min-width:780px"><thead><tr><th>Logiciel</th><th>Mode de vente</th><th>Prix (FCFA)</th><th>Frais initiaux</th><th>Maintenance %</th><th>Part des ventes %</th></tr></thead><tbody>${lignes}
      <tr style="font-weight:700"><td colspan="5" style="text-align:right">Total des parts (ramené à 100 %)</td><td>${fmt(tot)} %</td></tr></tbody></table></div>${tot > 0 ? '' : note('⚠️ Aucune part de ventes : le modèle utilise un produit moyen. Indiquez la part de chaque logiciel.')}`;
  }

  /** Tableau des investissements (matériel, développement capitalisé, juridique…). Vide par défaut : rien n'est inventé, à saisir. */
  function blocInvestissements() {
    const lignes = h.investissements || [], tot = sum(investissementsActifs(h), (i) => i.montant);
    const row = (x) => `<tr><td><input class="form-input" data-inv="${esc(x.id)}" data-f="nom" value="${esc(x.nom)}" aria-label="Investissement"></td>
      <td><input class="form-input" type="number" min="0" max="59" step="1" style="width:80px" data-inv="${esc(x.id)}" data-f="mois" value="${num(x.mois)}" aria-label="Mois de l'achat"></td>
      <td><input class="form-input" type="number" min="0" style="width:140px" data-inv="${esc(x.id)}" data-f="montant" value="${x.montant == null ? '' : num(x.montant)}" aria-label="Montant"></td>
      <td><input class="form-input" type="number" min="0" step="0.5" style="width:90px" data-inv="${esc(x.id)}" data-f="duree" value="${x.duree == null ? '' : num(x.duree)}" aria-label="Durée d'amortissement en années"></td>
      <td style="text-align:center"><input type="checkbox" data-inv="${esc(x.id)}" data-f="finance" ${x.finance !== false ? 'checked' : ''} aria-label="Financé"></td>
      <td><button class="btn btn-outline btn-sm" data-act="inv-del" data-id="${esc(x.id)}" aria-label="Supprimer cet investissement">🗑</button></td></tr>`;
    return note('Achats ponctuels qui ne sont pas des charges courantes : <b>matériel</b> (ordinateurs, serveur), <b>développement</b> capitalisé, <b>marque et juridique</b>, <b>aménagement</b>, <b>véhicule</b>. « Mois » : mois de l\'achat (0 = maintenant, 59 = dernier mois). « Amortissement » : durée en années, linéaire (0 = non amorti, par exemple un dépôt de garantie). « Financé » : acheté grâce au financement (absent du scénario sans financement). Chaque investissement s\'ajoute au <b>montant à lever</b>, apparaît dans les flux de trésorerie, et son amortissement réduit le résultat et l\'impôt.')
      + (lignes.length ? `<div style="overflow-x:auto"><table class="client-table" style="min-width:620px"><thead><tr><th>Investissement</th><th>Mois</th><th>Montant (${esc(base.devise)})</th><th title="Durée d'amortissement linéaire, en années (0 = non amorti)">Amortissement (ans)</th><th>Financé</th><th></th></tr></thead><tbody>${lignes.map(row).join('')}
        <tr style="font-weight:700"><td colspan="2" style="text-align:right">Total</td><td>${fmt(tot)}</td><td colspan="3"></td></tr></tbody></table></div>${lignes.some((x) => !(pos(x.montant) > 0)) ? note('⚠️ Une ligne sans montant est ignorée par le calcul.') : ''}`
        : `<p class="muted" style="margin:0 0 10px">Aucun investissement saisi : le plan ne contient que des charges de fonctionnement et le montant à lever ne couvre pas d'achats.</p>`)
      + '<button class="btn btn-outline btn-sm" data-act="inv-add" style="margin-top:10px">+ Ajouter un investissement</button>';
  }

  function tabProj() {
    const s = res.sans.annees, m = res.options[3].sim.annees;
    // colonne : [libellé, valeur, en gras, valeur brute (sans conversion en milliers)]
    const L = (lib, k, bold) => [lib, (x) => x[k], bold], neg = (lib, k) => [lib, (x) => -x[k]], B = (lib, k, bold) => [lib, (x) => x.bilan[k], bold];
    const clients = ['Nouveaux clients', (x) => x.clients.toLocaleString('fr-FR', { maximumFractionDigits: 1 }), false, true];
    const tab = (titre, A, cols) => `<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">${titre}</span></div><div style="overflow-x:auto"><table class="client-table" style="min-width:560px"><thead><tr><th></th>${A.map((x) => `<th style="text-align:right">An ${x.an}</th>`).join('')}</tr></thead><tbody>${cols.map((c) => `<tr style="${c[2] ? 'font-weight:700' : ''}"><td>${c[0]}</td>${A.map((x) => `<td style="text-align:right">${c[3] ? c[1](x) : fmt(c[1](x) / 1e3)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
    const invOn = investissementsActifs(h).length > 0;
    const ce = calc.compteExploitation(res.options[3].sim, 12), ceSkip = (l) => !invOn && /^(Dotations|Résultat d'exploitation)/.test(l.lib);
    const exploitation12 = `<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">📅 Compte d'exploitation prévisionnel — 12 premiers mois</span></div><div style="overflow-x:auto"><table class="client-table" style="min-width:1100px;font-size:12px"><thead><tr><th></th>${ce.lignes[0].v.map((_, i) => `<th style="text-align:right">${esc(moisLabel(i))}</th>`).join('')}<th style="text-align:right">Total</th></tr></thead><tbody>${ce.lignes.filter((l) => !ceSkip(l)).map((l) => `<tr style="${l.gras ? 'font-weight:700' : ''}"><td style="min-width:230px;white-space:nowrap">${esc(l.lib)}</td>${l.v.map((x) => `<td style="text-align:right">${fmt(x / 1e3)}</td>`).join('')}<td style="text-align:right;font-weight:700">${fmt(l.total / 1e3)}</td></tr>`).join('')}</tbody></table></div></div>`;
    const imm = calc.tableauImmobilisations(h, 'avec');
    const immoTables = invOn ? `<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">🏗️ Tableau des immobilisations</span></div><div style="overflow-x:auto"><table class="client-table" style="min-width:640px"><thead><tr><th>Désignation</th><th>Acquisition</th><th style="text-align:right">Valeur d'origine</th><th style="text-align:right">Durée</th><th style="text-align:right">Taux</th><th>Financé</th></tr></thead><tbody>${imm.lignes.map((l) => `<tr><td>${esc(l.nom)}</td><td>${esc(moisLabel(l.mois))}</td><td style="text-align:right">${fmt(l.montant)}</td><td style="text-align:right">${l.duree ? (Math.round(l.duree * 10) / 10).toLocaleString('fr-FR') + ' an' + (l.duree > 1 ? 's' : '') : 'non amorti'}</td><td style="text-align:right">${l.taux ? pct(l.taux / 100, 1) : '–'}</td><td>${l.finance ? 'oui' : 'non (déjà engagé)'}</td></tr>`).join('')}<tr style="font-weight:700"><td colspan="2">Total</td><td style="text-align:right">${fmt(sum(imm.lignes, (l) => l.montant))}</td><td colspan="3"></td></tr></tbody></table></div></div>`
      + tab('📉 Plan d\'amortissement prévisionnel (linéaire)', m, imm.lignes.map((l) => [esc(l.nom) + ' — dotation', (x) => l.annees[x.an - 1].dotation]).concat([['Valeur brute des immobilisations (fin d\'année)', (x) => imm.total[x.an - 1].brut, true], ['Dotation aux amortissements de l\'exercice', (x) => imm.total[x.an - 1].dotation, true], ['Cumul des amortissements', (x) => imm.total[x.an - 1].cumul], ['Valeur nette comptable (VNC)', (x) => imm.total[x.an - 1].vnc, true]]))
      : note('🏗️ <b>Tableau des immobilisations et plan d\'amortissement :</b> aucun investissement saisi. Ajoutez-les dans « Hypothèses » → « Investissements » : les tableaux apparaîtront ici.');
    const PA = m[0].produits, parts = (k) => PA.map((p, i) => [esc(p.nom) + ` <span class="badge badge-muted" style="font-weight:600">${p.mode === 'perpetuelle' ? 'perpétuelle' : p.mode === 'annuelle' ? 'annuel' : 'mensuel'}</span>`, (x) => x.produits[i][k]]);
    const parProd = tab('📦 Revenus par logiciel', m, parts('total').concat([['Total', (x) => x.ca, true]])) + tab('🔁 Dont revenus récurrents (maintenance et abonnements)', m, parts('recurrent').concat([['Total récurrent', (x) => x.maint + x.abo, true], ['Part du chiffre d\'affaires', (x) => x.ca > 0 ? Math.round((x.maint + x.abo) / x.ca * 100) + ' %' : '–', false, true]]));
    return note('Montants en milliers de ' + esc(base.devise) + '. États financiers simplifiés du plan financé (mix).') + parProd + exploitation12
      + tab('📈 Compte de résultat', m, [clients, L('Licences perpétuelles', 'lic'), L('Frais initiaux et services', 'serv'), L('Maintenance', 'maint'), L('Abonnements', 'abo'), L('Chiffre d\'affaires', 'ca', true), ['Coûts directs et commissions', (x) => -(x.directs + x.commissions)], neg('Salaires', 'sal'), neg('Marketing', 'mkt'), neg('Charges fixes', 'fixes'), neg('Infrastructure technique', 'infra'), neg('Intelligence artificielle (Anthropic)', 'ia'), L('EBITDA', 'ebitda', true)].concat(invOn ? [neg('Dotations aux amortissements', 'dotation')] : []).concat([neg('Intérêts', 'interet'), neg('Impôts', 'impot'), L('Résultat net', 'resultatNet', true)]))
      + tab('💧 Flux de trésorerie', m, [L('Flux d\'exploitation', 'fExpl')].concat(invOn ? [L('Flux d\'investissement (achats)', 'fInv')] : []).concat([L('Flux de financement (apports, intérêts, remboursements)', 'fFin'), L('Variation de trésorerie', 'flux', true), L('Trésorerie en fin d\'année', 'tresoFin', true)]))
      + tab('🏛️ Bilan simplifié', m, [B('Trésorerie', 'tresorerie'), B('Créances clients (besoin en fonds de roulement)', 'creances')].concat(invOn ? [B('Immobilisations nettes (investissements amortis)', 'immo')] : []).concat([B('Total actif', 'actif', true), B('Capitaux propres', 'capitaux'), B('Dettes financières', 'dette'), B('Total passif', 'passif', true), [ 'Écart actif − passif (doit être nul)', (x) => x.bilan.actif - x.bilan.passif ]]))
      + immoTables
      + note('Bilan simplifié : à l\'ouverture, la société n\'a que de la trésorerie et des créances clients ; pas d\'immobilisations existantes, de stocks ni de dettes fournisseurs' + (invOn ? ' (les investissements saisis dans « Hypothèses » s\'y ajoutent, amortis linéairement)' : '') + '. À remplacer par votre bilan réel (module Comptabilité) avant de présenter le dossier.')
      + `<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">🥧 Tour de table</span></div>${tourHtml('client-table')}${note('Répartition du capital avant et après l\'apport. Renseignez vos associés et le pool d\'intéressement dans « Hypothèses » (« Capital actuel »).')}</div>`
      + tab('🅰️ Sans financement (activité actuelle)', s, [L('Chiffre d\'affaires', 'ca', true), L('EBITDA', 'ebitda'), L('Résultat net', 'resultatNet'), L('Trésorerie en fin d\'année', 'tresoFin', true)]);
  }

  /* — notes explicatives (aussi reprises en annexe du dossier) — */
  const LEXIQUE = [
    ['Chiffre d\'affaires', 'Trois sources : les <b>licences</b> (vente des logiciels à de nouveaux clients), la <b>maintenance</b> (abonnement annuel calculé sur l\'ensemble des clients déjà équipés, qui s\'érode selon la rétention) et les <b>services</b> (installation, formation).'],
    ['EBITDA', 'Chiffre d\'affaires moins les charges d\'exploitation (salaires, marketing, charges fixes, intelligence artificielle, coûts directs, commissions), avant intérêts, impôts et amortissements. Il dit si l\'activité gagne de l\'argent <b>avant</b> tout financement.'],
    ['Point mort', 'Premier mois à partir duquel l\'EBITDA reste positif jusqu\'à la fin du plan. S\'il n\'existe pas, le plan n\'est pas rentable sur 5 ans.'],
    ['Trésorerie', 'L\'argent réellement disponible : les ventes sont encaissées avec un délai, les charges sont payées au fil du temps, les impôts et remboursements de prêt s\'y ajoutent.'],
    ['Besoin de financement', 'Le niveau le plus bas atteint par la trésorerie du plan de croissance <b>sans apport</b> : c\'est la somme à financer pour ne jamais être à court. Le montant recommandé y ajoute une marge de sécurité.'],
    ['Plan sans financement', 'L\'activité actuelle, sans recrutement ni campagne financés et avec une croissance limitée par les moyens : il montre ce que le financement change.'],
    ['Valorisation avant apport', 'Ce que vaut la société avant l\'entrée d\'un investisseur. La <b>part cédée</b> vaut l\'apport divisé par (valorisation + apport).'],
    ['Multiple investisseur', 'Ce que rapporte 1 FCFA investi à la sortie, supposée à l\'année 5 à un multiple du chiffre d\'affaires. Le <b>TRI</b> est le rendement annuel équivalent.'],
    ['Capacité de remboursement', 'Flux de trésorerie disponible (exploitation encaissée, après impôt, moins investissements) divisé par le service de la dette (intérêts + capital remboursé). Un prêteur attend généralement au moins 1,2.'],
    ['Mix', 'Un montage qui combine capital, prêt et subvention selon les parts choisies.'],
    ['Créances clients', 'Ce que les clients doivent encore : facturé moins encaissé. Dans le bilan, elles forment le besoin en fonds de roulement (argent immobilisé en attendant d\'être payé).'],
    ['Revenu récurrent', 'Revenu qui revient chaque année sans nouvelle vente (maintenance, abonnement). Les financeurs le valorisent bien plus que les ventes ponctuelles.'],
    ['Coût d\'acquisition', 'Ce que coûte la conquête d\'un nouveau client : marketing et équipe d\'acquisition, divisés par le nombre de nouveaux clients.'],
    ['Valeur d\'un client', 'Marge qu\'un client rapporte sur 5 ans : marge de sa 1re vente plus maintenance des années suivantes. Un rapport valeur / coût d\'au moins 3 est un repère usuel.'],
    ['Frais initiaux de mise en exploitation', 'Somme facturée au client à la signature pour installer, paramétrer et former : elle s\'ajoute à la licence ou à l\'abonnement.'],
    ['Abonnement annuel ou mensuel', 'Le client paie une redevance (par an ou par mois) tant qu\'il reste, maintenance comprise, au lieu d\'acheter la licence une fois. Le revenu est plus lent à venir mais récurrent.'],
    ['Infrastructure technique', 'Supabase (bases de données, un projet par client chez vous), Vercel (hébergement des applications) et GitHub (code), facturés en dollars. Convertis en FCFA avec le taux de change et des frais de paiement. L\'intelligence artificielle (Anthropic) est comptée à part.'],
    ['Investissement', 'Achat ponctuel qui sert plusieurs années (ordinateurs, serveur, développement capitalisé, marque, aménagement). Il sort de la trésorerie le mois de l\'achat, mais n\'est pas une charge de l\'année : il est étalé par l\'<b>amortissement</b>.'],
    ['Amortissement', 'Étalement du prix d\'un investissement sur sa durée d\'utilisation (linéaire : montant ÷ durée). C\'est une charge comptable sans décaissement : elle réduit le résultat et l\'impôt, pas la trésorerie.'],
    ['Partie liée', 'Client qui appartient à la société, à ses dirigeants ou à leurs proches. Les financeurs demandent de l\'isoler : ce chiffre d\'affaires est moins probant.']
  ];
  const LIMITES = ['Les valeurs initiales sont des exemples : seuls le nombre de clients, le prix moyen, la base installée et la commission viennent du CRM.', 'La croissance des ventes est une hypothèse : le modèle ne la relie pas automatiquement aux recrutements ou aux campagnes.',
    'Modèle simplifié : pas de TVA ni de stocks ; seuls les investissements saisis sont amortis (linéaire, sans valeur résiduelle) ; bilan d\'ouverture réduit à la trésorerie et aux créances clients ; impôt calculé sur le résultat avec report des pertes.', 'Maintenance : la 1re année est incluse dans la licence ; elle n\'est facturée qu\'à partir du 12e mois (réglable), et la base déjà vendue n\'entre en maintenance qu\'à son 1er anniversaire. Aucun contrat de maintenance n\'est signé à ce jour : la maintenance est à 0 % par défaut. Dès qu\'un client signe, saisissez son taux (12 % du prix de la licence en général) sur la ligne du logiciel concerné ; elle entre alors dans le plan.', 'Impôt : le régime dépend du chiffre d\'affaires TTC (taxe communale, taxe d\'État de l\'entreprenant, micro-entreprise, réel simplifié, réel normal : barème DGI). Les trois premiers sont des impôts sur le chiffre d\'affaires qui remplacent l\'IS ; les deux autres appliquent l\'IS (25 %, 30 % pour les TIC) avec report des pertes (5 exercices au plus : sans effet sur 5 ans) et l\'impôt minimum. Le CGI retient le chiffre d\'affaires de l\'année précédente : le modèle utilise celui de l\'année (approximation). TVA, retenues à la source et paiement par acomptes : non modélisés. Régime et taux à faire confirmer par l\'expert-comptable.', 'Charges sociales à 20 % : estimation prudente (le barème CNPS et taxes employeur donne de l\'ordre de 12 à 18 % selon le cas) ; à remplacer par le calcul de votre expert-comptable.', 'Embauches échelonnées : le plan part de l\'équipe actuelle et n\'ajoute qu\'un poste à la fois (commercial au mois 3, développeur au mois 9, support au mois 15). Chaque embauche ne doit être déclenchée que si les ventes réelles atteignent le niveau prévu ; sinon, repoussez-la. Le plan n\'est pas validé par l\'historique : le CRM ne contient que quelques mois de ventes.','Les abonnements, même annuels, sont comptabilisés et encaissés mois par mois (prudent pour la trésorerie) ; la même rétention s\'applique à tous les logiciels.', 'Ces projections ne sont ni une garantie de résultat ni un conseil financier : à faire valider par un expert-comptable.'];

  function tabNotes() {
    const etape = (n, t, d) => `<div style="display:flex;gap:12px;margin-bottom:10px"><div class="badge badge-primary" style="height:24px;flex-shrink:0">${n}</div><div><b>${t}</b><div class="muted" style="font-size:12.5px">${d}</div></div></div>`;
    return `<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">🧭 Comment fonctionne ce modèle</span></div>
      <p style="font-size:13px;margin:0 0 12px">Le modèle part de vos chiffres réels du CRM (commandes, prix moyen, base de clients), puis simule votre activité <b>mois par mois sur 5 ans</b>, dans deux situations : <b>sans financement</b> (l'activité actuelle) et <b>avec le plan de croissance</b> (recrutements, campagnes). Le point bas de trésorerie du plan de croissance donne le <b>besoin de financement</b>. Ce besoin est ensuite couvert de quatre façons (capital, prêt, subvention, mix) pour comparer ce que chacune coûte et rapporte.</p>
      ${etape(1, 'Hypothèses', 'Remplacez les valeurs d\'exemple par vos vraies données : équipe, charges, prix, croissance, conditions de financement.')}${etape(2, 'Synthèse', 'Lisez le verdict de rentabilité, le besoin de financement et la comparaison des options. Modifiez les champs du haut pour simuler en direct.')}
      ${etape(3, 'Optimisations', 'Si le plan n\'est pas assez rentable, l\'onglet teste des leviers un par un et propose un enchaînement chiffré.')}${etape(4, 'Validation', 'Quand chaque hypothèse reflète votre réalité, cochez la case de validation dans « Dossier » : la mention « document de travail » disparaît.')}${etape(5, 'Dossier', 'Imprimez le PDF ou exportez le tableur pour vos rendez-vous.')}</div>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">📖 Lexique</span></div><table class="client-table"><tbody>${LEXIQUE.map((l) => `<tr><td style="width:190px;font-weight:700;vertical-align:top">${l[0]}</td><td style="font-size:13px">${l[1]}</td></tr>`).join('')}</tbody></table></div>
      <div class="card"><div class="card-header"><span class="card-title">⚠️ Limites à connaître</span></div><ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.7">${LIMITES.map((l) => `<li>${l}</li>`).join('')}</ul></div>`;
  }

  const dlt = (v, bon) => Math.abs(v) < 5e3 ? '<span class="muted">—</span>' : `<span style="white-space:nowrap;color:var(--${(v > 0) === bon ? 'success' : 'danger'})">${v > 0 ? '+' : '−'}${fmtM(Math.abs(v))}</span>`;
  const pmTxt = (pm) => pm === null ? '<span style="color:var(--danger)">jamais</span>' : 'mois ' + (pm + 1);
  function tabOpti() {
    const o = calc.optimiser(h), b = o.base, c = o.combine, sc = o.seuils, rent = b.pointMort !== null, cat = { Ventes: 'badge-success', 'Coûts': 'badge-warning', 'Trésorerie': 'badge-primary' };
    let html = rent ? `<div class="alert alert-info" role="status">✅ <div>Le plan est rentable à partir du <b>mois ${b.pointMort + 1}</b>. Les pistes ci-dessous visent à <b>réduire le besoin de financement</b> (${fmtM(b.besoin)} ${esc(base.devise)}) et à avancer la rentabilité.</div></div>`
      : `<div class="alert alert-danger" role="alert">⛔ <div>Le plan n'est pas rentable à l'année 5 (EBITDA ${fmtM(b.ebitda5)} ${esc(base.devise)}). Voici, chiffré par le modèle, ce qui peut le corriger.</div></div>`;
    const seuilTxt = (x, lib, fmtv, unite) => !x ? `<li>${lib} : hors de portée avec la structure de coûts actuelle.</li>` : x.deja ? `<li>${lib} : déjà atteint avec vos hypothèses.</li>` : `${x.valeur == null ? `<li>${lib} : au moins <b>+${pct(x.facteur - 1)}</b> sur tous les prix (licences, abonnements, frais initiaux).</li>` : `<li>${lib} : au moins <b>${fmtv(x.valeur)}</b> ${unite} (soit <b>+${pct(x.facteur - 1)}</b>).</li>`}`;
    html += `<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">🎯 Seuils d'équilibre</span></div><p class="page-sub" style="margin:0 0 6px">Pour que le plan soit durablement rentable, une seule hypothèse changeant, tout le reste égal :</p><ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.8">
      ${seuilTxt(sc.clients, 'Nouveaux clients la 1re année', (v) => Math.ceil(v).toLocaleString('fr-FR'), 'clients (vous en avez prévu ' + fmt(h.clientsAn1) + ')')}${seuilTxt(sc.prix, 'Prix moyen d\'une licence', (v) => fmt(v), esc(base.devise) + ' HT (vous avez prévu ' + fmt(h.prixLicence) + ')')}</ul></div>`;
    html += `<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">🧪 Leviers testés un par un</span><span class="badge badge-muted">Effet sur le plan de croissance, sans apport</span></div><div style="overflow-x:auto"><table class="client-table" style="min-width:760px"><thead><tr><th>Levier</th><th>Test</th><th style="text-align:right">EBITDA an 5</th><th style="text-align:right">Point mort</th><th style="text-align:right">Besoin</th><th style="text-align:right">Trésorerie an 5</th><th></th></tr></thead><tbody>
      ${o.leviers.map((l) => `<tr><td style="min-width:230px"><span class="badge ${cat[l.cat] || 'badge-muted'}">${l.cat}</span> <b>${esc(l.lib)}</b>${l.arbitrer ? ' <span class="badge badge-warning" title="Le modèle ne réduit pas la croissance en contrepartie">⚠️ à arbitrer</span>' : ''}<div class="muted" style="font-size:11.5px;margin-top:2px">${esc(l.note)}</div></td><td style="font-size:12px">${esc(l.test)}</td><td style="text-align:right">${dlt(l.dEbitda5, true)}</td><td style="text-align:right">${l.rentable ? '<span style="color:var(--success)">' + pmTxt(l.m.pointMort) + '</span>' : pmTxt(null)}</td><td style="text-align:right">${dlt(l.dBesoin, false)}</td><td style="text-align:right">${dlt(l.dTreso, true)}</td><td><button class="btn btn-outline btn-sm" data-act="levier" data-id="${l.id}">Appliquer</button></td></tr>`).join('')}</tbody></table></div>
      <p class="page-sub" style="margin:10px 0 0">Situation de départ : EBITDA an 5 ${fmtM(b.ebitda5)}, point mort ${pmTxt(b.pointMort)}, besoin ${fmtM(b.besoin)}. Les variations sont mesurées par rapport à elle.</p></div>`;
    html += `<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">🚀 Plan combiné</span>${c.etapes.length ? '<button class="btn btn-primary btn-sm" data-act="plan">Appliquer ce plan</button>' : ''}</div>`;
    if (!c.etapes.length) html += '<p class="page-sub" style="margin:0">Aucun levier supplémentaire n\'améliore le plan : il est déjà rentable et autofinancé.</p>';
    else html += `<p class="page-sub" style="margin:0 0 8px">Les leviers de ventes et de charges d'abord ; les recrutements et campagnes réduits seulement si cela ne suffit pas. ${c.rentable ? `Résultat : rentable à partir du <b>mois ${c.final.pointMort + 1}</b>, besoin ramené de ${fmtM(b.besoin)} à <b>${fmtM(c.final.besoin)}</b> ${esc(base.devise)}${c.autofinance ? ' (le plan s\'autofinance)' : ''}.` : '<b>Même en enchaînant tous les leviers, le plan reste non rentable : il faut revoir le modèle économique (prix, volumes).</b>'}</p>
      <div style="overflow-x:auto"><table class="client-table" style="min-width:560px"><thead><tr><th>#</th><th>Levier (cumulé)</th><th style="text-align:right">EBITDA an 5</th><th style="text-align:right">Point mort</th><th style="text-align:right">Besoin</th></tr></thead><tbody>
      ${c.etapes.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.lib)} <span class="muted" style="font-size:11.5px">(${esc(e.test)})</span>${e.arbitrer ? ' <span class="badge badge-warning">⚠️ à arbitrer</span>' : ''}</td><td style="text-align:right;white-space:nowrap">${fmtM(e.m.ebitda5)}</td><td style="text-align:right;white-space:nowrap">${pmTxt(e.m.pointMort)}</td><td style="text-align:right;white-space:nowrap">${fmtM(e.m.besoin)}</td></tr>`).join('')}</tbody></table></div>`;
    html += '</div>' + note('💡 Ces pistes sont des <b>tests chiffrés par le modèle</b>, pas des promesses : chaque levier doit être jugé réaliste par vous. « Appliquer » modifie vos hypothèses (la mention « document de travail » revient) ; « Réinitialiser » dans l\'onglet Hypothèses remet les valeurs initiales.');
    return html;
  }

  /* — onglet Dossier — */
  function tabDossier() {
    const alerte = h.valide ? '<div class="alert alert-success" role="status">✅ Hypothèses validées : les exports ne portent plus la mention « document de travail ».</div>'
      : '<div class="alert alert-warn" role="note">⚠️ <div><b>Document de travail.</b> Les valeurs d\'exemple (équipe, coûts, croissance) n\'ont pas encore été validées : le PDF et le CSV portent la mention « DOCUMENT DE TRAVAIL — hypothèses indicatives non validées ». Ne les remettez pas à un financeur tant que ce n\'est pas fait.</div></div>';
    const blocages = calc.controlesDossier(h, res).filter((c) => c.bloquant), bloc = blocages.length ? `<div class="alert alert-danger" role="alert">⛔ <div><b>Ce dossier n'est pas prêt à être diffusé</b> : ${blocages.map((c) => esc(c.msg)).join(' ')} <span class="muted">La validation est impossible tant que ces points ne sont pas réglés ; le PDF porte la mention « non prêt à diffuser ».</span></div></div>` : '';
    return `${alerte}${bloc}${note('Le dossier reprend la synthèse, le besoin, les projections et les options. <b>Aucune donnée de client</b> n\'y figure : seulement des totaux.')}<div class="card" style="margin-bottom:16px"><label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:13px"><input type="checkbox" data-k="valide" ${h.valide ? 'checked' : ''} style="margin-top:3px"><span><b>J'ai vérifié et validé toutes les hypothèses</b> (ventes, coûts, équipe, conditions de financement). Cochez seulement quand chaque valeur reflète votre réalité ou votre décision.</span></label></div><div class="card"><div class="flex gap-3" style="flex-wrap:wrap">
      <button class="btn btn-primary" data-act="pdf">🖨️ Dossier PDF (imprimer)</button><button class="btn btn-outline" data-act="csv">📥 Tableur (CSV pour Excel)</button></div>
      ${note('Le dossier s\'ouvre dans un nouvel onglet : utilisez « Imprimer » puis « Enregistrer au format PDF ». Le tableur contient les projections annuelles, la comparaison des options et le détail mensuel.')}</div>`;
  }

  /* — exports — */
  function csv() {
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"', R = (a) => a.map((v) => typeof v === 'number' ? String(Math.round(v)).replace('.', ',') : q(v)).join(';');
    const keys = [['Nouveaux clients', 'clients'], ['Licences', 'lic'], ['Maintenance', 'maint'], ['Frais initiaux et services', 'serv'], ['Abonnements', 'abo'], ['CA', 'ca'], ['Couts directs', 'directs'], ['Commissions', 'commissions'], ['IA', 'ia'], ['Infrastructure technique', 'infra'], ['Marketing', 'mkt'], ['Salaires', 'sal'], ['Charges fixes', 'fixes'], ['EBITDA', 'ebitda'], ['Investissements (decaissement)', 'capex'], ['Dotations amortissements', 'dotation'], ['Interets', 'interet'], ['Remboursement capital', 'princ'], ['Impots', 'impot'], ['Resultat net', 'resultatNet'], ['Flux de tresorerie', 'flux'], ['Tresorerie fin annee', 'tresoFin']];
    const L = [];
    if (!h.valide) { L.push(R(['DOCUMENT DE TRAVAIL : hypotheses indicatives non validees, ne pas diffuser'])); L.push(''); }
    const bloc = (titre, A) => { L.push(R([titre])); L.push(R(['Poste'].concat(A.map((x) => 'An ' + x.an)))); keys.forEach((k) => L.push(R([k[0]].concat(A.map((x) => x[k[1]] == null ? 0 : x[k[1]]))))); L.push(''); };
    L.push(R(['Revenus par logiciel (plan finance, mix)'])); L.push(R(['Logiciel', 'Mode'].concat(res.options[3].sim.annees.map((x) => 'An ' + x.an + ' total')).concat(res.options[3].sim.annees.map((x) => 'An ' + x.an + ' recurrent'))));
    res.options[3].sim.annees[0].produits.forEach((p, i) => L.push(R([p.nom, p.mode].concat(res.options[3].sim.annees.map((x) => x.produits[i].total)).concat(res.options[3].sim.annees.map((x) => x.produits[i].recurrent))))); L.push('');
    bloc('Plan finance (mix)', res.options[3].sim.annees); bloc('Plan de croissance sans apport', res.avec0.annees); bloc('Sans financement', res.sans.annees);
    const ceC = calc.compteExploitation(res.options[3].sim, 12), immC = calc.tableauImmobilisations(h, 'avec');
    L.push(R(['Compte d\'exploitation previsionnel 12 mois (plan finance, mix)'])); L.push(R(['Poste'].concat(ceC.lignes[0].v.map((_, i) => moisLabel(i))).concat(['Total'])));
    ceC.lignes.forEach((l) => L.push(R([l.lib].concat(l.v).concat([l.total])))); L.push('');
    if (immC.lignes.length) {
      L.push(R(['Tableau des immobilisations'])); L.push(R(['Designation', 'Acquisition', 'Valeur d\'origine', 'Duree (ans)', 'Taux (%)', 'Finance']));
      immC.lignes.forEach((l) => L.push(R([l.nom, moisLabel(l.mois), l.montant, Math.round(l.duree * 10) / 10, Math.round(l.taux * 10) / 10, l.finance ? 'oui' : 'non']))); L.push('');
      L.push(R(['Plan d\'amortissement previsionnel (lineaire)'])); L.push(R(['Poste'].concat(immC.total.map((x) => 'An ' + x.an))));
      immC.lignes.forEach((l) => L.push(R([l.nom + ' - dotation'].concat(l.annees.map((x) => x.dotation))))); [['Dotation de l\'exercice', 'dotation'], ['Valeur brute fin d\'annee', 'brut'], ['Cumul des amortissements', 'cumul'], ['Valeur nette comptable', 'vnc']].forEach((k) => L.push(R([k[0]].concat(immC.total.map((x) => x[k[1]]))))); L.push('');
    }
    const dc = (x) => String(Math.round(num(x) * 10) / 10).replace('.', ',');       // ratio à une décimale, virgule française, en texte (R() arrondit tout nombre à l'entier)
    L.push(R(['Comparaison des options'])); L.push(R(['', 'Montant a lever', 'Tresorerie minimale', 'Tresorerie an 5', 'CA an 5', 'EBITDA an 5', 'Part cedee (%)', 'Multiple investisseur', 'TRI (%)', 'Interets payes', 'DSCR mini', 'Viable']));
    res.options.forEach((o) => L.push(R([o.label, o.montant, o.ind.tresoMin, o.ind.tresoFin, o.ind.ca5, o.ind.ebitda5, o.ind.equity ? dc(o.ind.equity.part * 100) : '', o.ind.equity ? dc(o.ind.equity.moic) : '', o.ind.equity ? dc(o.ind.equity.tri * 100) : '', o.ind.dette ? o.ind.dette.totalInterets : '', o.ind.dette && o.ind.dette.dscrMin != null ? dc(o.ind.dette.dscrMin) : '', o.viable ? 'oui' : 'non'])));
    L.push(''); L.push(R(['Detail mensuel (plan finance, mix)'])); L.push(R(['Mois', 'CA', 'Charges', 'EBITDA', 'Investissements', 'Flux', 'Tresorerie']));
    res.options[3].sim.mois.forEach((x) => L.push(R([x.t + 1, x.ca, x.opex, x.ebitda, x.capex, x.flux, x.treso])));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + L.join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = 'modele_financement.csv'; document.body.appendChild(a); a.click(); a.remove();
  }

  function dossierHtml() {
    const r = res, c = base, T = c.traction, A = T.tous, mix = r.options[3], a = mix.sim.annees, d = c.devise, U = calc.economieUnitaire(h, r.avec0);
    const K = (A2, k) => A2.map((x) => `<td style="text-align:right">${fmt(x[k] / 1e3)}</td>`).join(''), KB = (A2, k) => A2.map((x) => `<td style="text-align:right">${fmt(x.bilan[k] / 1e3)}</td>`).join('');
    const head = (A2) => `<thead><tr><th></th>${A2.map((x) => `<th style="text-align:right">An ${x.an}</th>`).join('')}</tr></thead>`;
    const opt = (o) => `<tr><td><b>${esc(o.label)}</b></td><td style="text-align:right">${fmtM(o.montant)}</td><td style="text-align:right">${o.ind.equity ? pct(o.ind.equity.part, 1) : '–'}</td><td style="text-align:right">${o.ind.equity ? dec1(o.ind.equity.moic) + ' ×' : '–'}</td><td style="text-align:right">${o.ind.dette && o.ind.dette.dscrMin != null ? dec1(o.ind.dette.dscrMin) + ' ×' : '–'}</td><td style="font-size:11px">${o.viable ? '' : '<b>Non viable. </b>'}${o.ind.alertes.map(esc).join(' ')}</td></tr>`;
    const brouillon = !h.valide, R = T.retraite, invOn = investissementsActifs(h).length > 0, blocages = calc.controlesDossier(h, r).filter((x) => x.bloquant);
    const css = '.m12{font-size:8px}.m12 td,.m12 th{padding:2px 3px}.wip{border:2px solid #c62828;color:#c62828;background:#fde5e5;padding:8px 12px;border-radius:8px;margin-bottom:14px;font-weight:700}.wm{position:fixed;top:42%;left:0;right:0;text-align:center;font-size:72px;font-weight:800;color:rgba(198,40,40,.09);transform:rotate(-25deg);pointer-events:none;z-index:0}body{font:13px/1.5 system-ui,Arial,sans-serif;color:#1b2240;max-width:900px;margin:0 auto;padding:24px}h1{font-size:24px;margin:0}h2{font-size:16px;margin:22px 0 8px;color:#0b3b4c;border-bottom:2px solid #0e7490;padding-bottom:4px}table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border-bottom:1px solid #d6e4ea;padding:6px 8px;text-align:left}th{background:#dff3f8;font-size:12px}.k{display:flex;gap:12px;flex-wrap:wrap}.k div{flex:1;min-width:150px;border:1px solid #d6e4ea;border-radius:10px;padding:10px}.k b{display:block;font-size:20px;color:#0e7490}.n{font-size:11px;color:#6b7390;margin-top:18px}@media print{body{padding:0}h2{break-after:avoid}table{break-inside:avoid}}';
    const lignes = r.emplois ? r.emplois.lignes.map((l) => `<tr><td>${esc(l[0])}</td><td style="text-align:right">${fmt(l[1])}</td><td style="text-align:right">${pct(l[1] / r.emplois.depenses)}</td></tr>`).join('') : '';
    const ce = calc.compteExploitation(mix.sim, 12), imm = calc.tableauImmobilisations(h, 'avec');
    const ceHtml = `<p><b>Compte d'exploitation prévisionnel — 12 premiers mois</b> (milliers de ${esc(d)}, plan financé) :</p><table class="m12"><thead><tr><th></th>${ce.lignes[0].v.map((_, i) => `<th style="text-align:right">${esc(moisLabel(i))}</th>`).join('')}<th style="text-align:right">Total</th></tr></thead><tbody>${ce.lignes.filter((l) => invOn || !/^(Dotations|Résultat d'exploitation)/.test(l.lib)).map((l) => `<tr style="${l.gras ? 'font-weight:700' : ''}"><td>${esc(l.lib)}</td>${l.v.map((x) => `<td style="text-align:right">${fmt(x / 1e3)}</td>`).join('')}<td style="text-align:right"><b>${fmt(l.total / 1e3)}</b></td></tr>`).join('')}</tbody></table>`;
    const immHtml = invOn ? `<p><b>Tableau des immobilisations</b> (${esc(d)}) :</p><table><thead><tr><th>Désignation</th><th>Acquisition</th><th style="text-align:right">Valeur d'origine</th><th style="text-align:right">Durée</th><th style="text-align:right">Taux</th></tr></thead><tbody>${imm.lignes.map((l) => `<tr><td>${esc(l.nom)}</td><td>${esc(moisLabel(l.mois))}</td><td style="text-align:right">${fmt(l.montant)}</td><td style="text-align:right">${l.duree ? (Math.round(l.duree * 10) / 10).toLocaleString('fr-FR') + ' an' + (l.duree > 1 ? 's' : '') : 'non amorti'}</td><td style="text-align:right">${l.taux ? pct(l.taux / 100, 1) : '–'}</td></tr>`).join('')}<tr><td colspan="2"><b>Total</b></td><td style="text-align:right"><b>${fmt(sum(imm.lignes, (l) => l.montant))}</b></td><td colspan="2"></td></tr></tbody></table>
      <p><b>Plan d'amortissement prévisionnel</b> (linéaire, milliers de ${esc(d)}) :</p><table>${head(a)}<tbody>${imm.lignes.map((l) => `<tr><td>${esc(l.nom)} — dotation</td>${l.annees.map((x) => `<td style="text-align:right">${fmt(x.dotation / 1e3)}</td>`).join('')}</tr>`).join('')}<tr><td><b>Dotation aux amortissements de l'exercice</b></td>${imm.total.map((x) => `<td style="text-align:right"><b>${fmt(x.dotation / 1e3)}</b></td>`).join('')}</tr><tr><td>Valeur brute (fin d'année)</td>${imm.total.map((x) => `<td style="text-align:right">${fmt(x.brut / 1e3)}</td>`).join('')}</tr><tr><td>Cumul des amortissements</td>${imm.total.map((x) => `<td style="text-align:right">${fmt(x.cumul / 1e3)}</td>`).join('')}</tr><tr><td><b>Valeur nette comptable</b></td>${imm.total.map((x) => `<td style="text-align:right"><b>${fmt(x.vnc / 1e3)}</b></td>`).join('')}</tr></tbody></table>` : '';
    const invs = investissementsActifs(h);
    const invTab = invOn ? `<p><b>Investissements prévus</b> (${esc(d)}, amortissement linéaire) :</p><table><thead><tr><th>Investissement</th><th style="text-align:right">Mois (0 = aujourd'hui)</th><th style="text-align:right">Montant</th><th style="text-align:right">Amortissement</th><th>Financé par l'apport</th></tr></thead><tbody>${invs.map((i) => `<tr><td>${esc(i.nom)}</td><td style="text-align:right">${i.mois}</td><td style="text-align:right">${fmt(i.montant)}</td><td style="text-align:right">${i.mAmort ? (Math.round(i.mAmort / 12 * 10) / 10).toLocaleString('fr-FR') + ' an' + (i.mAmort > 12 ? 's' : '') : 'non amorti'}</td><td>${i.finance ? 'oui' : 'non (déjà engagé)'}</td></tr>`).join('')}<tr><td><b>Total</b></td><td></td><td style="text-align:right"><b>${fmt(sum(invs, (i) => i.montant))}</b></td><td></td><td></td></tr></tbody></table>`
      : '<p>Aucun investissement (matériel, développement capitalisé, juridique, aménagement) n\'est inclus dans ce plan : les fonds levés couvrent uniquement le fonctionnement.</p>';
    const tr = (lib, v1, v2) => `<tr><td>${lib}</td><td style="text-align:right">${v1}</td><td style="text-align:right">${v2}</td></tr>`;
    const ui2 = (lib, f) => `<tr><td>${lib}</td>${U.map((u) => `<td style="text-align:right">${f(u)}</td>`).join('')}</tr>`;
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Dossier de financement — ${esc(c.societe)}</title><style>${css}</style></head><body>${brouillon ? '<div class="wip">DOCUMENT DE TRAVAIL — hypothèses indicatives non validées. Ne pas diffuser à des financeurs.</div><div class="wm">DOCUMENT DE TRAVAIL</div>' : ''}${blocages.length ? `<div class="wip">NON PRÊT À DIFFUSER — ${blocages.map((x) => esc(x.msg)).join(' ')}</div>${brouillon ? '' : '<div class="wm">NON PRÊT</div>'}` : ''}
      <h1>${esc(c.societe)}</h1><p style="margin:2px 0 0;color:#6b7390">Dossier de financement · ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <h2>1. Situation actuelle</h2><div class="k"><div><b>${fmtM(c.ca12m)} ${esc(d)}</b>CA HT, ${lib12()}</div><div><b>${c.commandes12m}</b>commandes, ${lib12()}</div><div><b>${c.clients}</b>clients actifs</div><div><b>${fmtM(c.pipelinePondere)} ${esc(d)}</b>pipeline pondéré (${c.prospects} prospects)</div><div><b>${c.produits}</b>produits au catalogue</div></div>
      <h2>2. Qualité des chiffres</h2><p>Chiffres réels issus des commandes du CRM (hors brouillons et commandes annulées). Les montants encaissés correspondent aux acomptes et règlements saisis.</p>
      <table><thead><tr><th></th><th style="text-align:right">Tous les clients</th><th style="text-align:right">Hors parties liées</th></tr></thead><tbody>${tr('Clients facturés', A.clients, R.clients)}${tr('Facturé HT', fmtM(A.factureHT) + ' ' + esc(d), fmtM(R.factureHT) + ' ' + esc(d))}${tr('Facturé HT, ' + lib12(), fmtM(A.ht12), fmtM(R.ht12))}${tr('Encaissé (part du facturé TTC)', pct(A.taux), pct(R.taux))}${tr('Créances clients', fmtM(A.creance), fmtM(R.creance))}${tr('Part du revenu récurrent', pct(A.partRecurrent), pct(R.partRecurrent))}${T.renouv && T.renouv.n ? tr('Renouvellements et maintenance facturés (HT)', fmtM(T.renouv.ht) + ' ' + esc(d), '—') : ''}</tbody></table>
      <p>Concentration : le premier client représente ${pct(T.top1)} du facturé, les deux premiers ${pct(T.top2)}. ${T.nbLies > 0 ? `Les clients liés à la société ou à ses dirigeants représentent ${pct(T.partLies)} du facturé ; ils sont isolés dans la colonne « hors parties liées ».` : 'Aucun client n\'est déclaré lié à la société ou à ses dirigeants.'}${T.encaisseNature > 0 ? ` Des règlements en nature (${fmtM(T.encaisseNature)} ${esc(d)}) sont isolés de l'encaissé monétaire.` : ''} Créances de plus de 90 jours : ${fmtM(T.ages.plus)} ${esc(d)}.</p>
      <h2>3. Besoin de financement</h2>${r.avec0.pointMort === null ? '<p style="border:2px solid #c62828;padding:8px;border-radius:8px;color:#c62828"><b>Attention :</b> dans les hypothèses retenues, le plan n\'atteint pas la rentabilité sur 5 ans. À corriger avant toute remise à un financeur.</p>' : `<p>Rentabilité durable atteinte en ${moisLabel(r.avec0.pointMort)}.</p>`}<p>${r.besoin > 0 ? `Pour déployer le plan de croissance, la société a besoin de <b>${fmt(r.besoin)} ${esc(d)}</b> (point bas de trésorerie en ${moisLabel(r.avec0.moisMin)}). Avec une marge de sécurité de ${fmt(h.margeSecuritePct)} %, le montant recherché est de <b>${fmt(r.recommande)} ${esc(d)}</b>.` : 'Le plan de croissance s\'autofinance : aucun apport n\'est nécessaire dans les hypothèses retenues.'}</p>
      ${r.emplois ? `<table><thead><tr><th>Utilisation des fonds (jusqu'au point bas, ${r.emplois.mois} mois)</th><th style="text-align:right">${esc(d)}</th><th style="text-align:right">Part</th></tr></thead><tbody>${lignes}<tr><td>Encaissements sur la période</td><td style="text-align:right">− ${fmt(r.emplois.recu)}</td><td></td></tr>${r.emplois.tresoDepart > 0 ? `<tr><td>Trésorerie de départ</td><td style="text-align:right">− ${fmt(r.emplois.tresoDepart)}</td><td></td></tr>` : ''}<tr><td><b>Besoin de financement</b></td><td style="text-align:right"><b>${fmt(r.emplois.besoin)}</b></td><td></td></tr></tbody></table>` : ''}
      ${invTab}
      <h2>4. Projections et états financiers (milliers de ${esc(d)})</h2><table>${head(a)}<tbody><tr><td>Chiffre d'affaires</td>${K(a, 'ca')}</tr><tr><td>EBITDA</td>${K(a, 'ebitda')}</tr>${invOn ? `<tr><td>Dotations aux amortissements</td>${K(a, 'dotation')}</tr>` : ''}<tr><td>Résultat net</td>${K(a, 'resultatNet')}</tr><tr><td>Flux d'exploitation</td>${K(a, 'fExpl')}</tr>${invOn ? `<tr><td>Flux d'investissement</td>${K(a, 'fInv')}</tr>` : ''}<tr><td>Flux de financement</td>${K(a, 'fFin')}</tr><tr><td><b>Trésorerie fin d'année</b></td>${K(a, 'tresoFin')}</tr></tbody></table>
      <table>${head(a)}<tbody><tr><td>Trésorerie</td>${KB(a, 'tresorerie')}</tr><tr><td>Créances clients</td>${KB(a, 'creances')}</tr>${invOn ? `<tr><td>Immobilisations nettes</td>${KB(a, 'immo')}</tr>` : ''}<tr><td><b>Total actif</b></td>${KB(a, 'actif')}</tr><tr><td>Capitaux propres</td>${KB(a, 'capitaux')}</tr><tr><td>Dettes financières</td>${KB(a, 'dette')}</tr><tr><td><b>Total passif</b></td>${KB(a, 'passif')}</tr></tbody></table>
      ${ceHtml}
      ${immHtml}
      <p><b>Revenus par logiciel</b> (milliers de ${esc(d)}) :</p><table>${head(a)}<tbody>${a[0].produits.map((p, i) => `<tr><td>${esc(p.nom)} <span style="font-size:10px;color:#6b7390">(${p.mode === 'perpetuelle' ? 'licence perpétuelle, maintenance ' + fmt((h.produits || []).filter((x) => x.id === p.id)[0] ? (h.produits.filter((x) => x.id === p.id)[0].maintPct) : h.maintenancePct) + ' %' : p.mode === 'annuelle' ? 'abonnement annuel' : 'abonnement mensuel'})</span></td>${a.map((x) => `<td style="text-align:right">${fmt(x.produits[i].total / 1e3)}</td>`).join('')}</tr>`).join('')}<tr><td><b>Total</b></td>${K(a, 'ca')}</tr><tr><td>dont récurrent (maintenance et abonnements)</td>${a.map((x) => `<td style="text-align:right">${fmt((x.maint + x.abo) / 1e3)}</td>`).join('')}</tr></tbody></table>
      <p style="font-size:11px;color:#6b7390">Bilan simplifié : ouverture réduite à la trésorerie et aux créances clients, sans immobilisations existantes ni stocks${invOn ? ' ; les investissements prévus s\'y ajoutent, amortis linéairement' : ''}. Plan financé selon le mix choisi.</p>
      <p>Sans financement, le chiffre d'affaires de l'année 5 serait de ${fmtM(r.sans.annees[ANNEES - 1].ca)} ${esc(d)}, contre ${fmtM(a[ANNEES - 1].ca)} ${esc(d)} avec le plan de croissance.</p>
      <h2>5. Indicateurs et économie unitaire</h2><table><thead><tr><th></th>${U.map((u) => `<th style="text-align:right">An ${u.an}</th>`).join('')}</tr></thead><tbody>${ui2('Nouveaux clients', (u) => u.clients.toLocaleString('fr-FR', { maximumFractionDigits: 1 }))}${ui2('Marge brute', (u) => pct(u.margeBrute))}${ui2('Revenu récurrent annualisé', (u) => fmtM(u.arr))}${ui2('Part du revenu récurrent', (u) => pct(u.partRecurrente))}${ui2('Coût d\'acquisition d\'un client', (u) => u.cac == null ? '–' : fmt(u.cac))}${ui2('Valeur d\'un client sur 5 ans', (u) => fmt(u.ltv))}${ui2('Valeur client / coût d\'acquisition', (u) => u.ltvCac == null ? '–' : dec1(u.ltvCac) + ' ×')}${ui2('Délai de retour', (u) => u.retour == null ? '–' : u.retour === 0 ? 'immédiat' : Math.round(u.retour) + ' mois')}${ui2('CA par salarié', (u) => u.caParSalarie == null ? '–' : fmtM(u.caParSalarie))}</tbody></table>
      <p><b>Coûts techniques</b> (${esc(d)}, tarifs publics en dollars au taux de ${fmt(h.usdFcfa)}) :</p><table><thead><tr><th></th>${U.map((u) => `<th style="text-align:right">An ${u.an}</th>`).join('')}</tr></thead><tbody>${[['Supabase', 'supa'], ['Vercel', 'vercel'], ['GitHub', 'github'], ['Anthropic (intelligence artificielle)', 'ia']].map((x) => `<tr><td>${x[0]}</td>${r.avec0.annees.map((a) => `<td style="text-align:right">${fmt(a[x[1]])}</td>`).join('')}</tr>`).join('')}<tr><td><b>Total</b></td>${r.avec0.annees.map((a) => `<td style="text-align:right"><b>${fmt(a.infra + a.ia)}</b></td>`).join('')}</tr></tbody></table>
      <h2>6. Options de financement</h2><table><thead><tr><th>Option</th><th style="text-align:right">Montant</th><th style="text-align:right">Part cédée</th><th style="text-align:right">Multiple investisseur</th><th style="text-align:right">Capacité de remboursement</th><th>Points d'attention</th></tr></thead><tbody>${r.options.map(opt).join('')}</tbody></table>
      <h2>7. Tour de table</h2>${tourHtml('')}
      <h2>8. Hypothèses principales</h2><ul>${invOn ? `<li>Investissements : ${invs.length} ligne${invs.length > 1 ? 's' : ''}, ${fmt(sum(invs, (i) => i.montant))} ${esc(d)} au total, amortis linéairement ; ceux marqués « financés » s'ajoutent au besoin de financement.</li>` : ''}<li>Scénario de croissance « ${esc(SCEN_LABEL[h.scenario] || 'personnalisé')} » : nouveaux clients +${h.croiss.join(' %, +')} % par an (année 1 : ${fmt(h.clientsAn1)} clients).</li><li>${(h.produits || []).some((p) => pos(p.part) > 0) ? `Ventes réparties entre ${produitsActifs(h).map((p) => esc(p.nom) + ' (' + Math.round(p.part * 100) + ' %)').join(', ')} ; prix indexés de ${h.hausseAn} % par an ; frais initiaux de mise en exploitation facturés à chaque nouveau client.` : `Prix moyen d'une licence : ${fmt(h.prixLicence)} ${esc(d)} HT (hausse de ${h.hausseAn} % par an) ; maintenance ${h.maintenancePct} % de la base installée ; services ${h.servicesPct} % des licences.`}</li><li>Équipe : ${h.postes.filter((p) => p.finance).map((p) => `${p.nb} ${esc(p.nom)}`).join(', ') || 'aucune embauche'} financé(s) par l'apport.</li><li>Sortie investisseur supposée à l'année 5 à ${h.multSortie} × le chiffre d'affaires.</li>${h.baseRetraitee ? '<li>Base de départ calculée hors clients liés à la société.</li>' : ''}</ul>
      <h2>9. Notes méthodologiques</h2><p>Le modèle simule l'activité mois par mois sur 5 ans, à partir des chiffres réels de la société, dans deux situations : sans financement et avec le plan de croissance. Le besoin de financement est le point bas de trésorerie du plan de croissance sans apport.</p>
      <table><tbody>${LEXIQUE.map((l) => `<tr><td style="width:170px;vertical-align:top"><b>${l[0]}</b></td><td style="font-size:12px">${l[1]}</td></tr>`).join('')}</tbody></table><p><b>Limites :</b></p><ul>${LIMITES.map((l) => `<li style="font-size:12px">${l}</li>`).join('')}</ul>
      <p class="n">Ces projections reposent sur des hypothèses de la direction ; elles ne constituent ni une garantie de résultat ni une offre de titres financiers. Les données de départ proviennent du CRM de la société.</p></body></html>`;
  }
  function pdf() { const w = window.open('', '_blank'); if (!w) { toast('⚠️ Autorisez les fenêtres pop-up pour ouvrir le dossier'); return; } w.document.write(dossierHtml()); w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* impression manuelle */ } }, 400); }

  /* — assemblage — */
  function render() {
    const host = root(); if (!host) return;
    let el = host.querySelector(':scope > #fin-body'); if (!el) { el = document.createElement('div'); el.id = 'fin-body'; host.appendChild(el); }
    const tabs = [['synthese', '📊 Synthèse'], ['traction', '🔎 Traction'], ['hyp', '🧮 Hypothèses'], ['proj', '📈 États financiers'], ['indic', '📐 Indicateurs'], ['opti', '💡 Optimisations'], ['notes', '📖 Notes'], ['dossier', '📄 Dossier']];
    el.innerHTML = `<div class="ban"><div class="ban-deco"></div><h1 class="page-title">🏦 Financement</h1><p class="page-sub">Modèle financier sur 5 ans : besoin de financement, options et dossier pour les financeurs — départ : vos chiffres réels du CRM</p></div>
      <div class="tabs" role="tablist" style="margin-bottom:16px">${tabs.map((t) => `<div class="tab ${ui.tab === t[0] ? 'active' : ''}" role="tab" tabindex="0" aria-selected="${ui.tab === t[0]}" data-tab="${t[0]}">${t[1]}</div>`).join('')}</div>` +
      (ui.tab === 'hyp' ? tabHyp() : ui.tab === 'traction' ? tabTraction() : ui.tab === 'indic' ? tabIndic() : ui.tab === 'proj' ? tabProj() : ui.tab === 'opti' ? tabOpti() : ui.tab === 'notes' ? tabNotes() : ui.tab === 'dossier' ? tabDossier() : tabSynthese());
  }
  function bind() {
    const el = root(); if (!el || el.dataset.bound) return; el.dataset.bound = '1';
    const act = (t) => {
      if (t.dataset.tab) { ui.tab = t.dataset.tab; render(); return; }
      const a = t.dataset.act; if (!a) return;
      const appliquer = (h2, qui) => {
        if (!confirm(qui + '\n\nVos hypothèses seront modifiées et la mention « document de travail » reviendra. « Réinitialiser » (onglet Hypothèses) remet les valeurs initiales. Continuer ?')) return;
        Object.keys(h2).forEach((k) => { if (k === 'produits') diffProduits(h.produits, h2.produits).forEach((d) => editProduit(d.id, d.champ, d.valeur)); else if (JSON.stringify(h2[k]) !== JSON.stringify(h[k])) edit(k, clone(h2[k])); });
        edit('valide', false); render();
      };
      if (a === 'levier') { const l = LEVIERS.filter((x) => x.id === t.dataset.id)[0]; if (l) appliquer(Object.assign({}, h, l.f(h)), 'Appliquer : ' + l.lib + ' (' + l.test + ')'); }
      else if (a === 'plan') { const c = calc.optimiser(h).combine; if (c.etapes.length) appliquer(c.h, 'Appliquer le plan combiné (' + c.etapes.length + ' leviers)'); }
      else if (a === 'csv') csv(); else if (a === 'pdf') pdf();
      else if (a === 'reset') { if (confirm('Revenir aux valeurs initiales ? Vos hypothèses modifiées seront effacées ; le marquage des parties liées et des règlements en nature est conservé.')) { const liens = ov.liens; ov = liens ? { liens } : {}; persist(); recompute(); render(); } }
      else if (a === 'associe-add') { ov.valide = false; if (!('associes' in ov)) ov.associes = clone(h.associes); ov.associes.push({ id: 'a' + Date.now().toString(36), nom: 'Nouvel associé', part: 0 }); persist(); recompute(); render(); }
      else if (a === 'associe-del') { ov.valide = false; if (!('associes' in ov)) ov.associes = clone(h.associes); ov.associes = ov.associes.filter((x) => x.id !== t.dataset.id); persist(); recompute(); render(); }
      else if (a === 'inv-add') { ov.valide = false; if (!('investissements' in ov)) ov.investissements = clone(h.investissements); ov.investissements.push({ id: 'i' + Date.now().toString(36), nom: 'Nouvel investissement', mois: 3, montant: 0, duree: 3, finance: true }); persist(); recompute(); render(); }
      else if (a === 'inv-del') { ov.valide = false; if (!('investissements' in ov)) ov.investissements = clone(h.investissements); ov.investissements = ov.investissements.filter((i) => i.id !== t.dataset.id); persist(); recompute(); render(); }
      else if (a === 'poste-add') { ov.valide = false; if (!('postes' in ov)) ov.postes = clone(h.postes); ov.postes.push({ id: 'p' + Date.now().toString(36), nom: 'Nouveau poste', nb: 1, cout: 300000, debut: 6, finance: true }); persist(); recompute(); render(); }
      else if (a === 'poste-del') { ov.valide = false; if (!('postes' in ov)) ov.postes = clone(h.postes); ov.postes = ov.postes.filter((p) => p.id !== t.dataset.id); persist(); recompute(); render(); }
    };
    el.addEventListener('click', (e) => { const t = e.target.closest('[data-tab],[data-act]'); if (t) act(t); });
    el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.tab) { e.preventDefault(); act(e.target); } });
    const valeur = (t) => t.type === 'checkbox' ? t.checked : (t.type === 'number' ? (t.value === '' ? null : num(t.value)) : t.value);
    el.addEventListener('input', (e) => {                                  // simulation en direct : seuls les résultats sont redessinés, le champ en cours de saisie reste intact
      const t = e.target; if (!t.closest('#fin-ctl') || t.dataset.scen !== undefined) return;
      if (t.dataset.k) { edit(t.dataset.k, valeur(t)); const o = document.getElementById('fin-out'); if (o) o.innerHTML = out(); }
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.scen !== undefined) { edit('scenario', t.value); edit('croiss', SCEN[t.value].slice()); render(); }
      else if (t.dataset.inv) { editInv(t.dataset.inv, t.dataset.f, t.dataset.f === 'nom' ? t.value : valeur(t)); render(); }
      else if (t.dataset.p) { editPoste(t.dataset.p, t.dataset.f, t.dataset.f === 'nom' ? t.value : valeur(t)); render(); }
      else if (t.dataset.prod !== undefined) { editProduit(t.dataset.prod, t.dataset.f, valeur(t)); render(); }
      else if (t.dataset.lien !== undefined) { editLien(t.dataset.lien, t.dataset.f, t.checked); render(); }
      else if (t.dataset.a) { editAssocie(t.dataset.a, t.dataset.f, t.dataset.f === 'nom' ? t.value : valeur(t)); render(); }
      else if (t.dataset.k === 'valide' && t.checked && calc.controlesDossier(h, res).some((c) => c.bloquant)) { t.checked = false; alert('Validation impossible :\n\n• ' + calc.controlesDossier(h, res).filter((c) => c.bloquant).map((c) => c.msg).join('\n• ') + '\n\nCorrigez les hypothèses ou le montage, puis validez.'); render(); }
      else if (t.dataset.k && !t.closest('#fin-ctl')) { edit(t.dataset.k, valeur(t)); if (t.dataset.k.indexOf('croiss.') === 0) edit('scenario', 'perso'); render(); }
    });
  }
  G.initFinancement = function () { if (!ov) load(); recompute(); bind(); render(); };
  G.SanixFinancement.refresh = function () { if (ov && visible()) { recompute(); render(); } };
})(typeof window !== 'undefined' ? window : globalThis);
