// SANIX AI — PARAMÉTRAGE (direction) : logiciels, équipes (cellules par logiciel), agents et rôles.
// Rien de l'organisation ni du catalogue n'est figé dans le code : cet écran lit et modifie les tables ai_products, ai_roles, ai_cells, ai_cell_members et
// ai_agents par les fonctions d'administration ai_cfg_* (direction seule, journalisées côté serveur).
import { $, closeModal, html, openModal, raw, toast } from "./ui.js";
import { q, S } from "./state.js";

let D = { products: [], pricing: [], aliases: [], roles: [], cells: [], members: [], rules: [], funnel: [], pilote: [], phase3: false }, sec = "logiciels", hooks = {}, apercu = null;
/** app.js fournit le rechargement des agents (évite une importation circulaire). */
export const setHooks = (h) => { hooks = h; };
const SECTIONS = [["logiciels", "💻 Logiciels"], ["equipes", "🧩 Équipes"], ["agents", "🤖 Agents"], ["roles", "🎭 Rôles"], ["pilote", "🎯 Pilote"]];
const lines = (a) => (a ?? []).join("\n"), csv = (a) => (a ?? []).join(", ");
const split = (s, sep) => String(s ?? "").split(sep).map((x) => x.trim()).filter(Boolean);
const productName = (id) => D.products.find((p) => p.id === id)?.nom ?? id ?? "—";
const roleName = (c) => D.roles.find((r) => r.code === c)?.libelle ?? (c || "—");
const agentName = (id) => S.agents.find((a) => a.id === id)?.nom ?? "—";
const agentsActifs = () => S.agents.filter((a) => a.etat !== "archive");

export async function loadConfig() {
  const [products, pricing, aliases, roles, cells, members] = await Promise.all([
    q(S.sb.from("ai_products").select("*").order("nom")),
    q(S.sb.from("ai_pricing").select("product_id,actif")),
    q(S.sb.from("ai_product_aliases").select("alias,product_id").order("alias")),
    q(S.sb.from("ai_roles").select("*").order("niveau").order("libelle")),
    q(S.sb.from("ai_cells").select("*").order("nom")),
    q(S.sb.from("ai_cell_members").select("*").order("ordre")),
  ]);
  // Phase 3 (segmentation et pilote) : tolérant à l'absence de la migration, sans empêcher les autres sections
  let rules = [], funnel = [], pilote = [], phase3 = false;
  try {
    [rules, funnel, pilote] = await Promise.all([
      q(S.sb.from("ai_segment_rules").select("*").order("priorite").order("id")),
      q(S.sb.from("ai_pilote_entonnoir").select("*").order("segment")),
      q(S.sb.from("ai_pilote").select("prospect_id,product_id,raison,ai_prospects(entreprise,secteur,telephone,email)").order("product_id")),
    ]);
    phase3 = true;
  } catch { /* migration 20261115 non appliquée */ }
  D = { products: products ?? [], pricing: pricing ?? [], aliases: aliases ?? [], roles: roles ?? [], cells: cells ?? [], members: members ?? [], rules: rules ?? [], funnel: funnel ?? [], pilote: pilote ?? [], phase3 };
}

const rpc = async (name, args) => { try { const r = await q(S.sb.rpc(name, args)); return r ?? {}; } catch (e) { toast(e.message, "bad"); throw e; } };
async function refresh(main = $("#main")) { await loadConfig(); renderConfig(main); }

export function renderConfig(main) {
  main.innerHTML = html`<div class="head"><h2>🛠️ Paramétrage</h2><p class="muted small">Logiciels vendus, équipes, agents et rôles : tout se modifie ici, sans toucher au code. Les changements sont journalisés.</p></div>
    <div class="actions" role="tablist" style="margin-bottom:14px">${SECTIONS.map(([k, l]) => html`<button class="btn ${sec === k ? "pri" : ""}" type="button" data-act="cfg-sec" data-sec="${k}">${l}</button>`)}</div>
    ${raw(({ logiciels: viewProducts, equipes: viewCells, agents: viewAgents, roles: viewRoles, pilote: viewPilote }[sec])().toString())}`.s;
  const pf = $("#cfg-pilote-form");                                           // sélection du pilote : quotas par logiciel actif
  if (pf) pf.onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(pf), quotas = {};
    for (const p of D.products.filter((x) => x.actif)) quotas[p.id] = Number(f.get(`q_${p.id}`) || 0);
    try {
      const r = await rpc("ai_choisir_pilote", { p_quotas: quotas });
      const manque = Object.entries(r).filter(([, v]) => v.manque > 0).map(([k, v]) => `${productName(k)} : ${v.manque} manquant(s)`);
      toast(manque.length ? `Pilote sélectionné — ${manque.join(" ; ")}` : "Pilote sélectionné", "ok"); await refresh(main);
    } catch { /* affiché */ }
  };
}

// ─── Logiciels ───────────────────────────────────────────────────────────────
function viewProducts() {
  const tarif = (id) => D.pricing.some((p) => p.product_id === id && p.actif);
  return html`<div class="actions" style="margin-bottom:10px"><button class="btn pri" type="button" data-act="cfg-product-new">＋ Nouveau logiciel</button></div>
    <p class="small muted">Seuls les logiciels <b>actifs</b> sont présentés et recommandés par les agents. Un nouveau logiciel est créé inactif ; il faut aussi une grille tarifaire officielle pour que les agents puissent établir des offres.</p>
    <div class="scroll"><table class="tbl"><thead><tr><th>Logiciel</th><th>Marché cible</th><th>Cellule</th><th>Tarif officiel</th><th>État</th><th></th></tr></thead><tbody>${D.products.map((p) => {
      const cell = D.cells.find((c) => c.product_id === p.id && c.actif);
      return html`<tr><td><b>${p.nom}</b><div class="small muted">${p.id}</div></td><td>${p.marche_cible}</td><td>${cell ? cell.nom : "—"}</td>
        <td>${tarif(p.id) ? "✓" : "⚠️ aucune grille"}</td><td>${p.actif ? "Actif" : "Inactif"}</td>
        <td class="actions"><button class="btn sm" type="button" data-act="cfg-product-toggle" data-id="${p.id}">${p.actif ? "Désactiver" : "Activer"}</button><button class="btn sm" type="button" data-act="cfg-product-edit" data-id="${p.id}">Modifier</button></td></tr>`;
    })}</tbody></table></div>`;
}
function productForm(p) {
  const aliases = D.aliases.filter((a) => a.product_id === p?.id).map((a) => a.alias);
  openModal(html`<h3>${p ? `Modifier ${p.nom}` : "Nouveau logiciel"}</h3><form id="cfg-form" class="form">
    ${p ? "" : html`<label class="f">Identifiant<input name="id" required pattern="[a-z0-9_]{2,40}" placeholder="ex. monlogiciel"></label>`}
    <label class="f">Nom<input name="nom" required maxlength="120" value="${p?.nom ?? ""}"></label>
    <label class="f">Marché cible<input name="marche_cible" required maxlength="300" value="${p?.marche_cible ?? ""}"></label>
    <label class="f">Secteurs (séparés par des virgules)<input name="secteurs" value="${csv(p?.secteurs)}"></label>
    <label class="f">Mots-clés (séparés par des virgules)<input name="mots_cles" value="${csv(p?.mots_cles)}"></label>
    <label class="f">Noms utilisés dans le CRM (virgules)<input name="aliases" value="${csv(aliases)}" placeholder="ex. nom commercial, ancien nom"></label>
    <label class="f" style="grid-column:1/-1">Fonctionnalités réellement livrées (une par ligne)<textarea name="fonctionnalites" rows="4">${lines(p?.fonctionnalites)}</textarea></label>
    <label class="f" style="grid-column:1/-1">Questions de découverte (une par ligne)<textarea name="questions" rows="3">${lines(p?.questions_decouverte)}</textarea></label>
    <label class="f" style="grid-column:1/-1">Argumentaire<textarea name="argumentaire" rows="3">${p?.argumentaire ?? ""}</textarea></label>
    <div class="actions" style="grid-column:1/-1"><button class="btn pri" type="submit">Enregistrer</button><button class="btn" type="button" data-act="close-modal">Annuler</button></div></form>`);
  $("#cfg-form").onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.currentTarget), id = p?.id ?? String(f.get("id")).trim().toLowerCase();
    try {
      await rpc("ai_cfg_save_product", { p_id: id, p: { nom: f.get("nom"), marche_cible: f.get("marche_cible"), secteurs: split(f.get("secteurs"), ","), mots_cles: split(f.get("mots_cles"), ","),
        fonctionnalites: split(f.get("fonctionnalites"), "\n"), questions_decouverte: split(f.get("questions"), "\n"), argumentaire: f.get("argumentaire") } });
      const want = new Set(split(f.get("aliases"), ",").map((x) => x.toLowerCase())), have = new Set(aliases);
      for (const a of want) if (!have.has(a)) await rpc("ai_cfg_set_alias", { p_alias: a, p_product: id, p_on: true });
      for (const a of have) if (!want.has(a)) await rpc("ai_cfg_set_alias", { p_alias: a, p_product: id, p_on: false });
      closeModal(); toast("Logiciel enregistré", "ok"); await refresh();
    } catch { /* message déjà affiché */ }
  };
}

// ─── Équipes (cellules) ──────────────────────────────────────────────────────
function viewCells() {
  const rolesCommerciaux = D.roles.filter((r) => r.actif && (r.departement_id === "commercial" || D.members.some((m) => m.role_code === r.code)));
  return html`<div class="actions" style="margin-bottom:10px"><button class="btn pri" type="button" data-act="cfg-cell-new">＋ Nouvelle cellule</button></div>
    <p class="small muted">Une cellule regroupe, pour un logiciel, les agents qui tiennent chaque rôle. Un même agent peut servir plusieurs cellules (mutualisation). Un rôle sans agent est un <b>poste vacant</b> : le moteur se rabat alors sur tout agent actif portant ce rôle.</p>
    ${D.cells.map((c) => html`<div class="card" style="margin-bottom:14px"><div class="actions" style="justify-content:space-between"><div><b>${c.nom}</b> <span class="small muted">· ${productName(c.product_id)}${c.actif ? "" : " · inactive"}</span></div>
      <div class="actions"><label class="small">Responsable <select data-act-change="cfg-cell-resp" data-id="${c.id}"><option value="">—</option>${agentsActifs().filter((a) => a.niveau >= 2 && a.niveau <= 4).map((a) => html`<option value="${a.id}" ${a.id === c.responsable_agent_id ? "selected" : ""}>${a.nom}</option>`)}</select></label>
      <button class="btn sm" type="button" data-act="cfg-cell-toggle" data-id="${c.id}">${c.actif ? "Désactiver" : "Activer"}</button></div></div>
      <div class="scroll"><table class="tbl"><thead><tr><th>Rôle</th><th>Agents</th><th>Ajouter</th></tr></thead><tbody>${rolesCommerciaux.map((r) => {
        const ms = D.members.filter((m) => m.cell_id === c.id && m.role_code === r.code);
        return html`<tr><td>${r.libelle}</td><td>${ms.length ? ms.map((m) => html`<span class="pill" style="--c:#2563eb"><i></i>${agentName(m.agent_id)} <button class="btn sm" type="button" data-act="cfg-member-del" data-cell="${c.id}" data-role="${r.code}" data-agent="${m.agent_id}" aria-label="Retirer ${agentName(m.agent_id)}">✕</button></span> `) : html`<span class="muted small">poste vacant</span>`}</td>
          <td><select data-act-change="cfg-member-add" data-cell="${c.id}" data-role="${r.code}"><option value="">＋</option>${agentsActifs().filter((a) => !ms.some((m) => m.agent_id === a.id)).map((a) => html`<option value="${a.id}">${a.nom}</option>`)}</select></td></tr>`;
      })}</tbody></table></div></div>`)}`;
}
function cellForm() {
  const libres = D.products.filter((p) => !D.cells.some((c) => c.product_id === p.id && c.actif));
  if (!libres.length) { toast("Tous les logiciels du catalogue ont déjà une cellule active", "bad"); return; }
  openModal(html`<h3>Nouvelle cellule</h3><form id="cfg-form" class="form">
    <label class="f">Identifiant<input name="id" required pattern="[a-z0-9_]{2,40}"></label><label class="f">Nom<input name="nom" required maxlength="120"></label>
    <label class="f">Logiciel<select name="product_id">${libres.map((p) => html`<option value="${p.id}">${p.nom}${p.actif ? "" : " (inactif)"}</option>`)}</select></label>
    <div class="actions" style="grid-column:1/-1"><button class="btn pri" type="submit">Créer</button><button class="btn" type="button" data-act="close-modal">Annuler</button></div></form>`);
  $("#cfg-form").onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    try { await rpc("ai_cfg_save_cell", { p: { id: f.get("id"), nom: f.get("nom"), product_id: f.get("product_id") } }); closeModal(); toast("Cellule créée", "ok"); await refresh(); } catch { /* affiché */ }
  };
}

// ─── Agents ──────────────────────────────────────────────────────────────────
function viewAgents() {
  return html`<div class="actions" style="margin-bottom:10px"><button class="btn pri" type="button" data-act="cfg-agent-new">＋ Créer un agent</button></div>
    <p class="small muted">Un agent est créé depuis un <b>rôle</b> (modèle de poste : niveau, outils, charte type) ; tout peut être ajusté. Suspendre ou réactiver un agent se fait depuis le bureau 3D ou l'organisation.</p>
    <div class="scroll"><table class="tbl"><thead><tr><th>Agent</th><th>Rôle</th><th>Niv.</th><th>Responsable</th><th>État</th><th class="num">Outils</th><th></th></tr></thead><tbody>${agentsActifs().map((a) => html`<tr><td><b>${a.nom}</b><div class="small muted">${a.fonction}</div></td>
      <td>${roleName(a.role_code)}</td><td>${a.niveau}</td><td>${a.manager_id ? agentName(a.manager_id) : "—"}</td><td>${a.etat}</td><td class="num">${(a.outils ?? []).length}</td>
      <td><button class="btn sm" type="button" data-act="cfg-agent-edit" data-id="${a.id}">Modifier</button></td></tr>`)}</tbody></table></div>`;
}
const opts = (list, sel, label = (x) => x.nom, key = (x) => x.id) => list.map((x) => html`<option value="${key(x)}" ${key(x) === sel ? "selected" : ""}>${label(x)}</option>`);
function agentForm(a) {
  const roles = D.roles.filter((r) => r.actif || r.code === a?.role_code), managers = agentsActifs().filter((m) => m.id !== a?.id);
  openModal(html`<h3>${a ? `Modifier ${a.nom}` : "Créer un agent"}</h3><form id="cfg-form" class="form">
    <label class="f">Rôle<select name="role_code" id="cfg-role">${a ? "" : html`<option value="">— choisir —</option>`}${opts(roles, a?.role_code, (r) => `${r.libelle} (niv. ${r.niveau})`, (r) => r.code)}</select></label>
    <label class="f">Nom<input name="nom" required maxlength="80" value="${a?.nom ?? ""}"></label>
    <label class="f">Fonction<input name="fonction" maxlength="120" value="${a?.fonction ?? ""}" placeholder="par défaut : libellé du rôle"></label>
    <label class="f">Responsable<select name="manager_id"><option value="">—</option>${opts(managers, a?.manager_id, (m) => `${m.nom} (niv. ${m.niveau})`)}</select></label>
    <label class="f">Département<select name="departement_id">${opts(S.depts, a?.departement_id ?? "commercial", (d) => d.nom)}</select></label>
    <label class="f">Effort<select name="effort">${["low", "medium", "high"].map((x) => html`<option ${x === (a?.effort ?? "medium") ? "selected" : ""}>${x}</option>`)}</select></label>
    <label class="f">Budget IA par jour ($, vide = défaut)<input name="budget" type="number" min="0" step="0.5" value="${a?.budget_jour_usd ?? ""}"></label>
    ${a ? "" : html`<label class="f">Cellule<select name="cell_id"><option value="">—</option>${opts(D.cells, "", (c) => c.nom)}</select></label>`}
    <label class="f" style="grid-column:1/-1">Outils (séparés par des virgules ; vide = ceux du rôle)<textarea name="outils" rows="2">${csv(a?.outils)}</textarea></label>
    <div class="actions" style="grid-column:1/-1"><button class="btn pri" type="submit">${a ? "Enregistrer" : "Créer l'agent"}</button><button class="btn" type="button" data-act="close-modal">Annuler</button></div></form>`);
  $("#cfg-role").onchange = (e) => {                                             // création : le rôle pré-remplit la fonction et les outils
    if (a) return; const r = D.roles.find((x) => x.code === e.target.value); if (!r) return;
    const f = $("#cfg-form"); if (!f.fonction.value) f.fonction.value = r.libelle; f.outils.value = csv(r.outils); if (r.departement_id) f.departement_id.value = r.departement_id;
  };
  $("#cfg-form").onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.currentTarget), outils = split(f.get("outils"), ",");
    try {
      if (a) {
        await rpc("ai_cfg_update_agent", { p_agent: a.id, p: { role_code: f.get("role_code") || null, nom: f.get("nom"), fonction: f.get("fonction") || a.fonction, manager_id: f.get("manager_id") || null,
          departement_id: f.get("departement_id"), effort: f.get("effort"), budget_jour_usd: f.get("budget") === "" ? null : f.get("budget"), outils } });
      } else {
        const p = { role_code: f.get("role_code"), nom: f.get("nom"), departement_id: f.get("departement_id"), manager_id: f.get("manager_id") || null, effort: f.get("effort"),
          budget_jour_usd: f.get("budget") === "" ? null : f.get("budget"), cell_id: f.get("cell_id") || null }; if (f.get("fonction")) p.fonction = f.get("fonction"); if (outils.length) p.outils = outils;
        await rpc("ai_cfg_create_agent", { p });
      }
      closeModal(); toast(a ? "Agent modifié" : "Agent créé", "ok"); await hooks.reloadCore?.(); await refresh();
    } catch { /* affiché */ }
  };
}

// ─── Rôles ───────────────────────────────────────────────────────────────────
function viewRoles() {
  return html`<div class="actions" style="margin-bottom:10px"><button class="btn pri" type="button" data-act="cfg-role-new">＋ Nouveau rôle</button></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Rôle</th><th>Niv.</th><th>Département</th><th class="num">Outils</th><th>Agents</th><th>État</th><th></th></tr></thead><tbody>${D.roles.map((r) => html`<tr><td><b>${r.libelle}</b><div class="small muted">${r.code}</div></td><td>${r.niveau}</td>
      <td>${r.departement_id ?? "—"}</td><td class="num">${(r.outils ?? []).length}</td><td>${S.agents.filter((a) => a.role_code === r.code && a.etat !== "archive").length}</td><td>${r.actif ? "Actif" : "Inactif"}</td>
      <td><button class="btn sm" type="button" data-act="cfg-role-edit" data-id="${r.code}">Modifier</button></td></tr>`)}</tbody></table></div>`;
}
function roleForm(r) {
  openModal(html`<h3>${r ? `Modifier ${r.libelle}` : "Nouveau rôle"}</h3><form id="cfg-form" class="form">
    ${r ? "" : html`<label class="f">Code<input name="code" required pattern="[a-z0-9_]{3,40}"></label>`}
    <label class="f">Libellé<input name="libelle" required maxlength="120" value="${r?.libelle ?? ""}"></label>
    <label class="f">Niveau (1 DG · 2 directeur · 3 responsable · 4 superviseur · 5 agent)<input name="niveau" type="number" min="1" max="5" required value="${r?.niveau ?? 5}"></label>
    <label class="f">Département<select name="departement_id"><option value="">—</option>${opts(S.depts, r?.departement_id, (d) => d.nom)}</select></label>
    <label class="f">Effort<select name="effort">${["low", "medium", "high"].map((x) => html`<option ${x === (r?.effort ?? "medium") ? "selected" : ""}>${x}</option>`)}</select></label>
    <label class="f" style="grid-column:1/-1">Description (devient la mission principale de la charte)<textarea name="description" rows="2" maxlength="1000">${r?.description ?? ""}</textarea></label>
    <label class="f" style="grid-column:1/-1">Outils par défaut (séparés par des virgules)<textarea name="outils" rows="2">${csv(r?.outils)}</textarea></label>
    <label class="f"><span>Actif</span><select name="actif"><option value="true" ${r?.actif !== false ? "selected" : ""}>Oui</option><option value="false" ${r?.actif === false ? "selected" : ""}>Non</option></select></label>
    <div class="actions" style="grid-column:1/-1"><button class="btn pri" type="submit">Enregistrer</button><button class="btn" type="button" data-act="close-modal">Annuler</button></div></form>`);
  $("#cfg-form").onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    try {
      await rpc("ai_cfg_save_role", { p: { code: r?.code ?? String(f.get("code")).trim().toLowerCase(), libelle: f.get("libelle"), niveau: Number(f.get("niveau")), departement_id: f.get("departement_id"),
        effort: f.get("effort"), description: f.get("description"), outils: split(f.get("outils"), ","), actif: f.get("actif") === "true" } });
      closeModal(); toast("Rôle enregistré", "ok"); await refresh();
    } catch { /* affiché */ }
  };
}

// ─── Pilote : segmentation par logiciel, sélection, entonnoir mesuré ─────────
const SEG_SPECIAUX = { hors_perimetre: "Hors périmètre commercial actuel", a_verifier: "À vérifier (Industrie sans indice d'activité)", non_segmente: "Non segmenté" };
const segName = (s) => SEG_SPECIAUX[s] ?? productName(s);
function viewPilote() {
  if (!D.phase3) return html`<div class="card"><p class="muted">La migration <b>20261115000000_phase3_pilote.sql</b> n'est pas encore appliquée : segmentation et pilote indisponibles.</p></div>`;
  const f = (n) => num(n), actifs = D.products.filter((p) => p.actif);
  return html`<p class="small muted">La segmentation range chaque prospect dans le logiciel qu'il peut acheter (règles ci-dessous, modifiables), « à vérifier » ou « hors périmètre ». Rien n'est forcé : l'Industrie sans indice reste à confirmer par l'enrichissement. Le pilote prend les prospects les plus joignables, dans la limite de ce qui existe.</p>
    <div class="card" style="margin-bottom:14px"><b>Entonnoir par logiciel (données réelles)</b><div class="scroll"><table class="tbl"><thead><tr><th>Segment</th><th class="num">Prospects</th><th class="num">Pilote</th><th class="num">Qualifiés</th><th class="num">Prioritaires</th><th class="num">Contactés</th><th class="num">Réponses</th><th class="num">RDV</th><th class="num">Démos</th><th class="num">Offres</th><th class="num">CA CRM HT</th><th class="num">Coût IA</th></tr></thead><tbody>${D.funnel.map((r) => html`<tr><td><b>${segName(r.segment)}</b></td><td class="num">${f(r.prospects)}</td><td class="num">${f(r.dans_le_pilote)}</td><td class="num">${f(r.qualifies)}</td><td class="num">${f(r.prioritaires)}</td><td class="num">${f(r.contactes)}</td><td class="num">${f(r.reponses)}</td><td class="num">${f(r.rendez_vous)}</td><td class="num">${f(r.demonstrations)}</td><td class="num">${f(r.offres)}</td><td class="num">${f(r.ca_ht_crm)}</td><td class="num">$${Number(r.cout_ia_usd ?? 0).toFixed(2)}</td></tr>`)}</tbody></table></div></div>
    <div class="card" style="margin-bottom:14px"><div class="actions" style="justify-content:space-between"><b>Règles de segmentation</b><div class="actions"><button class="btn sm" type="button" data-act="cfg-rule-new">＋ Règle</button><button class="btn sm" type="button" data-act="cfg-seg-preview">Aperçu de la répartition</button><button class="btn sm pri" type="button" data-act="cfg-seg-apply">Appliquer</button></div></div>
      ${apercu ? html`<p class="small" id="cfg-apercu">Aperçu (rien n'est enregistré) : ${Object.entries(apercu.segments_calcules ?? {}).map(([k, v]) => `${segName(k)} ${v}`).join(" · ")} — ${apercu.deja_travailles ?? 0} fiche(s) déjà travaillée(s) jamais modifiée(s), ${apercu.choix_manuels ?? 0} choix manuel(s) conservé(s).</p>` : ""}
      <div class="scroll"><table class="tbl"><thead><tr><th class="num">Priorité</th><th>Champ</th><th>Motif (expression régulière, sans accents)</th><th>Segment</th><th>État</th><th></th></tr></thead><tbody>${D.rules.map((r) => html`<tr><td class="num">${r.priorite}</td><td>${r.champ}</td><td><code>${r.motif}</code><div class="small muted">${r.note ?? ""}</div></td><td>${segName(r.segment)}</td><td>${r.actif ? "Active" : "Inactive"}</td><td><button class="btn sm" type="button" data-act="cfg-rule-toggle" data-id="${r.id}">${r.actif ? "Désactiver" : "Activer"}</button></td></tr>`)}</tbody></table></div></div>
    <div class="card"><b>Sélection du pilote (30 à 50 prospects réels)</b>
      <form id="cfg-pilote-form" class="form" style="margin:10px 0">${actifs.map((p) => html`<label class="f">${p.nom}<input name="q_${p.id}" type="number" min="0" max="200" value="${D.pilote.filter((x) => x.product_id === p.id).length || (p.id === "avicosuite" ? 10 : 20)}"></label>`)}<div class="actions" style="align-self:end"><button class="btn pri" type="submit">Sélectionner</button></div></form>
      <div class="scroll"><table class="tbl"><thead><tr><th>Entreprise</th><th>Logiciel</th><th>Contacts</th><th>Raison</th><th></th></tr></thead><tbody>${D.pilote.map((x) => html`<tr><td>${x.ai_prospects?.entreprise ?? "—"}</td><td>${productName(x.product_id)}</td><td>${[x.ai_prospects?.telephone ? "tél." : "", x.ai_prospects?.email ? "e-mail" : ""].filter(Boolean).join(" + ") || "—"}</td><td class="small muted">${x.raison ?? ""}</td><td><button class="btn sm" type="button" data-act="cfg-pilote-del" data-id="${x.prospect_id}">Retirer</button></td></tr>`)}</tbody></table></div>
      ${D.pilote.length ? "" : html`<p class="muted small">Aucun prospect dans le pilote. Appliquez d'abord la segmentation, puis sélectionnez.</p>`}</div>`;
}
function ruleForm() {
  const segs = [...D.products.map((p) => [p.id, p.nom]), ["hors_perimetre", SEG_SPECIAUX.hors_perimetre], ["a_verifier", SEG_SPECIAUX.a_verifier]];
  openModal(html`<h3>Nouvelle règle de segmentation</h3><form id="cfg-form" class="form"><label class="f">Champ<select name="champ"><option value="entreprise">Nom de l'entreprise</option><option value="secteur">Secteur</option><option value="resume_ia">Résumé IA</option></select></label>
    <label class="f">Motif (expression régulière)<input name="motif" required maxlength="300" placeholder="ex. \\mpoulet|ferme"></label>
    <label class="f">Segment<select name="segment">${segs.map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label>
    <label class="f">Priorité (plus petit = d'abord)<input name="priorite" type="number" value="15"></label><label class="f" style="grid-column:1/-1">Note<input name="note" maxlength="300"></label>
    <div class="actions" style="grid-column:1/-1"><button class="btn pri" type="submit">Enregistrer</button><button class="btn" type="button" data-act="close-modal">Annuler</button></div></form>`);
  $("#cfg-form").onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    try { await rpc("ai_cfg_save_segment_rule", { p: { champ: f.get("champ"), motif: f.get("motif"), segment: f.get("segment"), priorite: Number(f.get("priorite")), note: f.get("note") } }); closeModal(); toast("Règle enregistrée", "ok"); apercu = null; await refresh(); } catch { /* affiché */ }
  };
}
const num = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 0 }));

// ─── Actions (déléguées par app.js : data-act="cfg-…" et data-act-change="cfg-…") ───
export async function configAction(el, ev) {
  const a = el.dataset.act ?? el.dataset.actChange, id = el.dataset.id, main = $("#main");
  try {
    if (a === "cfg-sec") { sec = el.dataset.sec; renderConfig(main); }
    else if (a === "cfg-product-new") productForm(null);
    else if (a === "cfg-product-edit") productForm(D.products.find((p) => p.id === id));
    else if (a === "cfg-product-toggle") { const p = D.products.find((x) => x.id === id); await rpc("ai_cfg_save_product", { p_id: id, p: { actif: !p.actif } }); toast(p.actif ? "Logiciel désactivé" : "Logiciel activé", "ok"); await refresh(main); }
    else if (a === "cfg-cell-new") cellForm();
    else if (a === "cfg-cell-toggle") { const c = D.cells.find((x) => x.id === id); await rpc("ai_cfg_save_cell", { p: { id, actif: !c.actif } }); await refresh(main); }
    else if (a === "cfg-cell-resp") { await rpc("ai_cfg_save_cell", { p: { id, responsable_agent_id: el.value || null } }); toast("Responsable enregistré", "ok"); await refresh(main); }
    else if (a === "cfg-member-add") { if (!el.value) return; await rpc("ai_cfg_set_member", { p_cell: el.dataset.cell, p_role: el.dataset.role, p_agent: el.value, p_on: true, p_ordre: 0 }); await refresh(main); }
    else if (a === "cfg-member-del") { await rpc("ai_cfg_set_member", { p_cell: el.dataset.cell, p_role: el.dataset.role, p_agent: el.dataset.agent, p_on: false, p_ordre: 0 }); await refresh(main); }
    else if (a === "cfg-agent-new") agentForm(null);
    else if (a === "cfg-agent-edit") agentForm(S.agents.find((x) => x.id === id));
    else if (a === "cfg-role-new") roleForm(null);
    else if (a === "cfg-role-edit") roleForm(D.roles.find((x) => x.code === id));
    else if (a === "cfg-rule-new") ruleForm();
    else if (a === "cfg-rule-toggle") { const r = D.rules.find((x) => String(x.id) === id); await rpc("ai_cfg_save_segment_rule", { p: { id: Number(id), actif: !r.actif } }); apercu = null; await refresh(main); }
    else if (a === "cfg-seg-preview") { apercu = await rpc("ai_segmenter_prospects", { p_appliquer: false }); renderConfig(main); }
    else if (a === "cfg-seg-apply") {
      if (!confirm("Appliquer la segmentation ? Les fiches « identifié » ou « enregistré » reçoivent leur segment et leur logiciel recommandé ; les fiches déjà travaillées et les choix manuels ne sont jamais modifiés.")) return;
      const r = await rpc("ai_segmenter_prospects", { p_appliquer: true }); apercu = r; toast(`${r.fiches_modifiees ?? 0} fiche(s) segmentée(s)`, "ok"); await refresh(main);
    }
    else if (a === "cfg-pilote-del") { await rpc("ai_cfg_pilote_set", { p_prospect: id, p_on: false }); await refresh(main); }
  } catch { /* message déjà affiché par rpc() */ }
}
