// SANIX AI VIRTUAL COMPANY — avatar humain GLB : squelette animé par des clips recalés (AnimationMixer), deux niveaux de détail.
// Même interface que avatar.js (setAnim, setPosture, update, setDetail, inspect…) : le moteur de bureau ne voit pas la différence.
import { makeIndicators } from "./avatar.js";
import { makeCarried } from "./avatar_props.js";
import { AV_SCALE, BASE_WALK, BODY_SCALE, CHARACTERS } from "./assets.js";

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const CLIP = { idle: "idle", screen: "screen", multiscreen: "multiscreen", documents: "documents", typing: "typing", terminal: "terminal", headset: "headset", talk: "talk", present: "present",
  meeting: "meeting", speak: "speak", celebrate: "celebrate", alert: "alert", pause: "pause", relax: "relax", watch: "watch", handover: "handover" };
const PROPS = { headset: ["Prop_Phone"], terminal: ["Prop_Phone"], documents: ["Prop_Doc"], relax: ["Prop_Cup"], handover: ["Prop_Folder"] };
const MUTED = 0.5;   // collaborateur suspendu : matières assombries (le personnage reste lisible, mais « éteint »)
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

  // Matières partagées entre tous les avatars du même personnage (textures PBR conservées) ; copiées seulement si le collaborateur est suspendu.
  model.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.receiveShadow = true; } });
  const lod0 = model.getObjectByName("Corps_LOD0"), lod1 = model.getObjectByName("Corps_LOD1");
  const clips = assets.clipsOf?.get(variant) ?? assets.clips;     // clips recalés sur ce squelette (repli : clips d'origine)

  const mixer = new T.AnimationMixer(model), actions = new Map();
  const action = (n) => { if (!clips.has(n)) return null; if (!actions.has(n)) actions.set(n, mixer.clipAction(clips.get(n))); return actions.get(n); };
  const bone = (n) => model.getObjectByName(n);
  model.updateWorldMatrix(true, true);
  const carried = makeCarried(env, model, deptColor);            // téléphone, document, tasse, chemise, casque, badge de département
  const props = carried.props;
  const headB = bone("Head"), neckB = bone("Neck");
  const { halo, spin, icon, hit, marker } = makeIndicators(env, a, root, env.mats(`m${deptColor}`, () => new T.MeshStandardMaterial({ color: deptColor, roughness: 0.6 })));
  const seed = (h % 1000) / 100, top = 1.76 * AV_SCALE * S + 0.05;
  const q = new T.Quaternion(), q2 = new T.Quaternion(), up = new T.Vector3(0, 1, 0), v = new T.Vector3(), fwd = new T.Vector3();
  model.updateMatrixWorld(true); const headRest = headB ? headB.getWorldQuaternion(new T.Quaternion()) : null;
  let own = null;                                                 // matières propres à cet avatar (créées au premier « suspendu »)

  const av = {
    id: a.id, root, body, S, top, seed, halo, spin, icon, hit, marker, agent: a, anim: "idle", posture: "stand", walking: false, detail: "full", animSince: 0, speakerYaw: 0, frame: 0, lod: 0,
    variant, clip: null, pose: {}, muted: false, carried, model,
    setAnim(anim, now) { if (anim !== this.anim) { this.anim = anim; this.animSince = now; } },
    setPosture(p) { this.posture = p; },
    setMuted(on) {
      on = !!on; if (on === this.muted) return; this.muted = on;
      if (!own) {
        own = new Map();
        model.traverse((o) => { if (!o.isMesh || carried.owns(o)) return; const ms = [].concat(o.material).map((m) => own.get(m) ?? (own.set(m, m.clone()), own.get(m))); o.material = Array.isArray(o.material) ? ms : ms[0]; });
        for (const m of own.values()) m.userData.base = m.color.clone();
      }
      for (const m of own.values()) m.color.copy(m.userData.base).multiplyScalar(on ? MUTED : 1);
    },
    /** « full » : niveau de détail 0 ; « lite » : niveau 1 (téléphones, personnages éloignés) ; « marker » : repère simple. */
    setDetail(d) {
      if (d === this.detail) return; this.detail = d;
      const full = d === "full", lite = d === "lite";
      body.visible = full || lite; marker.visible = !(full || lite);
      if (lod0) lod0.visible = full || (lite && !lod1);
      if (lod1) lod1.visible = lite;
      if (!(full || lite)) for (const k in props) if (props[k]) props[k].visible = false;
    },
    clipName() {
      const prefix = this.posture === "seat" ? "Sit" : "Stand", motion = CLIP[this.anim] ?? "idle", n = `${prefix}_${motion}`;
      return clips.has(n) ? n : `${prefix}_idle`;
    },
    update(dt, now) {
      if (this.detail === "marker") return;
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
      if (props.Prop_Cup?.visible) { model.updateWorldMatrix(true, true); carried.keepUpright(props.Prop_Cup); }   // la tasse reste droite
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
      return { anim: this.walking ? "walk" : this.anim, clip: this.clip, posture: this.posture, walking: this.walking, detail: this.detail, variant, muted: this.muted,
        props: { phone: !!props.Prop_Phone?.visible, docs: !!props.Prop_Doc?.visible, cup: !!props.Prop_Cup?.visible, folder: !!props.Prop_Folder?.visible, headset: !!props.Prop_Headset?.visible },
        pose: this.metrics(), x: root.position.x, z: root.position.z, yaw: root.rotation.y };
    },
    dispose() {
      mixer.stopAllAction(); mixer.uncacheRoot(model);
      if (own) for (const m of own.values()) m.dispose();            // les matières partagées appartiennent au cache de ressources
      carried.dispose();
      halo.material.dispose(); spin.material.dispose(); hit.material.dispose();
    },
  };
  av.setDetail("full");
  return av;
}
