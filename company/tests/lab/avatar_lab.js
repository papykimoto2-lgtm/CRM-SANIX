// Laboratoire des avatars : les quatre personnages réels du bureau (mêmes modules : assets.js, retarget.js, avatar_glb.js), sans base de données.
// Sert aux tests et aux captures : window.__lab.{setPose, settle, camera, ready, info}.
import { loadAssets, CHARACTERS } from "../../assets.js";
import { makeGlbAvatar } from "../../avatar_glb.js";
const THREE = await import("../../vendor/three.bundle.js");

const qs = new URLSearchParams(location.search), quality = qs.get("q") ?? "high";
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight, false);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xaeb8c4);
const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 100);
scene.add(new THREE.HemisphereLight(0xd9efff, 0x526176, 1.4));
const sun = new THREE.DirectionalLight(0xfff6ea, 2.4); sun.position.set(-3, 6, 5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -1, near: 1, far: 20 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; scene.add(sun);
const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.5;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x8b95a1, roughness: 0.9 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

const cache = (make) => { const m = new Map(); return (k, f) => (m.has(k) ? m.get(k) : (m.set(k, f()), m.get(k))); };
const assets = await loadAssets(THREE);
const env = { THREE, mats: cache(), geos: cache(), seg: 10, props: true, assets, walk: 2.05, shadows: true, blobMat: null };
const DEPT = [0x2563eb, 0x16a34a, 0xdb2777, 0xea580c];
const row = [];
const GAP = 1.5;
CHARACTERS.slice().sort().forEach((variant, i) => {
  for (let k = 0; k < 400; k++) {
    const av = makeGlbAvatar(env, { id: `lab-${variant}-${k}`, niveau: 3, departement_id: "x" }, DEPT[i]);
    if (av.variant === variant) { av.root.position.set((i - 1.5) * GAP, 0, 0); av.halo.visible = false; scene.add(av.root); row.push(av); break; }
    av.dispose();
  }
});

let t = 0;
const lab = window.__lab = {
  ready: true, row, scene, camera, assets,
  setPose(anim, posture = "stand", detail = "full") { for (const av of row) { av.walking = anim === "walk"; av.setAnim(anim === "walk" ? "idle" : anim, t); av.setPosture(posture); av.setDetail(detail); } },
  settle(sec = 1) { for (let s = 0; s < sec * 30; s++) { t += 1 / 30; for (const av of row) av.update(1 / 30, t); } renderer.render(scene, camera); },
  camera(preset) {
    // les avatars regardent -Z (convention du bureau) : la caméra est donc placée côté -Z pour les voir de face
    const P = { full: [0, 1.15, -7.2, 0, 1.0, 0], face: [0, 1.95, -2.3, 0, 1.85, 0], bust: [0, 1.7, -4.2, 0, 1.55, 0], hands: [0, 1.2, -2.6, 0, 1.15, 0], back: [0, 1.15, 7.2, 0, 1.0, 0] }[preset] ?? preset;
    camera.position.set(P[0], P[1], P[2]); camera.lookAt(P[3], P[4], P[5]); renderer.render(scene, camera);
  },
  focus(i, preset) { const x = (i - 1.5) * GAP; const d = { face: [0.0, 1.95, 1.05, 1.85], bust: [0, 1.7, 2.2, 1.5], full: [0, 1.15, 5.2, 1.0], hands: [0, 1.25, 1.6, 1.2], body: [0, 1.2, 3.4, 1.1], sit: [0, 1.25, 2.9, 1.0], sit34: [1.5, 1.6, 2.5, 1.0], sit34L: [-1.5, 1.6, 2.5, 1.0], top: [0.4, 3.0, 1.6, 0.9] }[preset]; camera.position.set(x + d[0], d[1], -d[2]); camera.lookAt(x, d[3], 0); renderer.render(scene, camera); },
  info: () => row.map((av) => ({ variant: av.variant, ...av.inspect() })),
  stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries }),
  render: () => renderer.render(scene, camera),
};
lab.setPose(qs.get("anim") ?? "idle", qs.get("posture") ?? "stand", qs.get("detail") ?? "full"); lab.settle(0.5); lab.camera("full");
