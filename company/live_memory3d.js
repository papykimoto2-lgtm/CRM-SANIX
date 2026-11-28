// SANIX AI — cerveau neuronal anatomique 3D (Three.js local, sans CDN).
// Géométrie volumétrique réelle, deux hémisphères, sillons corticaux, neurones et rotation continue.
import * as THREE from "./vendor/three.bundle.js";

const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function surfacePoint(side,theta,phi,scale=1){
  const x=-Math.cos(phi)*Math.sin(theta)*2.02*scale;
  const y=Math.cos(theta)*1.48*scale;
  const z=Math.sin(phi)*Math.sin(theta)*1.12*scale;
  return new THREE.Vector3(x,y,z);
}
function makeCortex(side){
  const phiStart=side<0?-Math.PI/2:Math.PI/2;
  const geo=new THREE.SphereGeometry(1,112,80,phiStart,Math.PI,.10,Math.PI-.20);
  const pos=geo.attributes.position;
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
    const n=new THREE.Vector3(x,y,z).normalize();
    const fold=(Math.sin(n.y*19+n.z*11)*Math.sin(n.x*15+n.z*17)*.020+
      Math.sin(n.y*31-n.x*13+n.z*8)*.012+
      Math.cos(n.x*27+n.y*22)*.008);
    pos.setXYZ(i,x*(2.02+fold),y*(1.48+fold),z*(1.12+fold));
  }
  geo.computeVertexNormals();
  const mat=new THREE.MeshPhysicalMaterial({
    color:side<0?0x75cce8:0x83d8ef,metalness:.22,roughness:.42,
    clearcoat:.92,clearcoatRoughness:.2,emissive:0x07324b,emissiveIntensity:.42,
    side:THREE.DoubleSide
  });
  const mesh=new THREE.Mesh(geo,mat);mesh.position.x=side*.045;mesh.castShadow=true;mesh.receiveShadow=true;
  return mesh;
}
function makeFolds(group,side){
  const dark=new THREE.MeshStandardMaterial({color:0x123c5d,roughness:.82,transparent:true,opacity:.72});
  const light=new THREE.MeshBasicMaterial({color:0x9deaff,transparent:true,opacity:.34});
  for(let i=0;i<15;i++){
    const pts=[],theta0=.38+(i%5)*.43,phi0=(side<0?-1.42:Math.PI/2+.15)+Math.floor(i/5)*.48;
    for(let k=0;k<=44;k++){
      const u=k/44,theta=theta0+u*(2.30-theta0);
      const phi=phi0+Math.sin(u*Math.PI*2+i*.63)*.12+Math.sin(u*Math.PI*5+i)*.035;
      pts.push(surfacePoint(side,theta,phi,1.012));
    }
    const curve=new THREE.CatmullRomCurve3(pts);
    const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,72,.018,5,false),dark);
    group.add(tube);
    if(i%3===0){
      const ridge=new THREE.Mesh(new THREE.TubeGeometry(curve,72,.006,4,false),light);
      group.add(ridge);
    }
  }
}
function glowMap(){
  const c=document.createElement("canvas");c.width=c.height=64;
  const g=c.getContext("2d"),r=g.createRadialGradient(32,32,0,32,32,32);
  r.addColorStop(0,"rgba(255,255,255,1)");r.addColorStop(.18,"rgba(120,235,255,.9)");
  r.addColorStop(.5,"rgba(34,211,238,.24)");r.addColorStop(1,"rgba(34,211,238,0)");
  g.fillStyle=r;g.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);
}

export function createMemoryBrain3D(host){
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:"high-performance"});
  renderer.setClearColor(0x000000,0);renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.65));
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
  const canvas=renderer.domElement;
  canvas.className="sanix-memory-brain-3d";
  canvas.setAttribute("aria-label","Cerveau neuronal SANIX en trois dimensions, rotation 360 degrés");
  canvas.style.cssText="position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:2";
  host.appendChild(canvas);

  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(34,1,.1,100);camera.position.set(0,.10,10.7);camera.lookAt(0,0,0);
  scene.add(new THREE.HemisphereLight(0xbcefff,0x07152e,2.0));
  const key=new THREE.DirectionalLight(0xe5faff,3.1);key.position.set(-4,5,7);scene.add(key);
  const fill=new THREE.DirectionalLight(0x32bce9,2.0);fill.position.set(5,1,4);scene.add(fill);
  const rim=new THREE.DirectionalLight(0x6b5cff,3.0);rim.position.set(0,3,-5);scene.add(rim);
  const brain=new THREE.Group();scene.add(brain);
  const left=makeCortex(-1),right=makeCortex(1);brain.add(left,right);
  makeFolds(brain,-1);makeFolds(brain,1);

  // Sillon interhémisphérique : fin, profond et visible de face.
  const seamPts=[];
  for(let i=0;i<=30;i++){const y=-1.35+i*2.7/30;seamPts.push(new THREE.Vector3(0,y,1.10*Math.sqrt(Math.max(.08,1-(y/1.58)**2))+.015));}
  brain.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seamPts),64,.025,7,false),
    new THREE.MeshStandardMaterial({color:0x09243c,roughness:.9})));

  // Cervelet et tronc cérébral, en retrait pour donner une vraie silhouette anatomique.
  const cerebMat=new THREE.MeshPhysicalMaterial({color:0x397f9e,metalness:.18,roughness:.58,clearcoat:.55});
  const cereb=new THREE.Mesh(new THREE.SphereGeometry(.78,48,32),cerebMat);
  cereb.scale.set(1.16,.58,.72);cereb.position.set(0,-1.22,-.52);brain.add(cereb);
  for(let i=0;i<7;i++){
    const curve=new THREE.CatmullRomCurve3([
      new THREE.Vector3(-.78+i*.26,-1.24,-.02),
      new THREE.Vector3(-.62+i*.20,-1.48,.02),
      new THREE.Vector3(-.50+i*.17,-1.56,-.10)
    ]);
    brain.add(new THREE.Mesh(new THREE.TubeGeometry(curve,18,.022,5,false),
      new THREE.MeshStandardMaterial({color:0x1a5875,roughness:.8})));
  }
  const stem=new THREE.Mesh(new THREE.CylinderGeometry(.22,.32,1.0,32,1),cerebMat);
  stem.position.set(0,-1.78,-.30);stem.rotation.x=-.12;brain.add(stem);

  // Fibres lumineuses internes et points d'activité.
  const fiberMat=new THREE.MeshBasicMaterial({color:0x41d9ff,transparent:true,opacity:.26});
  const fiberCurves=[];
  for(let i=0;i<24;i++){
    const side=i%2?1:-1,theta=.48+(i%8)*.26,phi=(side<0?-1.15:Math.PI/2+.42)+(Math.floor(i/8)-1)*.55+(i%3)*.12;
    const points=[];
    for(let k=0;k<=24;k++){const u=k/24;points.push(surfacePoint(side,theta+u*.55,phi+Math.sin(u*Math.PI)*.24,.995));}
    const curve=new THREE.CatmullRomCurve3(points);fiberCurves.push(curve);
    brain.add(new THREE.Mesh(new THREE.TubeGeometry(curve,32,.009,4,false),fiberMat));
  }
  const neuronGeo=new THREE.SphereGeometry(.035,10,8);
  const neuronMat=new THREE.MeshBasicMaterial({color:0x8ceeff});
  const neurons=new THREE.InstancedMesh(neuronGeo,neuronMat,180);neurons.instanceMatrix.setUsage(THREE.DynamicDrawUsage);brain.add(neurons);
  const neuronDummy=new THREE.Object3D(),neuronColors=[];
  for(let i=0;i<180;i++){
    const side=i%2?1:-1,theta=.28+((i*37)%137)/137*2.55,phi=(side<0?-Math.PI/2:Math.PI/2)+((i*19)%89)/89*Math.PI;
    const p=surfacePoint(side,theta,phi,1.025);neuronDummy.position.copy(p);neuronDummy.scale.setScalar(.72+(i%5)*.13);neuronDummy.updateMatrix();neurons.setMatrixAt(i,neuronDummy.matrix);
    const color=new THREE.Color(i%11===0?0xa78bfa:i%7===0?0x34d399:0x4bdcff);neurons.setColorAt(i,color);neuronColors.push(color);
  }
  neurons.instanceMatrix.needsUpdate=true;if(neurons.instanceColor)neurons.instanceColor.needsUpdate=true;
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowMap(),color:0x40dfff,transparent:true,opacity:.55,depthWrite:false,blending:THREE.AdditiveBlending}));
  glow.scale.set(5.4,4.2,1);glow.position.set(0,0,-1.4);brain.add(glow);

  // Halo elliptique et orbites de signal.
  const halo=new THREE.Mesh(new THREE.TorusGeometry(2.78,.012,8,180),new THREE.MeshBasicMaterial({color:0x36d8ff,transparent:true,opacity:.28}));
  halo.rotation.x=Math.PI/2.2;halo.position.y=-.10;scene.add(halo);
  const pulseGeo=new THREE.SphereGeometry(.045,12,10),pulseMat=new THREE.MeshBasicMaterial({color:0xbaf8ff});
  const pulses=Array.from({length:9},()=>{const m=new THREE.Mesh(pulseGeo,pulseMat);scene.add(m);return m;});

  let active=false,raf=0,last=0,width=1,height=1,disposed=false;
  function resize(){
    const r=host.getBoundingClientRect();width=Math.max(1,r.width);height=Math.max(1,r.height);
    renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
  }
  function frame(now){
    if(!active||disposed)return;
    const dt=Math.min(.05,(now-last)/1000||0);last=now;
    brain.rotation.y+=dt*TAU/26000; // un tour en 26 secondes, rotation continue et régulière
    brain.rotation.x=Math.sin(now*.00022)*.025;
    halo.rotation.z-=dt*.10;
    const t=now*.00018;
    pulses.forEach((p,i)=>{const a=t+i*TAU/pulses.length;p.position.set(Math.cos(a)*2.82,Math.sin(a)*.66-.10,Math.sin(a)*.30);p.material.opacity=.45+.45*Math.sin(a*2);});
    neurons.rotation.y=brain.rotation.y*.18;
    renderer.render(scene,camera);raf=requestAnimationFrame(frame);
  }
  function setActive(value){
    active=!!value;canvas.style.display=active?"block":"none";
    if(active){resize();if(!raf){last=performance.now();raf=requestAnimationFrame(frame);}}
    else if(raf){cancelAnimationFrame(raf);raf=0;}
  }
  function update(memories=[]){
    // Les mémoires sont encodées dans la densité et les couleurs des neurones, sans exposer leur texte sur le modèle.
    const rows=Array.isArray(memories)?memories.slice(0,180):[];
    for(let i=0;i<180;i++){
      const visible=i<rows.length,side=i%2?1:-1,theta=.28+((i*37)%137)/137*2.55,phi=(side<0?-1:1)*(.10+((i*19)%89)/89*1.43);
      const p=surfacePoint(side,theta,phi,visible?1.04:.001);
      neuronDummy.position.copy(p);neuronDummy.scale.setScalar(visible?.72+(Number(rows[i]?.importance)||1)*.08:0);
      neuronDummy.updateMatrix();neurons.setMatrixAt(i,neuronDummy.matrix);
      const status=rows[i]?.statut==="valide"?0x34d399:rows[i]?.statut==="partagee"?0xa78bfa:0xfbbf24;
      neurons.setColorAt(i,new THREE.Color(status));
    }
    neurons.instanceMatrix.needsUpdate=true;if(neurons.instanceColor)neurons.instanceColor.needsUpdate=true;
  }
  function destroy(){
    disposed=true;setActive(false);renderer.dispose();canvas.remove();host.removeEventListener("resize",resize);
    scene.traverse(o=>{o.geometry?.dispose?.();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose?.());else o.material?.dispose?.();});
  }
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  return{setActive,update,resize,destroy};
}
