// SANIX CRM — réseau relationnel agents ↔ prospects.
// Les liens reposent sur les affectations owner_id et les événements ai_actions(agent_id, prospect_id).
// Les événements sans agent_id restent visibles comme non attribués : aucune relation n'est inventée.
export function createProspectRelations(canvas, api) {
  const ctx = canvas.getContext("2d");
  const state = { agents: [], prospects: [], activities: [], tasks: [], memories: [], mode: "relations", width: 0, height: 0, dpr: 1, nodes: [], edges: [], raf: 0, stopped: false, filters: { agent: "", product: "", prospect: "" }, products: [], aliases: [], totalProspects: 0, camera: { x: 0, y: 0, scale: 1 }, selected: null, selectedRelation: null, pointer: null, manualPositions: new Map() };
  const palette = { nouveau:"#64748B",a_qualifier:"#94A3B8",qualifie:"#22D3EE",premier_contact:"#38BDF8",conversation:"#60A5FA",besoin_identifie:"#818CF8",interesse:"#A78BFA",rdv_propose:"#F59E0B",rdv_confirme:"#FBBF24",demo_realisee:"#F97316",offre_transmise:"#FB923C",negociation:"#E879F9",offre_acceptee:"#22C55E",contrat_transmis:"#4ADE80",marche_gagne:"#16A34A",client_fidelise:"#10B981",perdu:"#EF4444",en_veille:"#64748B" };
  const label = s => String(s || "nouveau").replace(/_/g," ");
  const norm = v => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr").trim();
  const productValues = p => {
    let raw = p?.produits_recommandes;
    if (raw == null || raw === "") return [];
    if (typeof raw === "string") {
      const value = raw.trim();
      if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}"))) {
        try { raw = JSON.parse(value); } catch { raw = value.split(/[;,|]/); }
      } else raw = value.split(/[;,|]/);
    }
    const values = Array.isArray(raw) ? raw : [raw];
    return values.map(v => typeof v === "object" && v ? (v.id ?? v.product_id ?? v.nom ?? v.name ?? v.label ?? "") : v).map(v => String(v ?? "").trim()).filter(Boolean);
  };
  const catalogProduct = token => {
    const key = norm(token);
    const direct = state.products.find(p => norm(p.id) === key || norm(p.nom) === key);
    if (direct) return direct;
    const alias = state.aliases.find(a => norm(a.alias) === key);
    return alias ? state.products.find(p => String(p.id) === String(alias.product_id)) || null : null;
  };
  const productOf = p => {
    if (state.filters.product && matchesProduct(p, state.filters.product)) return state.products.find(x => String(x.id) === String(state.filters.product))?.nom || String(state.filters.product);
    const token = productValues(p)[0] || "";
    return catalogProduct(token)?.nom || token;
  };
  const matchesProduct = (p, selectedId) => {
    if (!selectedId) return true;
    return productValues(p).some(token => {
      const product = catalogProduct(token);
      return product ? String(product.id) === String(selectedId) : norm(token) === norm(selectedId);
    });
  };
  const productColor = value => {
    const s=norm(value);
    if(!s) return "#64748B";
    let hash=0;for(let i=0;i<s.length;i++)hash=(hash*31+s.charCodeAt(i))|0;
    const hue=Math.abs(hash)%360,sat=0.82,l=0.64,k=n=>(n+hue/30)%12,a=sat*Math.min(l,1-l);
    const f=n=>Math.round(255*(l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)))));
    return "#"+[f(0),f(8),f(4)].map(v=>v.toString(16).padStart(2,"0")).join("");
  };
  const prospectColor = p => productOf(p) ? productColor(productOf(p)) : (palette[p.stage] || "#64748B");
  const resize = () => { const r=canvas.getBoundingClientRect();state.dpr=Math.min(2,devicePixelRatio||1);state.width=Math.max(320,r.width);state.height=Math.max(360,r.height);canvas.width=Math.round(state.width*state.dpr);canvas.height=Math.round(state.height*state.dpr);ctx.setTransform(state.dpr,0,0,state.dpr,0,0);layout(); };
  function layout() {
    const w=state.width,h=state.height,left=state.agents.filter(a=>a.etat!=="archive"&&(!state.filters.agent||String(a.id)===state.filters.agent)).slice(0,24);
    const norm = v => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr").trim();
    const filteredProspects = state.prospects.filter(p => {
      const productOk = matchesProduct(p, state.filters.product);
      const haystack = [p.entreprise,p.ville,p.telephone,p.email].map(norm).join(" ");
      const prospectOk = !state.filters.prospect || haystack.includes(norm(state.filters.prospect));
      const agentOk = !state.filters.agent || String(p.agent_id || "") === state.filters.agent || state.activities.some(a => String(a.agent_id || "") === state.filters.agent && String(a.prospect_id || "") === String(p.id)) || state.tasks.some(t => String(t.agent_id || "") === state.filters.agent && String(t.prospect_id || "") === String(p.id));
      return productOk && prospectOk && agentOk;
    });
    const byAgent=new Map(left.map(a=>[String(a.id),a]));
    const byProspect=new Map(filteredProspects.map(p=>[String(p.id),p]));
    // Agréger toutes les preuves disponibles par paire agent/prospect.
    // Une mission et une interaction peuvent coexister : aucune ne doit masquer l'autre.
    const activityPairs=new Map(), missionPairs=new Map();
    for(const t of state.tasks){
      if(!t.agent_id||!t.prospect_id||!byAgent.has(String(t.agent_id))||!byProspect.has(String(t.prospect_id))) continue;
      const key=String(t.agent_id)+"|"+String(t.prospect_id);
      if(!missionPairs.has(key)) missionPairs.set(key,[]);
      missionPairs.get(key).push(t);
    }
    for(const a of state.activities){
      if(!a.agent_id||!a.prospect_id||!byAgent.has(String(a.agent_id))||!byProspect.has(String(a.prospect_id))) continue;
      const key=String(a.agent_id)+"|"+String(a.prospect_id);
      if(!activityPairs.has(key)) activityPairs.set(key,[]);
      activityPairs.get(key).push(a);
    }
    const owners=new Map();
    for(const p of filteredProspects){
      const assigned=[p.agent_id].find(id=>id&&byAgent.has(String(id)));
      if(assigned) owners.set(String(p.id),String(assigned));
    }
    for(const rows of missionPairs.values()) { const t=rows[0]; if(t&&!owners.has(String(t.prospect_id))) owners.set(String(t.prospect_id),String(t.agent_id)); }
    for(const rows of activityPairs.values()) { const a=rows[0]; if(a&&!owners.has(String(a.prospect_id))) owners.set(String(a.prospect_id),String(a.agent_id)); }
    const linkedIds=new Set([...owners.keys()]);
    const ranked=filteredProspects.slice().sort((a,b)=>Number(linkedIds.has(String(b.id)))-Number(linkedIds.has(String(a.id)))||String(b.next_action_at||"").localeCompare(String(a.next_action_at||"")));
    const taskById=new Map(state.tasks.map(t=>[String(t.id),t]));
    const memoryRows=state.mode==="memory"?state.memories.filter(m=>{const task=taskById.get(String(m.task_id));const prospect=task?.prospect_id?state.prospects.find(p=>String(p.id)===String(task.prospect_id)):null;const productOk=!state.filters.product||(prospect&&matchesProduct(prospect,state.filters.product))||(task?.produit&&norm(task.produit)===norm(state.products.find(p=>String(p.id)===String(state.filters.product))?.nom));return(!state.filters.agent||String(m.agent_id||"")===state.filters.agent)&&(!state.filters.prospect||norm([m.contenu,m.source,(m.tags||[]).join(" ")].join(" ")).includes(norm(state.filters.prospect)))&&productOk;}).slice(0,90):[];
    const memoryProspectIds=new Set(memoryRows.map(m=>taskById.get(String(m.task_id))?.prospect_id).filter(Boolean).map(String));
    const prospects=(state.mode==="memory"?ranked.filter(p=>memoryProspectIds.has(String(p.id))).slice(0,45):ranked.slice(0,70)),groups=new Map();
    prospects.forEach(p=>{const owner=owners.get(String(p.id));if(owner){if(!groups.has(owner))groups.set(owner,[]);groups.get(owner).push(p);}});
    const agentNodes=[],prospectNodes=[];
    left.forEach((a,i)=>{const id=String(a.id),pos=state.manualPositions.get(id);agentNodes.push({id,kind:"agent",data:a,x:pos?.x??w*.16,y:pos?.y??h*(.12+.76*(i+.5)/Math.max(1,left.length)),r:7});});
    const byOwner=new Map(agentNodes.map(n=>[n.id,n]));
    prospects.forEach((p,i)=>{
      const ownerId=owners.get(String(p.id))||null,owner=ownerId?byOwner.get(ownerId):null;
      const group=owner?groups.get(ownerId):[],index=owner?group.findIndex(x=>String(x.id)===String(p.id)):i;
      const x=state.mode==="memory"?(owner?w*.84:w*.92):(owner?w*(.52+(index%3)*.045):w*.84);
      const y=owner?owner.y+(index-(group.length-1)/2)*24:h*(.10+.80*(i+0.5)/Math.max(1,prospects.length));
      const id=String(p.id),pos=state.manualPositions.get(id);prospectNodes.push({id,kind:"prospect",data:p,owner,x:pos?.x??x,y:pos?.y??Math.max(34,Math.min(h-34,y)),r:5});
    });
    const nodeByProspect=new Map(prospectNodes.map(n=>[n.id,n]));
    const brainW=Math.min(w*.43,h*.92),brainH=Math.min(h*.66,w*.48),brainCx=w*.51,brainCy=h*.51;
    const memoryNodes=memoryRows.map((m,i)=>{
      const owner=m.agent_id?byOwner.get(String(m.agent_id)):null,task=taskById.get(String(m.task_id)),pos=state.manualPositions.get("memory:"+m.id);
      // Répartition en spirale dans les deux hémisphères du cerveau.
      const angle=i*2.399963229728653,rad=.84*Math.sqrt((i+.5)/Math.max(1,memoryRows.length));
      const nx=Math.cos(angle)*rad,ny=Math.sin(angle)*rad;
      return{id:"memory:"+m.id,kind:"memory",data:m,owner,task,x:pos?.x??brainCx+nx*brainW*.47,y:pos?.y??brainCy+ny*brainH*.43,r:4.2};
    });
    const edges=[];
    const linkedPairs=new Set([...activityPairs.keys(),...missionPairs.keys()]);
    for(const key of linkedPairs){
      const [agentId,prospectId]=key.split("|"),from=byOwner.get(agentId),to=nodeByProspect.get(prospectId);
      if(!from||!to)continue;
      const activities=activityPairs.get(key)||[],tasks=missionPairs.get(key)||[];
      edges.push({from,to,color:prospectColor(to.data),activities,tasks,activity:activities[0]||null,task:tasks[0]||null,activityCount:activities.length,missionCount:tasks.length,kind:activities.length?"activity":"mission"});
    }
    for(const n of prospectNodes){
      if(n.owner&&!linkedPairs.has(n.owner.id+"|"+n.id)) edges.push({from:n.owner,to:n,color:prospectColor(n.data),kind:"assignment"});
    }
    const memoryEdges=[];
    for(const n of memoryNodes){const color=n.data.statut==="valide"?"#34D399":n.data.agent_id?"#FBBF24":"#A78BFA";if(n.owner)memoryEdges.push({from:n.owner,to:n,color,kind:"memory",memory:n.data});const p=n.task?.prospect_id?nodeByProspect.get(String(n.task.prospect_id)):null;if(p)memoryEdges.push({from:n,to:p,color:prospectColor(p.data),kind:"memory_link",memory:n.data,task:n.task});}
    state.nodes=state.mode==="memory"?[...agentNodes,...memoryNodes,...prospectNodes]:[...agentNodes,...prospectNodes];state.edges=state.mode==="memory"?memoryEdges:edges;api.onFilterCount?.(state.mode==="memory"?memoryRows.length:filteredProspects.length,state.mode==="memory"?state.memories.length:state.totalProspects);
  }
  function update(data){
    state.agents=Array.isArray(data.agents)?data.agents:[];
    state.prospects=Array.isArray(data.prospects)?data.prospects:[];
    state.activities=Array.isArray(data.activities)?data.activities:[];
    state.tasks=Array.isArray(data.tasks)?data.tasks:[];
    state.memories=Array.isArray(data.memories)?data.memories:[];
    const nextMode=data.mode==="memory"?"memory":"relations";if(nextMode!==state.mode){state.selected=null;state.selectedRelation=null;}state.mode=nextMode;
    state.totalProspects=state.prospects.length;
    state.products=Array.isArray(data.products)?data.products:[];
    state.aliases=Array.isArray(data.aliases)?data.aliases:[];
    state.filters={ agent: String(data.filters?.agent || ""), product: String(data.filters?.product || ""), prospect: String(data.filters?.prospect || "") };
    layout();
  }
  const clipMemory=(v,n)=>{const text=String(v||"Souvenir");return text.length>n?text.slice(0,n-1)+"…":text;};
  function brainPath(cx,cy,bw,bh){
    ctx.beginPath();
    ctx.moveTo(cx,cy+bh*.43);
    ctx.bezierCurveTo(cx-bw*.17,cy+bh*.52,cx-bw*.48,cy+bh*.40,cx-bw*.49,cy+bh*.13);
    ctx.bezierCurveTo(cx-bw*.61,cy-bh*.08,cx-bw*.46,cy-bh*.38,cx-bw*.23,cy-bh*.42);
    ctx.bezierCurveTo(cx-bw*.12,cy-bh*.50,cx-bw*.045,cy-bh*.43,cx,cy-bh*.34);
    ctx.bezierCurveTo(cx+bw*.045,cy-bh*.43,cx+bw*.12,cy-bh*.50,cx+bw*.23,cy-bh*.42);
    ctx.bezierCurveTo(cx+bw*.46,cy-bh*.38,cx+bw*.61,cy-bh*.08,cx+bw*.49,cy+bh*.13);
    ctx.bezierCurveTo(cx+bw*.48,cy+bh*.40,cx+bw*.17,cy+bh*.52,cx,cy+bh*.43);
    ctx.closePath();
  }
  function drawBrain(cx,cy,bw,bh,t){
    ctx.save();
    const pulse=.5+.5*Math.sin(t/1050), sheen=.5+.5*Math.sin(t/2400);
    // Rotation continue sur 360° autour de l'axe vertical (un tour en 18 secondes).
    const angle=(t/18000)*Math.PI*2, facing=Math.cos(angle), side=Math.sin(angle);
    // Une vraie épaisseur visuelle : la projection ne s'écrase jamais en feuille.
    const depth=.34+.66*Math.abs(facing), bodyShift=side*bw*.16, bodyThickness=bw*.25;
    // Halo orbital indépendant : donne un repère spatial pendant le tour.
    ctx.save();ctx.translate(cx,cy+bh*.04);ctx.scale(1,.19);ctx.beginPath();ctx.ellipse(0,0,bw*.61,bw*.61,0,0,Math.PI*2);
    ctx.strokeStyle="rgba(91,220,255,.28)";ctx.lineWidth=1.4;ctx.shadowColor="#22D3EE";ctx.shadowBlur=9;ctx.stroke();ctx.shadowBlur=0;
    const orbitA=angle+Math.PI*.18,ox=Math.cos(orbitA)*bw*.61,oy=Math.sin(orbitA)*bw*.61;
    ctx.beginPath();ctx.arc(ox,oy,3.5+2*pulse,0,Math.PI*2);ctx.fillStyle="#9CF3FF";ctx.shadowColor="#22D3EE";ctx.shadowBlur=14;ctx.fill();ctx.restore();
    // Projection volumétrique : coque arrière, tranche corticale et face avant.
    // La tranche reste visible de profil grâce à l'épaisseur du volume.
    ctx.save();
    const mirror=facing<0?-1:1, projectedCx=cx+bodyShift;
    ctx.translate(projectedCx,cy);ctx.scale(mirror*depth,1);ctx.translate(-cx,-cy);
    for(let layer=12;layer>=1;layer--){
      const offset=side*bodyThickness*(layer/12);
      brainPath(cx+offset,cy+Math.abs(offset)*.10,bw,bh);
      const shade=layer/12;
      ctx.fillStyle="rgba(4,15,38,"+(.22+.42*shade)+")";
      ctx.strokeStyle="rgba(38,132,181,"+(.12+.20*(1-shade))+")";
      ctx.lineWidth=1;ctx.fill();ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.translate(projectedCx,cy);ctx.scale(mirror*depth,1);ctx.translate(-cx,-cy);
    brainPath(cx,cy,bw,bh);
    const volume=ctx.createRadialGradient(cx-bw*.17,cy-bh*.27,2,cx,cy,bw*.69);
    volume.addColorStop(0,"rgba(116,225,255,.48)");
    volume.addColorStop(.25,"rgba(48,133,190,.42)");
    volume.addColorStop(.62,"rgba(29,66,119,.68)");
    volume.addColorStop(1,"rgba(7,18,43,.96)");
    ctx.fillStyle=volume;ctx.shadowColor="#22D3EE";ctx.shadowBlur=30+18*pulse;ctx.fill();
    ctx.shadowBlur=0;ctx.lineWidth=2.2;ctx.strokeStyle="rgba(112,224,255,.9)";ctx.stroke();
    // Relief organique : sillons ramifiés, dessinés à l'intérieur du volume.
    ctx.save();brainPath(cx,cy,bw,bh);ctx.clip();
    const folds=[
      [-.39,-.22,-.29,-.39,-.12,-.32,-.09,-.15],[-.43,-.02,-.28,-.15,-.14,-.05,-.19,.12],
      [-.38,.22,-.25,.08,-.13,.27,-.22,.36],[-.28,-.36,-.21,-.19,-.31,-.05,-.20,.02],
      [-.18,-.27,-.06,-.16,-.22,.04,-.10,.16],[-.12,.02,-.03,.15,-.16,.26,-.08,.34],
      [.39,-.22,.29,-.39,.12,-.32,.09,-.15],[.43,-.02,.28,-.15,.14,-.05,.19,.12],
      [.38,.22,.25,.08,.13,.27,.22,.36],[.28,-.36,.21,-.19,.31,-.05,.20,.02],
      [.18,-.27,.06,-.16,.22,.04,.10,.16],[.12,.02,.03,.15,.16,.26,.08,.34]
    ];
    for(let i=0;i<folds.length;i++){
      const a=folds[i],side=a[0]<0?-1:1;
      ctx.beginPath();ctx.moveTo(cx+bw*a[0],cy+bh*a[1]);
      ctx.bezierCurveTo(cx+bw*a[2],cy+bh*a[3],cx+bw*a[4],cy+bh*a[5],cx+bw*a[6],cy+bh*a[7]);
      ctx.strokeStyle=i%2?"rgba(124,222,255,.34)":"rgba(5,19,48,.48)";
      ctx.lineWidth=i%3===0?4:2.2;ctx.lineCap="round";ctx.stroke();
      ctx.beginPath();ctx.moveTo(cx+bw*a[0],cy+bh*a[1]-2);
      ctx.bezierCurveTo(cx+bw*a[2],cy+bh*a[3]-2,cx+bw*a[4],cy+bh*a[5]-2,cx+bw*a[6],cy+bh*a[7]-2);
      ctx.strokeStyle="rgba(177,241,255,.19)";ctx.lineWidth=1;ctx.stroke();
    }
    // Petites fibres lumineuses évoquant les réseaux neuronaux.
    for(let i=0;i<34;i++){
      const side=i%2?-1:1,xx=cx+side*bw*(.08+(i%7)*.045),yy=cy+bh*(-.28+Math.floor(i/7)*.13);
      ctx.beginPath();ctx.moveTo(xx,yy);ctx.quadraticCurveTo(xx+side*bw*.055,yy-bh*.055,xx+side*bw*.10,yy+bh*.015);
      ctx.strokeStyle="rgba(67,220,255,"+(.12+.12*sheen)+")";ctx.lineWidth=1;ctx.stroke();
    }
    ctx.restore();
    // Sillon central uniquement visible lorsque la face avant est orientée vers nous.
    if(Math.abs(facing)>.42){
      ctx.beginPath();ctx.moveTo(cx,cy-bh*.34);ctx.bezierCurveTo(cx-bw*.045,cy-bh*.12,cx+bw*.04,cy+bh*.12,cx,cy+bh*.39);
      ctx.strokeStyle="rgba(173,240,255,.82)";ctx.lineWidth=2.4;ctx.shadowColor="#57DFFF";ctx.shadowBlur=12;ctx.stroke();ctx.shadowBlur=0;
    }else{
      // Crête lumineuse du profil : révèle l'épaisseur anatomique, pas une tranche plate.
      ctx.beginPath();ctx.moveTo(cx+side*bw*.11,cy-bh*.34);ctx.bezierCurveTo(cx+side*bw*.27,cy-bh*.18,cx+side*bw*.23,cy+bh*.17,cx+side*bw*.10,cy+bh*.37);
      ctx.strokeStyle="rgba(174,241,255,.72)";ctx.lineWidth=3.5;ctx.shadowColor="#57DFFF";ctx.shadowBlur=16;ctx.stroke();ctx.shadowBlur=0;
    }
    // Reflet volumétrique supérieur et ombre basale.
    const gloss=ctx.createRadialGradient(cx-bw*.18,cy-bh*.30,1,cx-bw*.08,cy-bh*.12,bw*.40);
    gloss.addColorStop(0,"rgba(220,250,255,.23)");gloss.addColorStop(1,"rgba(220,250,255,0)");
    brainPath(cx,cy,bw,bh);ctx.fillStyle=gloss;ctx.fill();
    // Reflet latéral mobile pour matérialiser le relief pendant la rotation.
    const rimX=cx-side*bw*.30;
    const rim=ctx.createRadialGradient(rimX,cy,2,rimX,cy,bw*.38);
    rim.addColorStop(0,"rgba(107,231,255,.28)");rim.addColorStop(1,"rgba(107,231,255,0)");
    brainPath(cx,cy,bw,bh);ctx.fillStyle=rim;ctx.fill();
    ctx.restore();
    // Titre toujours lisible, même lorsque le cerveau présente son profil.
    ctx.font="700 11px system-ui";ctx.textAlign="center";ctx.fillStyle="#C9F4FF";ctx.shadowColor="#22D3EE";ctx.shadowBlur=12;
    ctx.fillText("SANIX  /  MÉMOIRE NEURONALE",cx,cy-bh*.59);ctx.shadowBlur=0;
    ctx.restore();
  }
  function draw(t){
    if(state.stopped)return;
    const w=state.width,h=state.height;ctx.clearRect(0,0,w,h);
    const bg=ctx.createRadialGradient(w*.52,h*.5,10,w*.52,h*.5,Math.max(w,h)*.72);bg.addColorStop(0,"rgba(20,54,91,.34)");bg.addColorStop(1,"rgba(4,10,22,.98)");ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    for(let i=0;i<55;i++){ctx.fillStyle="rgba(148,180,230,.18)";ctx.fillRect((i*137.5)%w,(i*83.7)%h,1,1);}
    ctx.font="600 10px system-ui";ctx.fillStyle="#9FB2D3";ctx.fillText("ÉQUIPE COMMERCIALE",16,20);ctx.fillText(state.mode==="memory"?"MÉMOIRE ACTIVE":"RELATIONS / ACTIVITÉS",w*.43,20);ctx.fillText(state.mode==="memory"?"PROSPECTS LIÉS":"SANS LIAISON",w*.78,20);
    ctx.save();ctx.translate(w/2+state.camera.x,h/2+state.camera.y);ctx.scale(state.camera.scale,state.camera.scale);ctx.translate(-w/2,-h/2);
    for(const e of state.edges){
      const {from,to,color}=e;const active=!state.selected||from.id===state.selected||to.id===state.selected;ctx.globalAlpha=active?1:.12;const c1=from.x+(to.x-from.x)*.36,c2=from.x+(to.x-from.x)*.68;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.bezierCurveTo(c1,from.y,c2,to.y,to.x,to.y);
      ctx.setLineDash(e.kind==="mission"?[5,4]:e.kind==="assignment"?[2,5]:e.kind==="memory_link"?[3,5]:[]);ctx.strokeStyle=e.kind==="activity"?color+"D8":e.kind==="mission"?color+"C0":e.kind==="memory"?"#FBBF24D8":e.kind==="memory_link"?color+"C0":color+"70";ctx.lineWidth=e.kind==="memory"?2.2:e.kind==="memory_link"?1.8:e.activityCount&&e.missionCount?2.8:e.kind==="activity"?2:e.kind==="mission"?1.6:1.2;ctx.stroke();ctx.setLineDash([]);
      const seed=(Number(String(to.id).replace(/\D/g,"").slice(-4))||13)%97/97;
      const k=(t*.00012+seed)%1,q=1-k;
      const x=q*q*q*from.x+3*q*q*k*c1+3*q*k*k*c2+k*k*k*to.x;
      const y=q*q*q*from.y+3*q*q*k*from.y+3*q*k*k*to.y+k*k*k*to.y;
      ctx.beginPath();ctx.arc(x,y,e.kind==="activity"?2.8:e.kind==="mission"?2.4:e.kind==="memory"?3:2,0,Math.PI*2);ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=11;ctx.fill();ctx.shadowBlur=0;
    }
    if(state.mode==="memory"){
      const bw=Math.min(w*.43,h*.92),bh=Math.min(h*.66,w*.48);
      drawBrain(w*.51,h*.51,bw,bh,t);
    }
    for(const n of state.nodes){
      const p=n.data,color=n.kind==="agent"?"#22D3EE":n.kind==="memory"?(p.statut==="valide"?"#34D399":p.agent_id?"#FBBF24":"#A78BFA"):prospectColor(p),active=!state.selected||n.id===state.selected||state.edges.some(e=>(e.from.id===state.selected&&e.to.id===n.id)||(e.to.id===state.selected&&e.from.id===n.id));ctx.globalAlpha=active?1:.18;
      const phase=t/500+n.y, pulse=3.5+Math.sin(phase)*2;if(state.selected===n.id){ctx.beginPath();ctx.arc(n.x,n.y,n.r+10,0,Math.PI*2);ctx.strokeStyle="#FFFFFF";ctx.lineWidth=1.5;ctx.stroke();}
      ctx.beginPath();ctx.arc(n.x,n.y,n.r+ pulse,0,Math.PI*2);ctx.fillStyle=color+"18";ctx.fill();
      ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=12;ctx.fill();ctx.shadowBlur=0;
      if(n.kind==="agent"||n.kind==="prospect"){
        ctx.font=n.kind==="agent"?"600 10px system-ui":"9px system-ui";ctx.fillStyle=n.kind==="agent"?"#E5F5FF":"#C8D6ED";
        const name=n.kind==="agent"?(p.nom||p.code||"Agent"):(p.entreprise||"Prospect"),max=n.kind==="agent"?23:22;
        ctx.fillText(name.length>max?name.slice(0,max-1)+"…":name,n.x+(n.kind==="agent"?12:9),n.y+3);
        if(n.kind==="prospect"){ctx.font="8px system-ui";ctx.fillStyle=color;ctx.fillText(label(p.stage),n.x+9,n.y+13);}
      }else if(n.kind==="memory"){
        ctx.beginPath();ctx.arc(n.x,n.y,n.r+2+Math.sin(phase)*1.4,0,Math.PI*2);ctx.fillStyle=color+"25";ctx.fill();
        if(state.selected===n.id){ctx.font="600 10px system-ui";ctx.fillStyle="#F8FAFF";ctx.fillText(clipMemory(p.contenu,54),n.x+10,n.y-8);}
      }
    }
    ctx.restore();ctx.globalAlpha=1;
    const prospectNodes=state.nodes.filter(n=>n.kind==="prospect"),memoryNodes=state.nodes.filter(n=>n.kind==="memory"),total=prospectNodes.length,linked=new Set(state.edges.map(e=>e.to.id)).size,activityEdges=state.edges.filter(e=>e.kind==="activity").length,missionEdges=state.edges.filter(e=>e.kind==="mission").length,assigned=prospectNodes.filter(n=>n.owner).length;
    const noAgent=state.activities.filter(a=>a.prospect_id&&!a.agent_id).length;
    const legendItems=[{type:"agent",label:"Agents",color:"#22D3EE"}];
    if(state.mode==="memory"){legendItems.push({type:"memory",label:"Mémoire à vérifier",color:"#FBBF24",count:memoryNodes.filter(n=>n.data.statut!=="valide").length},{type:"memory-valid",label:"Mémoire validée",color:"#34D399",count:memoryNodes.filter(n=>n.data.statut==="valide").length},{type:"memory-shared",label:"Mémoire partagée",color:"#A78BFA",count:memoryNodes.filter(n=>!n.data.agent_id).length});}
    const productCounts=new Map(),stageCounts=new Map();
    for(const n of prospectNodes){const product=productOf(n.data);if(product)productCounts.set(product,(productCounts.get(product)||0)+1);else{const stage=label(n.data.stage);stageCounts.set(stage,(stageCounts.get(stage)||0)+1);}}
    for(const [name,count] of [...productCounts].sort((a,b)=>a[0].localeCompare(b[0],"fr"))) legendItems.push({type:"product",label:name,color:productColor(name),count});
    for(const [name,count] of [...stageCounts].sort((a,b)=>a[0].localeCompare(b[0],"fr"))) legendItems.push({type:"stage",label:name,color:palette[name.replace(/ /g,"_")]||"#64748B",count});
    legendItems.push({type:"activity",label:"Interaction réelle",color:"#E2E8F0"});
    legendItems.push({type:"mission",label:"Mission affectée",color:"#A78BFA"});
    legendItems.push({type:"assignment",label:"Affectation",color:"#64748B"});
    api.onLegend?.(legendItems);
    ctx.fillStyle="#DCE8FA";ctx.font="600 11px system-ui";
    ctx.fillText(state.mode==="memory"?memoryNodes.length+" mémoires affichées · "+memoryNodes.filter(n=>n.data.statut==="valide").length+" validées · "+memoryNodes.filter(n=>n.data.statut!=="valide").length+" à vérifier · "+memoryNodes.filter(n=>!n.data.agent_id).length+" partagées":total+" prospects · "+linked+" reliés · "+assigned+" affectations · "+missionEdges+" missions · "+activityEdges+" activités · "+noAgent+" activités sans agent identifié",16,h-16);
    state.raf=requestAnimationFrame(draw);
  }
  const screenPoint=ev=>{const r=canvas.getBoundingClientRect();return{x:ev.clientX-r.left,y:ev.clientY-r.top};};
  const worldPoint=p=>({x:(p.x-state.width/2-state.camera.x)/state.camera.scale+state.width/2,y:(p.y-state.height/2-state.camera.y)/state.camera.scale+state.height/2});
  const hitAt=p=>{
    const q=worldPoint(p);
    return [...state.nodes].reverse().find(n=>{
      if(Math.hypot(n.x-q.x,n.y-q.y)<=Math.max(15,n.r+8))return true;
      const data=n.data||{},name=String(n.kind==="agent"?(data.nom||data.code||"Agent"):n.kind==="memory"?(data.contenu||"Mémoire"):(data.entreprise||"Prospect"));
      ctx.save();ctx.font=n.kind==="agent"?"600 10px system-ui":n.kind==="memory"?"8px system-ui":"9px system-ui";
      const max=n.kind==="memory"?42:23,width=ctx.measureText(name.length>max?name.slice(0,max-1)+"…":name).width;ctx.restore();
      const left=n.x+(n.kind==="agent"?12:9),top=n.y-7;
      return q.x>=left&&q.x<=left+Math.max(24,width)&&q.y>=top&&q.y<=n.y+9;
    });
  };
  const edgeAt=p=>{const q=worldPoint(p);let best=null,dist=Infinity;for(const e of state.edges){const c1=e.from.x+(e.to.x-e.from.x)*.36,c2=e.from.x+(e.to.x-e.from.x)*.68;let prev={x:e.from.x,y:e.from.y};for(let i=1;i<=28;i++){const t=i/28,u=1-t,x=u*u*u*e.from.x+3*u*u*t*c1+3*u*t*t*c2+t*t*t*e.to.x,y=u*u*u*e.from.y+3*u*u*t*e.from.y+3*u*t*t*e.to.y+t*t*t*e.to.y,dx=x-prev.x,dy=y-prev.y,len=dx*dx+dy*dy||1,k=Math.max(0,Math.min(1,((q.x-prev.x)*dx+(q.y-prev.y)*dy)/len)),d=Math.hypot(q.x-(prev.x+k*dx),q.y-(prev.y+k*dy));if(d<dist){dist=d;best=e;}prev={x,y};}}return dist<10?best:null;};
  const zoomAt=(factor,p={x:state.width/2,y:state.height/2})=>{const before=worldPoint(p);state.camera.scale=Math.max(.55,Math.min(2.8,state.camera.scale*factor));const after=worldPoint(p);state.camera.x+=(after.x-before.x)*state.camera.scale;state.camera.y+=(after.y-before.y)*state.camera.scale;};
  const resetCamera=()=>{state.camera={x:0,y:0,scale:1};};
  const onPointerDown=ev=>{if(ev.button!==undefined&&ev.button!==0)return;const p=screenPoint(ev),hit=hitAt(p),edge=hit?null:edgeAt(p);state.pointer={id:ev.pointerId,start:p,last:p,hit,edge,moved:false,mode:hit?"node":edge?"relation":"pan"};canvas.setPointerCapture?.(ev.pointerId);canvas.classList.toggle("dragging",!hit&&!edge);};
  const onPointerMove=ev=>{const p=screenPoint(ev),pt=state.pointer;if(!pt){canvas.style.cursor=hitAt(p)?"pointer":"grab";return;}const dx=p.x-pt.last.x,dy=p.y-pt.last.y;if(Math.hypot(p.x-pt.start.x,p.y-pt.start.y)>4)pt.moved=true;if(pt.moved){if(pt.mode==="pan"){state.camera.x+=dx;state.camera.y+=dy;}else if(pt.mode==="node"&&pt.hit){const q=worldPoint(p);pt.hit.x=q.x;pt.hit.y=q.y;state.manualPositions.set(pt.hit.id,{x:q.x,y:q.y});}}pt.last=p;};
  const onPointerUp=()=>{const pt=state.pointer;if(!pt)return;state.pointer=null;canvas.classList.remove("dragging");if(!pt.moved&&pt.edge){state.selected=null;state.selectedRelation=pt.edge;if(pt.edge.memory)api.onMemory?.(pt.edge.memory);else api.onRelation?.({kind:pt.edge.kind,agent:pt.edge.from.data,prospect:pt.edge.to.data,task:pt.edge.task||null,activity:pt.edge.activity||null,tasks:pt.edge.tasks||[],activities:pt.edge.activities||[],missionCount:pt.edge.missionCount||0,activityCount:pt.edge.activityCount||0});}else if(!pt.moved&&pt.hit){state.selected=pt.hit.id;state.selectedRelation=null;api.onRelation?.(null);if(pt.hit.kind==="prospect")api.onProspect?.(pt.hit.data);else if(pt.hit.kind==="memory")api.onMemory?.(pt.hit.data);else api.onAgent?.(pt.hit.data);}};
  const onWheel=ev=>{ev.preventDefault();zoomAt(ev.deltaY<0?1.12:.89,screenPoint(ev));};
  const onDoubleClick=ev=>{ev.preventDefault();resetCamera();};
  canvas.addEventListener("pointerdown",onPointerDown);canvas.addEventListener("pointermove",onPointerMove);canvas.addEventListener("pointerup",onPointerUp);canvas.addEventListener("pointercancel",onPointerUp);canvas.addEventListener("wheel",onWheel,{passive:false});canvas.addEventListener("dblclick",onDoubleClick);
  resize();const observer=new ResizeObserver(resize);observer.observe(canvas);state.raf=requestAnimationFrame(draw);
  return {update,resize,zoom(factor){zoomAt(factor);},reset:resetCamera,clearSelection(){state.selected=null;state.selectedRelation=null;api.onClearSelection?.();},destroy(){state.stopped=true;cancelAnimationFrame(state.raf);observer.disconnect();canvas.removeEventListener("pointerdown",onPointerDown);canvas.removeEventListener("pointermove",onPointerMove);canvas.removeEventListener("pointerup",onPointerUp);canvas.removeEventListener("pointercancel",onPointerUp);canvas.removeEventListener("wheel",onWheel);canvas.removeEventListener("dblclick",onDoubleClick);}};
}
