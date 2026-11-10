// SANIX AI VIRTUAL COMPANY — recalage des animations SANIX sur le squelette des humains réalistes.
//
// Les clips (animations.glb) ont été créés sur le squelette SANIX : mêmes NOMS d'os que les humains réalistes, mais
//  - des poses de repos différentes (os orientés autrement, avant-bras droits chez SANIX, légèrement fléchis chez les humains) ;
//  - des longueurs d'os différentes ;
//  - des pistes de translation sur CHAQUE os, qui écraseraient les proportions du personnage (membres étirés ou écrasés).
// Appliqués tels quels, ils déforment donc le corps. Ce module recalcule, pour chaque personnage, des clips équivalents :
//  - rotations : le mouvement MONDE de chaque os de la source est rejoué sur l'os cible (même geste, mêmes noms de clips) ;
//    pour les bras, la pose de repos cible est d'abord alignée sur celle de la source (bras et avant-bras suivent la même direction) ;
//  - translation : seul le bassin (Hips) se déplace, proportionnellement à la hauteur de ses hanches ; les autres os gardent leur longueur.
//  - pronation : les clips SANIX n'orientaient pas les paumes (mains en moufles) ; quand l'avant-bras est tenu vers l'avant (frappe, lecture,
//    souris), la paume est tournée vers le bas, comme chez une vraie personne, au lieu de rester vers le haut.
// Calcul unique au chargement (27 clips × 4 personnages, quelques millisecondes), aucune ressource supplémentaire à télécharger.

/** Os dont la pose de repos cible est alignée sur la source : os → os enfant qui donne la direction (« @x » : reprend l'alignement de x). */
const ALIGN = {
  LeftShoulder: "LeftArm", LeftArm: "LeftForeArm", LeftForeArm: "LeftHand", LeftHand: "@LeftForeArm",
  RightShoulder: "RightArm", RightArm: "RightForeArm", RightForeArm: "RightHand", RightHand: "@RightForeArm",
};

export function retargetClips(T, sourceScene, sourceClips, targetModel) {
  const { Quaternion, Vector3 } = T;
  sourceScene.updateMatrixWorld(true); targetModel.updateMatrixWorld(true);
  const bonesOf = (root) => { const m = new Map(); root.traverse((o) => { if (o.isBone || o.name) m.set(o.name, o); }); return m; };
  const src = bonesOf(sourceScene), dst = bonesOf(targetModel);
  const names = [...new Set(sourceClips.flatMap((c) => c.tracks.filter((t) => t.name.endsWith(".quaternion")).map((t) => t.name.split(".")[0])))].filter((n) => src.has(n) && dst.has(n));
  const set = new Set(names);
  const parentName = (map, n) => { let p = map.get(n)?.parent; while (p && !set.has(p.name)) p = p.parent; return p && set.has(p.name) ? p.name : null; };
  // ordre topologique (parent avant enfant) pour composer les rotations
  const order = []; const seen = new Set();
  const visit = (n) => { if (seen.has(n)) return; seen.add(n); const p = parentName(dst, n); if (p) visit(p); order.push(n); };
  names.forEach(visit);

  const worldQ = (o) => o.getWorldQuaternion(new Quaternion());
  const rest = { s: new Map(), t: new Map(), tAligned: new Map() }, wp = new Vector3(), wc = new Vector3();
  for (const n of names) { rest.s.set(n, worldQ(src.get(n))); rest.t.set(n, worldQ(dst.get(n))); }
  const dirOf = (map, a, b) => { map.get(a).getWorldPosition(wp); map.get(b).getWorldPosition(wc); return wc.sub(wp).normalize().clone(); };
  const swing = new Map();
  for (const n of names) {
    const ref = ALIGN[n]; let q = new Quaternion();
    if (ref && !ref.startsWith("@") && src.has(ref) && dst.has(ref)) q = new Quaternion().setFromUnitVectors(dirOf(dst, n, ref), dirOf(src, n, ref));
    swing.set(n, q);
  }
  for (const n of names) { const ref = ALIGN[n]; const s = ref?.startsWith("@") ? swing.get(ref.slice(1)) : swing.get(n); rest.tAligned.set(n, s.clone().multiply(rest.t.get(n))); }
  // rotation monde de repos du parent de chaque os (hors liste : fixe), côté cible
  const parentRestWorld = (n) => { const p = dst.get(n).parent; return p ? worldQ(p) : new Quaternion(); };
  // delta constant par os : monde_cible(t) = monde_source(t) · repos_source⁻¹ · repos_cible_aligné
  const offset = new Map(names.map((n) => [n, rest.s.get(n).clone().invert().multiply(rest.tAligned.get(n))]));

  // pronation : repère de la paume de chaque main (normale, mesurée sur les doigts) et axe de l'avant-bras à la pose de repos alignée
  const palms = ["Left", "Right"].map((side) => {
    const fa = `${side}ForeArm`, hand = `${side}Hand`, mid = dst.get(`${side}HandMiddle1`), thumb = dst.get(`${side}HandThumb1`), pinky = dst.get(`${side}HandPinky1`);
    if (!set.has(fa) || !set.has(hand) || !mid || !thumb || !pinky) return null;
    const o = new Vector3(), f = new Vector3(), a = new Vector3(), p = new Vector3();
    dst.get(hand).getWorldPosition(o); mid.getWorldPosition(f); f.sub(o).normalize(); thumb.getWorldPosition(a); pinky.getWorldPosition(p); a.sub(p).normalize();
    const n = new Vector3().crossVectors(f, a).normalize();
    if (n.x * (side === "Left" ? -1 : 1) < 0) n.negate();                      // la paume regarde vers l'axe du corps au repos (modèle : +X = côté gauche)
    const nAligned = n.clone().applyQuaternion(swing.get(hand)), axis = dirOf(src, fa, hand);      // axe de l'avant-bras à la pose alignée = celui de la source
    return { fa, hand, nAligned, axis };
  }).filter(Boolean);
  const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const DOWN = new Vector3(0, -1, 0), qd = new Quaternion(), qa = new Quaternion(), tmpN = new Vector3(), tmpA = new Vector3(), tmpP = new Vector3(), tmpD = new Vector3();
  /** Tourne l'avant-bras et la main autour de l'axe de l'avant-bras pour que la paume regarde vers le bas quand l'avant-bras est tenu vers l'avant. */
  function pronate(tW) {
    for (const pm of palms) {
      const wf = tW.get(pm.fa), wh = tW.get(pm.hand);
      qd.copy(wf).multiply(rest.tAligned.get(pm.fa).clone().invert()); tmpA.copy(pm.axis).applyQuaternion(qd).normalize();
      qa.copy(wh).multiply(rest.tAligned.get(pm.hand).clone().invert()); tmpN.copy(pm.nAligned).applyQuaternion(qa);
      const weight = smooth(tmpA.z, 0.15, 0.5) * (1 - smooth(Math.abs(tmpA.y), 0.5, 0.8));      // avant-bras tenu vers l'avant et à peu près à l'horizontale
      if (weight <= 0) continue;
      tmpN.addScaledVector(tmpA, -tmpA.dot(tmpN)).normalize(); tmpP.copy(DOWN).addScaledVector(tmpA, -tmpA.dot(DOWN)).normalize();
      const ang = Math.atan2(tmpA.dot(tmpD.crossVectors(tmpN, tmpP)), tmpN.dot(tmpP)) * weight;
      qd.setFromAxisAngle(tmpA, ang); wf.premultiply(qd); wh.premultiply(qd);
    }
  }

  const hips = "Hips";
  const hipsSrc = src.get(hips)?.position.clone(), hipsDst = dst.get(hips)?.position.clone();
  const k = hipsSrc && hipsDst && hipsSrc.y > 0 ? hipsDst.y / hipsSrc.y : 1;      // proportion des hanches (cible / source)

  const out = new Map();
  for (const clip of sourceClips) {
    const rotTr = new Map(), posTr = new Map();
    for (const t of clip.tracks) { const [n, prop] = [t.name.split(".")[0], t.name.split(".")[1]]; if (prop === "quaternion") rotTr.set(n, t); else if (prop === "position" && n === hips) posTr.set(n, t); }
    if (!rotTr.size) continue;
    // Chaque piste a ses propres images clés (les os immobiles n'en ont que deux) : on échantillonne l'ensemble des instants de toutes les pistes,
    // complété par une grille de 24 images/s, pour ne perdre aucun mouvement.
    const ts = new Set();
    for (const t of clip.tracks) for (const x of t.times) ts.add(+x.toFixed(5));
    for (let k = 0; k * 24 <= clip.duration * 24 + 1e-6; k++) ts.add(+Math.min(k / 24, clip.duration).toFixed(5));
    const times = [...ts].sort((x, y) => x - y), N = times.length;
    const interp = new Map([...rotTr].map(([n, t]) => [n, t.createInterpolant()]));
    const parentOf = new Map(names.map((n) => [n, parentName(dst, n)]));
    const srcLocal = (n, ti) => { const it = interp.get(n); if (!it) return src.get(n).quaternion; const r = it.evaluate(times[ti]); return new Quaternion(r[0], r[1], r[2], r[3]); };
    const values = new Map(names.map((n) => [n, new Float32Array(N * 4)]));
    const sW = new Map(), tW = new Map(), q = new Quaternion();
    for (let i = 0; i < N; i++) {
      sW.clear(); tW.clear();
      for (const n of order) {                                                      // passe 1 : rotations monde source puis cible
        const p = parentName(src, n) ?? null, sp = p ? sW.get(p) : worldQ(src.get(n).parent ?? sourceScene);
        const sw = sp.clone().multiply(srcLocal(n, i)); sW.set(n, sw);
        tW.set(n, sw.clone().multiply(offset.get(n)));
      }
      pronate(tW);
      for (const n of order) {                                                      // passe 2 : rotations locales cible
        const tw = tW.get(n), tp = parentOf.get(n), tparent = tp ? tW.get(tp) : parentRestWorld(n);
        q.copy(tparent).invert().multiply(tw).normalize();
        // continuité : même hémisphère que l'image précédente (évite les rotations de 360° à l'interpolation)
        const v = values.get(n);
        if (i > 0 && q.x * v[(i - 1) * 4] + q.y * v[(i - 1) * 4 + 1] + q.z * v[(i - 1) * 4 + 2] + q.w * v[(i - 1) * 4 + 3] < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
        v.set([q.x, q.y, q.z, q.w], i * 4);
      }
    }
    const tracks = names.map((n) => new T.QuaternionKeyframeTrack(`${n}.quaternion`, times, values.get(n)));
    const hp = posTr.get(hips);
    if (hp && hipsSrc && hipsDst) {
      const it = hp.createInterpolant(), v = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { const r = it.evaluate(times[i]); v[i * 3] = hipsDst.x + k * (r[0] - hipsSrc.x); v[i * 3 + 1] = hipsDst.y + k * (r[1] - hipsSrc.y); v[i * 3 + 2] = hipsDst.z + k * (r[2] - hipsSrc.z); }
      tracks.push(new T.VectorKeyframeTrack(`${hips}.position`, times, v));
    }
    out.set(clip.name, new T.AnimationClip(clip.name, clip.duration, tracks));
  }
  return { clips: out, hipsRatio: k, bones: names.length };
}
