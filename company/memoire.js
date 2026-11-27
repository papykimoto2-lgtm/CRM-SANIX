// Centre mémoire (direction) : compteurs, souvenirs des agents (valider / invalider) et mémoire de Jarvis (consultable, épinglable, supprimable).
import { $, esc, html, toast, ago } from "./ui.js";
import { q, S } from "./state.js";

const CAT = { preference: "Préférence", decision: "Décision", consigne: "Consigne", fait: "Fait" };
let rows = [], centre = null, comp = [], liste = [], flt = { agent: "", statut: "" };

async function load() {
  rows = (await q(S.sb.rpc("ai_jarvis_memoire"))) ?? [];
  centre = await q(S.sb.rpc("ai_memoire_centre")).catch(() => null);
  const a = { p_n: 60 }; if (flt.agent === "partage") a.p_partage = true; else if (flt.agent) a.p_agent = flt.agent; if (flt.statut) a.p_statut = flt.statut;
  comp = centre ? ((await q(S.sb.rpc("ai_competences_mesurees")).catch(() => [])) ?? []) : [];
  liste = centre ? ((await q(S.sb.rpc("ai_memoire_liste", a)).catch(() => [])) ?? []) : [];
}
const kpi = (l, v) => html`<div class="card" style="flex:1;min-width:110px;text-align:center"><div style="font-size:22px;font-weight:700">${v}</div><div class="small muted">${l}</div></div>`;

function draw(main) {
  const C = centre;
  const centreHtml = C ? html`<h2>🧠 Centre mémoire</h2><p class="sub">Ce que SANIX retient. Un souvenir invalidé n'est plus jamais rappelé ni injecté aux agents.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${kpi("Souvenirs", C.souvenirs)}${kpi("Validés", C.valides)}${C.a_revalider ? kpi("↻ À revalider", C.a_revalider) : ""}${kpi("À vérifier", C.a_verifier)}${kpi("Expériences (missions)", C.experiences)}${kpi("Partagés", C.partages)}${kpi("Dossiers prospects", C.dossiers)}${kpi("Archivés", C.archives)}${C.erreurs_repetees ? kpi("⚠ Erreurs répétées", C.erreurs_repetees) : ""}</div>
    ${comp.length ? html`<div class="card" style="margin-top:12px"><h3 style="margin-top:0">Compétences mesurées (30 jours)</h3><p class="small muted">Niveau = moyenne des évaluations réelles des missions. « Insuffisant » sous 5 évaluations : aucun point gratuit.</p><table class="tbl" id="mc-comp"><thead><tr><th>Agent</th><th>Missions</th><th>Réalisation</th><th>Évaluées</th><th>Niveau</th></tr></thead><tbody>${comp.map((c) => html`<tr><td><b>${c.nom}</b><br><span class="small muted">${c.fonction}</span></td><td class="num">${c.missions}</td><td class="num">${c.taux} %</td><td class="num">${c.evaluees}</td><td class="num">${c.insuffisant ? html`<span class="muted small">insuffisant</span>` : html`<b>${c.niveau}</b>/100`}</td></tr>`)}</tbody></table></div>` : ""}
    <div class="card" style="margin-top:12px"><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px"><label class="f">Agent<select id="mc-agent"><option value="">Tous</option><option value="partage" ${flt.agent === "partage" ? "selected" : ""}>Partagée</option>${(C.par_agent ?? []).filter((x) => x.agent_id).map((x) => html`<option value="${x.agent_id}" ${flt.agent === x.agent_id ? "selected" : ""}>${x.nom} (${x.n})</option>`)}</select></label>
      <label class="f">Statut<select id="mc-statut">${[["", "Tous"], ["valide", "Validés"], ["a_verifier", "À vérifier"], ["experience", "Expériences"], ["a_revalider", "À revalider (> 90 j)"]].map(([v, l]) => html`<option value="${v}" ${flt.statut === v ? "selected" : ""}>${l}</option>`)}</select></label></div>
      <div id="mc-list">${liste.length ? liste.map((r) => html`<div class="row" style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--line,#2a3140)" data-id="${r.id}"><span class="pill">${r.agent_nom}</span><span style="flex:1">${r.contenu}${r.source ? html` <span class="small muted">· ${r.source}</span>` : ""}</span>
        <span class="pill" title="Indice indicatif de fiabilité (preuve + validation + fraîcheur), pas une probabilité de vérité">${r.fiabilite ?? 0}/100</span>${r.niveau_preuve ? html`<span class="pill" title="Niveau de preuve : 1 officiel … 6 forum">preuve ${r.niveau_preuve}</span>` : ""}<span class="small muted">${r.a_revalider ? "↻ à revalider" : r.statut === "valide" ? "✔ validé" : r.experience ? "mission" : "à vérifier"} · ${ago(r.created_at)}</span>
        ${r.statut === "valide" && !r.a_revalider ? "" : html`<select class="mc-niv" title="Niveau de preuve" style="width:auto"><option value="">preuve ?</option>${[[1, "1 officiel"], [2, "2 éditeur"], [3, "3 étude"], [4, "4 média"], [5, "5 témoignage"], [6, "6 forum"]].map(([v, l]) => html`<option value="${v}" ${r.niveau_preuve === v ? "selected" : ""}>${l}</option>`)}</select><button class="btn sm ok" type="button" data-mc="ok" title="${r.a_revalider ? "Revalider" : "Valider"}">${r.a_revalider ? "↻" : "✔"}</button>`}<button class="btn sm bad" type="button" data-mc="ko" title="Invalider (archivé)">✕</button></div>`) : html`<p class="muted small">Aucun souvenir pour ce filtre.</p>`}</div></div>` : "";
  main.innerHTML = html`<section class="panel">${centreHtml}<h2 style="margin-top:18px">🧠 Mémoire de Jarvis</h2>
    <p class="sub">Ce que Jarvis retient de vous (préférences, décisions, consignes). Dites « Jarvis, retiens que… » ou ajoutez ici. Jamais de mot de passe ni de clé : ils sont refusés.</p>
    <form id="mem-form" class="card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end"><label class="f" style="flex:1;min-width:220px">Nouveau souvenir<input id="mem-txt" maxlength="500" required placeholder="Ex. : je préfère les relances le matin"></label>
      <label class="f">Type<select id="mem-cat">${Object.entries(CAT).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label><button class="btn pri" type="submit">Mémoriser</button></form>
    <div class="card" style="margin-top:12px" id="mem-list">${rows.length ? rows.map((r) => html`<div class="row" style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line,#2a3140)" data-id="${r.id}">
      <span class="pill">${CAT[r.categorie] ?? r.categorie}</span><span style="flex:1">${r.contenu}</span><span class="small muted">${ago(r.created_at)}</span>
      <button class="btn sm" type="button" data-mem="pin" aria-pressed="${r.epingle}" title="Épingler (jamais effacé automatiquement)">${r.epingle ? "📌" : "📍"}</button>
      <button class="btn sm bad" type="button" data-mem="del" title="Oublier">✕</button></div>`) : html`<p class="muted small">Aucun souvenir pour l'instant.</p>`}</div>
    <p class="small muted" style="margin-top:8px">${rows.length}/100 souvenirs. Les plus anciens non épinglés sont retirés au-delà.</p></section>`.s;
  const refresh = async () => { await load(); draw(main); };
  if ($("#mc-agent")) {
    $("#mc-agent").onchange = (e) => { flt.agent = e.target.value; refresh().catch((err) => toast(err.message, "bad")); };
    $("#mc-statut").onchange = (e) => { flt.statut = e.target.value; refresh().catch((err) => toast(err.message, "bad")); };
    $("#mc-list").onclick = async (e) => {
      const b = e.target.closest("[data-mc]"); if (!b) return;
      const row = b.closest("[data-id]"), id = Number(row.dataset.id), ok = b.dataset.mc === "ok";
      try {
        let motif = null, type = null, niveau = null;
        if (ok) { const v = row.querySelector(".mc-niv")?.value; niveau = v ? Number(v) : null; }
        else { motif = prompt("Motif : obsolète, contredit, faux ou autre (+ précision facultative)"); if (motif === null) return; type = /^\s*obsol/i.test(motif) ? "obsolete" : /^\s*contredit/i.test(motif) ? "contredit" : /^\s*faux/i.test(motif) ? "faux" : "autre"; }
        await q(S.sb.rpc("ai_memoire_valider", { p_id: id, p_ok: ok, p_motif: motif || null, p_niveau: niveau, p_motif_type: type })); toast(ok ? "Souvenir validé" : "Souvenir archivé", "ok"); await refresh();
      } catch (err) { toast(err.message, "bad"); }
    };
  }
  $("#mem-form").onsubmit = async (e) => {
    e.preventDefault();
    try { await q(S.sb.rpc("ai_jarvis_memoriser", { p_contenu: $("#mem-txt").value, p_categorie: $("#mem-cat").value })); toast("Mémorisé", "ok"); await load(); draw(main); }
    catch (err) { toast(err.message, "bad"); }
  };
  $("#mem-list").onclick = async (e) => {
    const b = e.target.closest("[data-mem]"); if (!b) return;
    const id = Number(b.closest("[data-id]").dataset.id);
    try {
      if (b.dataset.mem === "del") { if (!confirm("Oublier ce souvenir ?")) return; await q(S.sb.rpc("ai_jarvis_oublier", { p_id: id })); }
      else await q(S.sb.rpc("ai_jarvis_epingler", { p_id: id, p_on: b.getAttribute("aria-pressed") !== "true" }));
      await load(); draw(main);
    } catch (err) { toast(err.message, "bad"); }
  };
}

export async function renderMemoire(main) {
  main.innerHTML = `<section class="panel"><div class="card muted">Chargement…</div></section>`;
  try { await load(); draw(main); } catch (err) { main.innerHTML = html`<section class="panel"><div class="card muted">Mémoire indisponible : ${err.message}</div></section>`.s; }
}
