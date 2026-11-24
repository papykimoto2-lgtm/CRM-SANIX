// SANIX CRM — réseau relationnel agents ↔ prospects.
// Les liens reposent sur les affectations owner_id et les événements ai_actions(agent_id, prospect_id).
// Les événements sans agent_id restent visibles comme non attribués : aucune relation n'est inventée.
export function createProspectRelations(canvas, api) {
  const ctx = canvas.getContext("2d");
  const state = { agents: [], prospects: [], activities: [], width: 0, height: 0, dpr: 1, nodes: [], edges: [], raf: 0, stopped: false, filters: { product: "", prospect: "" }, totalProspects: 0 };
  const palette = { nouveau:"#64748B",a_qualifier:"#94A3B8",qualifie:"#22D3EE",premier_contact:"#38BDF8",conversation:"#60A5FA",besoin_identifie:"#818CF8",interesse:"#A78BFA",rdv_propose:"#F59E0B",rdv_confirme:"#FBBF24",demo_realisee:"#F97316",offre_transmise:"#FB923C",negociation:"#E879F9",offre_acceptee:"#22C55E",contrat_transmis:"#4ADE80",marche_gagne:"#16A34A",client_fidelise:"#10B981",perdu:"#EF4444",en_veille:"#64748B" };
  const label = s => String(s || "nouveau").replace(/_/g," ");
  const norm = v => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr").trim();
  const productOf = p => {
    const values = Array.isArray(p.produits_recommandes) ? p.produits_recommandes : (p.produits_recommandes ? [p.produits_recommandes] : []);
    return String(values.find(Boolean) || "").trim();
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
    const w=state.width,h=state.height,left=state.agents.filter(a=>a.etat!=="archive").slice(0,24);
    const norm = v => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr").trim();
    const filteredProspects = state.prospects.filter(p => {
      const productValues = Array.isArray(p.produits_recommandes) ? p.produits_recommandes : (p.produits_recommandes ? [p.produits_recommandes] : []);
      const productOk = !state.filters.product || productValues.some(v => norm(v) === norm(state.filters.product) || norm(v).includes(norm(state.filters.product)));
      const haystack = [p.entreprise,p.ville,p.telephone,p.email].map(norm).join(" ");
      const prospectOk = !state.filters.prospect || haystack.includes(norm(state.filters.prospect));
      return productOk && prospectOk;
    });
    const byAgent=new Map(left.map(a=>[String(a.id),a]));
    const byProspect=new Map(filteredProspects.map(p=>[String(p.id),p]));
    const activityPairs=new Map();
    for(const a of state.activities){
      if(!a.agent_id||!a.prospect_id||!byAgent.has(String(a.agent_id))||!byProspect.has(String(a.prospect_id))) continue;
      const key=String(a.agent_id)+"|"+String(a.prospect_id);
      if(!activityPairs.has(key)) activityPairs.set(key,a);
    }
    const owners=new Map();
    for(const p of filteredProspects){if(p.owner_id&&byAgent.has(String(p.owner_id)))owners.set(String(p.id),String(p.owner_id));}
    for(const a of activityPairs.values()) if(!owners.has(String(a.prospect_id))) owners.set(String(a.prospect_id),String(a.agent_id));
    const linkedIds=new Set([...owners.keys()]);
    const ranked=filteredProspects.slice().sort((a,b)=>Number(linkedIds.has(String(b.id)))-Number(linkedIds.has(String(a.id)))||String(b.next_action_at||"").localeCompare(String(a.next_action_at||"")));
    const prospects=ranked.slice(0,70),groups=new Map();
    prospects.forEach(p=>{const owner=owners.get(String(p.id));if(owner){if(!groups.has(owner))groups.set(owner,[]);groups.get(owner).push(p);}});
    const agentNodes=[],prospectNodes=[];
    left.forEach((a,i)=>agentNodes.push({id:String(a.id),kind:"agent",data:a,x:w*.16,y:h*(.12+.76*(i+.5)/Math.max(1,left.length)),r:7}));
    const byOwner=new Map(agentNodes.map(n=>[n.id,n]));
    prospects.forEach((p,i)=>{
      const ownerId=owners.get(String(p.id))||null,owner=ownerId?byOwner.get(ownerId):null;
      const group=owner?groups.get(ownerId):[],index=owner?group.findIndex(x=>String(x.id)===String(p.id)):i;
      const x=owner?w*(.52+(index%3)*.045):w*.84;
      const y=owner?owner.y+(index-(group.length-1)/2)*24:h*(.10+.80*(i+0.5)/Math.max(1,prospects.length));
      prospectNodes.push({id:String(p.id),kind:"prospect",data:p,owner,x,y:Math.max(34,Math.min(h-34,y)),r:5});
    });
    const nodeByProspect=new Map(prospectNodes.map(n=>[n.id,n]));
    const edges=[];
    for(const [key,a] of activityPairs){
      const [agentId,prospectId]=key.split("|"),from=byOwner.get(agentId),to=nodeByProspect.get(prospectId);
      if(from&&to)edges.push({from,to,color:prospectColor(to.data),activity:a,kind:"activity"});
    }
    const activityLinked=new Set(edges.map(e=>e.to.id));
    for(const n of prospectNodes){if(n.owner&&!activityLinked.has(n.id))edges.push({from:n.owner,to:n,color:prospectColor(n.data),kind:"assignment"});}
    state.nodes=[...agentNodes,...prospectNodes];state.edges=edges;api.onFilterCount?.(filteredProspects.length,state.totalProspects);
  }
  function update(data){
    state.agents=Array.isArray(data.agents)?data.agents:[];
    state.prospects=Array.isArray(data.prospects)?data.prospects:[];
    state.activities=Array.isArray(data.activities)?data.activities:[];
    state.totalProspects=state.prospects.length;
    state.filters={ product: String(data.filters?.product || ""), prospect: String(data.filters?.prospect || "") };
    layout();
  }
  function draw(t){
    if(state.stopped)return;
    const w=state.width,h=state.height;ctx.clearRect(0,0,w,h);
    const bg=ctx.createRadialGradient(w*.52,h*.5,10,w*.52,h*.5,Math.max(w,h)*.72);bg.addColorStop(0,"rgba(20,54,91,.34)");bg.addColorStop(1,"rgba(4,10,22,.98)");ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    for(let i=0;i<55;i++){ctx.fillStyle="rgba(148,180,230,.18)";ctx.fillRect((i*137.5)%w,(i*83.7)%h,1,1);}
    ctx.font="600 10px system-ui";ctx.fillStyle="#9FB2D3";ctx.fillText("ÉQUIPE COMMERCIALE",16,20);ctx.fillText("RELATIONS / ACTIVITÉS",w*.43,20);ctx.fillText("SANS LIAISON",w*.78,20);
    for(const e of state.edges){
      const {from,to,color}=e;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.bezierCurveTo(w*.34,from.y,w*.38,to.y,to.x,to.y);
      ctx.strokeStyle=e.kind==="activity"?color+"B0":color+"55";ctx.lineWidth=e.kind==="activity"?1.8:1;ctx.stroke();
      const seed=(Number(String(to.id).replace(/\D/g,"").slice(-4))||13)%97/97;
      const k=(t*.00012+seed)%1,q=1-k;
      const x=q*q*q*from.x+3*q*q*k*w*.34+3*q*k*k*w*.38+k*k*k*to.x;
      const y=q*q*q*from.y+3*q*q*k*from.y+3*q*k*k*to.y+k*k*k*to.y;
      ctx.beginPath();ctx.arc(x,y,e.kind==="activity"?2.8:2,0,Math.PI*2);ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=11;ctx.fill();ctx.shadowBlur=0;
    }
    for(const n of state.nodes){
      const p=n.data,color=n.kind==="agent"?"#22D3EE":prospectColor(p);
      const phase=t/500+n.y, pulse=3.5+Math.sin(phase)*2;
      ctx.beginPath();ctx.arc(n.x,n.y,n.r+ pulse,0,Math.PI*2);ctx.fillStyle=color+"18";ctx.fill();
      ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=12;ctx.fill();ctx.shadowBlur=0;
      ctx.font=n.kind==="agent"?"600 10px system-ui":"9px system-ui";ctx.fillStyle=n.kind==="agent"?"#E5F5FF":"#C8D6ED";
      const name=n.kind==="agent"?(p.nom||p.code||"Agent"):(p.entreprise||"Prospect");
      ctx.fillText(name.length>23?name.slice(0,22)+"…":name,n.x+(n.kind==="agent"?12:9),n.y+3);
      if(n.kind==="prospect"){ctx.font="8px system-ui";ctx.fillStyle=color;ctx.fillText(label(p.stage),n.x+9,n.y+13);}
    }
    const total=state.nodes.filter(n=>n.kind==="prospect").length,linked=new Set(state.edges.map(e=>e.to.id)).size,activityEdges=state.edges.filter(e=>e.kind==="activity").length;
    const noAgent=state.activities.filter(a=>a.prospect_id&&!a.agent_id).length;
    const productLegend=[...new Set(state.nodes.filter(n=>n.kind==="prospect").map(n=>productOf(n.data)).filter(Boolean))].slice(0,7);
    if(productLegend.length){
      ctx.font="9px system-ui";
      let lx=Math.max(12,w-190),ly=42;
      for(const product of productLegend){
        const color=productColor(product);ctx.fillStyle=color;ctx.beginPath();ctx.arc(lx,ly-3,3.5,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#C8D6ED";const name=product.length>21?product.slice(0,20)+"…":product;
        ctx.fillText(name,lx+9,ly);ly+=14;
        if(ly>h-95)break;
      }
    }
    ctx.fillStyle="#DCE8FA";ctx.font="600 11px system-ui";
    ctx.fillText(total+" prospects affichés · "+linked+" reliés · "+activityEdges+" relations issues d'activités · "+noAgent+" activités sans agent identifié",16,h-16);
    state.raf=requestAnimationFrame(draw);
  }
  const onClick=ev=>{const r=canvas.getBoundingClientRect(),x=ev.clientX-r.left,y=ev.clientY-r.top;const hit=[...state.nodes].reverse().find(n=>Math.hypot(n.x-x,n.y-y)<Math.max(15,n.r+8));if(hit?.kind==="prospect")api.onProspect?.(hit.data);if(hit?.kind==="agent")api.onAgent?.(hit.data);};
  canvas.addEventListener("click",onClick);resize();const observer=new ResizeObserver(resize);observer.observe(canvas);state.raf=requestAnimationFrame(draw);
  return {update,resize,destroy(){state.stopped=true;cancelAnimationFrame(state.raf);observer.disconnect();canvas.removeEventListener("click",onClick);}};
}
