// SANIX AI VIRTUAL COMPANY — avatar humain GLB : squelette animé par des clips (AnimationMixer), teintes par collaborateur.
// Même interface que avatar.js (setAnim, setPosture, update, setDetail, inspect…) : le moteur de bureau ne voit pas la différence.
import { makeIndicators } from "./avatar.js";
import { AV_SCALE, BASE_WALK, BODY_SCALE, CHARACTERS, PALETTE } from "./assets.js";

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const CLIP = { idle: "idle", screen: "screen", multiscreen: "multiscreen", documents: "documents", typing: "typing", terminal: "terminal", headset: "headset", talk: "talk", present: "present",
  meeting: "meeting", speak: "speak", celebrate: "celebrate", alert: "alert", pause: "pause", relax: "relax", watch: "watch", handover: "handover" };
const PROPS = { headset: ["Prop_Phone"], terminal: ["Prop_Phone"], documents: ["Prop_Doc"], relax: ["Prop_Cup"], handover: ["Prop_Folder"] };
const SLOTS = ["skin", "top", "bottom", "shoes", "hair", "eye", "dark", "shirt", "accent"];   // ordre inscrit dans la couleur de sommet (rouge = indice / 8)
const FIXED = { shoes: "#161b24", eye: "#f4f6f8", dark: "#161616", shirt: "#f1f5f9" };

/** Corps : un seul matériau et un seul appel de dessin par personnage. Le fragment lit l'emplacement (couleur de sommet) et applique la teinte du collaborateur. */
function patchBody(shader) {
  shader.uniforms.uPal = { value: this.userData.pal };
  shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 uPal[9];")
    .replace("#include <color_fragment>", "diffuseColor.rgb = uPal[int(clamp(floor(vColor.r * 8.0 + 0.5), 0.0, 8.0))];");
}
const BODY_KEY = () => "sanix-body-v1";
const pick = (arr, h, k = 0) => arr[(h >>> k) % arr.length];

/** Morphologie : cadres et directeurs en costume, le reste réparti par identifiant (mixité). */
function variantFor(a, h) {
  if (a.niveau === 1) return "homme_a";
  if (a.niveau === 2) return h % 2 ? "femme_b" : "homme_a";
  return CHARACTERS[h % CHARACTERS.length];
}

export function makeGlbAvatar(env, a, deptColor) {
  const { THREE: T, assets } = env, SU = T.SkeletonUtils;
  const h = hash(a.id), lvl = a.niveau, variant = variantFor(a, h);
  const model = SU.clone(assets.models.get(variant));
  model.rotation.y = Math.PI;                                   // glTF regarde +Z, le moteur -Z
  const S = AV_SCALE * BODY_SCALE[variant] * (lvl === 1 ? 1.04 : lvl === 2 ? 1.02 : 0.97 + (h % 7) * 0.01) / AV_SCALE;
  const body = new T.Group(); body.add(model); body.scale.setScalar(AV_SCALE * S);
  const root = new T.Group(); root.add(body);

  // teintes propres au collaborateur (matériaux clonés ; yeux, chaussures et détails restent partagés)
  const color = {
    skin: pick(PALETTE.skin, h, 3), hair: pick(PALETTE.hair, h, 7), top: lvl === 1 ? "#0f172a" : pick(PALETTE.top[variant], h, 5), bottom: lvl === 1 ? "#111827" : pick(PALETTE.bottom, h, 11),
    accent: lvl === 1 ? "#EAB308" : "#" + new T.Color(deptColor).getHexString(),
  };
  const pal = SLOTS.map((k) => { const c = new T.Color(color[k] ?? FIXED[k]); return new T.Vector3(c.r, c.g, c.b); });
  const clones = new Map(); let bodyMat = null;
  model.traverse((o) => {
    if (!o.material) return;
    const m = o.material, slot = m.name.slice(variant.length + 1);
    if (slot === "body") {
      if (!bodyMat) { bodyMat = m.clone(); bodyMat.vertexColors = true; bodyMat.userData.pal = pal; bodyMat.onBeforeCompile = patchBody; bodyMat.customProgramCacheKey = BODY_KEY; }
      o.material = bodyMat;
    } else if (slot === "accent") {                              // chemise cartonnée : couleur du département
      if (!clones.has(m)) { const c = m.clone(); c.color.set(color.accent); clones.set(m, c); }
      o.material = clones.get(m);
    }
  });
  const topVec = pal[1].clone(), mutedVec = new T.Vector3(...new T.Color("#475569").toArray());

  const mixer = new T.AnimationMixer(model), actions = new Map();
  const action = (n) => { if (!assets.clips.has(n)) return null; if (!actions.has(n)) actions.set(n, mixer.clipAction(assets.clips.get(n))); return actions.get(n); };
  const bone = (n) => model.getObjectByName(n);
  const props = Object.fromEntries(["Prop_Phone", "Prop_Doc", "Prop_Cup", "Prop_Folder", "Prop_Headset"].map((n) => [n, bone(n)]));
  const headB = bone("Head"), neckB = bone("Neck");
  const { halo, spin, icon, hit, marker } = makeIndicators(env, a, root, env.mats(`m${deptColor}`, () => new T.MeshStandardMaterial({ color: deptColor, roughness: 0.6 })));
  const seed = (h % 1000) / 100, top = 1.76 * AV_SCALE * S + 0.05;
  const q = new T.Quaternion(), q2 = new T.Quaternion(), up = new T.Vector3(0, 1, 0), v = new T.Vector3(), fwd = new T.Vector3();
  model.updateMatrixWorld(true); const headRest = headB ? headB.getWorldQuaternion(new T.Quaternion()) : null;

  const av = {
    id: a.id, root, body, S, top, seed, halo, spin, icon, hit, marker, agent: a, anim: "idle", posture: "stand", walking: false, detail: "full", animSince: 0, speakerYaw: 0, frame: 0, lod: 0,
    variant, clip: null, pose: {},
    setAnim(anim, now) { if (anim !== this.anim) { this.anim = anim; this.animSince = now; } },
    setPosture(p) { this.posture = p; },
    setMuted(on) { pal[1].copy(on ? mutedVec : topVec); if (bodyMat) bodyMat.uniformsNeedUpdate = true; },
    setDetail(d) { if (d === this.detail) return; this.detail = d; const full = d === "full"; body.visible = full; marker.visible = !full; },
    clipName() {
      const prefix = this.posture === "seat" ? "Sit" : "Stand", motion = CLIP[this.anim] ?? "idle", n = `${prefix}_${motion}`;
      return assets.clips.has(n) ? n : `${prefix}_idle`;
    },
    update(dt, now) {
      if (this.detail !== "full") return;
      const want = this.walking ? "Walk" : this.clipName();
      if (want !== this.clip) {
        const next = action(want), prev = this.clip && action(this.clip);
        if (next) {
          next.enabled = true; next.setLoop(T.LoopRepeat, Infinity); next.reset();
          next.time = ((seed * 0.37) % Math.max(next.getClip().duration, 0.1)); next.fadeIn(0.28).play();
          if (prev && prev !== next) prev.fadeOut(0.28);
        }
        this.clip = want;
        const show = PROPS[this.anim] ?? [];
        for (const k in props) if (props[k]) props[k].visible = !this.walking && show.includes(k);
      }
      const cur = this.clip && action(this.clip);
      if (cur && this.clip === "Walk") cur.timeScale = env.walk / BASE_WALK;
      mixer.update(dt);
      // regard vers l'orateur (réunion) : rotation horizontale de la tête et du cou dans le repère du monde
      if (this.speakerYaw && headB && neckB) {
        for (const [b, k] of [[neckB, 0.35], [headB, 0.65]]) {
          b.parent.getWorldQuaternion(q2); q.setFromAxisAngle(up, this.speakerYaw * k);
          b.quaternion.premultiply(q2.clone().invert().multiply(q).multiply(q2));
        }
      }
    },
    /** Repères mesurés sur le squelette animé (tests, diagnostic) : hauteurs réelles des mains et de la tête. */
    metrics() {
      model.updateMatrixWorld(true); const g = (n) => { const b = bone(n); return b ? b.getWorldPosition(v).y / (AV_SCALE * S) : null; };
      let headYaw = 0;
      if (headB) { headB.getWorldQuaternion(q2); q2.multiply(headRest.clone().invert()); fwd.set(0, 0, 1).applyQuaternion(q2); headYaw = Math.atan2(fwd.x, fwd.z); }
      return { head: g("Head"), rightHand: g("RightHand"), leftHand: g("LeftHand"), hips: g("Hips"), headYaw, scale: AV_SCALE * S };
    },
    inspect() {
      return { anim: this.walking ? "walk" : this.anim, clip: this.clip, posture: this.posture, walking: this.walking, detail: this.detail, variant,
        props: { phone: !!props.Prop_Phone?.visible, docs: !!props.Prop_Doc?.visible, cup: !!props.Prop_Cup?.visible, folder: !!props.Prop_Folder?.visible, headset: !!props.Prop_Headset?.visible },
        pose: this.metrics(), x: root.position.x, z: root.position.z, yaw: root.rotation.y };
    },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model); bodyMat?.dispose(); for (const c of clones.values()) c.dispose(); halo.material.dispose(); spin.material.dispose(); hit.material.dispose(); },
  };
  av.setDetail("full");
  return av;
}
