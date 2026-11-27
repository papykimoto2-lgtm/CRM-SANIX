// Onglet Objectifs (direction) : objectifs chiffrés suivis sur les données réelles du CRM (entonnoir cumulé), jamais sur la déclaration d'un agent.
import { $, esc, html, toast, fmtD } from "./ui.js";
import { q, S } from "./state.js";

export const METRIQUES = { qualifies: "Prospects qualifiés", contactes: "Prospects contactés", conversations: "Conversations engagées", rdv: "Rendez-vous confirmés", demos: "Démonstrations réalisées", offres: "Offres transmises", contrats: "Contrats signés" };
const ETAT = { en_bonne_voie: ["En bonne voie", "ok"], en_retard: ["En retard", "warn"], echeance_depassee: ["Échéance dépassée", "bad"], atteint: ["Atteint", "ok"], abandonne: ["Abandonné", ""] };
let rows = [], produits = [];

async function load() {
  rows = (await q(S.sb.rpc("ai_goals_etat"))) ?? [];
  produits = await q(S.sb.from("ai_products").select("id,nom").order("nom")).catch(() => []);
}

function draw(main) {
  const actifs = rows.filter((r) => r.statut === "actif"), clos = rows.filter((r) => r.statut !== "actif");
  const card = (r) => { const [lab, cl] = ETAT[r.etat] ?? [r.etat, ""], tone = r.etat === "en_retard" || r.etat === "echeance_depassee" ? "low" : r.etat === "en_bonne_voie" && r.pct < r.temps_pct ? "mid" : "";
    return html`<div class="card goal" data-id="${r.id}" style="margin-top:10px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b style="flex:1;min-width:200px">${r.titre}</b><span class="pill ${cl}">${lab}</span>
      ${r.statut === "actif" ? html`<button class="btn sm ok" type="button" data-go="atteint" title="Clôturer comme atteint">✔</button><button class="btn sm bad" type="button" data-go="abandonne" title="Abandonner">✕</button>` : ""}</div>
      <div class="gauge"><div class="l"><span>${r.fait} / ${r.cible} · ${METRIQUES[r.metrique] ?? r.metrique}${r.produit ? ` · ${r.produit}` : ""}</span><span>${r.pct} %</span></div><div class="bar ${tone}"><b style="width:${r.pct}%"></b></div></div>
      ${r.statut === "actif" || r.statut === "atteint" ? html`<div class="small" style="margin-top:4px">Qualité : <b>${r.joignables_pct ?? "—"} %</b> joignables · <b>${r.retours_pct ?? "—"} %</b> e-mails invalides · ${r.optout ?? 0} désinscrit(s) · coût IA <b>${r.cout_usd != null ? Number(r.cout_usd).toFixed(2) : "—"} $</b>${r.cout_unitaire != null ? ` (${Number(r.cout_unitaire).toFixed(2)} $ par unité)` : ""}</div>${r.alerte_qualite ? html`<div class="small" style="margin-top:4px;color:var(--warn,#d97706)">⚠ Résultat à contrôler : le chiffre est atteint mais la qualité des cibles est faible.</div>` : ""}` : ""}
      <div class="small muted">Temps écoulé ${r.temps_pct} % · échéance ${fmtD(r.echeance)} · départ ${r.baseline} · actuel ${r.actuel}${r.agent_nom ? ` · responsable ${r.agent_nom}` : ""}</div></div>`; };
  const d = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  main.innerHTML = html`<section class="panel"><h2>🎯 Objectifs</h2><p class="sub">Chaque objectif est mesuré sur les données réelles du CRM (entonnoir cumulé depuis la création), jamais sur la déclaration d'un agent.</p>
    <form id="goal-form" class="card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end"><label class="f" style="flex:2;min-width:200px">Objectif<input id="g-titre" maxlength="120" required placeholder="Ex. : 3 rendez-vous AluExpert"></label>
      <label class="f">Indicateur<select id="g-metrique">${Object.entries(METRIQUES).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label>
      <label class="f" style="width:90px">Cible<input id="g-cible" type="number" min="1" max="100000" required value="10"></label>
      <label class="f">Échéance<input id="g-echeance" type="date" required value="${d}"></label>
      <label class="f">Produit<select id="g-produit"><option value="">Tous</option>${produits.map((p) => html`<option value="${p.id}">${p.nom}</option>`)}</select></label>
      <label class="f">Responsable<select id="g-agent"><option value="">—</option>${S.agents.filter((a) => a.etat !== "archive").map((a) => html`<option value="${a.id}">${a.nom}</option>`)}</select></label>
      <button class="btn pri" type="submit">Créer</button></form>
    ${actifs.length ? actifs.map(card) : html`<div class="card muted" style="margin-top:10px">Aucun objectif actif.</div>`}
    ${clos.length ? html`<details style="margin-top:12px"><summary class="small muted">Clôturés (${clos.length})</summary>${clos.map(card)}</details>` : ""}</section>`.s;
  $("#goal-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await q(S.sb.rpc("ai_goal_creer", { p_titre: $("#g-titre").value, p_metrique: $("#g-metrique").value, p_cible: Number($("#g-cible").value), p_echeance: new Date($("#g-echeance").value + "T23:59:59").toISOString(), p_produit: $("#g-produit").value || null, p_agent: $("#g-agent").value || null }));
      toast("Objectif créé", "ok"); await load(); draw(main);
    } catch (err) { toast(err.message, "bad"); }
  };
  main.onclick = async (e) => {
    const b = e.target.closest("[data-go]"); if (!b) return;
    try { await q(S.sb.rpc("ai_goal_cloturer", { p_id: b.closest("[data-id]").dataset.id, p_statut: b.dataset.go })); toast("Objectif clôturé", "ok"); await load(); draw(main); }
    catch (err) { toast(err.message, "bad"); }
  };
}

export async function renderObjectifs(main) {
  main.innerHTML = `<section class="panel"><div class="card muted">Chargement…</div></section>`;
  try { await load(); draw(main); } catch (err) { main.innerHTML = html`<section class="panel"><div class="card muted">Objectifs indisponibles : ${err.message}</div></section>`.s; }
}
