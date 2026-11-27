// Onglet Mémoire (direction) : souvenirs de Jarvis, consultables, épinglables, supprimables.
import { $, esc, html, toast, ago } from "./ui.js";
import { q, S } from "./state.js";

const CAT = { preference: "Préférence", decision: "Décision", consigne: "Consigne", fait: "Fait" };
let rows = [];

async function load() { rows = (await q(S.sb.rpc("ai_jarvis_memoire"))) ?? []; }

function draw(main) {
  main.innerHTML = html`<section class="panel"><h2>🧠 Mémoire de Jarvis</h2>
    <p class="sub">Ce que Jarvis retient de vous (préférences, décisions, consignes). Dites « Jarvis, retiens que… » ou ajoutez ici. Jamais de mot de passe ni de clé : ils sont refusés.</p>
    <form id="mem-form" class="card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end"><label class="f" style="flex:1;min-width:220px">Nouveau souvenir<input id="mem-txt" maxlength="500" required placeholder="Ex. : je préfère les relances le matin"></label>
      <label class="f">Type<select id="mem-cat">${Object.entries(CAT).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label><button class="btn pri" type="submit">Mémoriser</button></form>
    <div class="card" style="margin-top:12px" id="mem-list">${rows.length ? rows.map((r) => html`<div class="row" style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line,#2a3140)" data-id="${r.id}">
      <span class="pill">${CAT[r.categorie] ?? r.categorie}</span><span style="flex:1">${r.contenu}</span><span class="small muted">${ago(r.created_at)}</span>
      <button class="btn sm" type="button" data-mem="pin" aria-pressed="${r.epingle}" title="Épingler (jamais effacé automatiquement)">${r.epingle ? "📌" : "📍"}</button>
      <button class="btn sm bad" type="button" data-mem="del" title="Oublier">✕</button></div>`) : html`<p class="muted small">Aucun souvenir pour l'instant.</p>`}</div>
    <p class="small muted" style="margin-top:8px">${rows.length}/100 souvenirs. Les plus anciens non épinglés sont retirés au-delà.</p></section>`.s;
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
