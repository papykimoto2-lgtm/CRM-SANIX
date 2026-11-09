// SANIX AI VIRTUAL COMPANY — avatars articulés (procéduraux, sans ressource externe).
// Chaque animation traduit un statut RÉEL publié par le moteur IA ; elle ne prétend pas montrer chaque opération technique.
// Les modèles pourront être remplacés par des fichiers GLB (Blender) en réimplémentant makeAvatar() : le reste du moteur
// ne dépend que de l'interface décrite ici (setAnim, setPosture, setWalking, update, setDetail, inspect).

const SKIN = [0x6b4423, 0x8d5a32, 0xa9714a, 0x4a2c17, 0xc08a5e, 0x7a4b2a];
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// Poses de base (radians). Convention : l'avatar regarde vers -Z ; rotation X positive = vers l'avant (-Z) pour les membres.
const SEAT = { hipY: 0.6, hipL: 1.5, kneeL: -1.5, hipR: 1.5, kneeR: -1.5, torsoX: -0.04, torsoY: 0, headX: -0.04, headY: 0, headZ: 0, sLx: 0.55, sLo: 0.05, eL: 0.95, sRx: 0.55, sRo: 0.05, eR: 0.95 };
const STAND = { hipY: 0.9, hipL: 0, kneeL: 0, hipR: 0, kneeR: 0, torsoX: 0, torsoY: 0, headX: 0, headY: 0, headZ: 0, sLx: 0.06, sLo: 0.1, eL: 0.12, sRx: 0.06, sRo: 0.1, eR: 0.12 };
export const POSE_KEYS = Object.keys(SEAT);

/** Animations disponibles et accessoires qu'elles utilisent. */
export const ANIMS = {
  idle: {}, screen: {}, multiscreen: {}, documents: { docs: true }, typing: {}, terminal: { phone: true }, headset: { headset: true },
  talk: {}, present: {}, meeting: {}, speak: {}, celebrate: {}, alert: {}, pause: {}, relax: { cup: true }, watch: {}, handover: { folder: true }, walk: {},
};
export const DESK_FOR = { multiscreen: "multi", documents: "docs", typing: "typing", screen: "screen" };

/** Cible de pose d'une animation à l'instant t (secondes, déphasé par avatar). `o` : { speakerYaw, since } */
export function poseFor(anim, posture, t, o = {}) {
  const P = { ...(posture === "seat" ? SEAT : STAND) };
  const s = Math.sin, c = Math.cos;
  switch (anim) {
    case "idle":
      P.torsoX += s(t * 1.5) * 0.012; P.headY = s(t * 0.35) * 0.25 + s(t * 0.9) * 0.08; P.headX += s(t * 0.5) * 0.03;
      if (posture === "seat") { P.sLx = 0.5; P.sRx = 0.5; P.eL = 0.85; P.eR = 0.85; }
      break;
    case "screen":
      P.headX = -0.16 + s(t * 0.6) * 0.03; P.torsoX = -0.1; P.sRx = 0.6 + s(t * 2.2) * 0.04; P.eR = 0.95 + c(t * 2.2) * 0.07; P.headY = s(t * 0.7) * 0.12;
      break;
    case "multiscreen":
      P.headY = s(t * 0.95) * 0.75; P.headX = -0.08; P.torsoY = P.headY * 0.25; P.torsoX = -0.08;
      P.eL = 0.95 + s(t * 7) * 0.04; P.eR = 0.95 + s(t * 7 + 2) * 0.04;
      break;
    case "typing":
      P.headX = -0.22; P.torsoX = -0.1; P.sLx = 0.62; P.sRx = 0.62; P.eL = 1.0 + s(t * 17) * 0.09; P.eR = 1.0 + s(t * 17 + 2.4) * 0.09;
      P.headY = s(t * 0.4) * 0.08;
      break;
    case "documents":
      P.headX = -0.3; P.torsoX = -0.08; P.sLx = posture === "seat" ? 1.2 : 1.15; P.eL = 1.05; P.sLo = 0.18;
      P.sRx = 0.6 + s(t * 1.1) * 0.15; P.eR = 0.95 + s(t * 1.1 + 1) * 0.2; P.headY = s(t * 0.55) * 0.1;
      break;
    case "terminal":
      P.headX = -0.34; P.torsoX = -0.12; P.sLx = 0.95; P.eL = 1.7; P.sRx = 0.95; P.eR = 1.7; P.sLo = -0.15; P.sRo = -0.15;
      P.eL += s(t * 9) * 0.03; P.eR += s(t * 9 + 1.7) * 0.05; P.headY = s(t * 0.5) * 0.06;
      break;
    case "headset":
      P.headX = -0.04 + s(t * 2.3) * 0.05; P.headZ = s(t * 1.3) * 0.06; P.torsoX = -0.06;
      P.sRx = 1.0 + (s(t * 0.5) > 0.7 ? 0.6 : 0); P.eR = 1.2 + (s(t * 0.5) > 0.7 ? 0.9 : 0); P.sLx = 0.55 + s(t * 2.6) * 0.12; P.eL = 0.95 + s(t * 3.2) * 0.12;
      break;
    case "talk":
      P.headY = s(t * 1.4) * 0.3; P.headX = s(t * 1.9) * 0.08; P.torsoY = s(t * 0.9) * 0.12;
      P.sLx = 0.95 + s(t * 2.6) * 0.4; P.eL = 1.15 + s(t * 3.1 + 1) * 0.35; P.sLo = 0.2 + s(t * 2.1) * 0.15;
      P.sRx = 0.95 + s(t * 2.9 + 2) * 0.4; P.eR = 1.15 + s(t * 2.4) * 0.35; P.sRo = 0.2 + s(t * 2.3 + 1) * 0.15;
      break;
    case "speak":
      P.headY = s(t * 1.2) * 0.22; P.headX = s(t * 2.1) * 0.07; P.torsoY = s(t * 0.8) * 0.1;
      P.sLx = 0.85 + s(t * 2.3) * 0.35; P.eL = 1.1 + s(t * 2.9) * 0.3; P.sLo = 0.18; P.sRx = 0.85 + s(t * 2.7 + 2) * 0.35; P.eR = 1.1 + s(t * 2.2) * 0.3; P.sRo = 0.18;
      break;
    case "present":
      P.sRx = 2.0 + s(t * 1.6) * 0.15; P.sRo = 0.5; P.eR = 0.35 + s(t * 2.0) * 0.2; P.headY = s(t * 0.8) * 0.3; P.headX = s(t * 1.8) * 0.06;
      P.sLx = 0.6; P.eL = 0.95; P.torsoY = -0.12;
      break;
    case "meeting":
      P.sLx = 0.62; P.eL = 0.7; P.sRx = 0.62; P.eR = 0.7; P.headY = clamp(o.speakerYaw ?? 0, -1.0, 1.0); P.headX = -0.04 + s(t * 0.7) * 0.03; P.torsoY = P.headY * 0.2;
      break;
    case "celebrate": {
      const k = Math.min(1, (o.since ?? 99) / 0.35);
      P.sLx = 0.5 + 2.4 * k; P.sRx = 0.5 + 2.4 * k; P.sLo = 0.25 + 0.25 * k; P.sRo = 0.25 + 0.25 * k; P.eL = 0.3; P.eR = 0.3;
      P.headX = -0.1 * k; P.torsoX = -0.05; P.headY = s(t * 1.2) * 0.1;
      break;
    }
    case "alert":
      P.sRx = 2.7; P.sRo = 0.45; P.eR = 0.4 + s(t * 11) * 0.45; P.headY = s(t * 2.4) * 0.35; P.headX = -0.05; P.torsoX = -0.04;
      break;
    case "pause":
      P.torsoX = 0.16; P.headX = 0.14; P.headZ = 0.12; P.sLx = 0.15; P.eL = 0.2; P.sRx = 0.15; P.eR = 0.2; P.headY = s(t * 0.25) * 0.15;
      if (posture === "seat") { P.sLx = 0.3; P.eL = 0.4; P.sRx = 0.3; P.eR = 0.4; }
      break;
    case "relax": {
      const sip = (t % 6) > 4.2;
      P.sRx = sip ? 1.7 : 0.9; P.eR = sip ? 2.3 : 1.5; P.headX = sip ? 0.12 : 0.02; P.headY = s(t * 0.4) * 0.35; P.sLx = 0.1; P.torsoX = posture === "seat" ? 0.08 : 0;
      break;
    }
    case "watch":
      P.sLx = 0.9; P.sLo = -0.25; P.eL = 2.1; P.sRx = 0.9; P.sRo = -0.25; P.eR = 2.1; P.headY = s(t * 0.8) * 0.8; P.headX = 0.04;
      break;
    case "handover":
      P.sRx = 1.45; P.eR = 0.3 + s(t * 2) * 0.05; P.sRo = 0.1; P.sLx = 0.8 + s(t * 2.4) * 0.3; P.eL = 1.1 + s(t * 2.9) * 0.25; P.headY = s(t * 1.1) * 0.22; P.headX = 0.03 + s(t * 1.7) * 0.05;
      break;
    case "walk": {
      const w = s(t * 6.4) * 0.65;
      P.hipL = w; P.hipR = -w; P.kneeL = Math.max(0, -w) * 0.9; P.kneeR = Math.max(0, w) * 0.9;
      P.sLx = -w * 0.8; P.sRx = w * 0.8; P.eL = 0.3; P.eR = 0.3; P.torsoY = w * 0.08; P.hipY = 0.9 + Math.abs(s(t * 6.4)) * -0.03; P.headY = 0;
      break;
    }
  }
  return P;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Construit un avatar. `env` = { THREE, mats(key, make), geos(key, make), seg, props } ; `a` = agent. */
export function makeAvatar(env, a, deptColor) {
  const { THREE } = env;
  const lvl = a.niveau, S = lvl === 1 ? 1.12 : lvl === 2 ? 1.06 : 1;
  const std = (c, o = {}) => env.mats(`s${c}${JSON.stringify(o)}`, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.62, ...o }));
  const cap = (r, l, k) => env.geos(`cap${r}_${l}_${env.seg}_${k}`, () => new THREE.CapsuleGeometry(r, l, 3, env.seg));
  const cyl = (r, h, k) => env.geos(`cyl${r}_${h}_${env.seg}_${k}`, () => new THREE.CylinderGeometry(r, r * 0.92, h, Math.max(6, env.seg - 2)));
  const box = (x, y, z, k) => env.geos(`box${x}_${y}_${z}_${k}`, () => new THREE.BoxGeometry(x, y, z));
  const sph = (r, k) => env.geos(`sph${r}_${env.seg}_${k}`, () => new THREE.SphereGeometry(r, env.seg + 2, Math.max(6, env.seg)));
  const shirt = std(deptColor), skin = std(SKIN[hash(a.id) % SKIN.length], { roughness: 0.7 }), trousers = std(0x1b2235), hairM = std(0x15110e, { roughness: 0.9 }), shoe = std(0x0d1117);

  const root = new THREE.Group();                       // sol ; position = (x, 0, z), rotation.y = cap
  const body = new THREE.Group(); body.scale.setScalar(S); root.add(body);
  const hips = new THREE.Group(); body.add(hips);
  const mk = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (mat === shirt) shirtMeshes.push(m); return m; };
  const shirtMeshes = [];

  // jambes (pivot à la hanche, genou à 0,45)
  const leg = (side) => {
    const pivot = new THREE.Group(); pivot.position.set(side * 0.11, 0, 0);
    pivot.add(mk(cap(0.075, 0.3, "th"), trousers, 0, -0.225, 0));
    const shin = new THREE.Group(); shin.position.y = -0.45; pivot.add(shin);
    shin.add(mk(cap(0.065, 0.28, "sh"), trousers, 0, -0.215, 0));
    if (env.seg > 6) shin.add(mk(box(0.1, 0.06, 0.2, "ft"), shoe, 0, -0.45, -0.05));
    hips.add(pivot);
    return { pivot, shin };
  };
  const L = leg(-1), R = leg(1);

  // buste
  const torso = new THREE.Group(); hips.add(torso);
  torso.add(mk(cap(0.19, 0.2, "tr"), shirt, 0, 0.3, 0));
  torso.add(mk(box(0.42, 0.07, 0.24, "sd"), shirt, 0, 0.58, 0));       // épaules
  const head = new THREE.Group(); head.position.y = 0.74; torso.add(head);
  head.add(mk(sph(0.15, "hd"), skin, 0, 0.12, 0));
  const hair = mk(env.geos(`hair${env.seg}`, () => new THREE.SphereGeometry(0.162, env.seg + 2, Math.max(6, env.seg - 2), 0, Math.PI * 2, 0, Math.PI * 0.55)), hairM, 0, 0.135, 0.01); hair.rotation.x = -0.25; head.add(hair);

  // bras (épaule → coude → main)
  const arm = (side) => {
    const sh = new THREE.Group(); sh.position.set(side * 0.25, 0.55, 0); torso.add(sh);
    sh.add(mk(cap(0.06, 0.2, "ua"), shirt, 0, -0.17, 0));
    const fore = new THREE.Group(); fore.position.y = -0.31; sh.add(fore);
    fore.add(mk(cap(0.052, 0.2, "fa"), skin, 0, -0.16, 0));
    const hand = new THREE.Group(); hand.position.y = -0.31; fore.add(hand);
    hand.add(mk(sph(0.055, "hn"), skin));
    return { sh, fore, hand };
  };
  const AL = arm(-1), AR = arm(1);

  // accessoires (créés une fois, affichés selon l'animation)
  const props = {};
  if (env.props) {
    const hs = new THREE.Group();
    hs.add(mk(env.geos("hsband", () => new THREE.TorusGeometry(0.16, 0.012, 6, 16, Math.PI)), std(0x222a3d), 0, 0.12, 0));
    hs.add(mk(box(0.04, 0.07, 0.05, "cupL"), std(0x111827), -0.165, 0.1, 0)); hs.add(mk(box(0.04, 0.07, 0.05, "cupR"), std(0x111827), 0.165, 0.1, 0));
    hs.add(mk(box(0.012, 0.012, 0.1, "mic"), std(0x111827), 0.15, 0.06, -0.06));
    hs.visible = false; head.add(hs); props.headset = hs;
    const ph = mk(box(0.075, 0.14, 0.012, "ph"), env.mats("phone", () => new THREE.MeshStandardMaterial({ color: 0x0b1220, emissive: 0x25d366, emissiveIntensity: 0.9 })), 0.02, -0.06, -0.06);
    ph.rotation.x = -0.9; ph.visible = false; AR.hand.add(ph); props.phone = ph;
    const dc = mk(box(0.22, 0.3, 0.008, "doc"), std(0xf1f5f9, { emissive: 0x222222 }), 0.02, -0.1, -0.1); dc.rotation.x = -1.1; dc.visible = false; AL.hand.add(dc); props.docs = dc;
    const cp = mk(cyl(0.04, 0.09, "cup"), std(0xe2e8f0), 0, -0.05, -0.04); cp.visible = false; AR.hand.add(cp); props.cup = cp;
    const fd = mk(box(0.2, 0.03, 0.27, "fld"), std(0xf59e0b), 0.03, -0.06, -0.14); fd.visible = false; AR.hand.add(fd); props.folder = fd;
  }

  // marqueurs de niveau
  if (lvl === 1) { const crown = mk(env.geos("crown", () => new THREE.TorusGeometry(0.11, 0.025, 6, 16)), std(0xfacc15, { emissive: 0xfacc15, emissiveIntensity: 0.6 }), 0, 0.3, 0); crown.rotation.x = Math.PI / 2; head.add(crown); }
  if (lvl === 2) torso.add(mk(box(0.1, 0.16, 0.012, "tie"), std(0xcbd5e1, { metalness: 0.4 }), 0, 0.33, -0.2));

  // repères visuels (hors corps) : halo d'état, anneau d'analyse, icône, zone cliquable, marqueur léger
  const halo = new THREE.Mesh(env.geos("halo", () => new THREE.RingGeometry(0.62, 0.82, 36)), new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = 0.04; root.add(halo);
  const spin = new THREE.Mesh(env.geos("spin", () => new THREE.TorusGeometry(0.42, 0.03, 6, 24)), new THREE.MeshBasicMaterial({ color: 0x06b6d4 }));
  spin.rotation.x = Math.PI / 2; spin.visible = false; root.add(spin);
  const icon = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false })); icon.scale.set(0.8, 0.8, 1); icon.visible = false; icon.renderOrder = 10; root.add(icon);
  const hit = new THREE.Mesh(env.geos("hit", () => new THREE.CylinderGeometry(0.8, 0.8, 2.3, 8)), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); hit.position.y = 1.15; root.add(hit);
  const marker = mk(env.geos(`marker${env.seg}`, () => new THREE.CapsuleGeometry(0.28, 0.9, 3, env.seg)), shirt, 0, 0.8, 0); marker.visible = false; root.add(marker);
  root.userData.agentId = a.id; hit.userData.agentId = a.id;

  // ── état d'animation ──
  const pose = { ...STAND }, seed = (hash(a.id) % 1000) / 100;
  const av = {
    id: a.id, root, body, hips, torso, head, legL: L.pivot, shinL: L.shin, legR: R.pivot, shinR: R.shin, armL: AL, armR: AR, props, halo, spin, icon, hit, marker, shirt,
    S, seed, pose, anim: "idle", posture: "stand", walking: false, detail: "full", animSince: 0, speakerYaw: 0, hopUntil: 0,
    agent: a, lod: 0, frame: 0,
    setAnim(anim, now) { if (anim !== this.anim) { this.anim = anim; this.animSince = now; } },
    setPosture(p) { this.posture = p; },
    /** Agent suspendu : vêtement grisé (matériau partagé, aucun changement pour les collègues). */
    setMuted(on) { const m = on ? std(0x475569) : shirt; for (const x of shirtMeshes) x.material = m; },
    setDetail(d) { if (d === this.detail) return; this.detail = d; const full = d === "full"; body.visible = full; marker.visible = !full; if (!full) for (const k in props) props[k].visible = false; },
    /** Applique l'animation courante : lissage vers la pose cible, accessoires, mouvements globaux. */
    update(dt, now) {
      if (this.detail !== "full") return;
      const anim = this.walking ? "walk" : this.anim;
      const t = now / 1000 + seed;
      const tgt = poseFor(anim, this.posture, t, { speakerYaw: this.speakerYaw, since: (now - this.animSince) / 1000 });
      const k = Math.min(1, dt * (anim === "walk" ? 14 : 9));
      for (const key of POSE_KEYS) pose[key] += (tgt[key] - pose[key]) * k;
      hips.position.y = pose.hipY;
      L.pivot.rotation.x = pose.hipL; L.shin.rotation.x = pose.kneeL; R.pivot.rotation.x = pose.hipR; R.shin.rotation.x = pose.kneeR;
      torso.rotation.x = pose.torsoX; torso.rotation.y = pose.torsoY;
      head.rotation.set(pose.headX, pose.headY, pose.headZ);
      AL.sh.rotation.set(pose.sLx, 0, -pose.sLo); AL.fore.rotation.x = pose.eL;
      AR.sh.rotation.set(pose.sRx, 0, pose.sRo); AR.fore.rotation.x = pose.eR;
      const use = ANIMS[anim] ?? {};
      for (const key in props) props[key].visible = !!use[key];
      // saut de joie à l'entrée dans « mission terminée »
      root.position.y = anim === "celebrate" && (now - this.animSince) < 1500 && this.posture === "stand" ? Math.abs(Math.sin((now - this.animSince) / 200)) * 0.22 : 0;
    },
    inspect() {
      return { anim: this.walking ? "walk" : this.anim, posture: this.posture, walking: this.walking, detail: this.detail,
        props: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.visible])), pose: { ...pose }, x: root.position.x, z: root.position.z, yaw: root.rotation.y };
    },
    dispose() { halo.material.dispose(); spin.material.dispose(); hit.material.dispose(); },
  };
  av.setDetail("full");
  return av;
}
