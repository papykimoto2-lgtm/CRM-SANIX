/* SANIX CRM — Pilotage : suivi budgétaire, plan d'actions commercial, budget prévisionnel.
 *
 * Calculs purs (SanixPilotage.calc, testables sans navigateur) + écran « Budget & plan d'actions » (#view-budget).
 * Données : localStorage « sanix_crm_pil_depenses », « _pil_actions » et « _pil_config » (objectifs, hypothèses, taux), synchronisées avec
 * le serveur par le connecteur CRM (shared/crm-connector.js, entités pil_*) dès que la migration 20261112 est appliquée.
 * Serveur (SANIX AI) : coûts IA mensuels et propositions d'actions des agents, soumises à l'acceptation d'un opérateur.
 * Lit le CRM (DEALS, COMMANDES, CONFIG) sans jamais le modifier.
 */
(function () {
  'use strict';
  var CA_STATUTS = ['confirmee', 'en_cours', 'livree'];             // commandes comptées dans le CA réalisé (ni brouillon ni annulée)
  var PROBA = { prospect: 0.05, contact: 0.15, demo: 0.35, proposition: 0.55, negociation: 0.75 };
  var LAG = { prospect: 4, contact: 3, demo: 2, proposition: 1, negociation: 0 };   // mois avant signature, par étape
  var STATUTS = { a_faire: 'À faire', en_cours: 'En cours', fait: 'Fait', annule: 'Annulé' };
  var CATEGORIES = ['Déplacements', 'Outils & logiciels', 'Marketing', 'Commissions', 'Formation', 'Salaires commerciaux', 'Autre'];
  var MOIS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var num = function (v) { v = Number(v); return isFinite(v) && v > 0 ? v : 0; };
  var monthKey = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  var addMonths = function (key, n) { var y = +key.slice(0, 4), m = +key.slice(5, 7) - 1 + n; return new Date(y + Math.floor(m / 12), ((m % 12) + 12) % 12, 1); };
  var monthOf = function (s) { return /^\d{4}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 7) : null; };
  var uid = function (p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };

  /* ───────────── Calculs purs ───────────── */
  var calc = {
    monthKey: monthKey, addMonths: function (k, n) { return monthKey(addMonths(k, n)); }, PROBA: PROBA, LAG: LAG, CA_STATUTS: CA_STATUTS,

    /** CA réalisé par mois : commandes confirmées, en cours ou livrées (hors brouillon et annulées), sur leur date. */
    realise: function (commandes) {
      var out = {};
      (commandes || []).forEach(function (c) {
        var m = monthOf(c && c.date); if (!m || CA_STATUTS.indexOf(c.statut) < 0) return;
        out[m] = (out[m] || 0) + num(c.htNet);
      });
      return out;
    },

    /** Pipeline pondéré : valeur × probabilité de l'étape, placée dans le mois (mois courant + délai de l'étape). Gagné/perdu exclus. */
    pipeline: function (deals, nowKey, probas, lag) {
      var out = {}; probas = probas || PROBA; lag = lag || LAG;
      (deals || []).forEach(function (d) {
        var p = probas[d && d.stage]; if (p == null || !(num(d.valeur) > 0)) return;
        var m = monthKey(addMonths(nowKey, lag[d.stage] == null ? 3 : lag[d.stage]));
        var o = out[m] || (out[m] = { pondere: 0, brut: 0, n: 0 });
        o.pondere += num(d.valeur) * p; o.brut += num(d.valeur); o.n++;
      });
      return out;
    },

    /** Dépenses par mois : pour chaque ligne, le « réel » s'il est saisi, sinon le « prévu » (la somme est le « retenu »). */
    depenses: function (list) {
      var out = {};
      (list || []).forEach(function (x) {
        var m = monthOf(x && x.mois); if (!m) return;
        var o = out[m] || (out[m] = { prevu: 0, reel: 0, retenu: 0 });
        o.prevu += num(x.prevu); o.reel += num(x.reel);
        o.retenu += num(x.reel) > 0 ? num(x.reel) : num(x.prevu);          // ligne par ligne : le réel remplace le prévu de CETTE ligne seulement
      });
      return out;
    },

    /** Suivi budgétaire d'une année : objectif, réalisé, écart, taux d'atteinte, dépenses prévues/réelles, solde. */
    suivi: function (st, year, ctx) {
      var re = calc.realise(ctx.commandes), dep = calc.depenses(st.depenses), rows = [];
      for (var i = 1; i <= 12; i++) {
        var m = year + '-' + pad(i), obj = num(st.objectifs && st.objectifs[m]) || num(ctx.objectifDefaut);
        var r = re[m] || 0, d = dep[m] || { prevu: 0, reel: 0, retenu: 0 };
        rows.push({ mois: m, objectif: obj, realise: r, ecart: r - obj, taux: obj > 0 ? r / obj : 0, depPrevu: d.prevu, depReel: d.reel, depenses: d.retenu, solde: r - d.retenu });
      }
      return rows;
    },

    /** Budget prévisionnel sur 12 mois glissants : CA réalisé (mois courant) + pipeline pondéré, dépenses (+ coûts IA mensuels ctx.iaFcfa), solde cumulé. */
    previsionnel: function (st, nowKey, ctx) {
      var re = calc.realise(ctx.commandes), pl = calc.pipeline(ctx.deals, nowKey, (st.hyp && st.hyp.proba) || PROBA, (st.hyp && st.hyp.lag) || LAG), dep = calc.depenses(st.depenses), cum = 0, rows = [];
      for (var i = 0; i < 12; i++) {
        var m = monthKey(addMonths(nowKey, i)), obj = num(st.objectifs && st.objectifs[m]) || num(ctx.objectifDefaut);
        var p = pl[m] || { pondere: 0, brut: 0, n: 0 }, d = dep[m] || { retenu: 0 }, r = i === 0 ? (re[m] || 0) : 0;
        var ia = num(ctx.iaFcfa), dep2 = d.retenu + ia, ca = r + p.pondere, solde = ca - dep2; cum += solde;
        rows.push({ mois: m, objectif: obj, realise: r, pondere: p.pondere, brut: p.brut, deals: p.n, ca: ca, ecart: ca - obj, depenses: dep2, dontIA: ia, solde: solde, cumul: cum });
      }
      return rows;
    },

    /** Plan d'actions : synthèse (statuts, retards, CA visé). « Retard » = échéance dépassée et action ni faite ni annulée. */
    actions: function (list, todayStr) {
      var s = { total: 0, a_faire: 0, en_cours: 0, fait: 0, annule: 0, retard: 0, caVise: 0, caViseFait: 0 };
      (list || []).forEach(function (a) {
        s.total++; s[a.statut] = (s[a.statut] || 0) + 1;
        if (a.statut !== 'annule') { s.caVise += num(a.objectifCA); if (a.statut === 'fait') s.caViseFait += num(a.objectifCA); }
        if ((a.statut === 'a_faire' || a.statut === 'en_cours') && a.echeance && a.echeance < todayStr) s.retard++;
      });
      return s;
    }
  };

  /* ───────────── Stockage ───────────── */
  var LS = { depenses: 'pil_depenses', actions: 'pil_actions', config: 'pil_config' };      // clés CRM (préfixe sanix_crm_) = entités du connecteur
  var emptyState = function () { return { depenses: [], actions: [], objectifs: {}, hyp: { proba: Object.assign({}, PROBA), lag: Object.assign({}, LAG) }, usdFcfa: 0 }; };
  var ls = function (k) { try { return JSON.parse(localStorage.getItem('sanix_crm_' + k) || 'null'); } catch (e) { return null; } };
  /** Réglages à plat (« obj_2026-03 », « proba_demo », « lag_demo », « usd_fcfa ») : le serveur fusionne champ par champ, deux appareils ne s'écrasent pas. */
  function toFlat(s) {
    var o = {};
    Object.keys(s.objectifs).forEach(function (m) { o['obj_' + m] = s.objectifs[m]; });
    Object.keys(s.hyp.proba).forEach(function (k) { o['proba_' + k] = s.hyp.proba[k]; });
    Object.keys(s.hyp.lag).forEach(function (k) { o['lag_' + k] = s.hyp.lag[k]; });
    if (s.usdFcfa > 0) o.usd_fcfa = s.usdFcfa;
    return o;
  }
  function fromFlat(o, s) {
    s.objectifs = {}; s.hyp = { proba: Object.assign({}, PROBA), lag: Object.assign({}, LAG) }; s.usdFcfa = 0;
    Object.keys(o || {}).forEach(function (k) {
      var v = o[k];
      if (k.indexOf('obj_') === 0) s.objectifs[k.slice(4)] = (v === null || v === '') ? null : num(v);
      else if (k.indexOf('proba_') === 0) s.hyp.proba[k.slice(6)] = Math.min(1, num(v));
      else if (k.indexOf('lag_') === 0) s.hyp.lag[k.slice(4)] = Math.min(24, Math.round(num(v)));
      else if (k === 'usd_fcfa') s.usdFcfa = num(v);
    });
  }
  function load() {
    var s = emptyState(), d = ls(LS.depenses), a = ls(LS.actions);
    s.depenses = Array.isArray(d) ? d : []; s.actions = Array.isArray(a) ? a : []; fromFlat(ls(LS.config), s);
    return s;
  }
  /** Écriture par lsSave du CRM : le connecteur observe la clé et envoie la modification au serveur. */
  function persist(kind) {
    var data = kind === 'config' ? toFlat(st) : st[kind];
    try { if (typeof window.lsSave === 'function') window.lsSave(LS[kind], data); else localStorage.setItem('sanix_crm_' + LS[kind], JSON.stringify(data)); }
    catch (e) { toast('⚠️ Enregistrement local impossible'); }
  }
  var st = emptyState(), loaded = false, ui = { tab: 'budget', year: new Date().getFullYear() }, rem = { state: 'idle', costs: null, props: null, err: '' };
  function ensure() { if (!loaded) { st = load(); loaded = true; } return st; }

  /* ───────────── Contexte CRM (lecture seule) ───────────── */
  function ctx() {
    var g = function (f) { try { return f(); } catch (e) { return undefined; } };
    var rate = num(st.usdFcfa), usd = rem.costs ? num(rem.costs.prevision_fin_mois_usd) : 0;
    return { commandes: g(function () { return COMMANDES; }) || [], deals: g(function () { return DEALS; }) || [], objectifDefaut: num(g(function () { return CONFIG.objectifDefaut; })), iaFcfa: rate > 0 ? Math.round(usd * rate) : 0 };
  }
  function toast(m) { try { showToast(m); } catch (e) { /* hors CRM */ } }
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n) { return Math.round(n || 0).toLocaleString('fr-FR'); };
  var pct = function (x) { return Math.round((x || 0) * 100) + ' %'; };
  var today = function () { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var label = function (m) { return MOIS[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4); };
  var tone = function (v, bonIfPositif) { return v === 0 ? '' : ((v > 0) === bonIfPositif ? 'color:var(--success)' : 'color:var(--danger)'); };


  /* ───────────── Données serveur (SANIX AI) : coûts IA et propositions des agents ───────────── */
  function loadRemote() {
    var S = window.SanixCrmSync;
    if (!S || !S.available || !S.available()) { rem = { state: 'off', costs: null, props: null, err: '' }; render(); return; }
    if (rem.state === 'loading') return;
    rem.state = 'loading'; render();
    var fail = function (e) { return { err: e && e.code === 'NOFUNC' ? 'absent' : ((e && e.message) || 'erreur') }; };
    Promise.all([S.rpcAux('pilotage_ai_costs', { p_months: 6 }).catch(fail), S.rpcAux('pilotage_proposals_list', {}).catch(fail)]).then(function (r) {
      rem.costs = r[0] && !r[0].err ? r[0] : null; rem.props = Array.isArray(r[1]) ? r[1] : null;
      rem.err = (r[0] && r[0].err) || (r[1] && r[1].err) || ''; rem.state = 'ready'; render();
    });
  }
  var remHint = function () {
    return rem.state === 'off' ? 'Connectez l\'agent IA (menu Directeur IA → Synchronisation) pour voir les coûts IA et les propositions des agents.'
      : rem.state === 'loading' ? 'Chargement des données SANIX AI…'
      : rem.err === 'absent' ? 'Le serveur n\'a pas encore la migration du pilotage (20261112) : coûts IA et propositions indisponibles.'
      : rem.err ? 'Données SANIX AI indisponibles : ' + esc(rem.err) : '';
  };
  function iaCard() {
    var c = rem.costs, rate = num(st.usdFcfa), fc = function (usd) { return rate > 0 ? ' <small style="color:var(--muted)">≈ ' + fmt(usd * rate) + ' FCFA</small>' : ''; };
    var head = '<div class="card" style="margin-top:16px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><b>🤖 Coûts IA (API Anthropic)</b><span><label style="font-size:12px;color:var(--muted)">1 USD = <input type="number" min="0" step="1" ' + inp + 'width:80px" data-usd value="' + (rate || '') + '" placeholder="FCFA"> FCFA</label> <button class="btn btn-outline btn-sm" data-act="rem-refresh">↻</button></span></div>';
    if (!c) return head + '<p class="page-sub" style="margin:8px 0 0">' + remHint() + '</p></div>';
    var over = c.budget_mois_usd > 0 && c.prevision_fin_mois_usd > c.budget_mois_usd;
    return head + '<div class="stats-grid" style="margin:12px 0">' +
      stat('Aujourd\'hui', '$' + fmt2(c.jour_usd) + fc(c.jour_usd), 'Plafond du jour : $' + fmt2(c.budget_jour_usd), 'blue') +
      stat('Ce mois', '$' + fmt2(c.mois_usd) + fc(c.mois_usd), 'Plafond mensuel : $' + fmt2(c.budget_mois_usd), 'green') +
      stat('Prévision de fin de mois', '<span style="' + (over ? 'color:var(--danger)' : '') + '">$' + fmt2(c.prevision_fin_mois_usd) + '</span>' + fc(c.prevision_fin_mois_usd), over ? '⚠️ Dépasse le plafond mensuel' : 'Rythme actuel prolongé', over ? 'orange' : 'purple') +
      stat('Agents actifs ce mois', String((c.agents_mois || []).length), (c.agents_mois && c.agents_mois[0]) ? 'Plus coûteux : ' + esc(c.agents_mois[0].nom) : '—', 'teal') + '</div>' +
      '<div style="display:flex;gap:24px;flex-wrap:wrap;font-size:12px"><div><b>Par mois</b><table style="border-collapse:collapse;margin-top:4px"><tbody>' + (c.mois || []).map(function (m) { return '<tr><td style="padding-right:14px">' + label(m.mois) + '</td><td>$' + fmt2(m.cout_usd) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div><b>Agents (mois en cours)</b><table style="border-collapse:collapse;margin-top:4px"><tbody>' + (c.agents_mois || []).slice(0, 6).map(function (a) { return '<tr><td style="padding-right:14px">' + esc(a.nom) + '</td><td>$' + fmt2(a.cout_usd) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
      '<p class="page-sub" style="margin:10px 0 0">' + (rate > 0 ? 'Le prévisionnel inclut ce coût mensuel (' + fmt(rate * c.prevision_fin_mois_usd) + ' FCFA) dans les dépenses de chaque mois.' : 'Saisissez le taux USD → FCFA pour inclure les coûts IA dans le budget prévisionnel.') + '</p></div>';
  }
  function proposalsCard() {
    var list = rem.props || [];
    if (!rem.props) return rem.state === 'ready' || rem.state === 'off' || rem.state === 'loading' ? '<div class="card" style="margin-bottom:16px"><b>🤖 Propositions des agents IA</b><p class="page-sub" style="margin:8px 0 0">' + remHint() + '</p></div>' : '';
    return '<div class="card" style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;align-items:center"><b>🤖 Propositions des agents IA (' + list.length + ')</b><button class="btn btn-outline btn-sm" data-act="rem-refresh">↻</button></div>' +
      (list.length ? list.map(function (p) {
        return '<div style="border-top:1px solid var(--border);padding:10px 0;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap"><div style="flex:1;min-width:240px"><b>' + esc(p.titre) + '</b><div style="font-size:11px;color:var(--muted)">Proposée par ' + esc(p.agent || 'un agent') + (p.segment ? ' · ' + esc(p.segment) : '') + (p.echeance ? ' · échéance ' + esc(p.echeance) : '') + (p.objectif_ca ? ' · CA visé ' + fmt(p.objectif_ca) + ' FCFA' : '') + (p.responsable ? ' · ' + esc(p.responsable) : '') + '</div>' +
          (p.justification ? '<div style="font-size:12px;margin-top:4px">' + esc(p.justification) + '</div>' : '') + '</div><div style="display:flex;gap:6px"><button class="btn btn-success btn-sm" data-act="prop-ok" data-id="' + esc(p.id) + '">✓ Ajouter au plan</button><button class="btn btn-outline btn-sm" data-act="prop-no" data-id="' + esc(p.id) + '">Refuser</button></div></div>';
      }).join('') : '<p class="page-sub" style="margin:8px 0 0">Aucune proposition en attente. Les agents proposent des actions appuyées sur les chiffres du CRM ; rien n\'entre dans le plan sans votre acceptation.</p>') + '</div>';
  }
  function decide(id, ok) {
    var S = window.SanixCrmSync; if (!S) return;
    S.rpcAux('pilotage_proposal_decide', { p_id: id, p_accept: ok }).then(function (r) {
      if (ok) {
        st.actions.push({ id: uid('act_'), titre: r.titre, responsable: r.responsable || '', echeance: r.echeance || '', objectifCA: num(r.objectif_ca), segment: r.segment || '', statut: 'a_faire', source: 'ia', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        persist('actions'); toast('✅ Action ajoutée au plan');
      }
      rem.props = (rem.props || []).filter(function (p) { return p.id !== id; }); render();
    }).catch(function (e) { toast('❌ ' + ((e && e.message) || 'Décision impossible')); loadRemote(); });
  }
  var fmt2 = function (n) { return (Math.round((n || 0) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };

  /* ───────────── Écran ───────────── */
  var root = function () { return document.getElementById('view-budget'); };
  var inp = 'class="form-input" style="padding:5px 8px;font-size:12px;';              // style laissé ouvert : on le ferme à l'usage (largeur facultative)
  function stat(titre, val, sub, color) { return '<div class="stat-card ' + (color || 'blue') + '"><div class="stat-label">' + esc(titre) + '</div><div class="stat-val" style="font-size:20px">' + val + '</div><div style="font-size:11px;color:var(--muted);margin-top:6px">' + sub + '</div></div>'; }
  function bar(v, max, color) { return '<div style="height:8px;background:var(--surface2);border-radius:4px;overflow:hidden"><div style="height:100%;width:' + Math.min(100, max > 0 ? v / max * 100 : 0) + '%;background:' + color + '"></div></div>'; }

  function tabBudget() {
    var rows = calc.suivi(st, ui.year, ctx()), sum = function (k) { return rows.reduce(function (s, r) { return s + r[k]; }, 0); };
    var obj = sum('objectif'), rea = sum('realise'), dep = sum('depenses');
    var deps = st.depenses.filter(function (d) { return monthOf(d.mois) && d.mois.slice(0, 4) === String(ui.year); }).sort(function (a, b) { return a.mois < b.mois ? -1 : 1; });
    var years = []; for (var y = new Date().getFullYear() - 2; y <= new Date().getFullYear() + 2; y++) years.push(y);
    return '<div class="stats-grid">' +
      stat('Objectif de CA ' + ui.year, fmt(obj) + ' FCFA', 'Somme des objectifs mensuels', 'blue') +
      stat('CA réalisé', fmt(rea) + ' FCFA', pct(obj > 0 ? rea / obj : 0) + ' de l\'objectif', 'green') +
      stat('Dépenses commerciales', fmt(dep) + ' FCFA', 'Réel si saisi, sinon prévu', 'orange') +
      stat('Solde (CA − dépenses)', '<span style="' + tone(rea - dep, true) + '">' + fmt(rea - dep) + ' FCFA</span>', 'Avant charges hors commerce', 'purple') + '</div>' +
      '<div class="card" style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px"><b>Objectifs et réalisé par mois</b>' +
      '<span><select id="pil-year" ' + inp + '">' + years.map(function (y) { return '<option' + (y === ui.year ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select> ' +
      '<button class="btn btn-outline btn-sm" data-act="csv">⬇️ Export CSV</button></span></div>' +
      '<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse"><thead><tr style="text-align:left;color:var(--muted)"><th>Mois</th><th>Objectif (FCFA)</th><th>Réalisé</th><th>Écart</th><th style="width:130px">Atteinte</th><th>Dépenses</th><th>Solde</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr style="border-top:1px solid var(--border)"><td>' + label(r.mois) + '</td><td><input type="number" min="0" step="50000" ' + inp + 'width:120px" data-obj="' + r.mois + '" value="' + (st.objectifs[r.mois] != null ? st.objectifs[r.mois] : '') + '" placeholder="' + fmt(r.objectif) + '"></td><td>' + fmt(r.realise) + '</td><td style="' + tone(r.ecart, true) + '">' + fmt(r.ecart) + '</td><td>' + bar(r.realise, r.objectif, r.taux >= 1 ? 'var(--success)' : 'var(--primary)') + '<small>' + pct(r.taux) + '</small></td><td>' + fmt(r.depenses) + '</td><td style="' + tone(r.solde, true) + '">' + fmt(r.solde) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="page-sub" style="margin:8px 0 0">Laisser un objectif vide applique l\'objectif par défaut du Paramétrage. Le réalisé compte les commandes confirmées, en cours ou livrées (HT net).</p></div>' +
      '<div class="card"><b>Dépenses commerciales ' + ui.year + '</b>' +
      '<form data-form="dep" style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0"><input type="month" name="mois" required ' + inp + '" value="' + ui.year + '-' + pad(new Date().getMonth() + 1) + '">' +
      '<select name="categorie" ' + inp + '">' + CATEGORIES.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<input name="libelle" placeholder="Libellé" ' + inp + 'flex:1;min-width:140px"><input name="prevu" type="number" min="0" placeholder="Prévu" ' + inp + 'width:110px"><input name="reel" type="number" min="0" placeholder="Réel" ' + inp + 'width:110px"><button class="btn btn-primary btn-sm">Ajouter</button></form>' +
      (deps.length ? '<table style="width:100%;font-size:12px;border-collapse:collapse"><tbody>' + deps.map(function (d) {
        return '<tr style="border-top:1px solid var(--border)"><td>' + label(d.mois) + '</td><td>' + esc(d.categorie) + '</td><td>' + esc(d.libelle) + '</td><td>' + fmt(d.prevu) + '</td><td><input type="number" min="0" ' + inp + 'width:110px" data-dep-reel="' + esc(d.id) + '" value="' + (d.reel || '') + '" placeholder="Réel"></td><td><button class="btn btn-outline btn-sm" data-act="dep-del" data-id="' + esc(d.id) + '">🗑</button></td></tr>';
      }).join('') + '</tbody></table>' : '<p class="page-sub">Aucune dépense saisie pour ' + ui.year + '.</p>') + '</div>' + iaCard();
  }

  function tabActions() {
    var s = calc.actions(st.actions, today()), list = st.actions.slice().sort(function (a, b) { return (a.echeance || '9') < (b.echeance || '9') ? -1 : 1; });
    return proposalsCard() + '<div class="stats-grid">' + stat('Actions', String(s.total), s.fait + ' faites · ' + s.en_cours + ' en cours · ' + s.a_faire + ' à faire', 'blue') +
      stat('En retard', '<span style="' + (s.retard ? 'color:var(--danger)' : '') + '">' + s.retard + '</span>', 'Échéance dépassée', 'orange') +
      stat('CA visé', fmt(s.caVise) + ' FCFA', 'Hors actions annulées', 'purple') + stat('CA visé réalisé', fmt(s.caViseFait) + ' FCFA', pct(s.caVise > 0 ? s.caViseFait / s.caVise : 0) + ' des actions faites', 'green') + '</div>' +
      '<div class="card"><b>Plan d\'actions commercial</b>' +
      '<form data-form="act" style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0"><input name="titre" required placeholder="Action (ex. relancer les 20 prospects Santé)" ' + inp + 'flex:2;min-width:220px"><input name="responsable" placeholder="Responsable" ' + inp + 'width:130px"><input name="echeance" type="date" ' + inp + '">' +
      '<input name="objectifCA" type="number" min="0" placeholder="CA visé (FCFA)" ' + inp + 'width:140px"><input name="segment" placeholder="Segment / produit" ' + inp + 'width:140px"><button class="btn btn-primary btn-sm">Ajouter</button></form>' +
      (list.length ? '<div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse"><thead><tr style="text-align:left;color:var(--muted)"><th>Action</th><th>Responsable</th><th>Échéance</th><th>CA visé</th><th>Statut</th><th></th></tr></thead><tbody>' + list.map(function (a) {
        var late = (a.statut === 'a_faire' || a.statut === 'en_cours') && a.echeance && a.echeance < today();
        return '<tr style="border-top:1px solid var(--border)"><td>' + (a.source === 'ia' ? '<span class="chip" style="font-size:10px">🤖 IA</span> ' : '') + esc(a.titre) + (a.segment ? ' <small style="color:var(--muted)">· ' + esc(a.segment) + '</small>' : '') + '</td><td>' + esc(a.responsable) + '</td><td style="' + (late ? 'color:var(--danger);font-weight:700' : '') + '">' + esc(a.echeance) + (late ? ' ⚠️' : '') + '</td><td>' + fmt(a.objectifCA) + '</td>' +
          '<td><select ' + inp + '" data-act-statut="' + esc(a.id) + '">' + Object.keys(STATUTS).map(function (k) { return '<option value="' + k + '"' + (a.statut === k ? ' selected' : '') + '>' + STATUTS[k] + '</option>'; }).join('') + '</select></td><td><button class="btn btn-outline btn-sm" data-act="act-del" data-id="' + esc(a.id) + '">🗑</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="page-sub">Aucune action. Ajoutez la première : responsable, échéance et CA visé permettent de suivre ce que le plan doit rapporter.</p>') + '</div>';
  }

  function tabPrevi() {
    var rows = calc.previsionnel(st, monthKey(new Date()), ctx());
    var tot = function (k) { return rows.reduce(function (s, r) { return s + r[k]; }, 0); }, h = st.hyp;
    return '<div class="stats-grid">' + stat('CA prévisionnel 12 mois', fmt(tot('ca')) + ' FCFA', 'Pipeline pondéré + CA du mois en cours', 'blue') + stat('Objectif 12 mois', fmt(tot('objectif')) + ' FCFA', 'Écart : <b style="' + tone(tot('ca') - tot('objectif'), true) + '">' + fmt(tot('ca') - tot('objectif')) + '</b>', 'purple') +
      stat('Dépenses prévues', fmt(tot('depenses')) + ' FCFA', 'Réel si saisi, sinon prévu', 'orange') + stat('Solde prévisionnel', '<span style="' + tone(tot('solde'), true) + '">' + fmt(tot('solde')) + ' FCFA</span>', 'CA − dépenses commerciales', 'green') + '</div>' +
      '<div class="card" style="margin-bottom:16px"><b>Budget prévisionnel — 12 mois glissants</b><div style="overflow-x:auto"><table style="width:100%;font-size:12px;border-collapse:collapse;margin-top:10px"><thead><tr style="text-align:left;color:var(--muted)"><th>Mois</th><th>Deals</th><th>CA prévisionnel</th><th style="width:150px">vs objectif</th><th>Écart</th><th>Dépenses</th><th>Solde</th><th>Cumul</th></tr></thead><tbody>' + rows.map(function (r) {
        return '<tr style="border-top:1px solid var(--border)"><td>' + label(r.mois) + '</td><td>' + r.deals + '</td><td>' + fmt(r.ca) + '</td><td>' + bar(r.ca, Math.max(r.objectif, 1), r.ca >= r.objectif ? 'var(--success)' : 'var(--primary)') + '<small>obj. ' + fmt(r.objectif) + '</small></td><td style="' + tone(r.ecart, true) + '">' + fmt(r.ecart) + '</td><td>' + fmt(r.depenses) + (r.dontIA ? '<br><small style="color:var(--muted)">dont IA ' + fmt(r.dontIA) + '</small>' : '') + '</td><td style="' + tone(r.solde, true) + '">' + fmt(r.solde) + '</td><td style="' + tone(r.cumul, true) + '">' + fmt(r.cumul) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>' +
      '<div class="card"><b>Hypothèses du pipeline pondéré</b><p class="page-sub" style="margin:4px 0 10px">Chaque affaire ouverte compte pour valeur × probabilité, dans le mois courant + le délai de son étape. Modifiables : elles ne changent que cette prévision.</p>' +
      '<table style="font-size:12px;border-collapse:collapse"><thead><tr style="text-align:left;color:var(--muted)"><th style="padding-right:18px">Étape</th><th style="padding-right:18px">Probabilité (%)</th><th>Délai (mois)</th></tr></thead><tbody>' + Object.keys(PROBA).map(function (k) {
        return '<tr><td style="padding-right:18px">' + k + '</td><td style="padding-right:18px"><input type="number" min="0" max="100" ' + inp + 'width:80px" data-hyp-proba="' + k + '" value="' + Math.round((h.proba[k] != null ? h.proba[k] : PROBA[k]) * 100) + '"></td><td><input type="number" min="0" max="24" ' + inp + 'width:80px" data-hyp-lag="' + k + '" value="' + (h.lag[k] != null ? h.lag[k] : LAG[k]) + '"></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function render() {
    var host = root(); if (!host) return;
    var el = host.querySelector(':scope > #pil-body');                    // la barre d'onglets du groupe Pilotage (.grp-tabs) reste en place
    if (!el) { el = document.createElement('div'); el.id = 'pil-body'; host.appendChild(el); }
    var tabs = [['budget', '💶 Suivi budgétaire'], ['actions', '🎯 Plan d\'actions'], ['previ', '📈 Prévisionnel']];
    el.innerHTML = '<div style="margin-bottom:14px"><h1 class="page-title">💶 Budget & plan d\'actions commercial</h1><p class="page-sub">Objectifs, dépenses, plan d\'actions et prévision sur le pipeline — données propres à cet appareil</p></div>' +
      '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">' + tabs.map(function (t) { return '<button class="btn ' + (ui.tab === t[0] ? 'btn-primary' : 'btn-outline') + ' btn-sm" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
      (ui.tab === 'actions' ? tabActions() : ui.tab === 'previ' ? tabPrevi() : tabBudget());
  }

  function csv() {
    var rows = calc.suivi(st, ui.year, ctx()), esc2 = function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; };
    var out = ['Mois;Objectif;Realise;Ecart;Atteinte;Depenses prevues;Depenses reelles;Solde'].concat(rows.map(function (r) { return [r.mois, Math.round(r.objectif), Math.round(r.realise), Math.round(r.ecart), Math.round(r.taux * 100) + '%', Math.round(r.depPrevu), Math.round(r.depReel), Math.round(r.solde)].map(esc2).join(';'); })).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + out], { type: 'text/csv;charset=utf-8' })); a.download = 'budget_' + ui.year + '.csv'; document.body.appendChild(a); a.click(); a.remove();
  }

  function bind() {
    var el = root(); if (!el || el.dataset.bound) return; el.dataset.bound = '1';
    el.addEventListener('click', function (e) {
      var t = e.target.closest('[data-tab],[data-act]'); if (!t) return;
      if (t.dataset.tab) { ui.tab = t.dataset.tab; render(); return; }
      var a = t.dataset.act, id = t.dataset.id;
      if (a === 'csv') csv();
      else if (a === 'rem-refresh') { rem.state = 'idle'; loadRemote(); }
      else if (a === 'prop-ok') decide(id, true);
      else if (a === 'prop-no') { if (confirm('Refuser cette proposition ?')) decide(id, false); }
      else if (a === 'dep-del' && confirm('Supprimer cette dépense ?')) { st.depenses = st.depenses.filter(function (d) { return d.id !== id; }); persist('depenses'); render(); }
      else if (a === 'act-del' && confirm('Supprimer cette action ?')) { st.actions = st.actions.filter(function (x) { return x.id !== id; }); persist('actions'); render(); }
    });
    el.addEventListener('change', function (e) {
      var t = e.target, v;
      if (t.id === 'pil-year') { ui.year = +t.value; render(); }
      else if (t.dataset.usd !== undefined) { st.usdFcfa = num(t.value); persist('config'); render(); }
      else if (t.dataset.obj) { v = t.value === '' ? null : num(t.value); st.objectifs[t.dataset.obj] = v; persist('config'); render(); }      // vide = null (effacé aussi sur les autres appareils)
      else if (t.dataset.depReel !== undefined) { var d = st.depenses.filter(function (x) { return x.id === t.dataset.depReel; })[0]; if (d) { d.reel = num(t.value); persist('depenses'); render(); } }
      else if (t.dataset.actStatut !== undefined) { var a = st.actions.filter(function (x) { return x.id === t.dataset.actStatut; })[0]; if (a) { a.statut = t.value; a.updatedAt = new Date().toISOString(); persist('actions'); render(); } }
      else if (t.dataset.hypProba) { st.hyp.proba[t.dataset.hypProba] = Math.min(100, num(t.value)) / 100; persist('config'); render(); }
      else if (t.dataset.hypLag) { st.hyp.lag[t.dataset.hypLag] = Math.min(24, Math.round(num(t.value))); persist('config'); render(); }
    });
    el.addEventListener('submit', function (e) {
      var f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault();
      var v = function (n) { return (f.elements[n].value || '').trim(); };
      if (f.dataset.form === 'dep') { if (!monthOf(v('mois'))) return; st.depenses.push({ id: uid('dep_'), mois: v('mois'), categorie: v('categorie'), libelle: v('libelle'), prevu: num(v('prevu')), reel: num(v('reel')) }); }
      else { if (!v('titre')) return; st.actions.push({ id: uid('act_'), titre: v('titre'), responsable: v('responsable'), echeance: v('echeance'), objectifCA: num(v('objectifCA')), segment: v('segment'), statut: 'a_faire', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); }
      persist(f.dataset.form === 'dep' ? 'depenses' : 'actions'); render();
    });
  }

  var visible = function () { var e = root(); return !!(e && !e.classList.contains('hidden')); };
  var refresh = function () { if (loaded && visible()) render(); };
  window.initPilotage = function () { ensure(); bind(); render(); loadRemote(); };
  /** Interface du connecteur CRM (shared/crm-connector.js) : lecture et application des données reçues du serveur. */
  window.SanixPilotage = { calc: calc, refresh: refresh, store: {
    get: function (k) { return ensure()[k]; },
    set: function (k, arr) { ensure()[k] = Array.isArray(arr) ? arr : []; refresh(); },
    getConfig: function () { return toFlat(ensure()); },
    setConfig: function (o) { fromFlat(o, ensure()); refresh(); } } };
})();
