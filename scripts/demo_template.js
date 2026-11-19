// Démo interactive d'un logiciel du catalogue : une page autonome (aucun serveur, aucun compte, aucun lien étranger), données FICTIVES.
// Construite à partir des modules du catalogue ; ce n'est pas la copie des écrans de l'application réelle (le bandeau le dit).
const TECH = /sync|offline|pwa|iot|launcher|firebase|indexeddb|supabase|licence|admin m[ée]dia|admin panel|export dgi|fec export/i;
const RX = [
  ["synthese", /tableau de bord|cockpit|kpi|rapport|statistique|rentabilit|bi &|r[ée]sultat|bilan|[ée]tats financiers|balance|carte|gps|cartog/i],
  ["personnes", /client|fournisseur|souscripteur|patient|prospect|[ée]quipe|personnel|chauffeur|m[ée]canicien|main-d|rh|visiteur|vendeur|tiers|contact|portail/i],
  ["stock", /stock|article|produit|pi[èe]ce|intrant|emballage|mat[ée]riel|conditionnement|catalogue|inventaire/i],
  ["ecritures", /compta|journal|[ée]criture|grand livre|syscohada|tva|fiscal|tr[ée]sorerie|lettrage|plan comptable|immobilis|exercice|cl[ôo]ture|[àa]-nouveaux/i],
  ["pieces", /vente|facture|devis|commande|proforma|encaiss|paiement|caisse|[ée]ch[ée]an|recette|d[ée]pense|avoir|achat|bl\b|livraison|re[çc]u|commission|mobile money|encours|abonnement|r[ée]servation/i],
];
const schema = (m) => { for (const [k, r] of RX) if (r.test(m)) return k; return "dossiers"; };
const VILLES = ["Abidjan", "Bouaké", "Yamoussoukro", "San-Pédro", "Korhogo", "Daloa", "Man", "Abengourou"];
const PRENOMS = ["Awa", "Koffi", "Mariam", "Yao", "Aïcha", "Ibrahim", "Adjoua", "Serge", "Fatou", "Kouadio", "Nadège", "Moussa"];
const TIERS = ["Ets Horizon", "SARL Baobab", "Coop Soleil Levant", "Groupe Atlas", "SCI Lagune", "Ets Savane", "SA Éburnie", "Bureau Palmier", "Société Kaolin", "Ets Cacaoyer", "SARL Mangrove", "Ets Karité"];
const STATUTS = { personnes: ["Actif", "Nouveau", "À relancer"], stock: ["OK", "Bas", "Rupture"], pieces: ["Payée", "En attente", "En retard"], dossiers: ["En cours", "Terminé", "En attente"] };
const ARTICLES = ["Article A", "Référence B", "Lot C", "Modèle D", "Kit E", "Série F", "Pack G", "Réf. H", "Unité J", "Gamme K"];

function rng(seed) { let s = 0; for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function donnees(slug, module) {
  const R = rng(slug + "|" + module), pick = (a) => a[Math.floor(R() * a.length)], k = schema(module), n = 8, rows = [], mois = (i) => ("0" + (1 + Math.floor(R() * 28))).slice(-2) + "/" + ("0" + (1 + (i % 11))).slice(-2) + "/2026";
  const montant = (a, b) => Math.round((a + R() * (b - a)) / 500) * 500;
  if (k === "personnes") { for (let i = 0; i < n; i++) rows.push([pick(TIERS) + " " + (i + 1), pick(VILLES), "07 00 " + ("0" + Math.floor(R() * 100)).slice(-2) + " " + ("0" + Math.floor(R() * 100)).slice(-2), pick(STATUTS.personnes), montant(0, 900000)]); return { k, def: STATUTS.personnes[0], cols: [["Nom", "t"], ["Ville", "t"], ["Téléphone", "t"], ["Statut", "c"], ["Solde (FCFA)", "m"]], rows }; }
  if (k === "stock") { for (let i = 0; i < n; i++) { const q = Math.floor(R() * 200), s = 20 + Math.floor(R() * 40); rows.push([ARTICLES[i % ARTICLES.length], q, s, montant(1000, 90000), q === 0 ? "Rupture" : q < s ? "Bas" : "OK"]); } return { k, def: STATUTS.stock[0], cols: [["Article", "t"], ["Quantité", "n"], ["Seuil", "n"], ["Prix unitaire (FCFA)", "m"], ["État", "c"]], rows }; }
  if (k === "pieces") { for (let i = 0; i < n; i++) rows.push(["P-2026-" + ("00" + (101 + i)).slice(-3), pick(TIERS), mois(i), montant(50000, 2500000), pick(STATUTS.pieces)]); return { k, def: STATUTS.pieces[0], cols: [["N°", "t"], ["Tiers", "t"], ["Date", "t"], ["Montant (FCFA)", "m"], ["Statut", "c"]], rows }; }
  if (k === "ecritures") { for (let i = 0; i < n; i++) { const m = montant(20000, 1800000), d = R() < 0.5; rows.push([mois(i), "PC-" + (301 + i), pick(["Vente de marchandises", "Achat fournitures", "Règlement client", "Charges de personnel", "Loyer", "Prestation de services", "Règlement fournisseur", "Frais bancaires"]), d ? m : 0, d ? 0 : m]); } return { k, cols: [["Date", "t"], ["Pièce", "t"], ["Libellé", "t"], ["Débit (FCFA)", "m"], ["Crédit (FCFA)", "m"]], rows }; }
  for (let i = 0; i < n; i++) rows.push(["R-" + (101 + i), module.split(/[ &/]/)[0] + " " + (i + 1), pick(PRENOMS), mois(i), Math.floor(R() * 101), pick(STATUTS.dossiers)]);
  return { k: "dossiers", def: STATUTS.dossiers[0], cols: [["Réf.", "t"], ["Intitulé", "t"], ["Responsable", "t"], ["Échéance", "t"], ["Avancement (%)", "p"], ["Statut", "c"]], rows };
}

function demoHtml(log, o) {
  const E = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[x]));
  const mods = String(log.modules || "").split(",").map((x) => x.trim()).filter((x) => x && !TECH.test(x));
  const R = rng(o.slug), acc = /^#[0-9a-fA-F]{3,8}$/.test(log.color || "") ? log.color : "#0e7490";
  const data = { slug: o.slug, nom: log.nom, mods: mods.map((m) => ({ nom: m, ...donnees(o.slug, m) })), mois: ["Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov."].map((m) => [m, Math.round((3 + R() * 9) * 100000)]),
    wa: o.wa, wamsg: "Bonjour, je souhaite une démo gratuite de " + log.nom + " (après avoir essayé la démo en ligne)." };
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Démo ${E(log.nom)} · SANIX Africa</title>
<meta name="description" content="Essayez ${E(log.nom)} sans compte : démo interactive avec des données fictives."><meta name="theme-color" content="#0B1220">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#0B1220;color:#E5E7EB;line-height:1.5;min-height:100vh;display:flex;flex-direction:column}
a{color:inherit}.bandeau{background:#78350F;color:#FDE68A;font-size:12.5px;padding:7px 14px;text-align:center}.top{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 16px;background:#111827;border-bottom:1px solid #1F2937;flex-wrap:wrap}
.brand{font-weight:800}.brand span{color:#94A3B8}.btn{display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:10px;font-weight:700;font-size:13px;text-decoration:none;border:0;cursor:pointer;background:#25D366;color:#06260F}.btn.g{background:transparent;border:1px solid #334155;color:#E5E7EB}
.layout{display:flex;flex:1;min-height:0}nav{width:230px;background:#0F172A;border-right:1px solid #1F2937;padding:10px;overflow:auto}nav button{display:block;width:100%;text-align:left;background:none;border:0;color:#CBD5E1;padding:9px 10px;border-radius:8px;font-size:13.5px;cursor:pointer}nav button:hover{background:#1F2937}nav button.on{background:${E(acc)};color:#fff;font-weight:700}
main{flex:1;padding:18px;overflow:auto;min-width:0}h2{font-size:20px;color:#fff;margin-bottom:12px}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:16px}.kpi{background:#111827;border:1px solid #1F2937;border-radius:12px;padding:12px}.kpi b{display:block;font-size:22px;color:#fff}.kpi span{font-size:12px;color:#94A3B8}
.bar{display:flex;align-items:flex-end;gap:10px;height:150px;background:#111827;border:1px solid #1F2937;border-radius:12px;padding:14px;margin-bottom:16px}.bar div{flex:1;background:${E(acc)};border-radius:6px 6px 0 0;position:relative;min-height:6px}.bar div i{position:absolute;bottom:-18px;left:0;right:0;text-align:center;font-size:11px;color:#94A3B8;font-style:normal}
.tools{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}input,select{background:#0B1220;border:1px solid #334155;color:#fff;border-radius:8px;padding:8px 10px;font-size:14px}.wrap{overflow:auto;border:1px solid #1F2937;border-radius:12px}table{width:100%;border-collapse:collapse;font-size:13.5px;min-width:520px}th{background:#111827;text-align:left;padding:9px 10px;cursor:pointer;white-space:nowrap;color:#CBD5E1}td{padding:8px 10px;border-top:1px solid #1F2937}tr:hover td{background:#111827}
.chip{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700;background:#1F2937}.ok{background:#064E3B;color:#6EE7B7}.warn{background:#78350F;color:#FCD34D}.ko{background:#7F1D1D;color:#FECACA}.pct{height:8px;background:#1F2937;border-radius:99px;overflow:hidden;min-width:70px}.pct i{display:block;height:100%;background:${E(acc)}}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}.cards button{background:#111827;border:1px solid #1F2937;border-radius:12px;padding:14px;color:#E5E7EB;text-align:left;cursor:pointer;font-size:14px}.cards button:hover{border-color:${E(acc)}}
.x{background:none;border:0;color:#F87171;cursor:pointer}@media(max-width:760px){.layout{flex-direction:column}nav{width:100%;display:flex;gap:6px;overflow-x:auto;border-right:0;border-bottom:1px solid #1F2937}nav button{white-space:nowrap;width:auto}}</style></head><body>
<div class="bandeau">Démo interactive — <b>données fictives</b>, rien n'est enregistré. Elle illustre les modules de ${E(log.nom)} ; l'application réelle peut différer.</div>
<div class="top"><div class="brand">${E(log.icon || "")} ${E(log.nom)} <span>· démo</span></div><div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn g" href="../landing/${E(o.slug)}.html">← Présentation</a><a class="btn" id="cta" href="#">📱 Je veux ce logiciel</a></div></div>
<div class="layout"><nav id="nav"></nav><main id="main"></main></div>
<script>var D=${JSON.stringify(data).replace(/</g, "\\u003c")},cur=-1,Q="",S={k:-1,d:1};
var $=function(i){return document.getElementById(i)},esc=function(t){return String(t==null?"":t).replace(/[&<>"]/g,function(x){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[x]})},fm=function(n){return Number(n).toLocaleString("fr-FR")};
$("cta").href="https://wa.me/"+D.wa+"?text="+encodeURIComponent(D.wamsg);
function nav(){$("nav").innerHTML='<button class="'+(cur<0?"on":"")+'" data-i="-1">🏠 Vue d\\'ensemble</button>'+D.mods.map(function(m,i){return'<button class="'+(cur===i?"on":"")+'" data-i="'+i+'">'+esc(m.nom)+"</button>"}).join("")}
function chip(v){var c=/^(OK|Actif|Payée|Terminé)$/.test(v)?"ok":/^(Bas|En attente|Nouveau|À relancer|En cours)$/.test(v)?"warn":"ko";return'<span class="chip '+c+'">'+esc(v)+"</span>"}
function cell(t,v){return t==="m"?fm(v):t==="c"?chip(v):t==="p"?'<div class="pct"><i style="width:'+Number(v)+'%"></i></div> '+v+" %":esc(v)}
function home(){var tot=0,n=0;D.mods.forEach(function(m){m.rows.forEach(function(r){n++})});var max=Math.max.apply(null,D.mois.map(function(x){return x[1]}));tot=D.mois.reduce(function(a,x){return a+x[1]},0);
$("main").innerHTML="<h2>Vue d'ensemble</h2>"+'<div class="kpis"><div class="kpi"><b>'+fm(tot)+' FCFA</b><span>Activité sur 6 mois (exemple)</span></div><div class="kpi"><b>'+D.mods.length+'</b><span>Modules à explorer</span></div><div class="kpi"><b>'+n+'</b><span>Lignes d\\'exemple</span></div><div class="kpi"><b>0</b><span>Compte à créer</span></div></div>'
+'<div class="bar">'+D.mois.map(function(x){return'<div style="height:'+Math.round(x[1]/max*100)+'%" title="'+fm(x[1])+' FCFA"><i>'+x[0]+"</i></div>"}).join("")+"</div>"
+'<h2 style="margin-top:26px">Cliquez sur un module</h2><div class="cards">'+D.mods.map(function(m,i){return'<button data-i="'+i+'">'+esc(m.nom)+"</button>"}).join("")+"</div>"}
function view(){var m=D.mods[cur],q=Q.toLowerCase(),rows=m.rows.map(function(r,i){return{r:r,i:i}}).filter(function(x){return!q||x.r.join(" ").toLowerCase().indexOf(q)>-1});
if(S.k>=0){var t=m.cols[S.k][1];rows.sort(function(a,b){var x=a.r[S.k],y=b.r[S.k];return(t==="m"||t==="n"||t==="p"?x-y:String(x).localeCompare(String(y),"fr"))*S.d})}
var mi=m.cols.findIndex(function(c){return c[1]==="m"}),sum=mi>-1?m.rows.reduce(function(a,r){return a+Number(r[mi])},0):0,att=m.rows.filter(function(r){return/attente|retard|Bas|Rupture|relancer/.test(r.join("|"))}).length;
$("main").innerHTML="<h2>"+esc(m.nom)+"</h2>"+'<div class="kpis"><div class="kpi"><b>'+m.rows.length+"</b><span>Éléments</span></div>"+(mi>-1?'<div class="kpi"><b>'+fm(sum)+"</b><span>Total FCFA</span></div>":"")+'<div class="kpi"><b>'+att+"</b><span>À surveiller</span></div></div>"
+'<div class="tools"><input id="q" placeholder="🔍 Rechercher" value="'+esc(Q)+'"><button class="btn g" id="add">+ Ajouter une ligne d\\'exemple</button></div><div class="wrap"><table><thead><tr>'+m.cols.map(function(c,i){return'<th data-s="'+i+'">'+esc(c[0])+(S.k===i?(S.d>0?" ▲":" ▼"):"")+"</th>"}).join("")+"<th></th></tr></thead><tbody>"
+rows.map(function(x){return"<tr>"+x.r.map(function(v,i){return"<td>"+cell(m.cols[i][1],v)+"</td>"}).join("")+'<td><button class="x" data-d="'+x.i+'" title="Supprimer">✕</button></td></tr>'}).join("")+"</tbody></table></div>"+(rows.length?"":'<p style="padding:14px;color:#94A3B8">Aucun résultat.</p>');
var q2=$("q");q2.oninput=function(){Q=q2.value;var p=q2.selectionStart;view();var n=$("q");n.focus();n.setSelectionRange(p,p)}}
document.addEventListener("click",function(e){var t=e.target,b=t.closest&&t.closest("[data-i]");if(b){cur=Number(b.dataset.i);Q="";S={k:-1,d:1};nav();cur<0?home():view();return}
var s=t.closest&&t.closest("[data-s]");if(s){var k=Number(s.dataset.s);S.d=S.k===k?-S.d:1;S.k=k;view();return}
var d=t.closest&&t.closest("[data-d]");if(d){D.mods[cur].rows.splice(Number(d.dataset.d),1);view();return}
if(t.id==="add"){var m=D.mods[cur],r=m.cols.map(function(c,i){return c[1]==="m"?Math.round(Math.random()*20)*50000:c[1]==="n"?Math.floor(Math.random()*100):c[1]==="p"?Math.floor(Math.random()*101):c[1]==="c"?m.def:i===0?"Nouveau "+(m.rows.length+1):"—"});m.rows.unshift(r);view()}});
nav();home();</script></body></html>`;
}
module.exports = { demoHtml, schema, TECH };
