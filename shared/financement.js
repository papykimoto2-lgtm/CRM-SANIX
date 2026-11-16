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

  /* ───────────── Hypothèses ───────────── */
  /** Valeurs initiales : tirées du CRM quand il contient la donnée, sinon exemples indicatifs à adapter. */
  function defauts(base) {
    base = base || {};
    const nb = Math.round(pos(base.commandes12m));
    return {
      valide: false,                                                       // cochée par l'utilisateur : retire la mention « document de travail » des exports
      scenario: 'realiste', croiss: SCEN.realiste.slice(), croissSans: [10, 10, 10, 10],
      clientsAn1: nb > 0 ? nb : 12,                                         // nouveaux clients la 1re année (commandes des 12 derniers mois)
      prixLicence: pos(base.prixMoyen) > 0 ? Math.round(base.prixMoyen) : 1500000,   // HT par nouveau client
      hausseAn: 3, maintenancePct: 12, retentionPct: 85, servicesPct: 20, delaiEncaissement: 1,
      baseInstallee: Math.round(pos(base.caTotal)),                          // CA HT cumulé déjà vendu : assiette de la maintenance
      directsPct: 10, commissionPct: pos(base.commissionDefaut) > 0 ? pos(base.commissionDefaut) : 10,
      iaMensuel: 150000, marketingPct: 8, marketingMin: 250000, marketingBoost: 400000,
      fixesMensuels: 700000, chargesSocialesPct: 20, augmentationSalairesPct: 4, impotPct: 25, tresoDepart: 0,
      postes: [
        { id: 'p1', nom: 'Équipe actuelle (à renseigner)', nb: 1, cout: 500000, debut: 0, finance: false },
        { id: 'p2', nom: 'Développeurs', nb: 3, cout: 450000, debut: 3, finance: true },
        { id: 'p3', nom: 'Commerciaux', nb: 3, cout: 300000, debut: 3, finance: true, acquisition: true },
        { id: 'p4', nom: 'Responsable marketing', nb: 1, cout: 500000, debut: 4, finance: true, acquisition: true },
        { id: 'p5', nom: 'Support & déploiement', nb: 2, cout: 300000, debut: 6, finance: true }
      ],
      baseRetraitee: false,                                                // base du modèle : exclut les clients marqués « partie liée »
      associes: [{ id: 'a1', nom: 'Fondateur(s) et associés actuels', part: 100 }], esopPct: 0,   // tour de table actuel ; pool d'intéressement en % après l'apport
      margeSecuritePct: 20, partCapital: 50, partDette: 30, partSubvention: 20,
      preMoney: null, multEntree: 2, multSortie: 2.5, taux: 12, dureeMois: 60, differeMois: 12
    };
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
    const m = []; let bi = pos(h.baseInstallee);
    for (let t = 0; t < N; t++) {
      const y = Math.floor(t / 12);
      let ny = pos(h.clientsAn1); for (let k = 0; k < y; k++) ny *= 1 + clamp(g[k], -100, 1000) / 100;
      const n = ny / 12, prix = pos(h.prixLicence) * Math.pow(1 + num(h.hausseAn) / 100, y);
      const lic = n * prix, maint = pos(h.maintenancePct) / 100 / 12 * bi, serv = pos(h.servicesPct) / 100 * lic;
      bi = bi * rm + lic;
      m.push({ t, y, clients: n, lic, maint, serv, ca: lic + maint + serv });
    }

    // 2. Coûts, impôt, financement, trésorerie
    const d = fin.dette && pos(fin.dette.montant) > 0 ? fin.dette : null;
    const dur = d ? Math.max(1, Math.round(num(d.duree))) : 1, dif = d ? clamp(Math.round(num(d.differe)), 0, dur - 1) : 0;
    const tm = d ? pos(d.taux) / 100 / 12 : 0, amort = d ? pos(d.montant) / (dur - dif) : 0;
    const actif = (p, t) => (avec || !p.finance) && t >= num(p.debut);
    const coutPoste = (p, y) => pos(p.nb) * pos(p.cout) * cs * Math.pow(1 + num(h.augmentationSalairesPct) / 100, y);
    // Ouverture du bilan simplifié : la société n'a que de la trésorerie et des créances clients (à remplacer par le bilan réel).
    const eq0 = num(h.tresoDepart) + delai * m[0].ca, apports = pos(fin.equity) + pos(fin.subvention);
    let reste = 0, pool = 0, treso = num(h.tresoDepart), cumRes = 0;
    for (let t = 0; t < N; t++) {
      const r = m[t], y = r.y;
      r.directs = pos(h.directsPct) / 100 * r.ca;
      r.commissions = pos(h.commissionPct) / 100 * r.lic;
      r.ia = pos(h.iaMensuel);
      r.mkt = Math.max(pos(h.marketingPct) / 100 * r.ca, pos(h.marketingMin)) + (avec ? pos(h.marketingBoost) : 0);
      r.sal = sum(h.postes, (p) => actif(p, t) ? coutPoste(p, y) : 0);
      r.salAcq = sum(h.postes, (p) => p.acquisition && actif(p, t) ? coutPoste(p, y) : 0);
      r.effectif = sum(h.postes, (p) => actif(p, t) ? pos(p.nb) : 0);
      r.fixes = pos(h.fixesMensuels);
      r.opex = r.directs + r.commissions + r.ia + r.mkt + r.sal + r.fixes;
      r.ebitda = r.ca - r.opex;
      r.recu = m[Math.max(0, t - delai)].ca;                                // encaissement décalé ; avant le mois 0 : régime établi
      let inflow = 0;
      if (t === 0) { inflow = pos(fin.equity) + pos(fin.subvention) + (d ? pos(d.montant) : 0); reste = d ? pos(d.montant) : 0; }
      let interet = 0, princ = 0;
      if (t >= 1 && reste > 1e-9) {
        interet = reste * tm;
        if (t > dif && t <= dur) princ = t === dur ? reste : Math.min(reste, amort);
        reste -= princ;
      }
      const ebt = r.ebitda - interet; let impot = 0;
      if (ebt < 0) pool += -ebt; else { const use = Math.min(pool, ebt); pool -= use; impot = pos(h.impotPct) / 100 * (ebt - use); }
      r.interet = interet; r.princ = princ; r.impot = impot; r.inflow = inflow;
      r.flux = r.recu - r.opex - impot - interet - princ + inflow;
      treso += r.flux; r.treso = treso;
      cumRes += r.ebitda - interet - impot;
      r.fExpl = r.recu - r.opex - impot; r.fFin = inflow - interet - princ;
      let cre = 0; for (let j = t - delai + 1; j <= t; j++) cre += m[Math.max(j, 0)].ca;      // ventes pas encore encaissées en fin de mois
      r.creances = cre; r.detteFin = reste; r.cap = eq0 + apports + cumRes;
    }
    const annees = [];
    for (let y = 0; y < ANNEES; y++) {
      const s = m.slice(y * 12, y * 12 + 12), f = (k) => sum(s, (x) => x[k]);
      const a = { an: y + 1, clients: f('clients'), lic: f('lic'), maint: f('maint'), serv: f('serv'), ca: f('ca'), directs: f('directs'), commissions: f('commissions'),
        ia: f('ia'), mkt: f('mkt'), sal: f('sal'), fixes: f('fixes'), opex: f('opex'), ebitda: f('ebitda'), interet: f('interet'), princ: f('princ'), impot: f('impot'),
        flux: f('flux'), fExpl: f('fExpl'), fFin: f('fFin'), salAcq: f('salAcq'), tresoFin: s[11].treso };
      a.resultatNet = a.ebitda - a.interet - a.impot; a.margeEbitda = a.ca > 0 ? a.ebitda / a.ca : 0;
      const L = s[11]; a.effectif = L.effectif; a.arr = L.maint * 12; a.creances = L.creances;
      a.bilan = { tresorerie: L.treso, creances: L.creances, actif: L.treso + L.creances, capitaux: L.cap, dette: L.detteFin, passif: L.cap + L.detteFin };
      annees.push(a);
    }
    let min = Infinity, moisMin = 0; m.forEach((x) => { if (x.treso < min) { min = x.treso; moisMin = x.t; } });
    // Point mort : premier mois à partir duquel l'EBITDA reste positif jusqu'à la fin (null s'il n'est jamais atteint durablement)
    let pointMort = null; for (let t = N - 1; t >= 0 && m[t].ebitda > 0; t--) pointMort = t;
    return { plan, mois: m, annees, tresoMin: min, moisMin, tresoFin: m[N - 1].treso, detteRestante: reste, pointMort };
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
    const montant = X * (1 + pos(h.margeSecuritePct) / 100), s = sim(montant);
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
      const dscr = a.filter((x) => x.interet + x.princ > 0).map((x) => x.ebitda / (x.interet + x.princ));
      out.dette = { montant: dm, totalInterets: sum(a, (x) => x.interet), dscrMin: dscr.length ? Math.min.apply(null, dscr) : null, restant: s.detteRestante };
      if (out.dette.dscrMin !== null && out.dette.dscrMin < 1.2) out.alertes.push('Capacité de remboursement insuffisante (EBITDA / service de la dette < 1,2) : un prêteur refusera probablement.');
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
      ['Charges fixes', f('fixes')], ['Intelligence artificielle', f('ia')], ['Coûts directs et commissions', f('directs') + f('commissions')], ['Impôts', f('impot')]
    ].filter((l) => l[1] > 0.5);
    const depenses = sum(lignes, (l) => l[1]), recu = f('recu');
    return { mois: avec0.moisMin + 1, lignes, depenses, recu, tresoDepart: num(h.tresoDepart), besoin };
  }

  /* ───────────── Traction : chiffres réels du CRM ───────────── */
  const cle = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const RECURRENT = /annuel|mensuel|abonn|saas/i;
  /** Facturé, encaissé, créances par client ; concentration ; part récurrente ; vue retraitée sans les parties liées.
   *  cmds : { client, date, statut, typeLicence, htNet, ttc, acompte } ; o : { liens: { <cle client>: { lie, nature } }, now } */
  function analyserTraction(cmds, o) {
    o = o || {}; const liens = o.liens || {}, now = o.now ? new Date(o.now) : new Date(), statuts = o.statuts || ['confirmee', 'en_cours', 'livree'];
    const depuis = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString().slice(0, 7), jours = (d) => Math.floor((now - new Date(d)) / 864e5);
    const rows = {}, ages = { j30: 0, j90: 0, plus: 0 };
    (cmds || []).filter((c) => c && statuts.indexOf(c.statut) >= 0).forEach((c) => {
      const k = cle(c.client), lien = liens[k] || {};
      const r = rows[k] || (rows[k] = { cle: k, client: c.client || '—', n: 0, factureHT: 0, factureTTC: 0, encaisse: 0, creance: 0, ht12: 0, n12: 0, recurrent: 0, derniere: null, plusAncienne: null, lie: !!lien.lie, nature: !!lien.nature });
      const ht = pos(c.htNet), ttc = pos(c.ttc) || ht, verse = Math.min(ttc, pos(c.acompte)), reste = ttc - verse, d = String(c.date || '').slice(0, 10);
      r.n++; r.factureHT += ht; r.factureTTC += ttc; r.encaisse += verse; r.creance += reste;
      if (RECURRENT.test(c.typeLicence || '')) r.recurrent += ht;
      if (d && (!r.derniere || d > r.derniere)) r.derniere = d;
      if (d.slice(0, 7) >= depuis) { r.ht12 += ht; r.n12++; }
      if (reste > 0 && d) { if (!r.plusAncienne || d < r.plusAncienne) r.plusAncienne = d; const j = jours(d); if (j <= 30) ages.j30 += reste; else if (j <= 90) ages.j90 += reste; else ages.plus += reste; }
    });
    const lignes = Object.keys(rows).map((k) => rows[k]).sort((a, b) => b.factureHT - a.factureHT);
    const tot = (L) => { const t = { clients: L.length, commandes: sum(L, (r) => r.n), factureHT: sum(L, (r) => r.factureHT), factureTTC: sum(L, (r) => r.factureTTC), encaisse: sum(L, (r) => r.encaisse), creance: sum(L, (r) => r.creance), ht12: sum(L, (r) => r.ht12), n12: sum(L, (r) => r.n12), recurrent: sum(L, (r) => r.recurrent) };
      t.taux = t.factureTTC > 0 ? t.encaisse / t.factureTTC : 0; t.partRecurrent = t.factureHT > 0 ? t.recurrent / t.factureHT : 0; t.prixMoyen = t.n12 ? t.ht12 / t.n12 : (t.commandes ? t.factureHT / t.commandes : 0); return t; };
    const tous = tot(lignes), retraite = tot(lignes.filter((r) => !r.lie)), nature = lignes.filter((r) => r.nature);
    return { lignes, tous, retraite, ages, depuis,
      top1: tous.factureHT > 0 && lignes[0] ? lignes[0].factureHT / tous.factureHT : 0, top2: tous.factureHT > 0 ? sum(lignes.slice(0, 2), (r) => r.factureHT) / tous.factureHT : 0,
      partLies: tous.factureHT > 0 ? sum(lignes.filter((r) => r.lie), (r) => r.factureHT) / tous.factureHT : 0, nbLies: lignes.filter((r) => r.lie).length,
      encaisseNature: sum(nature, (r) => r.encaisse), encaisseMonetaire: tous.encaisse - sum(nature, (r) => r.encaisse) };
  }

  /* ───────────── Économie unitaire et indicateurs par année ───────────── */
  /** Pour chaque année : marge brute, revenu récurrent, coût d'acquisition d'un client (marketing + équipe d'acquisition ; les commissions
   *  sont déjà dans la marge), valeur d'un client sur 5 ans (marge de la 1re vente + maintenance avec rétention), rapport, délai de retour. */
  function economieUnitaire(h, sim) {
    const d = pos(h.directsPct) / 100, c = pos(h.commissionPct) / 100, ret = clamp(h.retentionPct, 0, 100) / 100, mp = pos(h.maintenancePct) / 100, sv = pos(h.servicesPct) / 100;
    return sim.annees.map((a, y) => {
      const prix = pos(h.prixLicence) * Math.pow(1 + num(h.hausseAn) / 100, y), n = a.clients;
      const margeInit = prix * (1 - d - c) + prix * sv * (1 - d), mAn = prix * mp * (1 - d);
      let ltv = margeInit; for (let k = 1; k < ANNEES; k++) ltv += mAn * Math.pow(ret, k);
      const cac = n > 0 ? (a.mkt + a.salAcq) / n : null, ltvCac = cac ? ltv / cac : null;
      const retour = cac === null ? null : (margeInit >= cac ? 0 : (mAn > 0 ? (cac - margeInit) / (mAn / 12) : null));
      return { an: a.an, clients: n, ca: a.ca, margeBrute: a.ca > 0 ? (a.ca - a.directs - a.commissions) / a.ca : 0, arr: a.arr, partRecurrente: a.ca > 0 ? a.maint / a.ca : 0,
        margeInit, ltv, cac, ltvCac, retour, effectif: a.effectif, caParSalarie: a.effectif > 0 ? a.ca / a.effectif : null };
    });
  }

  /** Tour de table avant / après un apport en capital (`part` : part de l'investisseur, 0 à 1). Le pool d'intéressement est prélevé sur l'ensemble. */
  function tourDeTable(h, part) {
    const as = (h.associes || []).filter((x) => pos(x.part) > 0), tot = sum(as, (x) => pos(x.part)) || 1, esop = clamp(h.esopPct, 0, 30) / 100, s = clamp(part, 0, 0.99);
    const rows = as.map((x) => ({ nom: x.nom, avant: pos(x.part) / tot, apres: pos(x.part) / tot * (1 - s - esop) }));
    if (s > 0) rows.push({ nom: 'Nouvel investisseur', avant: 0, apres: s });
    if (esop > 0) rows.push({ nom: 'Pool d\'intéressement', avant: 0, apres: esop });
    return rows;
  }

  /* ───────────── Pistes d'optimisation ───────────── */
  const reporte = (h, k) => h.postes.map((p) => p.finance ? Object.assign({}, p, { debut: Math.min(59, num(p.debut) + k) }) : p);
  /** Chaque levier renvoie les hypothèses modifiées (clés de premier niveau). `arbitrer` : le modèle ne baisse pas la croissance en contrepartie, à vérifier. */
  const LEVIERS = [
    { id: 'clients', cat: 'Ventes', lib: 'Gagner plus de clients', test: '+25 % de nouveaux clients la 1re année', f: (h) => ({ clientsAn1: h.clientsAn1 * 1.25 }), note: 'Dépend de votre capacité commerciale et de la demande : à confirmer avec votre pipeline.' },
    { id: 'prix', cat: 'Ventes', lib: 'Augmenter le prix des licences', test: '+15 % du prix moyen', f: (h) => ({ prixLicence: h.prixLicence * 1.15 }), note: 'Vérifier ce que vos clients acceptent de payer et les prix de vos concurrents.' },
    { id: 'maintenance', cat: 'Ventes', lib: 'Développer les contrats de maintenance', test: '+5 points de maintenance annuelle', f: (h) => ({ maintenancePct: h.maintenancePct + 5 }), note: 'Revenu récurrent : c\'est ce que les financeurs valorisent le plus.' },
    { id: 'retention', cat: 'Ventes', lib: 'Mieux fidéliser les clients', test: '+5 points de rétention', f: (h) => ({ retentionPct: Math.min(100, h.retentionPct + 5) }), note: 'Suivi après-vente, renouvellements : l\'onglet « Après-vente » du CRM sert à cela.' },
    { id: 'services', cat: 'Ventes', lib: 'Facturer plus d\'installation et de formation', test: '+10 points des licences', f: (h) => ({ servicesPct: h.servicesPct + 10 }), note: 'Marge généralement bonne, mais mobilise du temps de l\'équipe.' },
    { id: 'embauches', cat: 'Coûts', lib: 'Recruter moins de monde', test: '−30 % de l\'effectif à recruter', f: (h) => ({ postes: h.postes.map((p) => p.finance ? Object.assign({}, p, { nb: p.nb * 0.7 }) : p) }), arbitrer: true, note: 'Le modèle ne réduit pas la croissance en contrepartie : vérifiez que vos objectifs de ventes restent tenables avec moins de monde.' },
    { id: 'etaler', cat: 'Coûts', lib: 'Étaler les recrutements', test: 'recruter 6 mois plus tard', f: (h) => ({ postes: reporte(h, 6) }), arbitrer: true, note: 'Le modèle ne retarde pas la croissance en contrepartie : à ajuster si les recrues conditionnent les ventes.' },
    { id: 'marketing', cat: 'Coûts', lib: 'Calibrer les campagnes financées', test: '−50 % du budget de campagnes', f: (h) => ({ marketingBoost: h.marketingBoost * 0.5 }), arbitrer: true, note: 'Moins de campagnes peut ralentir la prospection : le modèle ne le compense pas.' },
    { id: 'fixes', cat: 'Coûts', lib: 'Réduire les charges fixes', test: '−10 % des charges fixes', f: (h) => ({ fixesMensuels: h.fixesMensuels * 0.9 }), note: 'Loyer, abonnements, déplacements : le gain est immédiat et sans effet sur les ventes.' },
    { id: 'directs', cat: 'Coûts', lib: 'Réduire les coûts directs', test: '−3 points du chiffre d\'affaires', f: (h) => ({ directsPct: Math.max(0, h.directsPct - 3) }), note: 'Hébergement, outils tiers : renégocier ou mutualiser.' },
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
    return { base, leviers, seuils: { clients: seuil(h, 'clientsAn1'), prix: seuil(h, 'prixLicence') }, combine: { etapes, final: mcur, h: cur, rentable: mcur.pointMort !== null, autofinance: mcur.besoin < 0.5 } };
  }

  const calc = { N, ANNEES, SCEN, SCEN_LABEL, OPT_LABEL, LEVIERS, cle, analyserTraction, economieUnitaire, tourDeTable, evaluer, optimiser, seuil, defauts, simuler, structure, dimensionner, indicateurs, comparer, emplois, preMoney };
  G.SanixFinancement = { calc };
  if (typeof module !== 'undefined' && module.exports) module.exports = { calc };
  if (!G.document) return;

  /* ───────────── Écran (navigateur) ───────────── */
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (Math.round(num(n)) || 0).toLocaleString('fr-FR');          // jamais « -0 »
  const fmtM = (n) => { const r = Math.round(num(n) / 1e5) / 10; return (r === 0 ? 0 : r).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M'; };
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
    return { traction: T, caTotal: B.factureHT, ca12m: B.ht12, commandes12m: B.n12, commandesTotal: B.commandes, prixMoyen: B.prixMoyen,
      pipelinePondere: pond, pipelineBrut: brut, prospects: cl.filter((c) => c && c.statut === 'prospect').length, clients: cl.filter((c) => c && c.statut === 'client').length,
      produits: (g(() => LOGICIELS) || []).filter((l) => l && l.actif !== false).length,
      commissionDefaut: num(g(() => CONFIG.commissionDefaut)), societe: g(() => CONFIG.raisonSociale) || 'SANIX', devise: g(() => CONFIG.devise) || 'FCFA' };
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function load() { try { const r = localStorage.getItem('sanix_crm_' + LSK); ov = r ? JSON.parse(r) : {}; } catch (e) { ov = {}; } if (!ov || typeof ov !== 'object') ov = {}; }
  function persist() { try { if (typeof window.lsSave === 'function') window.lsSave(LSK, ov); else localStorage.setItem('sanix_crm_' + LSK, JSON.stringify(ov)); } catch (e) { toast('⚠️ Enregistrement local impossible'); } }
  function recompute() { base = crm(); h = Object.assign(defauts(base), clone(ov)); res = comparer(h); }
  /** Modifie une hypothèse (chemin « croiss.0 », « clientsAn1 »…) et ne mémorise que ce que l'utilisateur a touché. */
  function edit(path, val) {
    const parts = path.split('.'), top = parts[0];
    if (!(top in ov)) ov[top] = clone(h[top]);
    let o = ov; for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = val; persist(); recompute();
  }
  function editPoste(id, field, val) {
    if (!('postes' in ov)) ov.postes = clone(h.postes);
    const p = ov.postes.filter((x) => x.id === id)[0]; if (!p) return; p[field] = val; persist(); recompute();
  }

  function editLien(k, f, v) { ov.liens = ov.liens || {}; ov.liens[k] = Object.assign({}, ov.liens[k], { [f]: !!v }); persist(); recompute(); }
  function editAssocie(id, field, val) {
    if (!('associes' in ov)) ov.associes = clone(h.associes);
    const a = ov.associes.filter((x) => x.id === id)[0]; if (!a) return; a[field] = val; persist(); recompute();
  }

  /* — éléments d'interface — */
  const stat = (titre, val, sub, color) => `<div class="stat-card ${color || 'blue'}"><div class="stat-label">${esc(titre)}</div><div class="stat-val" style="font-size:20px">${val}</div><div class="stat-label" style="margin-top:4px">${sub || ''}</div></div>`;
  const field = (label, key, val, o) => { o = o || {}; return `<label class="form-label" style="margin:0">${esc(label)}${o.hint ? ` <span class="muted" style="font-weight:400">${esc(o.hint)}</span>` : ''}<input class="form-input" type="number" step="${o.step || 'any'}" ${o.min != null ? `min="${o.min}"` : ''} data-k="${key}" value="${val == null ? '' : num(val)}" ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} style="margin-top:4px"></label>`; };
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
      ${stat('CA année 5', fmtM(ca5a) + ' ' + base.devise, 'Sans financement : ' + fmtM(ca5s) + ' · ×' + (ca5s > 0 ? (ca5a / ca5s).toFixed(1) : '–'), 'green')}
      ${stat('EBITDA année 5', fmtM(an5.ebitda) + ' ' + base.devise, 'Marge : ' + pct(an5.margeEbitda) + (pm === null ? ' · pas rentable' : ''), pm === null ? 'orange' : 'purple')}</div>`;
    html += `<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">📉 Trésorerie cumulée sur 5 ans</span></div>${courbe(series, 860, 230)}${legende(series)}
      ${r.besoin > 0 ? note('Sans apport, la trésorerie du plan de croissance descend à <b>' + fmt(a0.tresoMin) + ' ' + esc(base.devise) + '</b> en ' + moisLabel(a0.moisMin) + ' : c\'est le besoin à financer.') : ''}</div>`;
    html += '<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">⚖️ Comparaison des options de financement</span></div><div style="overflow-x:auto"><table class="client-table" style="min-width:640px"><thead><tr><th></th>' + r.options.map((o) => `<th style="text-align:right">${esc(o.label)}</th>`).join('') + '</tr></thead><tbody>';
    const row = (lib, f) => `<tr><td>${lib}</td>${r.options.map((o) => `<td style="text-align:right">${f(o)}</td>`).join('')}</tr>`;
    html += row('Montant à lever', (o) => '<b>' + fmtM(o.montant) + '</b>' + (o.viable ? '' : '<br><span class="badge badge-warning">Non viable</span>')) + row('Trésorerie minimale', (o) => `<span style="${o.ind.tresoMin < -0.5 ? 'color:var(--danger)' : ''}">${fmtM(o.ind.tresoMin)}</span>`) + row('Trésorerie année 5', (o) => `<span style="${o.ind.tresoFin < 0 ? 'color:var(--danger)' : ''}">${fmtM(o.ind.tresoFin)}</span>`)
      + row('Résultat net cumulé 5 ans', (o) => fmtM(o.ind.resultatCumule)) + row('Part du capital cédée', (o) => o.ind.equity ? pct(o.ind.equity.part, 1) : '–')
      + row('Rendement investisseur (×)', (o) => o.ind.equity ? o.ind.equity.moic.toFixed(1) + ' × · TRI ' + pct(o.ind.equity.tri) : '–')
      + row('Intérêts payés', (o) => o.ind.dette ? fmtM(o.ind.dette.totalInterets) : '–') + row('Capacité de remboursement', (o) => o.ind.dette && o.ind.dette.dscrMin != null ? o.ind.dette.dscrMin.toFixed(1) + ' ×' : '–')
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
    const c = base, bloc = (titre, corps) => `<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">${titre}</span></div>${corps}</div>`;
    const grid = (x) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">${x}</div>`;
    const an = (k, lab) => [0, 1, 2, 3].map((i) => field(lab + ' — année ' + (i + 2) + ' (%)', k + '.' + i, h[k][i])).join('');
    const poste = (p) => `<tr><td><input class="form-input" data-p="${esc(p.id)}" data-f="nom" value="${esc(p.nom)}"></td><td><input class="form-input" type="number" min="0" style="width:64px" data-p="${esc(p.id)}" data-f="nb" value="${num(p.nb)}"></td>
      <td><input class="form-input" type="number" min="0" style="width:110px" data-p="${esc(p.id)}" data-f="cout" value="${num(p.cout)}"></td><td><input class="form-input" type="number" min="0" max="59" style="width:64px" data-p="${esc(p.id)}" data-f="debut" value="${num(p.debut)}"></td>
      <td style="text-align:center"><input type="checkbox" data-p="${esc(p.id)}" data-f="finance" ${p.finance ? 'checked' : ''}></td><td style="text-align:center"><input type="checkbox" data-p="${esc(p.id)}" data-f="acquisition" ${p.acquisition ? 'checked' : ''}></td><td><button class="btn btn-outline btn-sm" data-act="poste-del" data-id="${esc(p.id)}" aria-label="Supprimer ce poste">🗑</button></td></tr>`;
    return `<div class="alert alert-warn" role="note">⚠️ Les valeurs initiales sont <b>indicatives</b> : seuls le nombre de clients, le prix moyen, la base installée et la commission viennent du CRM. Vérifiez chaque hypothèse avant de remettre le dossier à un financeur.</div>
      ${bloc('📊 Point de départ (lu dans le CRM)', `<div class="stats-grid" style="margin:0">${stat('CA HT réalisé, 12 mois', fmtM(c.ca12m), c.commandes12m + ' commandes', 'blue')}${stat('CA HT cumulé', fmtM(c.caTotal), c.commandesTotal + ' commandes', 'green')}${stat('Pipeline pondéré', fmtM(c.pipelinePondere), 'Brut : ' + fmtM(c.pipelineBrut), 'orange')}${stat('Clients actifs', c.clients, c.produits + ' produits au catalogue', 'purple')}</div>`)}
      ${bloc('🚀 Ventes', grid(field('Nouveaux clients, année 1', 'clientsAn1', h.clientsAn1) + field('Prix moyen HT par licence', 'prixLicence', h.prixLicence) + field('Hausse annuelle des prix (%)', 'hausseAn', h.hausseAn) + field('Maintenance (% de la base installée / an)', 'maintenancePct', h.maintenancePct) + field('Rétention des clients (% / an)', 'retentionPct', h.retentionPct) + field('Services : installation, formation (% des licences)', 'servicesPct', h.servicesPct) + field('Base installée (CA HT déjà vendu)', 'baseInstallee', h.baseInstallee) + field('Délai d\'encaissement (mois)', 'delaiEncaissement', h.delaiEncaissement, { min: 0 })) + '<h4 style="margin:14px 0 8px;font-size:13px">Croissance du nombre de nouveaux clients — avec financement</h4>' + grid(an('croiss', 'Croissance')) + '<h4 style="margin:14px 0 8px;font-size:13px">Sans financement (l\'activité actuelle, limitée par les moyens)</h4>' + grid(an('croissSans', 'Croissance')))}
      ${bloc('💸 Coûts', grid(field('Coûts directs (% du CA) : hébergement, outils', 'directsPct', h.directsPct) + field('Commissions (% des licences)', 'commissionPct', h.commissionPct) + field('Intelligence artificielle (par mois)', 'iaMensuel', h.iaMensuel) + field('Marketing (% du CA)', 'marketingPct', h.marketingPct) + field('Marketing minimum (par mois)', 'marketingMin', h.marketingMin) + field('Campagnes financées (par mois)', 'marketingBoost', h.marketingBoost) + field('Charges fixes (par mois)', 'fixesMensuels', h.fixesMensuels) + field('Charges sociales (%)', 'chargesSocialesPct', h.chargesSocialesPct) + field('Augmentation annuelle des salaires (%)', 'augmentationSalairesPct', h.augmentationSalairesPct) + field('Impôt sur les sociétés (%)', 'impotPct', h.impotPct) + field('Trésorerie actuelle', 'tresoDepart', h.tresoDepart)))}
      ${bloc('👥 Équipe', note('Coût mensuel brut par personne. « Financé » : poste créé grâce au financement (absent du scénario sans financement). « Début » : mois de prise de poste (0 = déjà en place). « Acquisition » : poste commercial ou marketing, compté dans le coût d\'acquisition d\'un client.') + `<div style="overflow-x:auto"><table class="client-table" style="min-width:560px"><thead><tr><th>Poste</th><th>Nombre</th><th>Coût mensuel</th><th>Début (mois)</th><th>Financé</th><th title="Compte dans le coût d'acquisition d'un client">Acquisition</th><th></th></tr></thead><tbody>${h.postes.map(poste).join('')}</tbody></table></div><button class="btn btn-outline btn-sm" data-act="poste-add" style="margin-top:10px">+ Ajouter un poste</button>`)}
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
    if (A.recurrent === 0) flags.push('<b>Aucun revenu récurrent</b> enregistré : toutes les commandes sont des licences ponctuelles, la maintenance n\'est pas facturée dans le CRM.');
    if (T.nbLies > 0) flags.push(`<b>${pct(T.partLies)}</b> du facturé vient de clients marqués « partie liée » : à présenter séparément.`);
    if (T.encaisseNature > 0) flags.push(`${fmt(T.encaisseNature)} ${d} de règlements marqués « en nature » : non monétaires.`);
    if (A.clients < 10) flags.push(`Seulement <b>${A.clients} clients</b> facturés : la traction reste faible pour un fonds.`);
    const lignes = T.lignes.map((r) => `<tr><td>${esc(r.client)}${r.lie ? ' <span class="badge badge-warning">liée</span>' : ''}${r.nature ? ' <span class="badge badge-muted">en nature</span>' : ''}</td><td style="text-align:right">${r.n}</td><td style="text-align:right">${fmt(r.factureHT)}</td><td style="text-align:right">${fmt(r.encaisse)}</td><td style="text-align:right;${r.creance > 0 ? 'color:var(--danger)' : ''}">${fmt(r.creance)}</td><td style="text-align:right">${r.factureTTC > 0 ? pct(r.encaisse / r.factureTTC) : '–'}</td>
      <td style="text-align:center"><input type="checkbox" data-lien="${esc(r.cle)}" data-f="lie" ${r.lie ? 'checked' : ''} aria-label="Partie liée : ${esc(r.client)}"></td><td style="text-align:center"><input type="checkbox" data-lien="${esc(r.cle)}" data-f="nature" ${r.nature ? 'checked' : ''} aria-label="Règlement en nature : ${esc(r.client)}"></td></tr>`).join('');
    const cmp = (lib, f) => `<tr><td>${lib}</td><td style="text-align:right">${f(A)}</td><td style="text-align:right">${f(R)}</td></tr>`;
    return `<div class="alert alert-info" role="note">🔎 <div><b>Ce qu'un financeur lit en premier.</b> Voici vos chiffres réels, tels que le CRM les enregistre : ce qui est facturé, ce qui est réellement encaissé, ce qui reste dû. Marquez les clients liés à vous ou à vos associés : ils seront présentés à part.</div></div>
      <div class="stats-grid">${stat('Facturé HT', fmtM(A.factureHT) + ' ' + d, A.commandes + ' commandes · ' + A.clients + ' clients', 'blue')}${stat('Encaissé', pct(A.taux), fmtM(A.encaisse) + ' sur ' + fmtM(A.factureTTC) + ' TTC', A.taux < 0.6 ? 'orange' : 'green')}${stat('Créances clients', fmtM(A.creance) + ' ' + d, 'dont plus de 90 jours : ' + fmtM(T.ages.plus), T.ages.plus > 0 ? 'orange' : 'green')}${stat('Concentration', pct(T.top1) + ' · ' + pct(T.top2), 'premier client · deux premiers', T.top1 > 0.4 ? 'orange' : 'green')}</div>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">🚩 Points qu'un financeur va relever</span></div>${flags.length ? '<ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.8">' + flags.map((f) => '<li>' + f + '</li>').join('') + '</ul>' : '<p class="page-sub" style="margin:0">✅ Aucun point d\'alerte sur ces critères.</p>'}</div>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">👥 Détail par client</span><span class="badge badge-muted">Montants en ${d}</span></div><div style="overflow-x:auto"><table class="client-table" style="min-width:720px"><thead><tr><th>Client</th><th style="text-align:right">Commandes</th><th style="text-align:right">Facturé HT</th><th style="text-align:right">Encaissé</th><th style="text-align:right">Créance</th><th style="text-align:right">Taux</th><th style="text-align:center">Partie liée</th><th style="text-align:center">En nature</th></tr></thead><tbody>${lignes}
        <tr style="font-weight:700"><td>Total</td><td style="text-align:right">${A.commandes}</td><td style="text-align:right">${fmt(A.factureHT)}</td><td style="text-align:right">${fmt(A.encaisse)}</td><td style="text-align:right">${fmt(A.creance)}</td><td style="text-align:right">${pct(A.taux)}</td><td></td><td></td></tr></tbody></table></div>
        ${note('Montants encaissés = acomptes saisis sur les commandes. Les commandes en brouillon ou annulées sont exclues. « En nature » : règlement qui n\'est pas en argent (terrain, matériel…).')}</div>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">⚖️ Tous les clients ou hors parties liées</span></div><table class="client-table"><thead><tr><th></th><th style="text-align:right">Tous</th><th style="text-align:right">Hors parties liées</th></tr></thead><tbody>${cmp('Clients', (x) => x.clients)}${cmp('Facturé HT', (x) => fmtM(x.factureHT))}${cmp('Facturé HT, 12 derniers mois', (x) => fmtM(x.ht12))}${cmp('Commandes, 12 derniers mois', (x) => x.n12)}${cmp('Prix moyen HT', (x) => fmtM(x.prixMoyen))}${cmp('Créances', (x) => fmtM(x.creance))}${cmp('Part récurrente', (x) => pct(x.partRecurrent))}</tbody></table>
        <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:13px;margin-top:12px"><input type="checkbox" data-k="baseRetraitee" ${h.baseRetraitee ? 'checked' : ''} style="margin-top:3px"><span><b>Partir de la base hors parties liées</b> pour le modèle (nombre de clients, prix moyen, base installée). Plus prudent, et plus crédible pour un financeur.</span></label></div>
      <div class="card"><div class="card-header"><span class="card-title">⏳ Ancienneté des créances</span></div><div class="stats-grid" style="margin:0">${stat('Moins de 30 jours', fmtM(T.ages.j30), '', 'green')}${stat('De 31 à 90 jours', fmtM(T.ages.j90), '', 'orange')}${stat('Plus de 90 jours', fmtM(T.ages.plus), '', T.ages.plus > 0 ? 'orange' : 'green')}</div></div>`;
  }

  function tabIndic() {
    const U = calc.economieUnitaire(h, res.avec0), col = (v, bon, ok) => v == null ? '–' : `<span style="color:var(--${bon ? 'success' : ok ? 'warning' : 'danger'})">`;
    const rowI = (lib, f, bold) => `<tr style="${bold ? 'font-weight:700' : ''}"><td>${lib}</td>${U.map((u) => `<td style="text-align:right;white-space:nowrap">${f(u)}</td>`).join('')}</tr>`;
    const lc = (u) => u.ltvCac == null ? '–' : `<span style="color:var(--${u.ltvCac >= 3 ? 'success' : u.ltvCac >= 1 ? 'warning' : 'danger'})">${u.ltvCac.toFixed(1)} ×</span>`;
    const rt = (u) => u.retour == null ? '–' : u.retour === 0 ? '<span style="color:var(--success)">immédiat</span>' : `<span style="color:var(--${u.retour <= 12 ? 'success' : u.retour <= 24 ? 'warning' : 'danger'})">${Math.round(u.retour)} mois</span>`;
    const u5 = U[ANNEES - 1], u1 = U[0], lect = [];
    if (u1.ltvCac != null && u1.ltvCac < 3) lect.push(`Valeur d'un client / coût d'acquisition de <b>${u1.ltvCac.toFixed(1)} ×</b> la 1re année : en dessous du repère de 3 ×, chaque client rapporte peu au regard de ce qu'il coûte à conquérir.`);
    if (u5.partRecurrente < 0.3) lect.push(`Le revenu récurrent ne pèse que <b>${pct(u5.partRecurrente)}</b> du chiffre d'affaires à l'année 5 : les financeurs valorisent surtout le récurrent.`);
    if (u1.retour != null && u1.retour > 12) lect.push(`Délai de retour sur le coût d'acquisition de <b>${Math.round(u1.retour)} mois</b> : au-delà de 12 mois, la croissance consomme beaucoup de trésorerie.`);
    if (!lect.length) lect.push('Les indicateurs unitaires sont dans les repères usuels.');
    return `${note('Calculés sur le plan de croissance. <b>Repères usuels du capital-risque</b> (à adapter au marché local) : valeur d\'un client ≥ 3 × son coût d\'acquisition, retour en moins de 12 mois, revenu récurrent dominant.')}
      <div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">📐 Indicateurs par année</span></div><div style="overflow-x:auto"><table class="client-table" style="min-width:560px"><thead><tr><th></th>${U.map((u) => `<th style="text-align:right">An ${u.an}</th>`).join('')}</tr></thead><tbody>
      ${rowI('Nouveaux clients', (u) => u.clients.toLocaleString('fr-FR', { maximumFractionDigits: 1 }))}${rowI('Chiffre d\'affaires', (u) => fmtM(u.ca), true)}${rowI('Marge brute', (u) => pct(u.margeBrute))}${rowI('Revenu récurrent annualisé', (u) => fmtM(u.arr))}${rowI('Part du revenu récurrent', (u) => pct(u.partRecurrente))}
      ${rowI('Coût d\'acquisition d\'un client', (u) => u.cac == null ? '–' : fmt(u.cac))}${rowI('Valeur d\'un client sur 5 ans', (u) => fmt(u.ltv))}${rowI('Valeur client / coût d\'acquisition', lc, true)}${rowI('Délai de retour', rt, true)}${rowI('Effectif', (u) => u.effectif.toLocaleString('fr-FR', { maximumFractionDigits: 1 }))}${rowI('CA par salarié', (u) => u.caParSalarie == null ? '–' : fmtM(u.caParSalarie))}</tbody></table></div></div>
      <div class="card"><div class="card-header"><span class="card-title">🔎 Lecture</span></div><ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.8">${lect.map((l) => '<li>' + l + '</li>').join('')}</ul>
      ${note('Coût d\'acquisition = marketing + salaires des postes cochés « Acquisition » (onglet Hypothèses), divisés par les nouveaux clients ; les commissions sont déjà déduites de la marge. Valeur d\'un client = marge de la 1re vente + maintenance des 4 années suivantes avec la rétention choisie.')}</div>`;
  }

  function tabProj() {
    const s = res.sans.annees, m = res.options[3].sim.annees;
    // colonne : [libellé, valeur, en gras, valeur brute (sans conversion en milliers)]
    const L = (lib, k, bold) => [lib, (x) => x[k], bold], neg = (lib, k) => [lib, (x) => -x[k]], B = (lib, k, bold) => [lib, (x) => x.bilan[k], bold];
    const clients = ['Nouveaux clients', (x) => x.clients.toLocaleString('fr-FR', { maximumFractionDigits: 1 }), false, true];
    const tab = (titre, A, cols) => `<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">${titre}</span></div><div style="overflow-x:auto"><table class="client-table" style="min-width:560px"><thead><tr><th></th>${A.map((x) => `<th style="text-align:right">An ${x.an}</th>`).join('')}</tr></thead><tbody>${cols.map((c) => `<tr style="${c[2] ? 'font-weight:700' : ''}"><td>${c[0]}</td>${A.map((x) => `<td style="text-align:right">${c[3] ? c[1](x) : fmt(c[1](x) / 1e3)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
    return note('Montants en milliers de ' + esc(base.devise) + '. États financiers simplifiés du plan financé (mix).')
      + tab('📈 Compte de résultat', m, [clients, L('Licences', 'lic'), L('Maintenance', 'maint'), L('Services', 'serv'), L('Chiffre d\'affaires', 'ca', true), neg('Coûts directs et commissions', 'directs'), neg('Salaires', 'sal'), neg('Marketing', 'mkt'), neg('Fixes et IA', 'fixes'), L('EBITDA', 'ebitda', true), neg('Intérêts', 'interet'), neg('Impôts', 'impot'), L('Résultat net', 'resultatNet', true)])
      + tab('💧 Flux de trésorerie', m, [L('Flux d\'exploitation', 'fExpl'), L('Flux de financement (apports, intérêts, remboursements)', 'fFin'), L('Variation de trésorerie', 'flux', true), L('Trésorerie en fin d\'année', 'tresoFin', true)])
      + tab('🏛️ Bilan simplifié', m, [B('Trésorerie', 'tresorerie'), B('Créances clients (besoin en fonds de roulement)', 'creances'), B('Total actif', 'actif', true), B('Capitaux propres', 'capitaux'), B('Dettes financières', 'dette'), B('Total passif', 'passif', true), [ 'Écart actif − passif (doit être nul)', (x) => x.bilan.actif - x.bilan.passif ]])
      + note('Bilan simplifié : à l\'ouverture, la société n\'a que de la trésorerie et des créances clients ; pas d\'immobilisations, de stocks ni de dettes fournisseurs. À remplacer par votre bilan réel (module Comptabilité) avant de présenter le dossier.')
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
    ['Capacité de remboursement', 'EBITDA divisé par le service de la dette (intérêts + capital remboursé). Un prêteur attend généralement au moins 1,2.'],
    ['Mix', 'Un montage qui combine capital, prêt et subvention selon les parts choisies.'],
    ['Créances clients', 'Ce que les clients doivent encore : facturé moins encaissé. Dans le bilan, elles forment le besoin en fonds de roulement (argent immobilisé en attendant d\'être payé).'],
    ['Revenu récurrent', 'Revenu qui revient chaque année sans nouvelle vente (maintenance, abonnement). Les financeurs le valorisent bien plus que les ventes ponctuelles.'],
    ['Coût d\'acquisition', 'Ce que coûte la conquête d\'un nouveau client : marketing et équipe d\'acquisition, divisés par le nombre de nouveaux clients.'],
    ['Valeur d\'un client', 'Marge qu\'un client rapporte sur 5 ans : marge de sa 1re vente plus maintenance des années suivantes. Un rapport valeur / coût d\'au moins 3 est un repère usuel.'],
    ['Partie liée', 'Client qui appartient à la société, à ses dirigeants ou à leurs proches. Les financeurs demandent de l\'isoler : ce chiffre d\'affaires est moins probant.']
  ];
  const LIMITES = ['Les valeurs initiales sont des exemples : seuls le nombre de clients, le prix moyen, la base installée et la commission viennent du CRM.', 'La croissance des ventes est une hypothèse : le modèle ne la relie pas automatiquement aux recrutements ou aux campagnes.',
    'Modèle simplifié : pas d\'amortissements, de TVA ni de stocks ; bilan d\'ouverture réduit à la trésorerie et aux créances clients ; impôt calculé sur le résultat avec report des pertes.', 'Ces projections ne sont ni une garantie de résultat ni un conseil financier : à faire valider par un expert-comptable.'];

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
    const seuilTxt = (x, lib, fmtv, unite) => !x ? `<li>${lib} : hors de portée avec la structure de coûts actuelle.</li>` : x.deja ? `<li>${lib} : déjà atteint avec vos hypothèses.</li>` : `<li>${lib} : au moins <b>${fmtv(x.valeur)}</b> ${unite} (soit <b>+${pct(x.facteur - 1)}</b>).</li>`;
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
    return `${alerte}${note('Le dossier reprend la synthèse, le besoin, les projections et les options. <b>Aucune donnée de client</b> n\'y figure : seulement des totaux.')}<div class="card" style="margin-bottom:16px"><label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:13px"><input type="checkbox" data-k="valide" ${h.valide ? 'checked' : ''} style="margin-top:3px"><span><b>J'ai vérifié et validé toutes les hypothèses</b> (ventes, coûts, équipe, conditions de financement). Cochez seulement quand chaque valeur reflète votre réalité ou votre décision.</span></label></div><div class="card"><div class="flex gap-3" style="flex-wrap:wrap">
      <button class="btn btn-primary" data-act="pdf">🖨️ Dossier PDF (imprimer)</button><button class="btn btn-outline" data-act="csv">📥 Tableur (CSV pour Excel)</button></div>
      ${note('Le dossier s\'ouvre dans un nouvel onglet : utilisez « Imprimer » puis « Enregistrer au format PDF ». Le tableur contient les projections annuelles, la comparaison des options et le détail mensuel.')}</div>`;
  }

  /* — exports — */
  function csv() {
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"', R = (a) => a.map((v) => typeof v === 'number' ? String(Math.round(v)).replace('.', ',') : q(v)).join(';');
    const keys = [['Nouveaux clients', 'clients'], ['Licences', 'lic'], ['Maintenance', 'maint'], ['Services', 'serv'], ['CA', 'ca'], ['Couts directs', 'directs'], ['Commissions', 'commissions'], ['IA', 'ia'], ['Marketing', 'mkt'], ['Salaires', 'sal'], ['Charges fixes', 'fixes'], ['EBITDA', 'ebitda'], ['Interets', 'interet'], ['Remboursement capital', 'princ'], ['Impots', 'impot'], ['Resultat net', 'resultatNet'], ['Flux de tresorerie', 'flux'], ['Tresorerie fin annee', 'tresoFin']];
    const L = [];
    if (!h.valide) { L.push(R(['DOCUMENT DE TRAVAIL : hypotheses indicatives non validees, ne pas diffuser'])); L.push(''); }
    const bloc = (titre, A) => { L.push(R([titre])); L.push(R(['Poste'].concat(A.map((x) => 'An ' + x.an)))); keys.forEach((k) => L.push(R([k[0]].concat(A.map((x) => x[k[1]] == null ? 0 : x[k[1]]))))); L.push(''); };
    bloc('Plan finance (mix)', res.options[3].sim.annees); bloc('Plan de croissance sans apport', res.avec0.annees); bloc('Sans financement', res.sans.annees);
    L.push(R(['Comparaison des options'])); L.push(R(['', 'Montant a lever', 'Tresorerie minimale', 'Tresorerie an 5', 'CA an 5', 'EBITDA an 5', 'Part cedee (%)', 'Multiple investisseur', 'TRI (%)', 'Interets payes', 'DSCR mini']));
    res.options.forEach((o) => L.push(R([o.label, o.montant, o.ind.tresoMin, o.ind.tresoFin, o.ind.ca5, o.ind.ebitda5, o.ind.equity ? Math.round(o.ind.equity.part * 1000) / 10 : '', o.ind.equity ? Math.round(o.ind.equity.moic * 10) / 10 : '', o.ind.equity ? Math.round(o.ind.equity.tri * 1000) / 10 : '', o.ind.dette ? o.ind.dette.totalInterets : '', o.ind.dette && o.ind.dette.dscrMin != null ? Math.round(o.ind.dette.dscrMin * 10) / 10 : ''])));
    L.push(''); L.push(R(['Detail mensuel (plan finance, mix)'])); L.push(R(['Mois', 'CA', 'Charges', 'EBITDA', 'Flux', 'Tresorerie']));
    res.options[3].sim.mois.forEach((x) => L.push(R([x.t + 1, x.ca, x.opex, x.ebitda, x.flux, x.treso])));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + L.join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = 'modele_financement.csv'; document.body.appendChild(a); a.click(); a.remove();
  }

  function dossierHtml() {
    const r = res, c = base, T = c.traction, A = T.tous, mix = r.options[3], a = mix.sim.annees, d = c.devise, U = calc.economieUnitaire(h, r.avec0);
    const K = (A2, k) => A2.map((x) => `<td style="text-align:right">${fmt(x[k] / 1e3)}</td>`).join(''), KB = (A2, k) => A2.map((x) => `<td style="text-align:right">${fmt(x.bilan[k] / 1e3)}</td>`).join('');
    const head = (A2) => `<thead><tr><th></th>${A2.map((x) => `<th style="text-align:right">An ${x.an}</th>`).join('')}</tr></thead>`;
    const opt = (o) => `<tr><td><b>${esc(o.label)}</b></td><td style="text-align:right">${fmtM(o.montant)}</td><td style="text-align:right">${o.ind.equity ? pct(o.ind.equity.part, 1) : '–'}</td><td style="text-align:right">${o.ind.equity ? o.ind.equity.moic.toFixed(1) + ' ×' : '–'}</td><td style="text-align:right">${o.ind.dette && o.ind.dette.dscrMin != null ? o.ind.dette.dscrMin.toFixed(1) + ' ×' : '–'}</td><td style="font-size:11px">${o.viable ? '' : '<b>Non viable. </b>'}${o.ind.alertes.map(esc).join(' ')}</td></tr>`;
    const brouillon = !h.valide, R = T.retraite;
    const css = '.wip{border:2px solid #c62828;color:#c62828;background:#fde5e5;padding:8px 12px;border-radius:8px;margin-bottom:14px;font-weight:700}.wm{position:fixed;top:42%;left:0;right:0;text-align:center;font-size:72px;font-weight:800;color:rgba(198,40,40,.09);transform:rotate(-25deg);pointer-events:none;z-index:0}body{font:13px/1.5 system-ui,Arial,sans-serif;color:#1b2240;max-width:900px;margin:0 auto;padding:24px}h1{font-size:24px;margin:0}h2{font-size:16px;margin:22px 0 8px;color:#0b3b4c;border-bottom:2px solid #0e7490;padding-bottom:4px}table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border-bottom:1px solid #d6e4ea;padding:6px 8px;text-align:left}th{background:#dff3f8;font-size:12px}.k{display:flex;gap:12px;flex-wrap:wrap}.k div{flex:1;min-width:150px;border:1px solid #d6e4ea;border-radius:10px;padding:10px}.k b{display:block;font-size:20px;color:#0e7490}.n{font-size:11px;color:#6b7390;margin-top:18px}@media print{body{padding:0}h2{break-after:avoid}table{break-inside:avoid}}';
    const lignes = r.emplois ? r.emplois.lignes.map((l) => `<tr><td>${esc(l[0])}</td><td style="text-align:right">${fmt(l[1])}</td><td style="text-align:right">${pct(l[1] / r.emplois.depenses)}</td></tr>`).join('') : '';
    const tr = (lib, v1, v2) => `<tr><td>${lib}</td><td style="text-align:right">${v1}</td><td style="text-align:right">${v2}</td></tr>`;
    const ui2 = (lib, f) => `<tr><td>${lib}</td>${U.map((u) => `<td style="text-align:right">${f(u)}</td>`).join('')}</tr>`;
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Dossier de financement — ${esc(c.societe)}</title><style>${css}</style></head><body>${brouillon ? '<div class="wip">DOCUMENT DE TRAVAIL — hypothèses indicatives non validées. Ne pas diffuser à des financeurs.</div><div class="wm">DOCUMENT DE TRAVAIL</div>' : ''}
      <h1>${esc(c.societe)}</h1><p style="margin:2px 0 0;color:#6b7390">Dossier de financement · ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <h2>1. Situation actuelle</h2><div class="k"><div><b>${fmtM(c.ca12m)} ${esc(d)}</b>CA HT, 12 derniers mois</div><div><b>${c.commandes12m}</b>commandes sur 12 mois</div><div><b>${c.clients}</b>clients actifs</div><div><b>${fmtM(c.pipelinePondere)} ${esc(d)}</b>pipeline pondéré (${c.prospects} prospects)</div><div><b>${c.produits}</b>produits au catalogue</div></div>
      <h2>2. Qualité des chiffres</h2><p>Chiffres réels issus des commandes du CRM (hors brouillons et commandes annulées). Les montants encaissés correspondent aux acomptes et règlements saisis.</p>
      <table><thead><tr><th></th><th style="text-align:right">Tous les clients</th><th style="text-align:right">Hors parties liées</th></tr></thead><tbody>${tr('Clients facturés', A.clients, R.clients)}${tr('Facturé HT', fmtM(A.factureHT) + ' ' + esc(d), fmtM(R.factureHT) + ' ' + esc(d))}${tr('Facturé HT, 12 derniers mois', fmtM(A.ht12), fmtM(R.ht12))}${tr('Encaissé (part du facturé TTC)', pct(A.taux), pct(R.taux))}${tr('Créances clients', fmtM(A.creance), fmtM(R.creance))}${tr('Part du revenu récurrent', pct(A.partRecurrent), pct(R.partRecurrent))}</tbody></table>
      <p>Concentration : le premier client représente ${pct(T.top1)} du facturé, les deux premiers ${pct(T.top2)}. ${T.nbLies > 0 ? `Les clients liés à la société ou à ses dirigeants représentent ${pct(T.partLies)} du facturé ; ils sont isolés dans la colonne « hors parties liées ».` : 'Aucun client n\'est déclaré lié à la société ou à ses dirigeants.'}${T.encaisseNature > 0 ? ` Des règlements en nature (${fmtM(T.encaisseNature)} ${esc(d)}) sont isolés de l'encaissé monétaire.` : ''} Créances de plus de 90 jours : ${fmtM(T.ages.plus)} ${esc(d)}.</p>
      <h2>3. Besoin de financement</h2>${r.avec0.pointMort === null ? '<p style="border:2px solid #c62828;padding:8px;border-radius:8px;color:#c62828"><b>Attention :</b> dans les hypothèses retenues, le plan n\'atteint pas la rentabilité sur 5 ans. À corriger avant toute remise à un financeur.</p>' : `<p>Rentabilité durable atteinte en ${moisLabel(r.avec0.pointMort)}.</p>`}<p>${r.besoin > 0 ? `Pour déployer le plan de croissance, la société a besoin de <b>${fmt(r.besoin)} ${esc(d)}</b> (point bas de trésorerie en ${moisLabel(r.avec0.moisMin)}). Avec une marge de sécurité de ${fmt(h.margeSecuritePct)} %, le montant recherché est de <b>${fmt(r.recommande)} ${esc(d)}</b>.` : 'Le plan de croissance s\'autofinance : aucun apport n\'est nécessaire dans les hypothèses retenues.'}</p>
      ${r.emplois ? `<table><thead><tr><th>Utilisation des fonds (jusqu'au point bas, ${r.emplois.mois} mois)</th><th style="text-align:right">${esc(d)}</th><th style="text-align:right">Part</th></tr></thead><tbody>${lignes}<tr><td>Encaissements sur la période</td><td style="text-align:right">− ${fmt(r.emplois.recu)}</td><td></td></tr><tr><td><b>Besoin de financement</b></td><td style="text-align:right"><b>${fmt(r.emplois.besoin)}</b></td><td></td></tr></tbody></table>` : ''}
      <h2>4. Projections et états financiers (milliers de ${esc(d)})</h2><table>${head(a)}<tbody><tr><td>Chiffre d'affaires</td>${K(a, 'ca')}</tr><tr><td>EBITDA</td>${K(a, 'ebitda')}</tr><tr><td>Résultat net</td>${K(a, 'resultatNet')}</tr><tr><td>Flux d'exploitation</td>${K(a, 'fExpl')}</tr><tr><td>Flux de financement</td>${K(a, 'fFin')}</tr><tr><td><b>Trésorerie fin d'année</b></td>${K(a, 'tresoFin')}</tr></tbody></table>
      <table>${head(a)}<tbody><tr><td>Trésorerie</td>${KB(a, 'tresorerie')}</tr><tr><td>Créances clients</td>${KB(a, 'creances')}</tr><tr><td><b>Total actif</b></td>${KB(a, 'actif')}</tr><tr><td>Capitaux propres</td>${KB(a, 'capitaux')}</tr><tr><td>Dettes financières</td>${KB(a, 'dette')}</tr><tr><td><b>Total passif</b></td>${KB(a, 'passif')}</tr></tbody></table>
      <p style="font-size:11px;color:#6b7390">Bilan simplifié : ouverture réduite à la trésorerie et aux créances clients, sans immobilisations ni stocks. Plan financé selon le mix choisi.</p>
      <p>Sans financement, le chiffre d'affaires de l'année 5 serait de ${fmtM(r.sans.annees[ANNEES - 1].ca)} ${esc(d)}, contre ${fmtM(a[ANNEES - 1].ca)} ${esc(d)} avec le plan de croissance.</p>
      <h2>5. Indicateurs et économie unitaire</h2><table><thead><tr><th></th>${U.map((u) => `<th style="text-align:right">An ${u.an}</th>`).join('')}</tr></thead><tbody>${ui2('Nouveaux clients', (u) => u.clients.toLocaleString('fr-FR', { maximumFractionDigits: 1 }))}${ui2('Marge brute', (u) => pct(u.margeBrute))}${ui2('Revenu récurrent annualisé', (u) => fmtM(u.arr))}${ui2('Part du revenu récurrent', (u) => pct(u.partRecurrente))}${ui2('Coût d\'acquisition d\'un client', (u) => u.cac == null ? '–' : fmt(u.cac))}${ui2('Valeur d\'un client sur 5 ans', (u) => fmt(u.ltv))}${ui2('Valeur client / coût d\'acquisition', (u) => u.ltvCac == null ? '–' : u.ltvCac.toFixed(1) + ' ×')}${ui2('Délai de retour', (u) => u.retour == null ? '–' : u.retour === 0 ? 'immédiat' : Math.round(u.retour) + ' mois')}${ui2('CA par salarié', (u) => u.caParSalarie == null ? '–' : fmtM(u.caParSalarie))}</tbody></table>
      <h2>6. Options de financement</h2><table><thead><tr><th>Option</th><th style="text-align:right">Montant</th><th style="text-align:right">Part cédée</th><th style="text-align:right">Multiple investisseur</th><th style="text-align:right">Capacité de remboursement</th><th>Points d'attention</th></tr></thead><tbody>${r.options.map(opt).join('')}</tbody></table>
      <h2>7. Tour de table</h2>${tourHtml('')}
      <h2>8. Hypothèses principales</h2><ul><li>Scénario de croissance « ${esc(SCEN_LABEL[h.scenario] || 'personnalisé')} » : nouveaux clients +${h.croiss.join(' %, +')} % par an (année 1 : ${fmt(h.clientsAn1)} clients).</li><li>Prix moyen d'une licence : ${fmt(h.prixLicence)} ${esc(d)} HT (hausse de ${h.hausseAn} % par an) ; maintenance ${h.maintenancePct} % de la base installée ; services ${h.servicesPct} % des licences.</li><li>Équipe : ${h.postes.filter((p) => p.finance).map((p) => `${p.nb} ${esc(p.nom)}`).join(', ') || 'aucune embauche'} financé(s) par l'apport.</li><li>Sortie investisseur supposée à l'année 5 à ${h.multSortie} × le chiffre d'affaires.</li>${h.baseRetraitee ? '<li>Base de départ calculée hors clients liés à la société.</li>' : ''}</ul>
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
        Object.keys(h2).forEach((k) => { if (JSON.stringify(h2[k]) !== JSON.stringify(h[k])) edit(k, clone(h2[k])); });
        edit('valide', false); render();
      };
      if (a === 'levier') { const l = LEVIERS.filter((x) => x.id === t.dataset.id)[0]; if (l) appliquer(Object.assign({}, h, l.f(h)), 'Appliquer : ' + l.lib + ' (' + l.test + ')'); }
      else if (a === 'plan') { const c = calc.optimiser(h).combine; if (c.etapes.length) appliquer(c.h, 'Appliquer le plan combiné (' + c.etapes.length + ' leviers)'); }
      else if (a === 'csv') csv(); else if (a === 'pdf') pdf();
      else if (a === 'reset') { if (confirm('Revenir aux valeurs initiales ? Vos hypothèses modifiées seront effacées ; le marquage des parties liées et des règlements en nature est conservé.')) { const liens = ov.liens; ov = liens ? { liens } : {}; persist(); recompute(); render(); } }
      else if (a === 'associe-add') { if (!('associes' in ov)) ov.associes = clone(h.associes); ov.associes.push({ id: 'a' + Date.now().toString(36), nom: 'Nouvel associé', part: 0 }); persist(); recompute(); render(); }
      else if (a === 'associe-del') { if (!('associes' in ov)) ov.associes = clone(h.associes); ov.associes = ov.associes.filter((x) => x.id !== t.dataset.id); persist(); recompute(); render(); }
      else if (a === 'poste-add') { if (!('postes' in ov)) ov.postes = clone(h.postes); ov.postes.push({ id: 'p' + Date.now().toString(36), nom: 'Nouveau poste', nb: 1, cout: 300000, debut: 6, finance: true }); persist(); recompute(); render(); }
      else if (a === 'poste-del') { if (!('postes' in ov)) ov.postes = clone(h.postes); ov.postes = ov.postes.filter((p) => p.id !== t.dataset.id); persist(); recompute(); render(); }
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
      else if (t.dataset.p) { editPoste(t.dataset.p, t.dataset.f, t.dataset.f === 'nom' ? t.value : valeur(t)); render(); }
      else if (t.dataset.lien !== undefined) { editLien(t.dataset.lien, t.dataset.f, t.checked); render(); }
      else if (t.dataset.a) { editAssocie(t.dataset.a, t.dataset.f, t.dataset.f === 'nom' ? t.value : valeur(t)); render(); }
      else if (t.dataset.k && !t.closest('#fin-ctl')) { edit(t.dataset.k, valeur(t)); if (t.dataset.k.indexOf('croiss.') === 0) edit('scenario', 'perso'); render(); }
    });
  }
  G.initFinancement = function () { if (!ov) load(); recompute(); bind(); render(); };
  G.SanixFinancement.refresh = function () { if (ov && visible()) { recompute(); render(); } };
})(typeof window !== 'undefined' ? window : globalThis);
