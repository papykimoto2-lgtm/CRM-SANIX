/* SANIX CRM — Crédit IA : solde du crédit Anthropic et tableau de bord de consommation des agents.
 *
 * L'API d'Anthropic ne donne pas le solde prépayé : il est tenu à partir de ce que la direction déclare (solde lu dans la Console, recharges)
 * moins la consommation enregistrée par les agents (fonctions ai_credit_status et ai_cost_center). Rien n'est modifié sans votre déclaration.
 * Calculs purs (SanixCreditIA.calc, testables sans navigateur) + écran « Crédit IA » (#view-creditia, groupe Pilotage).
 */
(function (G) {
  'use strict';
  const num = (v) => { v = Number(v); return isFinite(v) ? v : 0; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = (n, d) => num(n).toLocaleString('fr-FR', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }) + ' $';
  const nb = (n) => Math.round(num(n)).toLocaleString('fr-FR');
  const jourFr = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); };

  /** credit : résultat de ai_credit_status ; c30 / c7 : résultats de ai_cost_center sur 30 et 7 jours. Renvoie ce que l'écran affiche. */
  function etat(credit, c30, c7) {
    const e = { saisi: !!(credit && credit.saisi), alertes: [] };
    if (e.saisi) {
      e.solde = num(credit.solde_usd); e.base = num(credit.base_usd); e.baseAt = credit.base_at; e.depenseDepuis = num(credit.depense_depuis_usd); e.rechargesDepuis = num(credit.recharges_depuis_usd);
      e.rythme = num(credit.rythme_jour_usd); e.joursRestants = credit.jours_restants == null ? null : num(credit.jours_restants);
      e.niveau = e.solde <= 0 ? 'epuise' : (e.solde < 5 || (e.joursRestants !== null && e.joursRestants < 7)) ? 'bas' : 'ok';
      if (e.niveau === 'epuise') e.alertes.push('Le crédit est épuisé : les agents sont à l\'arrêt jusqu\'à une recharge.');
      else if (e.niveau === 'bas') e.alertes.push('Crédit bas' + (e.joursRestants !== null ? ' : environ ' + e.joursRestants + ' jour(s) au rythme actuel' : '') + '. Pensez à recharger dans la Console Anthropic.');
    }
    if (c30) {
      e.jourUsd = num(c30.jour_usd); e.moisUsd = num(c30.mois_usd); e.prevision = num(c30.prevision_fin_mois_usd);
      e.budgetJour = c30.budget_jour_usd == null ? null : num(c30.budget_jour_usd); e.budgetMois = c30.budget_mois_usd == null ? null : num(c30.budget_mois_usd);
      e.pctMois = e.budgetMois > 0 ? Math.min(999, Math.round(e.moisUsd / e.budgetMois * 100)) : null;
      e.pctJour = e.budgetJour > 0 ? Math.min(999, Math.round(e.jourUsd / e.budgetJour * 100)) : null;
      if (e.budgetMois > 0 && e.prevision > e.budgetMois) e.alertes.push('Au rythme actuel, la dépense de fin de mois (' + usd(e.prevision) + ') dépasserait le plafond mensuel de ' + usd(e.budgetMois) + ' : les agents s\'arrêteraient avant la fin du mois.');
      else if (e.pctMois !== null && e.pctMois >= 80) e.alertes.push('Le plafond mensuel est utilisé à ' + e.pctMois + ' %.');
      e.jours = (c30.jours || []).map((j) => ({ jour: j.jour, usd: num(j.cout_usd), appels: num(j.appels), erreurs: num(j.erreurs) }));
      e.modeles = (c30.modeles || []).map((m) => ({ modele: m.modele, usd: num(m.cout_usd), appels: num(m.appels), erreurs: num(m.erreurs) }));
      e.agents = (c30.agents || []).filter((a) => num(a.cout_usd) > 0).slice(0, 6).map((a) => ({ nom: a.nom, fonction: a.fonction, usd: num(a.cout_usd), appels: num(a.appels) }));
      e.appels30 = e.jours.reduce((s, j) => s + j.appels, 0); e.erreurs30 = e.jours.reduce((s, j) => s + j.erreurs, 0);
      e.maxJour = Math.max(0.01, ...e.jours.map((j) => j.usd));
    }
    if (c7) {
      const ag = c7.agents || [];
      e.tokensIn7 = ag.reduce((s, a) => s + num(a.tokens_in), 0); e.tokensOut7 = ag.reduce((s, a) => s + num(a.tokens_out), 0); e.depense7 = num(c7.periode_usd);
    }
    return e;
  }
  const calc = { etat, usd, nb };
  G.SanixCreditIA = { calc };
  if (typeof module !== 'undefined' && module.exports) module.exports = { calc };
  if (!G.document) return;

  /* ═══════════════════════════════ Écran ═══════════════════════════════ */
  const root = () => document.getElementById('view-creditia');
  const toast = (m) => { try { showToast(m); } catch (e) { /* hors CRM */ } };
  const st = { e: null, charge: false, erreur: null, maj: null, form: false };
  const api = (path, body) => { if (typeof window.aisApi !== 'function') return Promise.reject(new Error('Connectez l\'agent IA (Pilotage → Directeur IA)')); return window.aisApi(path, { method: 'POST', body: JSON.stringify(body || {}) }); };

  async function charger() {
    st.charge = true; st.erreur = null; render();
    try {
      const [credit, c30, c7] = await Promise.all([
        api('/rest/v1/rpc/ai_credit_status').catch((e) => { if (/n'existe pas|does not exist|404|PGRST202/i.test(e.message)) return { saisi: false, absent: true }; throw e; }),
        api('/rest/v1/rpc/ai_cost_center', { p_days: 30 }).catch(() => null),
        api('/rest/v1/rpc/ai_cost_center', { p_days: 7 }).catch(() => null),
      ]);
      st.e = etat(credit, c30, c7); st.e.absent = !!(credit && credit.absent); st.e.coutIndispo = !c30; st.maj = new Date();
    } catch (e) { st.erreur = /session|Connectez/i.test(e.message) ? 'Connectez l\'agent IA (Pilotage → Directeur IA) pour afficher le solde.' : e.message; }
    st.charge = false; render();
  }

  const carte = (titre, val, sub, couleur) => `<div class="stat-card ${couleur || 'blue'}"><div class="stat-label">${esc(titre)}</div><div class="stat-val" style="font-size:24px">${val}</div><div class="stat-label" style="margin-top:4px">${sub || ''}</div></div>`;
  const barre = (pct, c) => `<div style="height:10px;border-radius:6px;background:rgba(127,127,127,.25);overflow:hidden"><div style="height:100%;width:${Math.min(100, Math.max(0, pct || 0))}%;background:${c}"></div></div>`;
  const couleurPct = (p) => p == null ? '#6b7280' : p >= 100 ? '#dc2626' : p >= 80 ? '#d97706' : '#16a34a';

  function corps() {
    if (st.erreur) return `<div class="alert alert-warn">⚠️ <div>${esc(st.erreur)}</div></div><p><button class="btn btn-primary btn-sm" data-act="actualiser">🔄 Réessayer</button></p>`;
    const e = st.e; if (!e) return '<p class="muted">Chargement…</p>';
    const alertes = e.alertes.length ? `<div class="alert alert-warn">⚠️ <div><ul style="margin:0;padding-left:18px">${e.alertes.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div></div>` : '';
    const hero = e.saisi ? `<div class="stats-grid" style="margin:12px 0">${carte('Solde estimé du crédit', usd(e.solde), 'dernier relevé : ' + usd(e.base) + ' le ' + esc(jourFr(e.baseAt)), e.niveau === 'ok' ? 'green' : e.niveau === 'bas' ? 'orange' : 'red')}
        ${carte('Dépensé depuis le relevé', usd(e.depenseDepuis), e.rechargesDepuis ? 'recharges depuis : ' + usd(e.rechargesDepuis) : 'aucune recharge depuis', 'blue')}
        ${carte('Rythme moyen', usd(e.rythme) + ' / jour', e.joursRestants === null ? 'durée restante non calculable' : 'soit environ ' + e.joursRestants + ' jour(s) de crédit', 'purple')}
        ${e.pctMois !== null ? carte('Ce mois-ci', usd(e.moisUsd), 'plafond ' + usd(e.budgetMois) + ' · ' + e.pctMois + ' % utilisé', e.pctMois >= 100 ? 'red' : e.pctMois >= 80 ? 'orange' : 'green') : ''}</div>`
      : `<div class="alert alert-info">ℹ️ <div>${e.absent ? 'Le suivi du crédit n\'est pas installé sur le serveur (migration « credit_api »).' : 'Aucun solde déclaré. Lisez le solde dans la Console Anthropic (Tableau de bord → Crédits de l\'organisation) et saisissez-le ci-dessous.'}</div></div>`;
    const plafond = e.pctMois !== null ? `<div class="card"><div class="card-header"><span class="card-title">🧮 Plafonds de dépense des agents</span></div>
        <div style="margin:6px 0"><div style="display:flex;justify-content:space-between;font-size:13px"><span>Ce mois (plafond ${usd(e.budgetMois)})</span><b>${usd(e.moisUsd)} · ${e.pctMois} %</b></div>${barre(e.pctMois, couleurPct(e.pctMois))}</div>
        ${e.pctJour !== null ? `<div style="margin:10px 0 6px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>Aujourd'hui (plafond ${usd(e.budgetJour)})</span><b>${usd(e.jourUsd)} · ${e.pctJour} %</b></div>${barre(e.pctJour, couleurPct(e.pctJour))}</div>` : ''}
        <p class="muted" style="font-size:12px;margin:8px 0 0">Prévision de fin de mois au rythme actuel : <b>${usd(e.prevision)}</b>. Les plafonds se règlent dans l'entreprise IA → Gouvernance.</p></div>` : '';
    const barres = e.jours && e.jours.length ? `<div class="card"><div class="card-header"><span class="card-title">📈 Dépense par jour (30 jours)</span><span class="muted" style="font-size:12px">${nb(e.appels30)} appels · ${nb(e.erreurs30)} erreurs</span></div>
        <div role="img" aria-label="Dépense quotidienne des agents sur 30 jours" style="display:flex;align-items:flex-end;gap:2px;height:90px">${e.jours.map((j) => `<div title="${esc(j.jour)} : ${usd(j.usd)} · ${j.appels} appels" style="flex:1;min-width:3px;background:${j.erreurs ? '#d97706' : '#0b7f70'};height:${Math.max(2, Math.round(j.usd / e.maxJour * 100))}%;border-radius:2px 2px 0 0"></div>`).join('')}</div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:3px"><span>${esc(e.jours[0].jour)}</span><span>${esc(e.jours[e.jours.length - 1].jour)}</span></div></div>` : '';
    const tokens = e.tokensIn7 != null ? `<div class="card"><div class="card-header"><span class="card-title">🔤 Volume de jetons (7 jours)</span></div>
        <div class="stats-grid" style="margin:0">${carte('Jetons lus (entrée)', nb(e.tokensIn7), 'texte envoyé aux modèles', 'blue')}${carte('Jetons écrits (sortie)', nb(e.tokensOut7), 'réponses des modèles', 'purple')}${carte('Dépense sur 7 jours', usd(e.depense7), 'hors recherche web si non journalisée', 'green')}</div></div>` : '';
    const mod = e.modeles && e.modeles.length ? `<div class="card"><div class="card-header"><span class="card-title">🧠 Par modèle et par collaborateur (30 jours)</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px"><div>${e.modeles.map((m) => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid var(--border)"><span>${esc(m.modele)}</span><span><b>${usd(m.usd)}</b> · ${nb(m.appels)} appels${m.erreurs ? ` · <span style="color:#dc2626">${nb(m.erreurs)} erreurs</span>` : ''}</span></div>`).join('')}</div>
        <div>${e.agents.length ? e.agents.map((a) => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid var(--border)"><span>${esc(a.nom)}<span class="muted" style="font-size:11px"> · ${esc(a.fonction || '')}</span></span><b>${usd(a.usd)}</b></div>`).join('') : '<p class="muted">Aucune dépense par collaborateur.</p>'}</div></div></div>` : '';
    const form = st.form ? `<form id="cr-form" class="card"><div class="card-header"><span class="card-title">✍️ Déclarer le solde ou une recharge</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
          <label class="form-label" style="font-size:12px">Que déclarez-vous ?<select class="form-input" name="type"><option value="solde_constate">Le solde lu dans la Console</option><option value="recharge">Une recharge</option></select></label>
          <label class="form-label" style="font-size:12px">Montant ($)<input class="form-input" name="montant" type="number" min="0" step="0.01" required placeholder="ex. 80.89"></label>
          <label class="form-label" style="font-size:12px">Date de la recharge<input class="form-input" name="date" type="date"></label>
          <label class="form-label" style="font-size:12px">Note<input class="form-input" name="note" maxlength="300" placeholder="ex. Console, 19/11"></label></div>
        <div id="cr-err" class="alert alert-warn hidden" role="alert"></div>
        <div style="margin-top:8px"><button class="btn btn-primary btn-sm" type="submit">Enregistrer</button> <button class="btn btn-sm" type="button" data-act="form-fermer">Annuler</button></div></form>` : '';
    return `${alertes}${hero}${plafond}${tokens}${barres}${mod}${form}
      <div class="alert alert-info">ℹ️ <div>Le solde est <b>estimé</b> : dernier solde que vous avez déclaré, moins la dépense enregistrée par les agents depuis. La Console Anthropic fait foi (elle compte aussi la recherche web et les appels hors agents) : un léger écart est normal. Remettez-le à jour de temps en temps avec « Déclarer le solde ».${e.coutIndispo ? ' <b>Le détail des dépenses n\'est pas disponible</b> (fonction du centre des coûts absente ou accès refusé).' : ''}</div></div>`;
  }

  function render() {
    const host = root(); if (!host) return;
    let el = host.querySelector(':scope > #cr-body'); if (!el) { el = document.createElement('div'); el.id = 'cr-body'; host.appendChild(el); }
    el.innerHTML = `<div class="ban"><div class="ban-deco"></div><h1 class="page-title">💳 Crédit IA</h1><p class="page-sub">Solde du crédit Anthropic et consommation de vos agents — ${st.maj ? 'mis à jour à ' + esc(st.maj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })) : 'chargement…'}</p></div>
      <div style="margin:0 0 12px"><button class="btn btn-sm" data-act="actualiser" ${st.charge ? 'disabled' : ''}>🔄 Actualiser</button> <button class="btn btn-sm btn-primary" data-act="form-ouvrir">✍️ Déclarer le solde ou une recharge</button> <a class="btn btn-sm" href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener noreferrer">↗ Ouvrir la Console</a></div>${corps()}`;
  }
  function bind() {
    const el = root(); if (!el || el.dataset.bound) return; el.dataset.bound = '1';
    el.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-act]'); if (!t) return; const a = t.dataset.act;
      if (a === 'actualiser') charger(); else if (a === 'form-ouvrir') { st.form = true; render(); } else if (a === 'form-fermer') { st.form = false; render(); }
    });
    el.addEventListener('submit', async (ev) => {
      if (!ev.target || ev.target.id !== 'cr-form') return; ev.preventDefault();
      const f = ev.target, err = document.getElementById('cr-err'), montre = (m) => { if (err) { err.textContent = m; err.classList.remove('hidden'); } };
      const montant = parseFloat(f.montant.value); if (!isFinite(montant) || montant < 0) return montre('Saisissez un montant valide.');
      if (f.type.value === 'recharge' && montant <= 0) return montre('Une recharge doit être supérieure à 0.');
      try { await api('/rest/v1/rpc/ai_credit_ajouter', { p_type: f.type.value, p_montant: montant, p_date: f.type.value === 'recharge' && f.date.value ? f.date.value : null, p_note: f.note.value.trim() || null }); st.form = false; toast('✅ Enregistré'); await charger(); }
      catch (e) { montre(e.message); }
    });
  }
  G.initCreditIA = function () { bind(); render(); charger(); };
  G.SanixCreditIA.refresh = function () { const r = root(); if (r && !r.classList.contains('hidden')) charger(); };
})(typeof window !== 'undefined' ? window : globalThis);
