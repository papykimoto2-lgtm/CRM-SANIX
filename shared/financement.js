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
  const pos = (v) => Math.max(0, num(v));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, num(v)));
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);

  /* ───────────── Hypothèses ───────────── */
  /** Valeurs initiales : tirées du CRM quand il contient la donnée, sinon exemples indicatifs à adapter. */
  function defauts(base) {
    base = base || {};
    const nb = Math.round(pos(base.commandes12m));
    return {
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
        { id: 'p3', nom: 'Commerciaux', nb: 3, cout: 300000, debut: 3, finance: true },
        { id: 'p4', nom: 'Responsable marketing', nb: 1, cout: 500000, debut: 4, finance: true },
        { id: 'p5', nom: 'Support & déploiement', nb: 2, cout: 300000, debut: 6, finance: true }
      ],
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
    let reste = 0, pool = 0, treso = num(h.tresoDepart);
    for (let t = 0; t < N; t++) {
      const r = m[t], y = r.y;
      r.directs = pos(h.directsPct) / 100 * r.ca;
      r.commissions = pos(h.commissionPct) / 100 * r.lic;
      r.ia = pos(h.iaMensuel);
      r.mkt = Math.max(pos(h.marketingPct) / 100 * r.ca, pos(h.marketingMin)) + (avec ? pos(h.marketingBoost) : 0);
      r.sal = sum(h.postes, (p) => ((avec || !p.finance) && t >= num(p.debut)) ? pos(p.nb) * pos(p.cout) * cs * Math.pow(1 + num(h.augmentationSalairesPct) / 100, y) : 0);
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
    }
    const annees = [];
    for (let y = 0; y < ANNEES; y++) {
      const s = m.slice(y * 12, y * 12 + 12), f = (k) => sum(s, (x) => x[k]);
      const a = { an: y + 1, clients: f('clients'), lic: f('lic'), maint: f('maint'), serv: f('serv'), ca: f('ca'), directs: f('directs'), commissions: f('commissions'),
        ia: f('ia'), mkt: f('mkt'), sal: f('sal'), fixes: f('fixes'), opex: f('opex'), ebitda: f('ebitda'), interet: f('interet'), princ: f('princ'), impot: f('impot'),
        flux: f('flux'), tresoFin: s[11].treso };
      a.resultatNet = a.ebitda - a.interet - a.impot; a.margeEbitda = a.ca > 0 ? a.ebitda / a.ca : 0;
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

  const calc = { N, ANNEES, SCEN, SCEN_LABEL, OPT_LABEL, defauts, simuler, structure, dimensionner, indicateurs, comparer, emplois, preMoney };
  G.SanixFinancement = { calc };
  if (typeof module !== 'undefined' && module.exports) module.exports = { calc };
  if (!G.document) return;

  /* ───────────── Écran (navigateur) ───────────── */
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Math.round(num(n)).toLocaleString('fr-FR');
  const fmtM = (n) => (num(n) / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M';
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
    const P = G.SanixPilotage && G.SanixPilotage.calc, cmds = g(() => COMMANDES) || [], deals = g(() => DEALS) || [], cl = g(() => CLIENTS) || [];
    const statuts = P ? P.CA_STATUTS : ['confirmee', 'en_cours', 'livree'], ok = cmds.filter((c) => c && statuts.indexOf(c.statut) >= 0);
    const now = new Date(), nowKey = monthKey(now), since = P ? P.addMonths(nowKey, -11) : monthKey(new Date(now.getFullYear(), now.getMonth() - 11, 1));
    const r12 = ok.filter((c) => String(c.date || '').slice(0, 7) >= since);
    const caTotal = sum(ok, (c) => pos(c.htNet)), ca12m = sum(r12, (c) => pos(c.htNet));
    let pond = 0, brut = 0;
    if (P) { const p = P.pipeline(deals, nowKey); Object.keys(p).forEach((k) => { pond += p[k].pondere; brut += p[k].brut; }); }
    return { caTotal, ca12m, commandes12m: r12.length, commandesTotal: ok.length, prixMoyen: r12.length ? ca12m / r12.length : (ok.length ? caTotal / ok.length : 0),
      pipelinePondere: pond, pipelineBrut: brut, clients: cl.filter((c) => c && c.statut === 'client').length, produits: (g(() => LOGICIELS) || []).filter((l) => l && l.actif !== false).length,
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
      <td style="text-align:center"><input type="checkbox" data-p="${esc(p.id)}" data-f="finance" ${p.finance ? 'checked' : ''}></td><td><button class="btn btn-outline btn-sm" data-act="poste-del" data-id="${esc(p.id)}" aria-label="Supprimer ce poste">🗑</button></td></tr>`;
    return `<div class="alert alert-warn" role="note">⚠️ Les valeurs initiales sont <b>indicatives</b> : seuls le nombre de clients, le prix moyen, la base installée et la commission viennent du CRM. Vérifiez chaque hypothèse avant de remettre le dossier à un financeur.</div>
      ${bloc('📊 Point de départ (lu dans le CRM)', `<div class="stats-grid" style="margin:0">${stat('CA HT réalisé, 12 mois', fmtM(c.ca12m), c.commandes12m + ' commandes', 'blue')}${stat('CA HT cumulé', fmtM(c.caTotal), c.commandesTotal + ' commandes', 'green')}${stat('Pipeline pondéré', fmtM(c.pipelinePondere), 'Brut : ' + fmtM(c.pipelineBrut), 'orange')}${stat('Clients actifs', c.clients, c.produits + ' produits au catalogue', 'purple')}</div>`)}
      ${bloc('🚀 Ventes', grid(field('Nouveaux clients, année 1', 'clientsAn1', h.clientsAn1) + field('Prix moyen HT par licence', 'prixLicence', h.prixLicence) + field('Hausse annuelle des prix (%)', 'hausseAn', h.hausseAn) + field('Maintenance (% de la base installée / an)', 'maintenancePct', h.maintenancePct) + field('Rétention des clients (% / an)', 'retentionPct', h.retentionPct) + field('Services : installation, formation (% des licences)', 'servicesPct', h.servicesPct) + field('Base installée (CA HT déjà vendu)', 'baseInstallee', h.baseInstallee) + field('Délai d\'encaissement (mois)', 'delaiEncaissement', h.delaiEncaissement, { min: 0 })) + '<h4 style="margin:14px 0 8px;font-size:13px">Croissance du nombre de nouveaux clients — avec financement</h4>' + grid(an('croiss', 'Croissance')) + '<h4 style="margin:14px 0 8px;font-size:13px">Sans financement (l\'activité actuelle, limitée par les moyens)</h4>' + grid(an('croissSans', 'Croissance')))}
      ${bloc('💸 Coûts', grid(field('Coûts directs (% du CA) : hébergement, outils', 'directsPct', h.directsPct) + field('Commissions (% des licences)', 'commissionPct', h.commissionPct) + field('Intelligence artificielle (par mois)', 'iaMensuel', h.iaMensuel) + field('Marketing (% du CA)', 'marketingPct', h.marketingPct) + field('Marketing minimum (par mois)', 'marketingMin', h.marketingMin) + field('Campagnes financées (par mois)', 'marketingBoost', h.marketingBoost) + field('Charges fixes (par mois)', 'fixesMensuels', h.fixesMensuels) + field('Charges sociales (%)', 'chargesSocialesPct', h.chargesSocialesPct) + field('Augmentation annuelle des salaires (%)', 'augmentationSalairesPct', h.augmentationSalairesPct) + field('Impôt sur les sociétés (%)', 'impotPct', h.impotPct) + field('Trésorerie actuelle', 'tresoDepart', h.tresoDepart)))}
      ${bloc('👥 Équipe', note('Coût mensuel brut par personne. « Financé » : poste créé grâce au financement (absent du scénario sans financement). « Début » : mois de prise de poste (0 = déjà en place).') + `<div style="overflow-x:auto"><table class="client-table" style="min-width:560px"><thead><tr><th>Poste</th><th>Nombre</th><th>Coût mensuel</th><th>Début (mois)</th><th>Financé</th><th></th></tr></thead><tbody>${h.postes.map(poste).join('')}</tbody></table></div><button class="btn btn-outline btn-sm" data-act="poste-add" style="margin-top:10px">+ Ajouter un poste</button>`)}
      ${bloc('🏦 Conditions de financement', grid(field('Valorisation avant apport (vide = automatique)', 'preMoney', ov.preMoney, { min: 0 }) + field('Multiple d\'entrée (× CA année 1)', 'multEntree', h.multEntree) + field('Multiple de sortie (× CA année 5)', 'multSortie', h.multSortie) + field('Taux du prêt (% / an)', 'taux', h.taux) + field('Durée du prêt (mois)', 'dureeMois', h.dureeMois, { min: 1 }) + field('Différé de remboursement (mois)', 'differeMois', h.differeMois, { min: 0 })))}
      <button class="btn btn-outline btn-sm" data-act="reset">↺ Revenir aux valeurs initiales</button>`;
  }

  /* — onglet Projections — */
  function tabProj() {
    const a = res.avec0.annees, s = res.sans.annees, m = res.options[3].sim.annees;
    // colonne : [libellé, valeur, en gras, valeur brute (sans conversion en milliers)]
    const L = (lib, k, bold) => [lib, (x) => x[k], bold], neg = (lib, k) => [lib, (x) => -x[k]];
    const clients = ['Nouveaux clients', (x) => x.clients.toLocaleString('fr-FR', { maximumFractionDigits: 1 }), false, true];
    const tab = (titre, A, cols) => `<div class="card" style="margin-bottom:16px"><div class="card-header"><span class="card-title">${titre}</span></div><div style="overflow-x:auto"><table class="client-table" style="min-width:560px"><thead><tr><th></th>${A.map((x) => `<th style="text-align:right">An ${x.an}</th>`).join('')}</tr></thead><tbody>${cols.map((c) => `<tr style="${c[2] ? 'font-weight:700' : ''}"><td>${c[0]}</td>${A.map((x) => `<td style="text-align:right">${c[3] ? c[1](x) : fmt(c[1](x) / 1e3)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
    return note('Montants en milliers de ' + esc(base.devise) + '. Compte de résultat simplifié et trésorerie.')
      + tab('📈 Plan de croissance financé (mix)', m, [clients, L('Licences', 'lic'), L('Maintenance', 'maint'), L('Services', 'serv'), L('Chiffre d\'affaires', 'ca', true), neg('Coûts directs et commissions', 'directs'), neg('Salaires', 'sal'), neg('Marketing', 'mkt'), neg('Fixes et IA', 'fixes'), L('EBITDA', 'ebitda', true), neg('Intérêts', 'interet'), neg('Impôts', 'impot'), L('Résultat net', 'resultatNet', true), L('Trésorerie en fin d\'année', 'tresoFin', true)])
      + tab('🅰️ Sans financement (activité actuelle)', s, [L('Chiffre d\'affaires', 'ca', true), L('EBITDA', 'ebitda'), L('Résultat net', 'resultatNet'), L('Trésorerie en fin d\'année', 'tresoFin', true)]);
  }

  /* — onglet Dossier — */
  function tabDossier() {
    return `${note('Le dossier reprend la synthèse, le besoin, les projections et les options. <b>Aucune donnée de client</b> n\'y figure : seulement des totaux.')}<div class="card"><div class="flex gap-3" style="flex-wrap:wrap">
      <button class="btn btn-primary" data-act="pdf">🖨️ Dossier PDF (imprimer)</button><button class="btn btn-outline" data-act="csv">📥 Tableur (CSV pour Excel)</button></div>
      ${note('Le dossier s\'ouvre dans un nouvel onglet : utilisez « Imprimer » puis « Enregistrer au format PDF ». Le tableur contient les projections annuelles, la comparaison des options et le détail mensuel.')}</div>`;
  }

  /* — exports — */
  function csv() {
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"', R = (a) => a.map((v) => typeof v === 'number' ? String(Math.round(v)).replace('.', ',') : q(v)).join(';');
    const keys = [['Nouveaux clients', 'clients'], ['Licences', 'lic'], ['Maintenance', 'maint'], ['Services', 'serv'], ['CA', 'ca'], ['Couts directs', 'directs'], ['Commissions', 'commissions'], ['IA', 'ia'], ['Marketing', 'mkt'], ['Salaires', 'sal'], ['Charges fixes', 'fixes'], ['EBITDA', 'ebitda'], ['Interets', 'interet'], ['Remboursement capital', 'princ'], ['Impots', 'impot'], ['Resultat net', 'resultatNet'], ['Flux de tresorerie', 'flux'], ['Tresorerie fin annee', 'tresoFin']];
    const L = [];
    const bloc = (titre, A) => { L.push(R([titre])); L.push(R(['Poste'].concat(A.map((x) => 'An ' + x.an)))); keys.forEach((k) => L.push(R([k[0]].concat(A.map((x) => x[k[1]] == null ? 0 : x[k[1]]))))); L.push(''); };
    bloc('Plan finance (mix)', res.options[3].sim.annees); bloc('Plan de croissance sans apport', res.avec0.annees); bloc('Sans financement', res.sans.annees);
    L.push(R(['Comparaison des options'])); L.push(R(['', 'Montant a lever', 'Tresorerie minimale', 'Tresorerie an 5', 'CA an 5', 'EBITDA an 5', 'Part cedee (%)', 'Multiple investisseur', 'TRI (%)', 'Interets payes', 'DSCR mini']));
    res.options.forEach((o) => L.push(R([o.label, o.montant, o.ind.tresoMin, o.ind.tresoFin, o.ind.ca5, o.ind.ebitda5, o.ind.equity ? Math.round(o.ind.equity.part * 1000) / 10 : '', o.ind.equity ? Math.round(o.ind.equity.moic * 10) / 10 : '', o.ind.equity ? Math.round(o.ind.equity.tri * 1000) / 10 : '', o.ind.dette ? o.ind.dette.totalInterets : '', o.ind.dette && o.ind.dette.dscrMin != null ? Math.round(o.ind.dette.dscrMin * 10) / 10 : ''])));
    L.push(''); L.push(R(['Detail mensuel (plan finance, mix)'])); L.push(R(['Mois', 'CA', 'Charges', 'EBITDA', 'Flux', 'Tresorerie']));
    res.options[3].sim.mois.forEach((x) => L.push(R([x.t + 1, x.ca, x.opex, x.ebitda, x.flux, x.treso])));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + L.join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = 'modele_financement.csv'; document.body.appendChild(a); a.click(); a.remove();
  }

  function dossierHtml() {
    const r = res, c = base, mix = r.options[3], a = mix.sim.annees, d = c.devise, T = (A, k) => A.map((x) => `<td style="text-align:right">${fmt(x[k] / 1e3)}</td>`).join('');
    const opt = (o) => `<tr><td><b>${esc(o.label)}</b></td><td style="text-align:right">${fmtM(o.montant)}</td><td style="text-align:right">${o.ind.equity ? pct(o.ind.equity.part, 1) : '–'}</td><td style="text-align:right">${o.ind.equity ? o.ind.equity.moic.toFixed(1) + ' ×' : '–'}</td><td style="text-align:right">${o.ind.dette && o.ind.dette.dscrMin != null ? o.ind.dette.dscrMin.toFixed(1) + ' ×' : '–'}</td><td style="font-size:11px">${o.viable ? '' : '<b>Non viable. </b>'}${o.ind.alertes.map(esc).join(' ')}</td></tr>`;
    const css = 'body{font:13px/1.5 system-ui,Arial,sans-serif;color:#1b2240;max-width:900px;margin:0 auto;padding:24px}h1{font-size:24px;margin:0}h2{font-size:16px;margin:22px 0 8px;color:#0b3b4c;border-bottom:2px solid #0e7490;padding-bottom:4px}table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border-bottom:1px solid #d6e4ea;padding:6px 8px;text-align:left}th{background:#dff3f8;font-size:12px}.k{display:flex;gap:12px;flex-wrap:wrap}.k div{flex:1;min-width:150px;border:1px solid #d6e4ea;border-radius:10px;padding:10px}.k b{display:block;font-size:20px;color:#0e7490}.n{font-size:11px;color:#6b7390;margin-top:18px}@media print{body{padding:0}h2{break-after:avoid}table{break-inside:avoid}}';
    const lignes = r.emplois ? r.emplois.lignes.map((l) => `<tr><td>${esc(l[0])}</td><td style="text-align:right">${fmt(l[1])}</td><td style="text-align:right">${pct(l[1] / r.emplois.depenses)}</td></tr>`).join('') : '';
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Dossier de financement — ${esc(c.societe)}</title><style>${css}</style></head><body>
      <h1>${esc(c.societe)}</h1><p style="margin:2px 0 0;color:#6b7390">Dossier de financement · ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <h2>1. Situation actuelle</h2><div class="k"><div><b>${fmtM(c.ca12m)} ${esc(d)}</b>CA HT, 12 derniers mois</div><div><b>${c.commandes12m}</b>commandes sur 12 mois</div><div><b>${c.clients}</b>clients actifs</div><div><b>${fmtM(c.pipelinePondere)} ${esc(d)}</b>pipeline pondéré</div><div><b>${c.produits}</b>produits au catalogue</div></div>
      <h2>2. Besoin de financement</h2>${r.avec0.pointMort === null ? '<p style="border:2px solid #c62828;padding:8px;border-radius:8px;color:#c62828"><b>Attention :</b> dans les hypothèses retenues, le plan n\'atteint pas la rentabilité sur 5 ans. À corriger avant toute remise à un financeur.</p>' : `<p>Rentabilité durable atteinte en ${moisLabel(r.avec0.pointMort)}.</p>`}<p>${r.besoin > 0 ? `Pour déployer le plan de croissance, la société a besoin de <b>${fmt(r.besoin)} ${esc(d)}</b> (point bas de trésorerie en ${moisLabel(r.avec0.moisMin)}). Avec une marge de sécurité de ${fmt(h.margeSecuritePct)} %, le montant recherché est de <b>${fmt(r.recommande)} ${esc(d)}</b>.` : 'Le plan de croissance s\'autofinance : aucun apport n\'est nécessaire dans les hypothèses retenues.'}</p>
      ${r.emplois ? `<table><thead><tr><th>Utilisation des fonds (jusqu'au point bas, ${r.emplois.mois} mois)</th><th style="text-align:right">${esc(d)}</th><th style="text-align:right">Part</th></tr></thead><tbody>${lignes}<tr><td>Encaissements sur la période</td><td style="text-align:right">− ${fmt(r.emplois.recu)}</td><td></td></tr><tr><td><b>Besoin de financement</b></td><td style="text-align:right"><b>${fmt(r.emplois.besoin)}</b></td><td></td></tr></tbody></table>` : ''}
      <h2>3. Projections sur 5 ans (milliers de ${esc(d)})</h2><table><thead><tr><th></th>${a.map((x) => `<th style="text-align:right">An ${x.an}</th>`).join('')}</tr></thead><tbody><tr><td>Chiffre d'affaires</td>${T(a, 'ca')}</tr><tr><td>EBITDA</td>${T(a, 'ebitda')}</tr><tr><td>Résultat net</td>${T(a, 'resultatNet')}</tr><tr><td>Trésorerie fin d'année</td>${T(a, 'tresoFin')}</tr></tbody></table>
      <p>Sans financement, le chiffre d'affaires de l'année 5 serait de ${fmtM(r.sans.annees[ANNEES - 1].ca)} ${esc(d)}, contre ${fmtM(a[ANNEES - 1].ca)} ${esc(d)} avec le plan de croissance.</p>
      <h2>4. Options de financement</h2><table><thead><tr><th>Option</th><th style="text-align:right">Montant</th><th style="text-align:right">Part cédée</th><th style="text-align:right">Multiple investisseur</th><th style="text-align:right">Capacité de remboursement</th><th>Points d'attention</th></tr></thead><tbody>${r.options.map(opt).join('')}</tbody></table>
      <h2>5. Hypothèses principales</h2><ul><li>Scénario de croissance « ${esc(SCEN_LABEL[h.scenario] || 'personnalisé')} » : nouveaux clients +${h.croiss.join(' %, +')} % par an (année 1 : ${fmt(h.clientsAn1)} clients).</li><li>Prix moyen d'une licence : ${fmt(h.prixLicence)} ${esc(d)} HT (hausse de ${h.hausseAn} % par an) ; maintenance ${h.maintenancePct} % de la base installée ; services ${h.servicesPct} % des licences.</li><li>Équipe : ${h.postes.filter((p) => p.finance).map((p) => `${p.nb} ${esc(p.nom)}`).join(', ') || 'aucune embauche'} financé(s) par l'apport.</li><li>Sortie investisseur supposée à l'année 5 à ${h.multSortie} × le chiffre d'affaires.</li></ul>
      <p class="n">Ces projections reposent sur des hypothèses de la direction ; elles ne constituent ni une garantie de résultat ni une offre de titres financiers. Les données de départ proviennent du CRM de la société.</p></body></html>`;
  }
  function pdf() { const w = window.open('', '_blank'); if (!w) { toast('⚠️ Autorisez les fenêtres pop-up pour ouvrir le dossier'); return; } w.document.write(dossierHtml()); w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* impression manuelle */ } }, 400); }

  /* — assemblage — */
  function render() {
    const host = root(); if (!host) return;
    let el = host.querySelector(':scope > #fin-body'); if (!el) { el = document.createElement('div'); el.id = 'fin-body'; host.appendChild(el); }
    const tabs = [['synthese', '📊 Synthèse'], ['hyp', '🧮 Hypothèses'], ['proj', '📈 Projections'], ['dossier', '📄 Dossier']];
    el.innerHTML = `<div class="ban"><div class="ban-deco"></div><h1 class="page-title">🏦 Financement</h1><p class="page-sub">Modèle financier sur 5 ans : besoin de financement, options et dossier pour les financeurs — départ : vos chiffres réels du CRM</p></div>
      <div class="tabs" role="tablist" style="margin-bottom:16px">${tabs.map((t) => `<div class="tab ${ui.tab === t[0] ? 'active' : ''}" role="tab" tabindex="0" aria-selected="${ui.tab === t[0]}" data-tab="${t[0]}">${t[1]}</div>`).join('')}</div>` +
      (ui.tab === 'hyp' ? tabHyp() : ui.tab === 'proj' ? tabProj() : ui.tab === 'dossier' ? tabDossier() : tabSynthese());
  }
  function bind() {
    const el = root(); if (!el || el.dataset.bound) return; el.dataset.bound = '1';
    const act = (t) => {
      if (t.dataset.tab) { ui.tab = t.dataset.tab; render(); return; }
      const a = t.dataset.act; if (!a) return;
      if (a === 'csv') csv(); else if (a === 'pdf') pdf();
      else if (a === 'reset') { if (confirm('Revenir aux valeurs initiales ? Vos hypothèses modifiées seront effacées.')) { ov = {}; persist(); recompute(); render(); } }
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
      else if (t.dataset.k && !t.closest('#fin-ctl')) { edit(t.dataset.k, valeur(t)); if (t.dataset.k.indexOf('croiss.') === 0) edit('scenario', 'perso'); render(); }
    });
  }
  G.initFinancement = function () { if (!ov) load(); recompute(); bind(); render(); };
  G.SanixFinancement.refresh = function () { if (ov && visible()) { recompute(); render(); } };
})(typeof window !== 'undefined' ? window : globalThis);
