// SANIX AI SALES — interface commerciale reliée aux tables commerciales du même projet Supabase que CRM.
import { $, ago, closeModal, fmtDT, html, num, openModal, pill, raw, toast, usd } from "./ui.js";
import { q, S } from "./state.js";

const STAGES = [
  ["identifie","Identifié"],["enregistre","Enregistré"],["qualifie","Qualifié"],
  ["premier_contact","Premier contact"],["conversation","Conversation"],
  ["besoin_identifie","Besoin identifié"],["interesse","Intéressé"],
  ["rdv_propose","RDV proposé"],["rdv_confirme","RDV confirmé"],["demo_realisee","Démo réalisée"],
  ["offre_transmise","Offre transmise"],["negociation","Négociation"],["offre_acceptee","Offre acceptée"],
  ["contrat_transmis","Contrat transmis"],["contrat_signe","Contrat signé"],
  ["paiement_attendu","Paiement attendu"],["paiement_confirme","Paiement confirmé"],
  ["marche_gagne","Marché gagné"],["deploiement","Déploiement"],["client_fidelise","Client fidélisé"],
  ["perdu","Perdu"],["en_veille","En veille"],
];
const PHASES = [
  ["exploration","Exploration",["identifie","enregistre","qualifie","premier_contact","conversation","besoin_identifie","interesse","rdv_propose","rdv_confirme"]],
  ["proposition","Proposition",["demo_realisee","offre_transmise"]],
  ["negociation","Négociation",["negociation","offre_acceptee"]],
  ["closing","Closing",["contrat_transmis","contrat_signe","paiement_attendu","paiement_confirme","marche_gagne","deploiement","client_fidelise"]],
];
const LABEL = Object.fromEntries(STAGES);
const money = n => `${num(n)} FCFA`;
const PAGE=50, MAX_ROWS=1000;   // affichage par pages de 50 ; la base est lue jusqu'à 1 000 prospects
let prospects=[], products=[], offers=[], messages=[], mails=[], mailsErreur="", lectureReponses=null, operators=[], selected=null, filter={q:"",stage:"",owner:"",canal:"",offre:"",relance:""}, shown=PAGE, vue="prospects";
const VUES=[["pipeline","🧭 Pipeline"],["prospects","👥 Prospects"],["rdv","📅 Rendez-vous"],["offres","📄 Offres"],["conversations","💬 Conversations"],["relances","🔔 Relances"]];
const RDV_STAGES=["rdv_propose","rdv_confirme","demo_realisee"];
const CLOSED=["perdu","en_veille","marche_gagne","deploiement","client_fidelise"];
// Pondérations identiques au tableau de bord financier serveur SANIX AI.
// Pondérations reprises à l'identique du calcul de prévision de company/live.js.
const STAGE_PROBABILITY={identifie:.03,enregistre:.05,qualifie:.1,premier_contact:.12,conversation:.18,besoin_identifie:.25,interesse:.3,rdv_propose:.35,rdv_confirme:.4,demo_realisee:.45,offre_transmise:.55,negociation:.65,offre_acceptee:.8,contrat_transmis:.9,paiement_attendu:.95};
const OFFRE_ST={brouillon:["Brouillon","#64748b"],a_valider:["À valider","#F59E0B"],validee:["Validée","#0ea5e9"],envoyee:["Envoyée","#6366f1"],acceptee:["Acceptée","#22C55E"],refusee:["Refusée","#EF4444"],expiree:["Expirée","#94a3b8"]};
const ADRESSE_ST={invalide:["⛔ adresse invalide","var(--bad)"],a_confirmer:["⚠ adresse à confirmer","var(--warn)"],verifiee:["✓ adresse confirmée","var(--ok)"]};
const adresseBadge=p=>{ const a=p.email?ADRESSE_ST[p.email_statut]:null; return a?html` <span class="small" style="color:${a[1]};font-weight:600">${a[0]}</span>`:""; };
const CANAUX=["whatsapp","email","telephone","sms","visio","note"];
const nomDe=id=>prospects.find(p=>p.id===id)?.entreprise??"Prospect inconnu";

export async function loadSales() {
  const [p, pr, o, ops] = await Promise.all([
    q(S.sb.from("ai_prospects").select("id,crm_client_id,crm_rid,relances_sans_reponse,entreprise,secteur,ville,pays,decideur,telephone,whatsapp,email,stage,score,priorite,potentiel_fcfa,produits_recommandes,owner_id,opt_out,next_action_at,last_outbound_at,last_inbound_at,created_at,resume_ia,email_statut").order("updated_at",{ascending:false}).limit(MAX_ROWS)),
    q(S.sb.from("ai_products").select("id,nom,marche_cible,actif").eq("actif",true).order("nom")),
    q(S.sb.from("ai_offers").select("id,reference,prospect_id,product_id,total_ht,total_ttc,statut,created_at").order("created_at",{ascending:false}).limit(100)),
    q(S.sb.from("ai_operators").select("user_id,nom,role").eq("actif",true).order("nom")),
  ]);
  prospects=p??[]; products=pr??[]; offers=o??[]; operators=ops??[];
}
/** E-mails envoyés depuis le CRM (Gmail) : base du suivi des relances. */
export async function loadRelances() {
  mailsErreur="";
  try { mails=(await q(S.sb.from("crm_mails").select("id,client_rid,to_email,subject,status,error,sent_at,replied_at,relance_apres_jours").order("sent_at",{ascending:false}).limit(500)))??[]; }
  catch(e){ mails=[]; mailsErreur=e.message; }
  try { lectureReponses=(await q(S.sb.rpc("crm_mail_state")))?.lecture_reponses===true; } catch { lectureReponses=null; }   // null : état inconnu
}
/** Derniers échanges, tous prospects confondus (vue Conversations). */
export async function loadMessages() {
  messages=(await q(S.sb.from("ai_messages").select("id,prospect_id,canal,sens,auteur,contenu,statut,created_at").order("created_at",{ascending:false}).limit(150)))??[];
}
const stageOptions = (v) => STAGES.map(([k,l])=>html`<option value="${k}" ${v===k?"selected":""}>${l}</option>`);
const productName = id => products.find(p=>p.id===id)?.nom ?? id ?? "—";
const operatorName = id => operators.find(o=>o.user_id===id)?.nom ?? (id?"Commercial inconnu":"Non attribué");
const canAssign = () => ["direction","admin"].includes(S.op?.role);
const ownerOptions = id => html`<option value="">Non attribué</option>${operators.map(o=>html`<option value="${o.user_id}" ${id===o.user_id?"selected":""}>${o.nom}</option>`)}`;
const ownerFilter = () => html`<select id="sales-owner" aria-label="Filtrer par commercial"><option value="">Toute l'équipe</option><option value="__none__" ${filter.owner==="__none__"?"selected":""}>Non attribués</option>${operators.map(o=>html`<option value="${o.user_id}" ${filter.owner===o.user_id?"selected":""}>${o.nom}</option>`)}</select>`;
const matchesOwner = p => !filter.owner || (filter.owner==="__none__"?!p.owner_id:p.owner_id===filter.owner);
const ownerControl = p => canAssign()
  ? html`<select data-sales-owner data-id="${p.id}" aria-label="Responsable de ${p.entreprise}" style="width:100%;margin-top:5px">${ownerOptions(p.owner_id)}</select>`
  : html`<div class="small muted">Resp. : ${operatorName(p.owner_id)}</div>`;
const isOverdue = p => !!p.next_action_at && new Date(p.next_action_at).getTime()<Date.now() && !CLOSED.includes(p.stage);

const matchQ=p=>{ const t=filter.q.toLowerCase(); return !t||[p.entreprise,p.secteur,p.ville,p.decideur,p.email,p.telephone].some(v=>String(v??"").toLowerCase().includes(t)); };
const restoreQ=()=>{const el=$("#sales-q");if(el){el.focus();el.setSelectionRange(filter.q.length,filter.q.length);}};

function vueProspects(){
  const rows=prospects.filter(p=>(!filter.stage||p.stage===filter.stage)&&matchesOwner(p)&&matchQ(p));
  return html`<div class="filters">
      <input id="sales-q" type="search" placeholder="Entreprise, secteur, ville, contact…" value="${filter.q}" aria-label="Rechercher un prospect">
      <select id="sales-stage" aria-label="Filtrer par étape"><option value="">Toutes les étapes</option>${stageOptions(filter.stage)}</select>
      ${ownerFilter()}
    </div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Entreprise / Contact</th><th>Produit</th><th>Étape</th><th>Score</th><th>Potentiel</th><th>Responsable</th><th>Prochaine action</th><th></th></tr></thead><tbody>
    ${raw(rows.slice(0,shown).map(p=>html`<tr>
      <td><b>${p.entreprise}</b><div class="small muted">${[p.secteur,p.ville].filter(Boolean).join(" · ")||"—"} · ${p.decideur||"Contact non renseigné"}</div><div class="small muted">${p.email||p.whatsapp||p.telephone||""}${adresseBadge(p)}${p.crm_client_id?html` · CRM #${p.crm_client_id}`:""}</div></td>
      <td class="small">${(p.produits_recommandes??[]).map(productName).join(", ")||"À déterminer"}</td>
      <td><select data-sales-stage data-id="${p.id}" aria-label="Étape de ${p.entreprise}">${stageOptions(p.stage)}</select></td>
      <td><b>${p.score??0}/100</b><div class="small muted">${p.priorite??""}</div></td>
      <td class="num">${money(p.potentiel_fcfa)}</td>
      <td>${ownerControl(p)}</td>
      <td class="small">${p.next_action_at?fmtDT(p.next_action_at):"À planifier"}${isOverdue(p)?html` <span class="pill" style="--c:#EF4444"><i></i>retard</span>`:""}</td>
      <td><button class="btn sm" type="button" data-act="sales-open" data-id="${p.id}">Ouvrir</button></td>
    </tr>`).join("")||html`<tr><td colspan="8" class="muted">Aucun prospect correspondant.</td></tr>`.s)}
    </tbody></table></div>
    ${rows.length>shown?html`<p style="text-align:center;margin:10px 0"><button class="btn" type="button" data-act="sales-more">Afficher plus (${rows.length-shown} restants)</button></p>`:""}`;
}

/** Pipeline commercial par grandes phases, avec sous-étapes réelles et responsables visibles. */
function vuePipeline(){
  const rows=prospects.filter(p=>matchesOwner(p)&&matchQ(p));
  const activeRows=rows.filter(p=>!CLOSED.includes(p.stage));
  const won=rows.filter(p=>["marche_gagne","deploiement","client_fidelise"].includes(p.stage));
  const lost=rows.filter(p=>p.stage==="perdu");
  const closed=won.length+lost.length;
  const total=activeRows.reduce((s,p)=>s+Number(p.potentiel_fcfa||0),0);
  const weighted=activeRows.reduce((s,p)=>s+Math.max(0,Number(p.potentiel_fcfa)||0)*(STAGE_PROBABILITY[p.stage]||0),0);
  const conversion=closed?Math.round(won.length/closed*100):0;
  return html`<div class="filters">
      <input id="sales-q" type="search" placeholder="Rechercher une entreprise, un secteur, une ville…" value="${filter.q}" aria-label="Rechercher dans le pipeline">
      ${ownerFilter()}
      <button class="btn sm" type="button" data-act="sales-vue" data-vue="prospects">☷ Liste</button>
      <button class="btn sm pri" type="button" data-act="sales-vue" data-vue="pipeline">▥ Kanban</button>
    </div>
    <div style="display:grid;grid-template-columns:minmax(180px,220px) minmax(0,1fr);gap:12px;align-items:start">
      <aside style="display:grid;gap:10px">
        <div class="card kpi" style="border-left:4px solid #10b981"><span>Pipeline total actif</span><b style="font-size:23px">${money(total)}</b><span>${activeRows.length} opportunités actives</span></div>
        <div class="card kpi"><span>Opportunités gagnées</span><b style="font-size:25px">${won.length}</b><span>${money(won.reduce((s,p)=>s+Number(p.potentiel_fcfa||0),0))}</span></div>
        <div class="card kpi"><span>Opportunités perdues</span><b style="font-size:25px">${lost.length}</b><span>${money(lost.reduce((s,p)=>s+Number(p.potentiel_fcfa||0),0))}</span></div>
        <div class="card kpi"><span>Taux de conversion</span><b style="font-size:25px">${conversion}%</b><span>${won.length} gagnées sur ${closed} clôturées</span></div>
        <div class="card kpi"><span>Prévision pondérée</span><b style="font-size:18px">${money(weighted)}</b><span>Selon l'étape commerciale</span></div>
        <div class="card kpi"><span>Actions en retard</span><b style="font-size:23px">${rows.filter(isOverdue).length}</b><span>${rows.filter(p=>!p.owner_id&&!CLOSED.includes(p.stage)).length} non attribuées</span></div>
      </aside>
      <div class="scroll" style="overflow-x:auto"><div class="pipe" style="display:flex;gap:10px;align-items:flex-start;min-width:max-content;padding-bottom:8px">
      ${raw(PHASES.map(([key,label,stages])=>{
        const col=rows.filter(p=>stages.includes(p.stage)).sort((a,b)=>(b.score??0)-(a.score??0));
        const pot=col.reduce((t,p)=>t+Number(p.potentiel_fcfa||0),0);
        return html`<div class="card pipe-col" data-phase="${key}" style="width:245px;flex:none;padding:8px">
          <div style="display:flex;justify-content:space-between;gap:6px;align-items:center"><b>${label}</b><span class="pill"><i></i>${col.length}</span></div>
          <div class="small muted" style="margin:2px 0 6px">${money(pot)}</div>
          ${raw(col.slice(0,30).map(p=>html`<div class="card pipe-card" style="margin:6px 0;padding:9px">
            <b>${p.entreprise}</b><div class="small muted">${[p.secteur,p.ville].filter(Boolean).join(" · ")||"—"}</div>
            <div class="small">Contact : ${p.decideur||"Non renseigné"}</div>
            <div class="small">Commercial : <b>${operatorName(p.owner_id)}</b></div>
            <div class="small">Étape : <b>${LABEL[p.stage]??p.stage}</b></div>
            <div style="display:flex;justify-content:space-between;gap:6px;margin-top:5px"><b>${money(p.potentiel_fcfa)}</b><span class="small">${p.next_action_at?fmtDT(p.next_action_at):"Sans échéance"}</span></div>
            <div class="small ${isOverdue(p)?"":"muted"}">${isOverdue(p)?"⚠ Action en retard":p.score!=null?"Score "+p.score+"/100":""}</div>
            ${ownerControl(p)}
            <div style="display:flex;gap:5px;margin-top:7px"><select data-sales-stage data-id="${p.id}" aria-label="Étape de ${p.entreprise}" style="flex:1;min-width:0">${stageOptions(p.stage)}</select><button class="btn sm" type="button" data-act="sales-open" data-id="${p.id}">Ouvrir</button></div>
          </div>`.s).join("")||html`<div class="small muted" style="padding:12px">Aucune opportunité</div>`.s)}
          ${col.length>30?html`<div class="small muted">+ ${col.length-30} autres opportunités</div>`:""}
        </div>`.s;
      }).join(""))}
      </div></div>
    </div>
    <section style="margin-top:14px">
      <h3>Résultats clôturés</h3>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
        <div class="card" style="padding:10px"><b>Gagnées et en déploiement</b>
          ${raw(won.map(p=>html`<div class="small" style="padding:5px 0;border-bottom:1px solid var(--line)"><b>${p.entreprise}</b> · ${LABEL[p.stage]??p.stage}<div class="muted">${operatorName(p.owner_id)} · ${money(p.potentiel_fcfa)}</div></div>`.s).join("")||html`<p class="small muted">Aucune vente gagnée</p>`.s)}
        </div>
        <div class="card" style="padding:10px"><b>Perdues / en veille</b>
          ${raw(rows.filter(p=>["perdu","en_veille"].includes(p.stage)).map(p=>html`<div class="small" style="padding:5px 0;border-bottom:1px solid var(--line)"><b>${p.entreprise}</b> · ${LABEL[p.stage]??p.stage}<div class="muted">${operatorName(p.owner_id)} · ${money(p.potentiel_fcfa)}</div></div>`.s).join("")||html`<p class="small muted">Aucun dossier clôturé ou en veille</p>`.s)}
        </div>
      </div>
    </section>
    <p class="small muted" style="margin-top:8px">Les montants gagnés/perdus sont calculés à partir du potentiel renseigné sur les prospects. Les encaissements réels restent à rapprocher des factures et paiements du CRM.</p>`;
}

/** Rendez-vous : prospects aux étapes RDV proposé / confirmé / démo réalisée, du plus proche au plus lointain. */
function vueRdv(){
  const now=Date.now(), rows=prospects.filter(p=>RDV_STAGES.includes(p.stage)&&matchQ(p))
    .sort((a,b)=>(a.next_action_at?new Date(a.next_action_at).getTime():Infinity)-(b.next_action_at?new Date(b.next_action_at).getTime():Infinity));
  const nb=k=>rows.filter(p=>p.stage===k).length;
  return html`<div class="grid g3" style="margin-bottom:10px">${raw(RDV_STAGES.map(k=>html`<div class="card kpi"><b>${nb(k)}</b><span>${LABEL[k]}</span></div>`.s).join(""))}</div>
    <div class="filters"><input id="sales-q" type="search" placeholder="Filtrer : entreprise, ville, contact…" value="${filter.q}" aria-label="Filtrer les rendez-vous"></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Entreprise / Contact</th><th>Étape</th><th>Prochaine action</th><th>Dernier échange</th><th></th></tr></thead><tbody>
    ${raw(rows.map(p=>{ const t=p.next_action_at?new Date(p.next_action_at).getTime():null, retard=t!==null&&t<now;
      return html`<tr><td><b>${p.entreprise}</b><div class="small muted">${p.decideur||"Contact non renseigné"} · ${p.telephone||p.whatsapp||p.email||"—"}</div></td>
      <td>${pill(LABEL[p.stage],p.stage==="rdv_confirme"?"#22C55E":p.stage==="demo_realisee"?"#6366f1":"#F59E0B")}</td>
      <td class="small">${p.next_action_at?fmtDT(p.next_action_at):"À planifier"}${retard?html` <span class="pill" style="--c:#EF4444"><i></i>en retard</span>`:""}</td>
      <td class="small">${p.last_inbound_at||p.last_outbound_at?ago(p.last_inbound_at&&(!p.last_outbound_at||p.last_inbound_at>p.last_outbound_at)?p.last_inbound_at:p.last_outbound_at):"—"}</td>
      <td><button class="btn sm" type="button" data-act="sales-open" data-id="${p.id}">Ouvrir</button></td></tr>`.s;}).join("")||html`<tr><td colspan="5" class="muted">Aucun prospect à l'étape rendez-vous ou démo.</td></tr>`.s)}
    </tbody></table></div>`;
}

/** Offres : toutes les offres chiffrées par l'IA, tous prospects confondus. */
function vueOffres(){
  const rows=offers.filter(o=>!filter.offre||o.statut===filter.offre), ttc=rows.reduce((t,o)=>t+Number(o.total_ttc||0),0);
  return html`<div class="grid g3" style="margin-bottom:10px"><div class="card kpi"><b>${rows.length}</b><span>Offres${filter.offre?" · "+(OFFRE_ST[filter.offre]?.[0]??filter.offre):""}</span></div>
      <div class="card kpi"><b>${money(ttc)}</b><span>Montant TTC cumulé</span></div>
      <div class="card kpi"><b>${offers.filter(o=>o.statut==="acceptee").length}</b><span>Offres acceptées</span></div></div>
    <div class="filters"><select id="sales-offre" aria-label="Filtrer par statut"><option value="">Tous les statuts</option>${Object.entries(OFFRE_ST).map(([k,[l]])=>html`<option value="${k}" ${filter.offre===k?"selected":""}>${l}</option>`)}</select></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Référence</th><th>Prospect</th><th>Logiciel</th><th class="num">Total HT</th><th class="num">Total TTC</th><th>Statut</th><th>Créée</th><th></th></tr></thead><tbody>
    ${raw(rows.map(o=>html`<tr><td>${o.reference}</td><td><b>${nomDe(o.prospect_id)}</b></td><td class="small">${productName(o.product_id)}</td><td class="num">${money(o.total_ht)}</td><td class="num">${money(o.total_ttc)}</td>
      <td>${pill(OFFRE_ST[o.statut]?.[0]??o.statut,OFFRE_ST[o.statut]?.[1]??"#64748b")}</td><td class="small">${fmtDT(o.created_at)}</td>
      <td><button class="btn sm" type="button" data-act="sales-open" data-id="${o.prospect_id}">Ouvrir</button></td></tr>`).join("")||html`<tr><td colspan="8" class="muted">Aucune offre.</td></tr>`.s)}
    </tbody></table></div>${offers.length>=100?html`<p class="small muted">Les 100 offres les plus récentes sont affichées.</p>`:""}`;
}

/** Conversations : derniers échanges de tous les prospects (WhatsApp, e-mail, téléphone…), du plus récent au plus ancien. */
function vueConversations(){
  const rows=messages.filter(m=>!filter.canal||m.canal===filter.canal);
  return html`<div class="filters"><select id="sales-canal" aria-label="Filtrer par canal"><option value="">Tous les canaux</option>${CANAUX.map(c=>html`<option value="${c}" ${filter.canal===c?"selected":""}>${c}</option>`)}</select></div>
    ${raw(rows.map(m=>html`<div class="card" style="margin:6px 0"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><b>${nomDe(m.prospect_id)}</b> ${pill(m.canal,"#0ea5e9")} ${pill(m.sens==="entrant"?"Reçu":"Envoyé",m.sens==="entrant"?"#22C55E":"#6366f1")}</div>
      <div class="small muted">${m.auteur} · ${m.statut} · ${fmtDT(m.created_at)}</div></div>
      <div class="pv" style="margin-top:4px">${m.contenu.length>280?m.contenu.slice(0,279)+"…":m.contenu}</div>
      <div style="margin-top:6px"><button class="btn sm" type="button" data-act="sales-open" data-id="${m.prospect_id}">Ouvrir le dossier</button></div></div>`.s).join("")||html`<p class="muted">Aucun échange enregistré.</p>`.s)}
    ${messages.length>=150?html`<p class="small muted">Les 150 échanges les plus récents sont affichés.</p>`:""}`;
}

const RELANCE_MAX_JOURS=45;   // même règle que le CRM : au-delà de 45 jours sans réponse, le mail n'est plus proposé à la relance
/** Un contact par destinataire (dernier mail) avec la date de la prochaine relance : envoi + « relancer après N jours » (4 par défaut). */
export function relancesLignes(liste, prospectsListe, now=Date.now()) {
  const parCle=new Map();
  for(const m of liste??[]){ const k=m.client_rid||String(m.to_email||"").toLowerCase(); const g=parCle.get(k); if(!g) parCle.set(k,{dernier:m,nb:1}); else { g.nb++; if(new Date(m.sent_at)>new Date(g.dernier.sent_at)) g.dernier=m; } }
  const lignes=[];
  for(const {dernier:m,nb} of parCle.values()){
    const p=(prospectsListe??[]).find(x=>(m.client_rid&&x.crm_rid===m.client_rid)||(x.email&&String(x.email).toLowerCase()===String(m.to_email).toLowerCase()));
    const envoi=new Date(m.sent_at).getTime(), jours=Math.max(1,Number(m.relance_apres_jours)||4), echeance=envoi+jours*864e5, age=Math.floor((now-envoi)/864e5);
    let etat, retard=0;
    if(m.status==="repondu") etat="reponse";
    else if(m.status==="echec") etat="adresse";
    else if(age>RELANCE_MAX_JOURS) etat="hors_delai";
    else if(now>=echeance){ etat="a_relancer"; retard=Math.floor((now-echeance)/864e5); }
    else etat="a_venir";
    lignes.push({ cle:m.client_rid||String(m.to_email).toLowerCase(), ids:(liste??[]).filter(x=>(x.client_rid||String(x.to_email).toLowerCase())===(m.client_rid||String(m.to_email).toLowerCase())).map(x=>x.id), nom:p?.entreprise||m.to_email, prospectId:p?.id??null, email:m.to_email, objet:m.subject, nb, envoi:m.sent_at, repondu:m.replied_at, echeance:etat==="a_relancer"||etat==="a_venir"?new Date(echeance).toISOString():null, etat, retard, erreur:m.error||"" });
  }
  const ordre={a_relancer:0,reponse:1,a_venir:2,adresse:3,hors_delai:4};
  return lignes.sort((a,b)=>ordre[a.etat]-ordre[b.etat]||(a.etat==="a_relancer"?b.retard-a.retard:a.echeance&&b.echeance?a.echeance.localeCompare(b.echeance):0));
}
const RELANCE_ETAT={a_relancer:["À relancer","#EF4444"],a_venir:["Relance prévue","#0ea5e9"],reponse:["Réponse reçue","#22C55E"],adresse:["Adresse à corriger","#F59E0B"],hors_delai:["Sans réponse > 45 j","#94a3b8"]};
function vueRelances(){
  if(mailsErreur) return html`<div class="card muted">Suivi des e-mails indisponible : ${mailsErreur}</div>`;
  const now=Date.now(), tout=relancesLignes(mails,prospects,now), nb=k=>tout.filter(l=>l.etat===k).length;
  const sept=tout.filter(l=>l.etat==="a_venir"&&new Date(l.echeance).getTime()-now<=7*864e5).length;
  const lignes=tout.filter(l=>!filter.relance||l.etat===filter.relance);
  const iaRetard=prospects.filter(p=>p.next_action_at&&new Date(p.next_action_at).getTime()<now&&!p.opt_out&&!CLOSED.includes(p.stage)).sort((a,b)=>new Date(a.next_action_at)-new Date(b.next_action_at));
  const sansContact=prospects.filter(p=>!p.last_outbound_at&&!p.opt_out&&!CLOSED.includes(p.stage)).length;
  return html`<div class="grid g4" style="margin-bottom:10px">
      <div class="card kpi"><b>${tout.length}</b><span>Contacts relancés par e-mail</span></div>
      <div class="card kpi"><b style="${nb("a_relancer")?"color:var(--danger)":""}">${nb("a_relancer")}</b><span>À relancer maintenant</span></div>
      <div class="card kpi"><b>${sept}</b><span>Relances prévues sous 7 jours</span></div>
      <div class="card kpi"><b>${nb("reponse")}</b><span>Réponses reçues · ${nb("adresse")} adresse(s) à corriger</span></div></div>
    <div class="filters"><select id="sales-relance" aria-label="Filtrer le suivi">${[["","Tous les états"],...Object.entries(RELANCE_ETAT).map(([k,[l]])=>[k,l])].map(([k,l])=>html`<option value="${k}" ${filter.relance===k?"selected":""}>${l}${k?" · "+nb(k):""}</option>`)}</select></div>
    <div class="scroll"><table class="tbl"><thead><tr><th>Contact</th><th>Dernier e-mail</th><th class="num">Envois</th><th>État</th><th>Prochaine relance</th><th></th></tr></thead><tbody>
    ${raw(lignes.map(l=>html`<tr><td><b>${l.nom}</b><div class="small muted">${l.email}</div></td>
      <td class="small">${fmtDT(l.envoi)}<div class="muted">${l.objet}</div></td><td class="num">${l.nb}</td>
      <td>${pill(RELANCE_ETAT[l.etat][0],RELANCE_ETAT[l.etat][1])}${l.etat==="a_relancer"?html`<div class="small muted">retard de ${l.retard} j</div>`:l.etat==="reponse"?html`<div class="small muted">${fmtDT(l.repondu)}</div>`:l.etat==="adresse"?html`<div class="small muted">${l.erreur}</div>`:""}</td>
      <td class="small">${l.echeance?fmtDT(l.echeance):"—"}</td>
      <td style="white-space:nowrap"><button class="btn sm" type="button" data-act="sales-conv" data-cle="${l.cle}">📖 Lire</button> ${l.prospectId?html`<button class="btn sm" type="button" data-act="sales-open" data-id="${l.prospectId}">Ouvrir</button>`:""}</td></tr>`.s).join("")||html`<tr><td colspan="6" class="muted">Aucun e-mail envoyé pour l'instant.</td></tr>`.s)}
    </tbody></table></div>
    <h3 style="margin:16px 0 6px">Prospects suivis par les agents IA</h3>
    <div class="grid g2" style="margin-bottom:8px"><div class="card kpi"><b>${sansContact}</b><span>Jamais contactés par les agents</span></div><div class="card kpi"><b style="${iaRetard.length?"color:var(--danger)":""}">${iaRetard.length}</b><span>Action prévue dépassée</span></div></div>
    ${iaRetard.length?html`<div class="scroll"><table class="tbl"><thead><tr><th>Prospect</th><th>Étape</th><th>Action prévue</th><th class="num">Relances sans réponse</th><th></th></tr></thead><tbody>${raw(iaRetard.slice(0,20).map(p=>html`<tr><td><b>${p.entreprise}</b></td><td>${LABEL[p.stage]??p.stage}</td><td class="small">${fmtDT(p.next_action_at)}</td><td class="num">${p.relances_sans_reponse??0}</td><td><button class="btn sm" type="button" data-act="sales-open" data-id="${p.id}">Ouvrir</button></td></tr>`.s).join(""))}</tbody></table></div>`:html`<p class="muted">Aucune action prévue par les agents n'est en retard.</p>`}
    <p class="small muted" style="margin-top:8px">Règle : un e-mail sans réponse est à relancer au bout du délai choisi à l'envoi (4 jours par défaut), jusqu'à 45 jours. Les relances sont proposées ici ; rien n'est envoyé automatiquement.</p>`;
}

export function renderSales(main) {
  const total=prospects.length, capped=total>=MAX_ROWS, qualified=prospects.filter(p=>(p.score??0)>=60).length;
  const active=prospects.filter(p=>!CLOSED.includes(p.stage)).length;
  const potential=prospects.reduce((s,p)=>s+Number(p.potentiel_fcfa||0),0);
  const compte={pipeline:active,prospects:total,rdv:prospects.filter(p=>RDV_STAGES.includes(p.stage)).length,offres:offers.length,conversations:null,relances:null};
  const corps={pipeline:vuePipeline,prospects:vueProspects,rdv:vueRdv,offres:vueOffres,conversations:vueConversations,relances:vueRelances}[vue]();
  main.innerHTML=html`<section class="panel">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
      <div><h2>Direction commerciale</h2><p class="sub">Prospects, pipeline, qualification IA, historique et rattachement aux fiches clients SANIX CRM.</p></div>
      <div class="actions"><button class="btn" type="button" data-act="sales-refresh">Actualiser</button><button class="btn" type="button" data-act="sales-verif" title="Contrôle gratuit du domaine de chaque adresse jamais vérifiée (sans IA)">✉ Vérifier les adresses</button><button class="btn pri" type="button" data-act="sales-new">＋ Nouveau prospect</button></div>
    </div>
    <div class="grid g4" style="margin:12px 0">
      <div class="card kpi"><b>${capped?`${total}+`:total}</b><span>Prospects suivis</span></div>
      <div class="card kpi"><b>${active}</b><span>Pipeline actif</span></div>
      <div class="card kpi"><b>${qualified}</b><span>Qualifiés (score ≥ 60)</span></div>
      <div class="card kpi"><b>${money(potential)}</b><span>Potentiel commercial</span></div>
    </div>
    <div class="actions" role="tablist" aria-label="Vues commerciales" style="margin-bottom:12px">${VUES.map(([k,l])=>html`<button class="btn ${vue===k?"pri":""}" type="button" role="tab" aria-selected="${vue===k}" data-act="sales-vue" data-vue="${k}">${l}${compte[k]!=null?html` · ${compte[k]}`:""}</button>`)}</div>
    ${corps}
    ${capped?html`<p class="small muted">Affichage limité aux ${MAX_ROWS} prospects les plus récents : les indicateurs ne portent que sur ceux-ci.</p>`:""}
    <p class="small muted" style="margin-top:10px">Le dossier CRM est rattaché par une clé stable (<code>crm_rid</code>) : statuts, rendez-vous, comptes rendus, offres et missions sont écrits dans les données du CRM par le connecteur CRM ↔ IA (événements durables traités côté serveur). L'identifiant numérique local (<code>crm_client_id</code>) reste facultatif.</p>
  </section>`.s;
  const sq=$("#sales-q"); if(sq) sq.oninput=e=>{filter.q=e.target.value;shown=PAGE;renderSales(main);restoreQ();};
  const ss=$("#sales-stage"); if(ss) ss.onchange=e=>{filter.stage=e.target.value;shown=PAGE;renderSales(main);};
  const so=$("#sales-offre"); if(so) so.onchange=e=>{filter.offre=e.target.value;renderSales(main);};
  const sr=$("#sales-relance"); if(sr) sr.onchange=e=>{filter.relance=e.target.value;renderSales(main);};
  const sc=$("#sales-canal"); if(sc) sc.onchange=e=>{filter.canal=e.target.value;renderSales(main);};
  const ownerSel=$("#sales-owner"); if(ownerSel) ownerSel.onchange=e=>{filter.owner=e.target.value;shown=PAGE;renderSales(main);};
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
  const [p,msgs,os,hist]=await Promise.all([
    q(S.sb.from("ai_prospects").select("*").eq("id",id).single()),
    q(S.sb.from("ai_messages").select("canal,sens,auteur,contenu,statut,created_at").eq("prospect_id",id).order("created_at",{ascending:false}).limit(30)),
    q(S.sb.from("ai_offers").select("*").eq("prospect_id",id).order("created_at",{ascending:false}).limit(20)),
    q(S.sb.from("ai_stage_history").select("de,vers,par,at").eq("prospect_id",id).order("at",{ascending:false}).limit(30)),
  ]);
  selected=p;
  openModal(html`<h3>${p.entreprise}</h3><p class="small muted">${p.secteur||"Secteur non renseigné"} · ${p.ville||"Ville non renseignée"} · créé ${fmtDT(p.created_at)}</p>
    <div class="grid g2">
      <div class="card"><b>Contact</b><p>${p.decideur||"—"}<br>${p.telephone||"—"}<br>${p.email||"—"}</p></div>
      <div class="card"><b>Qualification</b><p><b>${p.score}/100</b> · ${p.priorite}<br>Potentiel : ${money(p.potentiel_fcfa)}<br>Opt-out : ${p.opt_out?"Oui":"Non"}</p></div>
    </div>
    <div class="card" style="margin:10px 0"><b>Rattachement SANIX CRM</b><form id="sales-link-form" class="form"><label class="f">Identifiant client CRM<input name="crm_client_id" type="number" min="1" step="1" value="${p.crm_client_id??""}" placeholder="ID numérique du client"></label><button class="btn sm" type="submit">Enregistrer le lien</button></form></div>
    <h4>Responsable & prochaine action</h4>
    <div class="card" style="margin:8px 0"><p class="small muted">Responsable commercial : <b>${operatorName(p.owner_id)}</b></p>
      <form id="sales-next-form" class="form">
        <label class="f">Prochaine action / échéance
          <input name="next_action_at" type="datetime-local" value="${p.next_action_at?new Date(new Date(p.next_action_at).getTime()-new Date(p.next_action_at).getTimezoneOffset()*60000).toISOString().slice(0,16):""}">
        </label>
        <div class="actions"><button class="btn sm pri" type="submit">Enregistrer l'échéance</button></div>
      </form>
    </div>
    <h4>Actions commerciales</h4><div class="actions">
      <button class="btn" type="button" data-act="sales-qualify" data-id="${p.id}">Qualifier par IA</button>
      <button class="btn pri" type="button" data-act="sales-contact" data-id="${p.id}" ${p.opt_out?"disabled":""}>Préparer / lancer le premier contact</button>
    </div>
    <h4>Historique du pipeline</h4>
    ${hist.length?raw(hist.map(h=>html`<div class="small" style="padding:5px 0;border-bottom:1px solid var(--line)"><b>${LABEL[h.vers]??h.vers}</b> <span class="muted">· ${h.de?LABEL[h.de]??h.de:"Création"} · ${fmtDT(h.at)} · ${h.par==="agent"?"Agent IA":h.par}</span></div>`.s).join("")):html`<p class="small muted">Aucune transition historisée pour ce dossier.</p>`}
    <h4>Produits recommandés</h4><p>${(p.produits_recommandes??[]).map(productName).join(", ")||"Non déterminés"}</p>
    <h4>Résumé IA</h4><div class="pv">${p.resume_ia||"Aucun résumé disponible."}</div>
    <h4>Offres</h4>${os.length?html`<div class="scroll"><table class="tbl"><thead><tr><th>Référence</th><th>Montant TTC</th><th>Statut</th></tr></thead><tbody>${os.map(o=>html`<tr><td>${o.reference}</td><td>${money(o.total_ttc)}</td><td>${o.statut}</td></tr>`)}</tbody></table></div>`:html`<p class="muted">Aucune offre créée.</p>`}
    <h4>Historique des échanges</h4>${msgs.length?msgs.map(m=>html`<div class="card" style="margin:6px 0"><div class="small muted">${m.canal} · ${m.sens} · ${m.auteur} · ${fmtDT(m.created_at)}</div><div class="pv">${m.contenu}</div></div>`):html`<p class="muted">Aucun échange enregistré.</p>`}`);
  $("#sales-next-form").onsubmit=async e=>{
    e.preventDefault();const rawValue=new FormData(e.currentTarget).get("next_action_at");
    const next_action_at=rawValue?new Date(rawValue).toISOString():null;
    try{await q(S.sb.from("ai_prospects").update({next_action_at}).eq("id",p.id));toast("Prochaine action enregistrée","ok");await loadSales();await openProspect(p.id);}
    catch(err){toast(err.message,"bad");}
  };
  $("#sales-link-form").onsubmit=async e=>{
    e.preventDefault();const v=new FormData(e.currentTarget).get("crm_client_id");
    try{await q(S.sb.from("ai_prospects").update({crm_client_id:v?Number(v):null}).eq("id",p.id));toast("Lien CRM enregistré","ok");await openProspect(p.id);}
    catch(err){toast(err.message,"bad");}
  };
}

/** Conversation avec un contact : e-mails envoyés (texte complet) et réponses reçues (texte), du plus ancien au plus récent. */
async function ouvrirConversation(cle) {
  const lignes=relancesLignes(mails,prospects), l=lignes.find(x=>x.cle===cle); if(!l) return;
  let envois=[], reponses=[], erreurLecture="";
  try { envois=(await q(S.sb.from("crm_mails").select("id,subject,body,to_email,sent_by,sent_at,status,replied_at,reply_from,error").in("id",l.ids).order("sent_at",{ascending:true})))??[]; }
  catch(e){ toast(e.message,"bad"); return; }
  try { reponses=(await q(S.sb.from("crm_mail_replies").select("id,mail_id,from_email,received_at,body").in("mail_id",l.ids).order("received_at",{ascending:true})))??[]; }
  catch(e){ erreurLecture=e.message; }
  const fil=[...envois.map(m=>({t:m.sent_at,sens:"sortant",m})),...reponses.map(r=>({t:r.received_at,sens:"entrant",r}))].sort((a,b)=>new Date(a.t)-new Date(b.t));
  const sansTexte=envois.filter(m=>m.status==="repondu"&&!reponses.some(r=>r.mail_id===m.id));
  const note=sansTexte.length?(lectureReponses===false?"Le texte de "+(sansTexte.length>1?"ces réponses n'est":"cette réponse n'est")+" pas lu : reconnectez Gmail une fois (SANIX CRM → Paramètres → Gmail) pour autoriser la lecture des réponses.":erreurLecture?"Lecture des réponses indisponible : "+erreurLecture:"Le texte de "+(sansTexte.length>1?"ces réponses sera":"cette réponse sera")+" lu à la prochaine synchronisation (15 minutes au plus).") :"";
  openModal(html`<h3>${l.nom}</h3><p class="small muted">${l.email} · ${envois.length} e-mail(s) envoyé(s) · ${reponses.length} réponse(s) lue(s)</p>
    ${note?html`<div class="card" style="border-left:4px solid #F59E0B;margin:8px 0">${note}</div>`:""}
    ${raw(fil.map(x=>x.sens==="sortant"
      ?html`<div class="card" style="margin:8px 0 8px 0;border-left:4px solid #6366f1"><div class="small muted">📤 Envoyé · ${fmtDT(x.m.sent_at)}${x.m.sent_by?" · "+x.m.sent_by:""}${x.m.status==="echec"?" · échec : "+(x.m.error||""):""}</div><b>${x.m.subject}</b><div class="pv" style="white-space:pre-wrap;margin-top:4px">${x.m.body}</div></div>`.s
      :html`<div class="card" style="margin:8px 0 8px 24px;border-left:4px solid #22C55E"><div class="small muted">📩 Réponse · ${fmtDT(x.r.received_at)} · ${x.r.from_email||""}</div><div class="pv" style="white-space:pre-wrap;margin-top:4px">${x.r.body}</div></div>`.s).join("")||html`<p class="muted">Aucun message.</p>`.s)}`);
}

export async function salesAction(el) {
  const id=el.dataset.id;
  if(el.dataset.act==="sales-verif"){
    el.disabled=true; const txt=el.textContent; el.textContent="Vérification…";
    try{
      const {data,error}=await S.sb.functions.invoke("crm-gmail",{body:{action:"verifier_adresses"}});
      if(error){ let m=error.message; try{const j=await error.context?.json?.(); if(j?.error) m=j.error;}catch{/* corps non JSON */} throw new Error(m); }
      toast(data.traitees?`${data.traitees} adresses contrôlées : ${data.invalides} invalide(s), ${data.a_confirmer} à confirmer${data.restantes?` · ${data.restantes} restantes, relancez`:""}`:"Toutes les adresses ont déjà été vérifiées","ok");
      await loadSales(); renderSales($("#main"));
    }catch(e){ toast(e.message,"bad"); el.disabled=false; el.textContent=txt; }
    return;
  }
  if(el.dataset.act==="sales-new") return newProspectForm();
  if(el.dataset.act==="sales-open") return openProspect(id);
  if(el.dataset.act==="sales-conv") return ouvrirConversation(el.dataset.cle);
  if(el.dataset.act==="sales-refresh"){await loadSales();if(vue==="conversations")await loadMessages();if(vue==="relances")await loadRelances();renderSales($("#main"));return;}
  if(el.dataset.act==="sales-more"){shown+=PAGE;renderSales($("#main"));return;}
  if(el.dataset.act==="sales-vue"){
    vue=VUES.some(v=>v[0]===el.dataset.vue)?el.dataset.vue:"prospects"; shown=PAGE;
    if(vue==="conversations"){ try{ await loadMessages(); }catch(err){ toast(err.message,"bad"); } }
    if(vue==="relances") await loadRelances();
    renderSales($("#main")); return;
  }
  if(el.dataset.act==="sales-qualify"||el.dataset.act==="sales-contact"){
    el.disabled=true;
    try{const {data,error}=await S.sb.functions.invoke("ai-sales-director",{body:{action:el.dataset.act==="sales-qualify"?"qualifier":"contacter",prospect_id:id}});
      if(error){let msg=error.message;try{msg=(await error.context?.json())?.error||msg;}catch{}throw new Error(msg);}
      toast(el.dataset.act==="sales-qualify"?"Qualification IA lancée":"Premier contact demandé à l'agent IA","ok");
      await loadSales();await openProspect(id);
    }catch(err){toast(err.message,"bad");}finally{el.disabled=false;}
  }
}

export async function changeSalesOwner(el) {
  const p=prospects.find(x=>x.id===el.dataset.id);if(!p)return;
  if(!canAssign()){toast("Seule la direction peut réaffecter un prospect.","bad");el.value=p.owner_id??"";return;}
  const owner_id=el.value||null;
  try{
    const {error}=await S.sb.from("ai_prospects").update({owner_id}).eq("id",p.id);
    if(error)throw error;
    toast("Responsable commercial mis à jour","ok");await loadSales();renderSales($("#main"));
  }catch(err){toast(err.message,"bad");el.value=p.owner_id??"";}
}

export async function changeSalesStage(el) {
  const p=prospects.find(x=>x.id===el.dataset.id);if(!p)return;
  const stage=el.value;
  if(["contrat_signe","paiement_attendu","paiement_confirme","marche_gagne","deploiement","client_fidelise"].includes(stage)&&!canAssign()){toast("Cette étape est réservée à la direction et au processus contractuel.","bad");el.value=p.stage;return;}
  try{
    const {error}=await S.sb.from("ai_prospects").update({stage}).eq("id",p.id);
    if(error)throw error;
    toast("Pipeline mis à jour","ok");await loadSales();renderSales($("#main"));
  }catch(err){toast(err.message,"bad");el.value=p.stage;}
}
