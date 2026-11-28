// SANIX AI — cerveau cortical 3D sculpté : volume continu, sillons intégrés à la géométrie.
import * as THREE from "./vendor/three.bundle.js";
const TAU=Math.PI*2,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
function corticalPoint(n,extra=0){
 const u=Math.atan2(n.z,n.x),v=Math.asin(clamp(n.y,-1,1));
 const wave=.018*Math.sin(17*u+3.8*Math.sin(5*v)+.7*Math.sin(9*v))+.014*Math.sin(21*v+4.2*Math.sin(4*u))+.009*Math.sin(31*u-13*v+1.4*Math.sin(7*v))+.006*Math.sin(43*v+8*u);
 const cleft=Math.exp(-Math.pow(n.x/.052,2))*smooth(-.05,.52,n.z)*smooth(-.30,.18,n.y)*.075;
 const radius=1+wave-cleft+extra;
 return new THREE.Vector3(n.x*2.02*radius*(1+.035*n.z),n.y*1.48*radius+.045*n.z,n.z*1.12*radius*(1-.035*n.y));
}
function makeCortex(){
 const geo=new THREE.SphereGeometry(1,176,128),pos=geo.attributes.position,n=new THREE.Vector3();
 for(let i=0;i<pos.count;i++){n.set(pos.getX(i),pos.getY(i),pos.getZ(i)).normalize();const p=corticalPoint(n);pos.setXYZ(i,p.x,p.y,p.z);}
 geo.computeVertexNormals();
 return new THREE.Mesh(geo,new THREE.MeshPhysicalMaterial({color:0x62c9ed,metalness:.04,roughness:.20,clearcoat:.95,clearcoatRoughness:.12,transparent:true,opacity:.30,depthWrite:false,side:THREE.DoubleSide,emissive:0x073b58,emissiveIntensity:.34}));
}
function makeMidline(group){
 const pts=[];
 for(let i=0;i<=54;i++){const y=1.27-i*(2.42/54),n=new THREE.Vector3(0,y/1.48,.92).normalize(),p=corticalPoint(n,.004);pts.push(new THREE.Vector3(0,p.y,p.z+.012));}
 group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),100,.010,6,false),new THREE.MeshBasicMaterial({color:0x0b3048,transparent:true,opacity:.48})));
}
function makeCerebellum(group){
 const cereb=new THREE.Group();cereb.position.set(0,-1.20,-.56);cereb.scale.set(1.03,.58,.68);group.add(cereb);
 const geo=new THREE.SphereGeometry(.76,88,56),p=geo.attributes.position,n=new THREE.Vector3();
 for(let i=0;i<p.count;i++){n.set(p.getX(i),p.getY(i),p.getZ(i)).normalize();const f=.018*Math.sin(n.y*46+Math.sin(n.x*9)*2)+.010*Math.sin(n.y*79+n.x*7);p.setXYZ(i,p.getX(i)*(1+f),p.getY(i)*(1+f),p.getZ(i)*(1+f));}
 geo.computeVertexNormals();cereb.add(new THREE.Mesh(geo,new THREE.MeshPhysicalMaterial({color:0x3f9fc1,metalness:.02,roughness:.28,clearcoat:.8,transparent:true,opacity:.42,depthWrite:false})));
 const foliaMat=new THREE.MeshStandardMaterial({color:0x174c68,roughness:.86,transparent:true,opacity:.68});
 for(let i=0;i<17;i++){const y=-.48+i*.058,pts=[];for(let k=0;k<=32;k++){const a=-1.28+k*(2.56/32),r=Math.sqrt(Math.max(.06,1-(y/.78)**2));pts.push(new THREE.Vector3(Math.sin(a)*.72*r,y+Math.sin(a*2+i)*.018,Math.cos(a)*.52*r));}cereb.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),52,.009,4,false),foliaMat));}
 const stemGeo=new THREE.LatheGeometry([new THREE.Vector2(.20,0),new THREE.Vector2(.24,.16),new THREE.Vector2(.19,.38),new THREE.Vector2(.14,.62),new THREE.Vector2(.11,.84),new THREE.Vector2(.08,1.02)],48);
 const stem=new THREE.Mesh(stemGeo,new THREE.MeshPhysicalMaterial({color:0x55b7d7,roughness:.25,metalness:.02,clearcoat:.8,transparent:true,opacity:.46,depthWrite:false}));stem.position.set(0,-1.65,-.28);stem.rotation.x=Math.PI;group.add(stem);
}
function fibonacciNormal(i,count){const y=1-2*(i+.5)/count,r=Math.sqrt(Math.max(0,1-y*y)),a=i*2.399963229728653;return new THREE.Vector3(Math.cos(a)*r,y,Math.sin(a)*r);}
export function createMemoryBrain3D(host){
 const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"high-performance"});renderer.setClearColor(0x000000,0);renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.02;
 const canvas=renderer.domElement;canvas.className="sanix-memory-brain-3d";canvas.setAttribute("aria-label","Cerveau SANIX anatomique 3D translucide en rotation à 360°, zoomable, avec activité neuronale interne");canvas.style.cssText="position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:2";host.appendChild(canvas);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(34,1,.1,100);camera.position.set(0,.02,10.9);camera.lookAt(0,-.08,0);
 scene.add(new THREE.HemisphereLight(0xc5efff,0x07172a,1.45));const key=new THREE.DirectionalLight(0xe8f8ff,2.25);key.position.set(-4,5,7);scene.add(key);const fill=new THREE.DirectionalLight(0x36bce8,1.25);fill.position.set(5,1,4);scene.add(fill);const rim=new THREE.DirectionalLight(0x665bff,1.8);rim.position.set(0,3,-5);scene.add(rim);
 const brain=new THREE.Group();brain.scale.setScalar(.79);brain.position.y=.04;scene.add(brain);brain.add(makeCortex());makeMidline(brain);makeCerebellum(brain);
 const fiberMat=new THREE.MeshBasicMaterial({color:0x58dfff,transparent:true,opacity:.15});
 for(let i=0;i<22;i++){const a=fibonacciNormal(i,22),b=fibonacciNormal((i*7+9)%22,22),p1=corticalPoint(a,-.12),p2=corticalPoint(b,-.12),mid=p1.clone().add(p2).multiplyScalar(.5);mid.z-=.28;const curve=new THREE.CatmullRomCurve3([p1.clone().multiplyScalar(.72),mid.multiplyScalar(.72),p2.clone().multiplyScalar(.72)]);brain.add(new THREE.Mesh(new THREE.TubeGeometry(curve,32,.006,4,false),fiberMat));}
 const neuronGeo=new THREE.SphereGeometry(.027,10,8),neuronMat=new THREE.MeshBasicMaterial({color:0x8ceeff}),neurons=new THREE.InstancedMesh(neuronGeo,neuronMat,180);neurons.instanceMatrix.setUsage(THREE.DynamicDrawUsage);brain.add(neurons);const dummy=new THREE.Object3D();
 for(let i=0;i<180;i++){const n=fibonacciNormal(i,180),p=corticalPoint(n,.018);dummy.position.copy(p);dummy.scale.setScalar(.85);dummy.updateMatrix();neurons.setMatrixAt(i,dummy.matrix);neurons.setColorAt(i,new THREE.Color(i%13===0?0xa78bfa:i%7===0?0x34d399:0x5de5ff));}
 neurons.instanceMatrix.needsUpdate=true;if(neurons.instanceColor)neurons.instanceColor.needsUpdate=true;
 const halo=new THREE.Mesh(new THREE.TorusGeometry(2.28,.009,8,180),new THREE.MeshBasicMaterial({color:0x36d8ff,transparent:true,opacity:.18}));halo.rotation.x=Math.PI/2.3;halo.position.y=-.12;scene.add(halo);
 const pulseGeo=new THREE.SphereGeometry(.032,10,8),pulseMat=new THREE.MeshBasicMaterial({color:0xbaf8ff}),pulses=Array.from({length:7},()=>{const m=new THREE.Mesh(pulseGeo,pulseMat);scene.add(m);return m;});
 let active=false,raf=0,last=0,disposed=false,observer=null,cameraSource=null,yaw=-.35,pitch=.08,autoRotate=true,pauseUntil=0,hostH=1;
 const ROT_SPEED=TAU/30000,BASE_SCALE=.79,BASE_Y=.04;
 function resize(){const r=host.getBoundingClientRect(),w=Math.max(1,r.width),h=Math.max(1,r.height);hostH=h;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
 // Caméra partagée avec la vue 2D (molette, boutons −/＋, pincement, glisser) : le cerveau suit le zoom et le déplacement des nœuds.
 function applyCamera(){const c=cameraSource?.()||{x:0,y:0,scale:1},sc=clamp(Number(c.scale)||1,.55,2.8),upp=2*10.9*Math.tan(17*Math.PI/180)/hostH;brain.scale.setScalar(BASE_SCALE*sc);brain.position.set((Number(c.x)||0)*upp,BASE_Y-(Number(c.y)||0)*upp,0);}
 function frame(now){if(!active||disposed)return;const dt=Math.min(64,now-(last||now));last=now;if(autoRotate&&now>=pauseUntil)yaw=(yaw+dt*ROT_SPEED)%TAU;brain.rotation.y=yaw;brain.rotation.x=pitch;applyCamera();const t=now*.00016;pulses.forEach((p,i)=>{const a=t+i*TAU/pulses.length;p.position.set(Math.cos(a)*1.72,Math.sin(a)*.86-.12,Math.sin(a)*.72);});renderer.render(scene,camera);raf=requestAnimationFrame(frame);}
 function setActive(value){active=!!value;canvas.style.display=active?"block":"none";if(active){resize();if(!raf){last=performance.now();raf=requestAnimationFrame(frame);}}else if(raf){cancelAnimationFrame(raf);raf=0;}}
 function update(memories=[]){const rows=Array.isArray(memories)?memories.slice(0,180):[];for(let i=0;i<180;i++){const visible=i<rows.length,n=fibonacciNormal(i,180),p=corticalPoint(n,visible?.022:0);dummy.position.copy(p);const score=Number(rows[i]?.fiabilite);dummy.scale.setScalar(visible ? .76+(Number(rows[i]?.importance)||1)*.055+(Number.isFinite(score)?Math.max(0,score)/500:0) : 0);dummy.updateMatrix();neurons.setMatrixAt(i,dummy.matrix);const color=!visible?0x8ceeff:Number.isFinite(score)&&score>=80&&rows[i]?.statut==="valide"?0x34d399:Number.isFinite(score)&&score>=50?0x38bdf8:0xfbbf24;neurons.setColorAt(i,new THREE.Color(color));}neurons.instanceMatrix.needsUpdate=true;if(neurons.instanceColor)neurons.instanceColor.needsUpdate=true;}
 function destroy(){disposed=true;setActive(false);observer?.disconnect();renderer.dispose();canvas.remove();scene.traverse(o=>{o.geometry?.dispose?.();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose?.());else o.material?.dispose?.();});}
 observer=new ResizeObserver(resize);observer.observe(host);resize();return{setActive,update,resize,destroy,
  setCameraSource(fn){cameraSource=typeof fn==="function"?fn:null;},
  rotate(dx,dy){yaw=(yaw+dx*.008)%TAU;pitch=clamp(pitch+dy*.006,-.9,.9);pauseUntil=performance.now()+3500;},
  resetView(){yaw=-.35;pitch=.08;autoRotate=true;pauseUntil=0;},
  setAutoRotate(v){autoRotate=!!v;pauseUntil=0;return autoRotate;},
  isAutoRotate(){return autoRotate;},
  state(){return{yaw,pitch,autoRotate,scale:brain.scale.x,x:brain.position.x,y:brain.position.y};}};
}