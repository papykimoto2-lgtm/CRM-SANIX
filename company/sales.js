// SANIX AI SALES — interface commerciale reliée aux tables commerciales du même projet Supabase que CRM.
import { $, ago, closeModal, fmtDT, html, num, openModal, pill, raw, toast, usd } from "./ui.js";
import { q, S } from "./state.js";

const STAGES = [
  ["identifie","Identifié"],["enregistre","Enregistré"],["qualifie","Qualifié"],
  ["premier_contact","Premier contact"],["conversation","Conversation"],
  ["besoin_identifie","Besoin identifié"],["interesse","Intéressé"],
  ["rdv_propose","RDV proposé"],["rdv_confirme","RDV confirmé"],
  ["demo_realisee","Démo réalisée"],["offre_transmise","Offre transmise"],
  ["negociation","Négociation"],["offre_acceptee","Offre acceptée"],
  ["contrat_transmis","Contrat transmis"],["perdu","Perdu"],["en_veille","En veille"],
];
const LABEL = Object.fromEntries(STAGES);
const money = n => `${num(n)} FCFA`;
const PAGE=50, MAX_ROWS=1000;   // affichage par pages de 50 ; la base est lue jusqu'à 1 000 prospects
let prospects=[], products=[], offers=[], selected=null, filter={q:"",stage:"",owner:""}, shown=PAGE;

export async function loadSales() {
  const [p, pr, o] = await Promise.all([
    q(S.sb.from("ai_prospects").select("id,crm_client_id,entreprise,secteur,ville,pays,decideur,telephone,whatsapp,email,stage,score,priorite,potentiel_fcfa,produits_recommandes,owner_id,opt_out,next_action_at,last_outbound_at,last_inbound_at,created_at,resume_ia").order("updated_at",{ascending:false}).limit(MAX_ROWS)),
    q(S.sb.from("ai_products").select("id,nom,marche_cible,actif").eq("actif",true).order("nom")),
    q(S.sb.from("ai_offers").select("id,reference,prospect_id,product_id,total_ht,total_ttc,statut,created_at").order("created_at",{ascending:false}).limit(100)),
  ]);
  prospects=p??[]; products=pr??[]; offers=o??[];
}
const stageOptions = (v) => STAGES.map(([k,l])=>html`<option value="${k}" ${v===k?"selected":""}>${l}</option>`);
const productName = id => products.find(p=>p.id===id)?.nom ?? id ?? "—";

export function renderSales(main) {
  const total=prospects.length, capped=total>=MAX_ROWS, qualified=prospects.filter(p=>(p.score??0)>=60).length;
  const active=prospects.filter(p=>!["perdu","en_veille","marche_gagne","client_fidelise"].includes(p.stage)).length;
  const potential=prospects.reduce((s,p)=>s+Number(p.potentiel_fcfa||0),0);
  const qtxt=filter.q.toLowerCase();
  const rows=prospects.filter(p=>(!filter.stage||p.stage===filter.stage)&&(!qtxt||[p.entreprise,p.secteur,p.ville,p.decideur,p.email,p.telephone].some(v=>String(v??"").toLowerCase().includes(qtxt))));
  main.innerHTML=html`<section class="panel">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div><h2>Direction commerciale</h2><p class="sub">Prospects, pipeline, qualification IA, historique et rattachement aux fiches clients SANIX CRM.</p></div>
      <div class="actions"><button class="btn" type="button" data-act="sales-refresh">Actualiser</button><button class="btn pri" type="button" data-act="sales-new">＋ Nouveau prospect</button></div>
    </div>
    <div class="grid g4" style="margin:12px 0">
      <div class="card kpi"><b>${capped?`${total}+`:total}</b><span>Prospects suivis</span></div>
      <div class="card kpi"><b>${active}</b><span>Pipeline actif</span></div>
      <div class="card kpi"><b>${qualified}</b><span>Qualifiés (score ≥ 60)</span></div>
      <div class="card kpi"><b>${money(potential)}</b><span>Potentiel commercial</span></div>
    </div>
    <div class="filters">
      <input id="sales-q" type="search" placeholder="Entreprise, secteur, ville, contact…" value="${filter.q}" aria-label="Rechercher un prospect">
      <select id="sales-stage" aria-label="Filtrer par étape"><option value="">Toutes les étapes</option>${stageOptions(filter.stage)}</select>
    </div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Entreprise / Contact</th><th>Produit</th><th>Étape</th><th>Score</th><th>Potentiel</th><th>Prochaine action</th><th></th></tr></thead><tbody>
    ${raw(rows.slice(0,shown).map(p=>html`<tr>
      <td><b>${p.entreprise}</b><div class="small muted">${[p.secteur,p.ville].filter(Boolean).join(" · ")||"—"} · ${p.decideur||"Contact non renseigné"}</div><div class="small muted">${p.email||p.whatsapp||p.telephone||""}${p.crm_client_id?html` · CRM #${p.crm_client_id}`:""}</div></td>
      <td class="small">${(p.produits_recommandes??[]).map(productName).join(", ")||"À déterminer"}</td>
      <td><select data-sales-stage data-id="${p.id}" aria-label="Étape de ${p.entreprise}">${stageOptions(p.stage)}</select></td>
      <td><b>${p.score??0}/100</b><div class="small muted">${p.priorite??""}</div></td>
      <td class="num">${money(p.potentiel_fcfa)}</td>
      <td class="small">${p.next_action_at?fmtDT(p.next_action_at):"À planifier"}</td>
      <td><button class="btn sm" type="button" data-act="sales-open" data-id="${p.id}">Ouvrir</button></td>
    </tr>`).join("")||html`<tr><td colspan="7" class="muted">Aucun prospect correspondant.</td></tr>`.s)}
    </tbody></table></div>
    ${rows.length>shown?html`<p style="text-align:center;margin:10px 0"><button class="btn" type="button" data-act="sales-more">Afficher plus (${rows.length-shown} restants)</button></p>`:""}
    ${capped?html`<p class="small muted">Affichage limité aux ${MAX_ROWS} prospects les plus récents : les indicateurs ne portent que sur ceux-ci.</p>`:""}
    <p class="small muted" style="margin-top:10px">Le dossier CRM est rattaché par une clé stable (<code>crm_rid</code>) : statuts, rendez-vous, comptes rendus, offres et missions sont écrits dans les données du CRM par le connecteur CRM ↔ IA (événements durables traités côté serveur). L'identifiant numérique local (<code>crm_client_id</code>) est conservé pour compatibilité.</p>
  </section>`.s;
  $("#sales-q").oninput=e=>{filter.q=e.target.value;shown=PAGE;renderSales(main);const el=$("#sales-q");el.focus();el.setSelectionRange(filter.q.length,filter.q.length);};
  $("#sales-stage").onchange=e=>{filter.stage=e.target.value;shown=PAGE;renderSales(main);};
}

function newProspectForm() {
  openModal(html`<h3>Créer un prospect</h3><form id="sales-new-form" class="form">
    <label class="f">Entreprise *<input name="entreprise" required maxlength="200"></label>
    <label class="f">Secteur<input name="secteur" maxlength="120"></label>
    <label class="f">Ville<input name="ville" value="Abidjan" maxlength="100"></label>
    <label class="f">Décideur / contact<input name="decideur" maxlength="160"></label>
    <label class="f">Téléphone<input name="telephone" maxlength="40"></label>
    <label class="f">WhatsApp<input name="whatsapp" maxlength="40"></label>
    <label class="f">E-mail<input name="email" type="email" maxlength="200"></label>
    <label class="f">Potentiel estimé (FCFA)<input name="potentiel_fcfa" type="number" min="0" step="1"></label>
    <label class="f">Produit envisagé<select name="product_id"><option value="">À déterminer</option>${products.map(p=>html`<option value="${p.id}">${p.nom}</option>`)}</select></label>
    <label class="f">ID client SANIX CRM (facultatif)<input name="crm_client_id" type="number" min="1" step="1" placeholder="Identifiant numérique du client"></label>
    <div class="actions"><button class="btn pri" type="submit">Enregistrer le prospect</button><button class="btn" type="button" data-act="close-modal">Annuler</button></div>
  </form>`);
  $("#sales-new-form").onsubmit=async e=>{
    e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget).entries());
    const product=d.product_id;delete d.product_id;
    const payload={...d,entreprise:d.entreprise.trim(),secteur:d.secteur.trim()||null,ville:d.ville.trim()||null,
      decideur:d.decideur.trim()||null,telephone:d.telephone.trim()||null,whatsapp:d.whatsapp.trim()||null,email:d.email.trim()||null,
      potentiel_fcfa:d.potentiel_fcfa?Number(d.potentiel_fcfa):null,crm_client_id:d.crm_client_id?Number(d.crm_client_id):null,
      owner_id:S.op.user_id,source:"manuel",produits_recommandes:product?[product]:[]};
    try{await q(S.sb.from("ai_prospects").insert(payload));closeModal();toast("Prospect enregistré","ok");await loadSales();renderSales($("#main"));}
    catch(err){toast(/duplicate|unique/i.test(err.message)?"Un prospect avec cet e-mail ou téléphone existe déjà.":err.message,"bad");}
  };
}

async function openProspect(id) {
  const [p,msgs,os]=await Promise.all([
    q(S.sb.from("ai_prospects").select("*").eq("id",id).single()),
    q(S.sb.from("ai_messages").select("canal,sens,auteur,contenu,statut,created_at").eq("prospect_id",id).order("created_at",{ascending:false}).limit(30)),
    q(S.sb.from("ai_offers").select("*").eq("prospect_id",id).order("created_at",{ascending:false}).limit(20)),
  ]);
  selected=p;
  openModal(html`<h3>${p.entreprise}</h3><p class="small muted">${p.secteur||"Secteur non renseigné"} · ${p.ville||"Ville non renseignée"} · créé ${fmtDT(p.created_at)}</p>
    <div class="grid g2">
      <div class="card"><b>Contact</b><p>${p.decideur||"—"}<br>${p.telephone||"—"}<br>${p.email||"—"}</p></div>
      <div class="card"><b>Qualification</b><p><b>${p.score}/100</b> · ${p.priorite}<br>Potentiel : ${money(p.potentiel_fcfa)}<br>Opt-out : ${p.opt_out?"Oui":"Non"}</p></div>
    </div>
    <div class="card" style="margin:10px 0"><b>Rattachement SANIX CRM</b><form id="sales-link-form" class="form"><label class="f">Identifiant client CRM<input name="crm_client_id" type="number" min="1" step="1" value="${p.crm_client_id??""}" placeholder="ID numérique du client"></label><button class="btn sm" type="submit">Enregistrer le lien</button></form></div>
    <h4>Actions commerciales</h4><div class="actions">
      <button class="btn" type="button" data-act="sales-qualify" data-id="${p.id}">Qualifier par IA</button>
      <button class="btn pri" type="button" data-act="sales-contact" data-id="${p.id}" ${p.opt_out?"disabled":""}>Préparer / lancer le premier contact</button>
    </div>
    <h4>Produits recommandés</h4><p>${(p.produits_recommandes??[]).map(productName).join(", ")||"Non déterminés"}</p>
    <h4>Résumé IA</h4><div class="pv">${p.resume_ia||"Aucun résumé disponible."}</div>
    <h4>Offres</h4>${os.length?html`<div class="scroll"><table class="tbl"><thead><tr><th>Référence</th><th>Montant TTC</th><th>Statut</th></tr></thead><tbody>${os.map(o=>html`<tr><td>${o.reference}</td><td>${money(o.total_ttc)}</td><td>${o.statut}</td></tr>`)}</tbody></table></div>`:html`<p class="muted">Aucune offre créée.</p>`}
    <h4>Historique des échanges</h4>${msgs.length?msgs.map(m=>html`<div class="card" style="margin:6px 0"><div class="small muted">${m.canal} · ${m.sens} · ${m.auteur} · ${fmtDT(m.created_at)}</div><div class="pv">${m.contenu}</div></div>`):html`<p class="muted">Aucun échange enregistré.</p>`}`);
  $("#sales-link-form").onsubmit=async e=>{
    e.preventDefault();const v=new FormData(e.currentTarget).get("crm_client_id");
    try{await q(S.sb.from("ai_prospects").update({crm_client_id:v?Number(v):null}).eq("id",p.id));toast("Lien CRM enregistré","ok");await openProspect(p.id);}
    catch(err){toast(err.message,"bad");}
  };
}

export async function salesAction(el) {
  const id=el.dataset.id;
  if(el.dataset.act==="sales-new") return newProspectForm();
  if(el.dataset.act==="sales-open") return openProspect(id);
  if(el.dataset.act==="sales-refresh"){await loadSales();renderSales($("#main"));return;}
  if(el.dataset.act==="sales-more"){shown+=PAGE;renderSales($("#main"));return;}
  if(el.dataset.act==="sales-qualify"||el.dataset.act==="sales-contact"){
    el.disabled=true;
    try{const {data,error}=await S.sb.functions.invoke("ai-sales-director",{body:{action:el.dataset.act==="sales-qualify"?"qualifier":"contacter",prospect_id:id}});
      if(error){let msg=error.message;try{msg=(await error.context?.json())?.error||msg;}catch{}throw new Error(msg);}
      toast(el.dataset.act==="sales-qualify"?"Qualification IA lancée":"Premier contact demandé à l'agent IA","ok");
      await loadSales();await openProspect(id);
    }catch(err){toast(err.message,"bad");}finally{el.disabled=false;}
  }
}

export async function changeSalesStage(el) {
  const p=prospects.find(x=>x.id===el.dataset.id);if(!p)return;
  const stage=el.value;
  if(["contrat_signe","paiement_attendu","paiement_confirme","marche_gagne","deploiement","client_fidelise"].includes(stage)){toast("Cette étape doit être confirmée par la direction ou le processus contractuel.","bad");el.value=p.stage;return;}
  try{
    const {error}=await S.sb.from("ai_prospects").update({stage}).eq("id",p.id);
    if(error)throw error;
    toast("Pipeline mis à jour","ok");await loadSales();renderSales($("#main"));
  }catch(err){toast(err.message,"bad");el.value=p.stage;}
}
