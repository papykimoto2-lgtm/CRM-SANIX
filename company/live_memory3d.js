// SANIX AI — cerveau humain anatomique rotatif, agents fixés au cortex et hippocampes mémoriels.
// Le cerveau, les agents corticaux et les voies neuronales tournent comme un seul ensemble.
import * as THREE from "./vendor/three.bundle.js";
const TAU=Math.PI*2, clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
function brainSurfacePoint(n,side,extra=0){
 const u=Math.atan2(n.z,n.y),v=Math.asin(clamp(n.x,-1,1));
 const folds=.040*Math.sin(15*u+3*Math.sin(5*v))+.026*Math.sin(23*u-4*v)+.016*Math.sin(31*v+2*Math.sin(7*u));
 const r=1+folds+extra;
 // Bord médial proche de la ligne interhémisphérique ; volume plus large et ovale.
 return new THREE.Vector3(side*(.065+Math.abs(n.x)*1.32*r),n.y*1.30*r,n.z*1.08*r);
}
function makeHemisphere(side){
 const geo=new THREE.SphereGeometry(1,144,112),p=geo.attributes.position,n=new THREE.Vector3();
 for(let i=0;i<p.count;i++){n.set(p.getX(i),p.getY(i),p.getZ(i)).normalize();const q=brainSurfacePoint(n,side);p.setXYZ(i,q.x-side*.88,q.y,q.z);}
 geo.computeVertexNormals();
 const mat=new THREE.MeshPhysicalMaterial({color:side>0?0x72c9e7:0x62b9dc,metalness:.02,roughness:.32,clearcoat:.8,clearcoatRoughness:.2,transparent:true,opacity:.43,depthWrite:false,side:THREE.DoubleSide,emissive:0x092d48,emissiveIntensity:.22});
 const mesh=new THREE.Mesh(geo,mat);
 // Les deux surfaces se rejoignent presque sur la ligne médiane, sans large fente.
 // Chaque hémisphère reste un volume indépendant pour conserver le relief bilatéral.
 mesh.position.x=side*.88;
 return mesh;
}
function makeSulci(group,side){
 const mat=new THREE.MeshBasicMaterial({color:0x164c68,transparent:true,opacity:.38});
 // Sillons corticaux courbes, répartis sur la surface de chaque hémisphère.
 for(let j=0;j<15;j++){
  const pts=[];const lat=-1.05+j*.15;
  for(let k=0;k<=42;k++){const a=-1.25+k*2.5/42;const n=new THREE.Vector3(Math.cos(lat)*Math.sin(a),Math.sin(lat)+.045*Math.sin(a*5+j),Math.cos(lat)*Math.cos(a)).normalize();const q=brainSurfacePoint(n,side,.012);pts.push(q);}
  group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),64,.009,5,false),mat));
 }
}
function makeCerebellum(group){
 const g=new THREE.Group();g.position.set(0,-1.10,-.72);g.scale.set(1.05,.58,.72);group.add(g);
 const geo=new THREE.SphereGeometry(.72,72,48),p=geo.attributes.position;
 for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),f=.035*Math.sin(y*44+Math.sin(x*8)*2)+.018*Math.sin(y*71+x*6);p.setXYZ(i,x*(1+f),y*(1+f),z*(1+f));}
 geo.computeVertexNormals();g.add(new THREE.Mesh(geo,new THREE.MeshPhysicalMaterial({color:0x4b9fbd,roughness:.3,transparent:true,opacity:.58,depthWrite:false})));
 const folia=new THREE.MeshBasicMaterial({color:0x17445f,transparent:true,opacity:.72});
 for(let i=0;i<21;i++){const y=-.55+i*.055,pts=[];for(let k=0;k<=36;k++){const a=-1.35+k*2.7/36,r=Math.sqrt(Math.max(.04,1-(y/.76)**2));pts.push(new THREE.Vector3(Math.sin(a)*.68*r,y+Math.sin(a*3+i)*.012,Math.cos(a)*.46*r));}g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),48,.009,4,false),folia));}
 const stem=new THREE.Mesh(new THREE.CylinderGeometry(.12,.23,1.25,32),new THREE.MeshPhysicalMaterial({color:0x4eabc9,roughness:.3,transparent:true,opacity:.55,depthWrite:false}));stem.position.set(0,-1.53,-.42);group.add(stem);
}
function makeHippocampus(group,side){
 const h=new THREE.Group();h.position.set(side*.57,-.48,-.18);h.rotation.z=side*.22;group.add(h);
 const mat=new THREE.MeshPhysicalMaterial({color:0xf0b45e,emissive:0x7a3c08,emissiveIntensity:.24,roughness:.28,metalness:.02,transparent:true,opacity:.94});
 const parts=[{x:0,y:0,z:0,s:[.19,.17,.58],r:.1},{x:side*.07,y:.14,z:.34,s:[.17,.14,.30],r:-.55},{x:-side*.04,y:-.10,z:-.37,s:[.14,.12,.25],r:.48}];
 for(const a of parts){const m=new THREE.Mesh(new THREE.SphereGeometry(1,36,24),mat);m.position.set(a.x,a.y,a.z);m.scale.set(...a.s);m.rotation.y=a.r;h.add(m);}
 const glow=new THREE.Mesh(new THREE.SphereGeometry(.67,24,16),new THREE.MeshBasicMaterial({color:0xffc36d,transparent:true,opacity:.075,depthWrite:false}));glow.scale.set(.36,.31,1.0);h.add(glow);
 return h;
}
function cortexPosition(i,count,side){
 const t=(i+.5)/Math.max(1,count),a=i*2.399963229728653;
 const n=new THREE.Vector3(Math.sin(a)*Math.sqrt(1-(2*t-1)**2),2*t-1,Math.cos(a)*Math.sqrt(1-(2*t-1)**2));
 return brainSurfacePoint(n,side,.035);
}
function makeLabel(text){
 const c=document.createElement("canvas");c.width=512;c.height=96;const x=c.getContext("2d");x.font="bold 34px system-ui";x.fillStyle="#dffaff";x.shadowColor="#25dfff";x.shadowBlur=14;x.fillText(String(text||"Agent").slice(0,26),8,58);
 const tex=new THREE.CanvasTexture(c);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));s.scale.set(.82,.16,1);return s;
}
export function createMemoryBrain3D(host){
 const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"high-performance"});renderer.setClearColor(0x000000,0);renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
 const canvas=renderer.domElement;canvas.className="sanix-memory-brain-3d";canvas.setAttribute("aria-label","Cerveau humain anatomique SANIX, cortex avec agents, hippocampes et flux de mémoire");canvas.style.cssText="position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:2";host.appendChild(canvas);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1,.1,100);camera.position.set(0,.02,11.8);camera.lookAt(0,-.08,0);
 scene.add(new THREE.HemisphereLight(0xc5efff,0x07172a,1.5));const key=new THREE.DirectionalLight(0xe8f8ff,2.1);key.position.set(-4,5,7);scene.add(key);const fill=new THREE.DirectionalLight(0x36bce8,1.2);fill.position.set(5,1,4);scene.add(fill);const rim=new THREE.DirectionalLight(0x665bff,1.5);rim.position.set(0,3,-5);scene.add(rim);
 const brain=new THREE.Group();scene.add(brain);
 const cortexMats=[];
 for(const side of [-1,1]){const hemi=makeHemisphere(side);brain.add(hemi);cortexMats.push(hemi.material);makeSulci(brain,side);}
 // Fissure interhémisphérique, cervelet et tronc cérébral.
 const fissure=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0,1.3,.1),new THREE.Vector3(0,.7,.35),new THREE.Vector3(0,0,.48),new THREE.Vector3(0,-.7,.22)]),48,.025,8,false),new THREE.MeshBasicMaterial({color:0x092b43,transparent:true,opacity:.7}));brain.add(fissure);
 makeCerebellum(brain);
 const hippocampi=[makeHippocampus(brain,-1),makeHippocampus(brain,1)];
 // Les voies neuronales statiques sont volontairement masquées pour dégager la lecture anatomique.
 // Mémoire : neurones regroupés dans les deux hippocampes, non dispersés sur tout le cortex.
 const memGeo=new THREE.SphereGeometry(.024,10,8),memMat=new THREE.MeshBasicMaterial({color:0xffd18a}),memoryNodes=new THREE.InstancedMesh(memGeo,memMat,180);memoryNodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);brain.add(memoryNodes);
 const dummy=new THREE.Object3D();
 for(let i=0;i<180;i++){const side=i%2?1:-1,a=i*2.39996,r=.12+((i*17)%100)/100*.30;dummy.position.set(side*.57+Math.cos(a)*r*.5,-.48+Math.sin(a)*r*.38,-.18+Math.sin(a*1.7)*.42);dummy.scale.setScalar(.7);dummy.updateMatrix();memoryNodes.setMatrixAt(i,dummy.matrix);}
 memoryNodes.instanceMatrix.needsUpdate=true;
 // Agents positionnés sur la surface corticale, avec une voie dédiée vers l'hippocampe.
 const agentGroup=new THREE.Group();brain.add(agentGroup);let agentMeshes=[],flowParticles=[];
 function update(data={}){
  const memories=Array.isArray(data)?data:(data.memories||[]),agents=Array.isArray(data.agents)?data.agents:[];
  for(let i=agentGroup.children.length-1;i>=0;i--){const o=agentGroup.children[i];agentGroup.remove(o);o.geometry?.dispose?.();if(o.material?.map)o.material.map.dispose();o.material?.dispose?.();}
  agentMeshes=[];flowParticles=[];
  const activeAgents=agents.filter(a=>a.etat!=="archive").slice(0,36);
  activeAgents.forEach((a,i)=>{
   const side=i%2?1:-1,p=cortexPosition(Math.floor(i/2),Math.ceil(activeAgents.length/2),side);
   const color=a.etat==="actif"||a.etat==="en_cours"?0x35e5c0:0x62d9ff;
   const marker=new THREE.Mesh(new THREE.SphereGeometry(.065,18,14),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.98}));marker.position.copy(p);agentGroup.add(marker);
   const halo=new THREE.Mesh(new THREE.SphereGeometry(.105,16,12),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.22,depthWrite:false}));halo.position.copy(p);agentGroup.add(halo);
   const label=makeLabel(a.nom||a.code||"Agent");label.position.copy(p);label.position.y+=.16;agentGroup.add(label);
   // Aucun faisceau statique : une impulsion lumineuse discrète matérialise ponctuellement l'échange.
   const target=new THREE.Vector3(side*.57,-.48,-.18),mid=p.clone().lerp(target,.5);mid.z+=.24;
   const curve=new THREE.CatmullRomCurve3([p.clone(),mid,target]);
   const pulse=new THREE.Mesh(new THREE.SphereGeometry(.027,10,8),new THREE.MeshBasicMaterial({color:0xffd18a}));
   agentGroup.add(pulse);flowParticles.push({mesh:pulse,curve,offset:i*.17});
   agentMeshes.push({mesh:marker,agent:a});
  });
  const rows=memories.slice(0,180);
  for(let i=0;i<180;i++){const visible=i<rows.length,side=i%2?1:-1,a=i*2.39996,r=.10+((i*17)%100)/100*.34;dummy.position.set(side*.57+Math.cos(a)*r*.5,-.48+Math.sin(a)*r*.38,-.18+Math.sin(a*1.7)*.42);dummy.scale.setScalar(visible?.75+(Number(rows[i]?.importance)||1)*.06:0);dummy.updateMatrix();memoryNodes.setMatrixAt(i,dummy.matrix);const m=rows[i],score=Number(m?.fiabilite),col=m?.statut==="valide"&&Number.isFinite(score)&&score>=80?0x35d89a:Number.isFinite(score)&&score>=50?0x50b9ff:0xffbd62;memoryNodes.setColorAt(i,new THREE.Color(visible?col:0xffd18a));}
  memoryNodes.instanceMatrix.needsUpdate=true;if(memoryNodes.instanceColor)memoryNodes.instanceColor.needsUpdate=true;
 }
 let active=false,raf=0,last=0,disposed=false,observer=null,cameraSource=null,hostH=1,zoomLevel=1;
 let yaw=0,pitch=.035,autoRotate=true,pauseUntil=0;
 const ROTATION_PERIOD_MS=45000;
 function resize(){const r=host.getBoundingClientRect(),w=Math.max(1,r.width),h=Math.max(1,r.height);hostH=h;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
 function applyCamera(){const c=cameraSource?.()||{x:0,y:0,scale:1};zoomLevel=clamp(Number(c.scale)||1,.55,3.8);const upp=2*11.8*Math.tan(17*Math.PI/180)/hostH;brain.position.set((Number(c.x)||0)*upp,-(Number(c.y)||0)*upp,0);camera.position.z=11.8/Math.sqrt(zoomLevel);camera.lookAt(0,-.08,0);const inside=smooth(1.25,2.25,zoomLevel);cortexMats.forEach(m=>{m.opacity=.43*(1-inside*.72);m.depthWrite=inside<.55;});}
 function frame(now){if(!active||disposed)return;const dt=Math.min(64,now-(last||now));last=now;if(autoRotate&&now>=pauseUntil)yaw=(yaw+dt*TAU/ROTATION_PERIOD_MS)%TAU;brain.rotation.set(pitch,yaw,0,"YXZ");applyCamera();const t=now*.00022;flowParticles.forEach(p=>{const u=(t*.22+p.offset)%1;p.mesh.position.copy(p.curve.getPoint(u));});renderer.render(scene,camera);raf=requestAnimationFrame(frame);}
 function setActive(v){active=!!v;canvas.style.display=active?"block":"none";if(active){resize();if(!raf){last=performance.now();raf=requestAnimationFrame(frame);}}else if(raf){cancelAnimationFrame(raf);raf=0;}}
 function destroy(){disposed=true;setActive(false);observer?.disconnect();renderer.dispose();canvas.remove();scene.traverse(o=>{o.geometry?.dispose?.();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose?.());else{o.material?.map?.dispose?.();o.material?.dispose?.();}});}
 observer=new ResizeObserver(resize);observer.observe(host);resize();
 return{setActive,update,resize,destroy,setCameraSource(fn){cameraSource=typeof fn==="function"?fn:null;},
  rotate(dx=0,dy=0){yaw=(yaw+Number(dx||0)*.008)%TAU;pitch=clamp(pitch+Number(dy||0)*.006,-.72,.72);pauseUntil=performance.now()+3500;},
  resetView(){yaw=0;pitch=.035;autoRotate=true;pauseUntil=0;},
  setAutoRotate(v){autoRotate=!!v;pauseUntil=0;return autoRotate;},isAutoRotate(){return autoRotate;},
  state(){return{yaw,pitch,autoRotate,zoom:zoomLevel,anatomical:true,agents:agentMeshes.length,hippocampi:2};}};
}
