// Onglet Constitution (direction) : règle supérieure applicable au DG AI, à Jarvis et à tous les agents, versionnée ; alertes de gouvernance.
import { $, esc, html, toast, fmtDT } from "./ui.js";
import { q, S } from "./state.js";

let cur = null, hist = [], journal = [];

async function load() {
  hist = (await q(S.sb.rpc("ai_constitution_historique"))) ?? [];
  cur = hist[0] ?? null;
  journal = (await q(S.sb.rpc("ai_gouvernance_journal", { p_jours: 30 })).catch(() => [])) ?? [];
}

function draw(main) {
  main.innerHTML = html`<section class="panel"><h2>📜 Constitution SANIX AI</h2><p class="sub">Règle supérieure applicable au DG AI, à Jarvis et à tous les agents. Seule la direction publie une nouvelle version ; l'historique est conservé.</p>
    <div class="card"><div class="small muted" style="margin-bottom:6px">Version ${cur?.version ?? "—"} · publiée ${cur ? fmtDT(cur.publie_at) : "—"}</div><pre id="const-txt" style="white-space:pre-wrap;font:inherit;margin:0">${cur?.contenu ?? "Aucune constitution publiée."}</pre></div>
    <details class="card" style="margin-top:12px"><summary><b>Réviser la constitution</b></summary><form id="const-form" style="margin-top:8px"><label class="f">Nouveau texte<textarea id="const-new" rows="12" maxlength="12000" required style="width:100%">${cur?.contenu ?? ""}</textarea></label>
      <label class="f">Motif de la révision<input id="const-motif" maxlength="300" required minlength="5" placeholder="Ex. : précision de l'article 2"></label><div class="actions"><button class="btn pri" type="submit">Publier une nouvelle version</button></div></form></details>
    ${hist.length > 1 ? html`<details class="card" style="margin-top:12px"><summary class="small muted">Historique (${hist.length} versions)</summary>${hist.map((h) => html`<div style="padding:6px 0;border-bottom:1px solid var(--line,#2a3140)"><b>v${h.version}</b> <span class="small muted">${fmtDT(h.publie_at)} · ${h.motif ?? ""}</span></div>`)}</details>` : ""}
    <div class="card" style="margin-top:12px" id="gov-journal"><h3 style="margin-top:0">Alertes de gouvernance (30 jours)</h3>${journal.length ? journal.map((j) => html`<div style="padding:5px 0;border-bottom:1px solid var(--line,#2a3140)"><span class="pill ${j.gravite === "critique" ? "bad" : "warn"}">${j.type}</span> <span class="small">${j.message}</span> <span class="small muted">· ${j.agent_nom ?? "—"} · ${fmtDT(j.created_at)}</span></div>`) : html`<p class="muted small">Aucune alerte de gouvernance.</p>`}</div></section>`.s;
  $("#const-form").onsubmit = async (e) => {
    e.preventDefault();
    if ($("#const-new").value.trim() === (cur?.contenu ?? "").trim()) { toast("Aucune modification du texte", "bad"); return; }
    if (!confirm("Publier une nouvelle version de la constitution ? Elle s'applique à tous les agents.")) return;
    try { const r = await q(S.sb.rpc("ai_constitution_publier", { p_contenu: $("#const-new").value, p_motif: $("#const-motif").value })); toast(`Version ${r?.version ?? ""} publiée`, "ok"); await load(); draw(main); }
    catch (err) { toast(err.message, "bad"); }
  };
}

export async function renderConstitution(main) {
  main.innerHTML = `<section class="panel"><div class="card muted">Chargement…</div></section>`;
  try { await load(); draw(main); } catch (err) { main.innerHTML = html`<section class="panel"><div class="card muted">Constitution indisponible : ${err.message}</div></section>`.s; }
}
