// SANIX AI — Centre des coûts IA : dépenses par jour, par collaborateur et par modèle, erreurs d'appel, incidents et disponibilité des agents.
// Lecture seule (fonction SQL ai_cost_center, direction uniquement) ; les budgets se règlent dans Gouvernance.
import { $, ago, clipT, html, num, pill, raw, toast, usd } from "./ui.js";
import { q, S } from "./state.js";

const PERIODES = [7, 30, 90];
const ETATS = { actif: ["Actif", "#22C55E"], attente_validation: ["En attente de validation", "#F59E0B"], suspendu: ["Suspendu", "#EF4444"] };
const GRAVITES = { critique: ["Critique", "#EF4444"], attention: ["Attention", "#F59E0B"], info: ["Information", "#64748b"] };
let jours = 30, D = null, erreur = "";

export async function loadCost() {
  erreur = "";
  try { D = await q(S.sb.rpc("ai_cost_center", { p_days: jours })); }
  catch (e) { D = null; erreur = /Could not find the function|ai_cost_center/i.test(e.message) ? "La migration « Centre des coûts IA » (20261129000000) n'est pas encore appliquée au projet Supabase." : e.message; }
}

const part = (v, t) => (t > 0 ? Math.round((v / t) * 100) : 0);
const jourCourt = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function barres(js) {
  const max = Math.max(...js.map((j) => Number(j.cout_usd)), 0.0001);
  return html`<div class="cost-bars" style="display:flex;align-items:flex-end;gap:2px;height:120px;margin:8px 0 2px" role="img" aria-label="Coût IA par jour">${raw(js.map((j) => {
    const h = Math.max(Number(j.cout_usd) > 0 ? 3 : 1, Math.round((Number(j.cout_usd) / max) * 116));
    return html`<div title="${jourCourt(j.jour)} : ${usd(j.cout_usd)} · ${j.appels} appel(s)${j.erreurs ? " · " + j.erreurs + " en erreur" : ""}" style="flex:1;min-width:2px;height:${h}px;background:${j.erreurs ? "#EF4444" : "#0ea5e9"};border-radius:2px 2px 0 0;opacity:${Number(j.cout_usd) > 0 ? 1 : 0.25}"></div>`.s;
  }).join(""))}</div>
    <div class="small muted" style="display:flex;justify-content:space-between"><span>${jourCourt(js[0].jour)}</span><span>${js.length > 2 ? "max. " + usd(max) + " / jour" : ""}</span><span>${jourCourt(js[js.length - 1].jour)}</span></div>`;
}

export function renderCost(main) {
  if (!D) {
    main.innerHTML = html`<section class="panel"><h2>💰 Coûts IA</h2><div class="card muted">${erreur || "Données indisponibles."}</div>
      <p style="margin-top:10px"><button class="btn" type="button" data-act="cost-refresh">Réessayer</button></p></section>`.s;
    return;
  }
  const d = D, agents = d.agents ?? [], total = Number(d.periode_usd);
  const nbErr = (d.jours ?? []).reduce((t, j) => t + Number(j.erreurs), 0), nbAppels = (d.jours ?? []).reduce((t, j) => t + Number(j.appels), 0);
  const bj = Number(d.budget_jour_usd) || 0, bm = Number(d.budget_mois_usd) || 0;
  const dispo = d.disponibilite ?? {}, inc = d.incidents_periode ?? {};
  const suspendus = agents.filter((a) => a.etat === "suspendu");
  main.innerHTML = html`<section class="panel">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div><h2>💰 Coûts IA</h2><p class="sub">Ce que coûte l'entreprise virtuelle : par jour, par collaborateur et par modèle, avec les erreurs d'appel et les incidents. Les budgets se règlent dans Gouvernance.</p></div>
      <div class="actions"><select id="cost-days" aria-label="Période">${PERIODES.map((p) => html`<option value="${p}" ${p === d.jours_periode ? "selected" : ""}>${p} derniers jours</option>`)}</select>
        <button class="btn" type="button" data-act="cost-refresh">Actualiser</button></div>
    </div>
    <div class="grid g4" style="margin:12px 0">
      <div class="card kpi"><b>${usd(d.jour_usd)}</b><span>Aujourd'hui${bj ? ` · ${part(Number(d.jour_usd), bj)} % du budget (${num(bj, 0)} $)` : ""}</span></div>
      <div class="card kpi"><b>${usd(d.mois_usd)}</b><span>Ce mois · prévision ${usd(d.prevision_fin_mois_usd)}${bm ? ` · budget ${num(bm, 0)} $` : ""}</span></div>
      <div class="card kpi"><b>${usd(total)}</b><span>Sur ${d.jours_periode} jours · ${num(nbAppels)} appel(s)</span></div>
      <div class="card kpi"><b style="${nbErr ? "color:var(--danger)" : ""}">${num(nbErr)}</b><span>Appels IA en erreur · ${num(inc.critique ?? 0)} incident(s) critique(s)</span></div>
    </div>
    ${bm && Number(d.prevision_fin_mois_usd) > bm ? html`<div class="card" style="border-left:4px solid #F59E0B;margin-bottom:12px">⚠️ À ce rythme, le mois finira à <b>${usd(d.prevision_fin_mois_usd)}</b>, au-dessus du budget mensuel de ${num(bm, 0)} $. <a href="#" data-act="tab" data-id="gov">Régler la gouvernance</a></div>` : ""}
    <div class="card"><h3 style="margin:0">Dépense par jour</h3>${barres(d.jours ?? [])}</div>
    <h3 style="margin:16px 0 6px">Par collaborateur</h3>
    <div class="scroll"><table class="tbl"><thead><tr><th>Collaborateur</th><th>État</th><th class="num">Appels</th><th class="num">Tokens (entrée / sortie)</th><th class="num">Coût</th><th class="num">Part</th><th class="num">Erreurs</th><th>Dernière activité</th></tr></thead><tbody>
    ${raw(agents.map((a) => html`<tr class="click" data-act="open-agent" data-id="${a.agent_id}"><td><b>${a.nom}</b><br><span class="small muted">${a.fonction}</span></td>
      <td>${pill(ETATS[a.etat]?.[0] ?? a.etat, ETATS[a.etat]?.[1] ?? "#64748b")}</td><td class="num">${num(a.appels)}</td><td class="num small">${num(a.tokens_in)} / ${num(a.tokens_out)}</td>
      <td class="num"><b>${usd(a.cout_usd)}</b></td><td class="num">${part(Number(a.cout_usd), total)} %</td><td class="num" style="${Number(a.erreurs) ? "color:var(--danger)" : ""}">${num(a.erreurs)}</td><td class="small">${a.derniere_activite ? ago(a.derniere_activite) : "—"}</td></tr>`.s).join("") || html`<tr><td colspan="8" class="muted">Aucun collaborateur.</td></tr>`.s)}
    </tbody></table></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3 style="margin:0 0 6px">Par modèle d'IA</h3>${(d.modeles ?? []).length ? html`<table class="tbl"><thead><tr><th>Modèle</th><th class="num">Appels</th><th class="num">Coût</th><th class="num">Part</th></tr></thead><tbody>
        ${raw(d.modeles.map((m) => html`<tr><td>${m.modele}<div class="small muted">Anthropic</div></td><td class="num">${num(m.appels)}</td><td class="num"><b>${usd(m.cout_usd)}</b></td><td class="num">${part(Number(m.cout_usd), total)} %</td></tr>`.s).join(""))}</tbody></table>` : html`<p class="muted">Aucun appel sur la période.</p>`}</div>
      <div class="card"><h3 style="margin:0 0 6px">Disponibilité des agents</h3><div class="tags">${Object.entries(dispo).map(([k, n]) => pill(`${ETATS[k]?.[0] ?? k} · ${n}`, ETATS[k]?.[1] ?? "#64748b"))}</div>
        ${suspendus.length ? html`<p class="small" style="margin-top:8px">Suspendus : ${suspendus.map((a) => a.nom).join(", ")}</p>` : html`<p class="small muted" style="margin-top:8px">Aucun agent suspendu.</p>`}
        <div class="tags" style="margin-top:8px">${Object.entries(inc).length ? Object.entries(inc).map(([k, n]) => pill(`${GRAVITES[k]?.[0] ?? k} · ${n}`, GRAVITES[k]?.[1] ?? "#64748b")) : html`<span class="small muted">Aucun incident sur la période.</span>`}</div></div>
    </div>
    <h3 style="margin:16px 0 6px">Incidents récents</h3>
    ${(d.incidents ?? []).length ? raw(d.incidents.map((i) => html`<div class="card" style="margin:6px 0"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div>${pill(GRAVITES[i.gravite]?.[0] ?? i.gravite, GRAVITES[i.gravite]?.[1] ?? "#64748b")} <b>${i.type}</b>${i.agent ? html` · ${i.agent}` : ""}</div><span class="small muted">${ago(i.at)}</span></div>
      <div class="small" style="margin-top:4px">${clipT(i.message, 240)}</div></div>`.s).join("")) : html`<p class="muted">Aucun incident sur la période.</p>`}
  </section>`.s;
  $("#cost-days").onchange = async (e) => { jours = Number(e.target.value); await loadCost(); renderCost(main); };
}

export async function costAction(el) {
  if (el.dataset.act === "cost-refresh") { await loadCost(); renderCost($("#main")); if (erreur) toast(erreur, "bad"); }
}
