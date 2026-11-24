// SANIX CRM — réseau relationnel agents ↔ prospects.
// Les liens reposent sur les affectations owner_id et les événements ai_actions(agent_id, prospect_id).
// Les événements sans agent_id restent visibles comme non attribués : aucune relation n'est inventée.
export function createProspectRelations(canvas, api) {
  const ctx = canvas.getContext("2d");
  const state = { agents: [], prospects: [], activities: [], tasks: [], width: 0, height: 0, dpr: 1, nodes: [], edges: [], raf: 0, stopped: false, filters: { agent: "", product: "", prospect: "" }, products: [], aliases: [], totalProspects: 0, camera: { x: 0, y: 0, scale: 1 }, selected: null, selectedRelation: null, pointer: null, manualPositions: new Map() };
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
    const activityPairs=new Map(), missionPairs=new Map();
    for(const t of state.tasks){
      if(!t.agent_id||!t.prospect_id||!byAgent.has(String(t.agent_id))||!byProspect.has(String(t.prospect_id))) continue;
      const key=String(t.agent_id)+"|"+String(t.prospect_id);
      if(!missionPairs.has(key)) missionPairs.set(key,t);
    }
    for(const a of state.activities){
      if(!a.agent_id||!a.prospect_id||!byAgent.has(String(a.agent_id))||!byProspect.has(String(a.prospect_id))) continue;
      const key=String(a.agent_id)+"|"+String(a.prospect_id);
      if(!activityPairs.has(key)) activityPairs.set(key,a);
    }
    const owners=new Map();
    for(const p of filteredProspects){
      const assigned=[p.agent_id].find(id=>id&&byAgent.has(String(id)));
      if(assigned) owners.set(String(p.id),String(assigned));
    }
    for(const t of missionPairs.values()) if(!owners.has(String(t.prospect_id))) owners.set(String(t.prospect_id),String(t.agent_id));
    for(const a of activityPairs.values()) if(!owners.has(String(a.prospect_id))) owners.set(String(a.prospect_id),String(a.agent_id));
    const linkedIds=new Set([...owners.keys()]);
    const ranked=filteredProspects.slice().sort((a,b)=>Number(linkedIds.has(String(b.id)))-Number(linkedIds.has(String(a.id)))||String(b.next_action_at||"").localeCompare(String(a.next_action_at||"")));
    const prospects=ranked.slice(0,70),groups=new Map();
    prospects.forEach(p=>{const owner=owners.get(String(p.id));if(owner){if(!groups.has(owner))groups.set(owner,[]);groups.get(owner).push(p);}});
    const agentNodes=[],prospectNodes=[];
    left.forEach((a,i)=>{const id=String(a.id),pos=state.manualPositions.get(id);agentNodes.push({id,kind:"agent",data:a,x:pos?.x??w*.16,y:pos?.y??h*(.12+.76*(i+.5)/Math.max(1,left.length)),r:7});});
    const byOwner=new Map(agentNodes.map(n=>[n.id,n]));
    prospects.forEach((p,i)=>{
      const ownerId=owners.get(String(p.id))||null,owner=ownerId?byOwner.get(ownerId):null;
      const group=owner?groups.get(ownerId):[],index=owner?group.findIndex(x=>String(x.id)===String(p.id)):i;
      const x=owner?w*(.52+(index%3)*.045):w*.84;
      const y=owner?owner.y+(index-(group.length-1)/2)*24:h*(.10+.80*(i+0.5)/Math.max(1,prospects.length));
      const id=String(p.id),pos=state.manualPositions.get(id);prospectNodes.push({id,kind:"prospect",data:p,owner,x:pos?.x??x,y:pos?.y??Math.max(34,Math.min(h-34,y)),r:5});
    });
    const nodeByProspect=new Map(prospectNodes.map(n=>[n.id,n]));
    const edges=[];
    for(const [key,t] of missionPairs){
      if(activityPairs.has(key)) continue;
      const [agentId,prospectId]=key.split("|"),from=byOwner.get(agentId),to=nodeByProspect.get(prospectId);
      if(from&&to)edges.push({from,to,color:prospectColor(to.data),task:t,kind:"mission"});
    }
    for(const [key,a] of activityPairs){
      const [agentId,prospectId]=key.split("|"),from=byOwner.get(agentId),to=nodeByProspect.get(prospectId);
      if(from&&to)edges.push({from,to,color:prospectColor(to.data),activity:a,kind:"activity"});
    }
    const linkedPairs=new Set([...activityPairs.keys(),...missionPairs.keys()]);
    for(const n of prospectNodes){
      if(n.owner&&!linkedPairs.has(n.owner.id+"|"+n.id)) edges.push({from:n.owner,to:n,color:prospectColor(n.data),kind:"assignment"});
    }
    state.nodes=[...agentNodes,...prospectNodes];state.edges=edges;api.onFilterCount?.(filteredProspects.length,state.totalProspects);
  }
  function update(data){
    state.agents=Array.isArray(data.agents)?data.agents:[];
    state.prospects=Array.isArray(data.prospects)?data.prospects:[];
    state.activities=Array.isArray(data.activities)?data.activities:[];
    state.tasks=Array.isArray(data.tasks)?data.tasks:[];
    state.totalProspects=state.prospects.length;
    state.products=Array.isArray(data.products)?data.products:[];
    state.aliases=Array.isArray(data.aliases)?data.aliases:[];
    state.filters={ agent: String(data.filters?.agent || ""), product: String(data.filters?.product || ""), prospect: String(data.filters?.prospect || "") };
    layout();
  }
  function draw(t){
    if(state.stopped)return;
    const w=state.width,h=state.height;ctx.clearRect(0,0,w,h);
    const bg=ctx.createRadialGradient(w*.52,h*.5,10,w*.52,h*.5,Math.max(w,h)*.72);bg.addColorStop(0,"rgba(20,54,91,.34)");bg.addColorStop(1,"rgba(4,10,22,.98)");ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    for(let i=0;i<55;i++){ctx.fillStyle="rgba(148,180,230,.18)";ctx.fillRect((i*137.5)%w,(i*83.7)%h,1,1);}
    ctx.font="600 10px system-ui";ctx.fillStyle="#9FB2D3";ctx.fillText("ÉQUIPE COMMERCIALE",16,20);ctx.fillText("RELATIONS / ACTIVITÉS",w*.43,20);ctx.fillText("SANS LIAISON",w*.78,20);
    ctx.save();ctx.translate(w/2+state.camera.x,h/2+state.camera.y);ctx.scale(state.camera.scale,state.camera.scale);ctx.translate(-w/2,-h/2);
    for(const e of state.edges){
      const {from,to,color}=e;const active=!state.selected||from.id===state.selected||to.id===state.selected;ctx.globalAlpha=active?1:.12;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.bezierCurveTo(state.width*.34,from.y,state.width*.38,to.y,to.x,to.y);
      ctx.setLineDash(e.kind==="mission"?[5,4]:e.kind==="assignment"?[2,5]:[]);ctx.strokeStyle=e.kind==="activity"?color+"D8":e.kind==="mission"?color+"C0":color+"70";ctx.lineWidth=e.kind==="activity"?2:e.kind==="mission"?1.6:1.2;ctx.stroke();ctx.setLineDash([]);
      const seed=(Number(String(to.id).replace(/\D/g,"").slice(-4))||13)%97/97;
      const k=(t*.00012+seed)%1,q=1-k;
      const x=q*q*q*from.x+3*q*q*k*state.width*.34+3*q*k*k*state.width*.38+k*k*k*to.x;
      const y=q*q*q*from.y+3*q*q*k*from.y+3*q*k*k*to.y+k*k*k*to.y;
      ctx.beginPath();ctx.arc(x,y,e.kind==="activity"?2.8:e.kind==="mission"?2.4:2,0,Math.PI*2);ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=11;ctx.fill();ctx.shadowBlur=0;
    }
    for(const n of state.nodes){
      const p=n.data,color=n.kind==="agent"?"#22D3EE":prospectColor(p),active=!state.selected||n.id===state.selected||state.edges.some(e=>(e.from.id===state.selected&&e.to.id===n.id)||(e.to.id===state.selected&&e.from.id===n.id));ctx.globalAlpha=active?1:.18;
      const phase=t/500+n.y, pulse=3.5+Math.sin(phase)*2;if(state.selected===n.id){ctx.beginPath();ctx.arc(n.x,n.y,n.r+10,0,Math.PI*2);ctx.strokeStyle="#FFFFFF";ctx.lineWidth=1.5;ctx.stroke();}
      ctx.beginPath();ctx.arc(n.x,n.y,n.r+ pulse,0,Math.PI*2);ctx.fillStyle=color+"18";ctx.fill();
      ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=12;ctx.fill();ctx.shadowBlur=0;
      ctx.font=n.kind==="agent"?"600 10px system-ui":"9px system-ui";ctx.fillStyle=n.kind==="agent"?"#E5F5FF":"#C8D6ED";
      const name=n.kind==="agent"?(p.nom||p.code||"Agent"):(p.entreprise||"Prospect");
      ctx.fillText(name.length>23?name.slice(0,22)+"…":name,n.x+(n.kind==="agent"?12:9),n.y+3);
      if(n.kind==="prospect"){ctx.font="8px system-ui";ctx.fillStyle=color;ctx.fillText(label(p.stage),n.x+9,n.y+13);}
    }
    ctx.restore();ctx.globalAlpha=1;
    const prospectNodes=state.nodes.filter(n=>n.kind==="prospect"),total=prospectNodes.length,linked=new Set(state.edges.map(e=>e.to.id)).size,activityEdges=state.edges.filter(e=>e.kind==="activity").length,missionEdges=state.edges.filter(e=>e.kind==="mission").length,assigned=prospectNodes.filter(n=>n.owner).length;
    const noAgent=state.activities.filter(a=>a.prospect_id&&!a.agent_id).length;
    const legendItems=[{type:"agent",label:"Agents",color:"#22D3EE"}];
    const productCounts=new Map(),stageCounts=new Map();
    for(const n of prospectNodes){const product=productOf(n.data);if(product)productCounts.set(product,(productCounts.get(product)||0)+1);else{const stage=label(n.data.stage);stageCounts.set(stage,(stageCounts.get(stage)||0)+1);}}
    for(const [name,count] of [...productCounts].sort((a,b)=>a[0].localeCompare(b[0],"fr"))) legendItems.push({type:"product",label:name,color:productColor(name),count});
    for(const [name,count] of [...stageCounts].sort((a,b)=>a[0].localeCompare(b[0],"fr"))) legendItems.push({type:"stage",label:name,color:palette[name.replace(/ /g,"_")]||"#64748B",count});
    legendItems.push({type:"activity",label:"Interaction réelle",color:"#E2E8F0"});
    legendItems.push({type:"mission",label:"Mission affectée",color:"#A78BFA"});
    legendItems.push({type:"assignment",label:"Affectation",color:"#64748B"});
    api.onLegend?.(legendItems);
    ctx.fillStyle="#DCE8FA";ctx.font="600 11px system-ui";
    ctx.fillText(total+" prospects · "+linked+" reliés · "+assigned+" affectations · "+missionEdges+" missions · "+activityEdges+" activités · "+noAgent+" activités sans agent identifié",16,h-16);
    state.raf=requestAnimationFrame(draw);
  }
  const screenPoint=ev=>{const r=canvas.getBoundingClientRect();return{x:ev.clientX-r.left,y:ev.clientY-r.top};};
  const worldPoint=p=>({x:(p.x-state.width/2-state.camera.x)/state.camera.scale+state.width/2,y:(p.y-state.height/2-state.camera.y)/state.camera.scale+state.height/2});
  const hitAt=p=>{const q=worldPoint(p);return [...state.nodes].reverse().find(n=>Math.hypot(n.x-q.x,n.y-q.y)<Math.max(15,n.r+8));};
  const edgeAt=p=>{const q=worldPoint(p);let best=null,dist=Infinity;for(const e of state.edges){let prev={x:e.from.x,y:e.from.y};for(let i=1;i<=28;i++){const t=i/28,u=1-t,x=u*u*u*e.from.x+3*u*u*t*state.width*.34+3*u*t*t*state.width*.38+t*t*t*e.to.x,y=u*u*u*e.from.y+3*u*u*t*e.from.y+3*u*t*t*e.to.y+t*t*t*e.to.y,dx=x-prev.x,dy=y-prev.y,len=dx*dx+dy*dy||1,k=Math.max(0,Math.min(1,((q.x-prev.x)*dx+(q.y-prev.y)*dy)/len)),d=Math.hypot(q.x-(prev.x+k*dx),q.y-(prev.y+k*dy));if(d<dist){dist=d;best=e;}prev={x,y};}}return dist<10?best:null;};
  const zoomAt=(factor,p={x:state.width/2,y:state.height/2})=>{const before=worldPoint(p);state.camera.scale=Math.max(.55,Math.min(2.8,state.camera.scale*factor));const after=worldPoint(p);state.camera.x+=(after.x-before.x)*state.camera.scale;state.camera.y+=(after.y-before.y)*state.camera.scale;};
  const resetCamera=()=>{state.camera={x:0,y:0,scale:1};};
  const onPointerDown=ev=>{if(ev.button!==undefined&&ev.button!==0)return;const p=screenPoint(ev),hit=hitAt(p),edge=hit?null:edgeAt(p);state.pointer={id:ev.pointerId,start:p,last:p,hit,edge,moved:false,mode:hit?"node":edge?"relation":"pan"};canvas.setPointerCapture?.(ev.pointerId);canvas.classList.toggle("dragging",!hit&&!edge);};
  const onPointerMove=ev=>{const p=screenPoint(ev),pt=state.pointer;if(!pt){canvas.style.cursor=hitAt(p)?"pointer":"grab";return;}const dx=p.x-pt.last.x,dy=p.y-pt.last.y;if(Math.hypot(p.x-pt.start.x,p.y-pt.start.y)>4)pt.moved=true;if(pt.moved){if(pt.mode==="pan"){state.camera.x+=dx;state.camera.y+=dy;}else if(pt.mode==="node"&&pt.hit){const q=worldPoint(p);pt.hit.x=q.x;pt.hit.y=q.y;state.manualPositions.set(pt.hit.id,{x:q.x,y:q.y});}}pt.last=p;};
  const onPointerUp=()=>{const pt=state.pointer;if(!pt)return;state.pointer=null;canvas.classList.remove("dragging");if(!pt.moved&&pt.edge){state.selected=null;state.selectedRelation=pt.edge;api.onRelation?.({kind:pt.edge.kind,agent:pt.edge.from.data,prospect:pt.edge.to.data,task:pt.edge.task||null,activity:pt.edge.activity||null});}else if(!pt.moved&&pt.hit){state.selected=pt.hit.id;state.selectedRelation=null;api.onRelation?.(null);if(pt.hit.kind==="prospect")api.onProspect?.(pt.hit.data);else api.onAgent?.(pt.hit.data);}};
  const onWheel=ev=>{ev.preventDefault();zoomAt(ev.deltaY<0?1.12:.89,screenPoint(ev));};
  const onDoubleClick=ev=>{ev.preventDefault();resetCamera();};
  canvas.addEventListener("pointerdown",onPointerDown);canvas.addEventListener("pointermove",onPointerMove);canvas.addEventListener("pointerup",onPointerUp);canvas.addEventListener("pointercancel",onPointerUp);canvas.addEventListener("wheel",onWheel,{passive:false});canvas.addEventListener("dblclick",onDoubleClick);
  resize();const observer=new ResizeObserver(resize);observer.observe(canvas);state.raf=requestAnimationFrame(draw);
  return {update,resize,zoom(factor){zoomAt(factor);},reset:resetCamera,clearSelection(){state.selected=null;state.selectedRelation=null;api.onClearSelection?.();},destroy(){state.stopped=true;cancelAnimationFrame(state.raf);observer.disconnect();canvas.removeEventListener("pointerdown",onPointerDown);canvas.removeEventListener("pointermove",onPointerMove);canvas.removeEventListener("pointerup",onPointerUp);canvas.removeEventListener("pointercancel",onPointerUp);canvas.removeEventListener("wheel",onWheel);canvas.removeEventListener("dblclick",onDoubleClick);}};
}
