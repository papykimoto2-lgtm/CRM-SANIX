// SANIX CRM — réseau relationnel agents ↔ prospects.
// Liens calculés uniquement depuis ai_prospects.owner_id : aucune relation n'est inventée.
export function createProspectRelations(canvas, api) {
  const ctx = canvas.getContext("2d");
  const state = { agents: [], prospects: [], width: 0, height: 0, dpr: 1, nodes: [], edges: [], raf: 0, stopped: false };
  const palette = { nouveau:"#64748B",a_qualifier:"#94A3B8",qualifie:"#22D3EE",premier_contact:"#38BDF8",conversation:"#60A5FA",besoin_identifie:"#818CF8",interesse:"#A78BFA",rdv_propose:"#F59E0B",rdv_confirme:"#FBBF24",demo_realisee:"#F97316",offre_transmise:"#FB923C",negociation:"#E879F9",offre_acceptee:"#22C55E",contrat_transmis:"#4ADE80",marche_gagne:"#16A34A",client_fidelise:"#10B981",perdu:"#EF4444",en_veille:"#64748B" };
  const label = s => String(s || "nouveau").replace(/_/g," ");
  const resize = () => { const r=canvas.getBoundingClientRect();state.dpr=Math.min(2,devicePixelRatio||1);state.width=Math.max(320,r.width);state.height=Math.max(360,r.height);canvas.width=Math.round(state.width*state.dpr);canvas.height=Math.round(state.height*state.dpr);ctx.setTransform(state.dpr,0,0,state.dpr,0,0);layout(); };
  function layout() {
    const w=state.width,h=state.height,left=state.agents.filter(a=>a.etat!=="archive").slice(0,24),prospects=state.prospects.slice(0,70),agentNodes=[],prospectNodes=[];
    left.forEach((a,i)=>agentNodes.push({id:String(a.id),kind:"agent",data:a,x:w*.18,y:h*(.14+.72*(i+.5)/Math.max(1,left.length)),r:7}));
    const byOwner=new Map(agentNodes.map(n=>[n.id,n]));
    prospects.forEach((p,i)=>{const owner=p.owner_id==null?null:byOwner.get(String(p.owner_id));const same=prospects.filter(x=>String(x.owner_id??"")===String(p.owner_id??""));const index=same.findIndex(x=>x.id===p.id);const x=owner?w*(.53+(i%3)*.035):w*.83;const y=owner?owner.y+(index-(same.length-1)/2)*24:h*(.12+.76*(i+.5)/Math.max(1,prospects.length));prospectNodes.push({id:String(p.id),kind:"prospect",data:p,owner,x,y:Math.max(35,Math.min(h-35,y)),r:5});});
    state.nodes=[...agentNodes,...prospectNodes];state.edges=prospectNodes.filter(n=>n.owner).map(n=>({from:n.owner,to:n,color:palette[n.data.stage]||"#22D3EE"}));
  }
  function update(data){state.agents=Array.isArray(data.agents)?data.agents:[];state.prospects=(Array.isArray(data.prospects)?data.prospects:[]).slice().sort((a,b)=>String(b.next_action_at||"").localeCompare(String(a.next_action_at||""))).slice(0,70);layout();}
  function draw(t){
    if(state.stopped)return;const w=state.width,h=state.height;ctx.clearRect(0,0,w,h);
    const bg=ctx.createRadialGradient(w*.52,h*.5,10,w*.52,h*.5,Math.max(w,h)*.72);bg.addColorStop(0,"rgba(20,54,91,.34)");bg.addColorStop(1,"rgba(4,10,22,.98)");ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
    for(let i=0;i<55;i++){ctx.fillStyle="rgba(148,180,230,.18)";ctx.fillRect((i*137.5)%w,(i*83.7)%h,1,1);}
    ctx.font="600 10px system-ui";ctx.fillStyle="#9FB2D3";ctx.fillText("ÉQUIPE COMMERCIALE",16,20);ctx.fillText("PROSPECTS AFFECTÉS",w*.48,20);ctx.fillText("À AFFECTER",w*.78,20);
    for(const e of state.edges){const {from,to,color}=e;ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.bezierCurveTo(w*.35,from.y,w*.38,to.y,to.x,to.y);ctx.strokeStyle=color+"88";ctx.lineWidth=1.2;ctx.stroke();const k=(t*.00012+(Number(to.id.slice(-4))%97)/97)%1,q=1-k;const x=q*q*q*from.x+3*q*q*k*w*.35+3*q*k*k*w*.38+k*k*k*to.x;const y=q*q*q*from.y+3*q*q*k*from.y+3*q*k*k*to.y+k*k*k*to.y;ctx.beginPath();ctx.arc(x,y,2.1,0,Math.PI*2);ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=9;ctx.fill();ctx.shadowBlur=0;}
    for(const n of state.nodes){const p=n.data,color=n.kind==="agent"?"#22D3EE":(palette[p.stage]||"#22D3EE");ctx.beginPath();ctx.arc(n.x,n.y,n.r+4+Math.sin(t/500+n.y)*1.4,0,Math.PI*2);ctx.fillStyle=color+"18";ctx.fill();ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,Math.PI*2);ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=12;ctx.fill();ctx.shadowBlur=0;ctx.font=n.kind==="agent"?"600 10px system-ui":"9px system-ui";ctx.fillStyle=n.kind==="agent"?"#E5F5FF":"#C8D6ED";const name=n.kind==="agent"?(p.nom||p.code||"Agent"):(p.entreprise||"Prospect");ctx.fillText(name.length>23?name.slice(0,22)+"…":name,n.x+(n.kind==="agent"?12:9),n.y+3);if(n.kind==="prospect"){ctx.font="8px system-ui";ctx.fillStyle=color;ctx.fillText(label(p.stage),n.x+9,n.y+13);}}
    const total=state.prospects.length,assigned=state.edges.length;ctx.fillStyle="#DCE8FA";ctx.font="600 11px system-ui";ctx.fillText(total+" prospects affichés · "+assigned+" affectations vérifiées · "+(total-assigned)+" sans propriétaire identifié",16,h-16);
    state.raf=requestAnimationFrame(draw);
  }
  const onClick=ev=>{const r=canvas.getBoundingClientRect(),x=ev.clientX-r.left,y=ev.clientY-r.top;const hit=[...state.nodes].reverse().find(n=>Math.hypot(n.x-x,n.y-y)<Math.max(15,n.r+8));if(hit?.kind==="prospect")api.onProspect?.(hit.data);if(hit?.kind==="agent")api.onAgent?.(hit.data);};
  canvas.addEventListener("click",onClick);resize();const observer=new ResizeObserver(resize);observer.observe(canvas);state.raf=requestAnimationFrame(draw);
  return {update,resize,destroy(){state.stopped=true;cancelAnimationFrame(state.raf);observer.disconnect();canvas.removeEventListener("click",onClick);}};
}