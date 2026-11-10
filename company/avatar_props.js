// SANIX AI VIRTUAL COMPANY — accessoires des avatars humains GLB : objets tenus (téléphone, document, tasse, chemise cartonnée)
// et badge de département porté sur la poitrine. Les humains réalistes n'embarquent aucun accessoire : ils sont créés ici, une fois
// par avatar, et rattachés aux os de la main ou du torse (ils suivent donc l'animation).
//
// Chaque accessoire est placé dans un repère de MAIN mesuré sur le squelette de CE personnage (poignet → base du majeur = « avant »,
// auriculaire → pouce = « travers », produit vectoriel = « normale de la paume »), pas dans le repère local des os, qui diffère d'un rig à l'autre.

const PROP_NAMES = ["Prop_Phone", "Prop_Doc", "Prop_Cup", "Prop_Folder", "Prop_Headset"];

export function makeCarried(env, model, deptColor) {
  const { THREE: T } = env;
  const bone = (n) => model.getObjectByName(n);
  const own = new Set(), props = Object.fromEntries(PROP_NAMES.map((n) => [n, null]));
  model.updateWorldMatrix(true, true);                          // parents compris : sinon les positions mesurées et la matrice du modèle ne partagent pas la même échelle
  const toLocal = new T.Matrix4().copy(model.matrixWorld).invert();
  const at = (b) => b.getWorldPosition(new T.Vector3()).applyMatrix4(toLocal);          // position d'un os dans le repère du modèle (1 unité = 1 m à 1,76 m)

  /** Repère de la main, DIRECT (X × Y = Z) : origine au poignet, Y = avant (poignet → base du majeur), Z = normale de la paume (côté où l'on tient un objet), X = travers. */
  function handFrame(side) {
    const hand = bone(`${side}Hand`), mid = bone(`${side}HandMiddle1`), thumb = bone(`${side}HandThumb1`), pinky = bone(`${side}HandPinky1`);
    if (!hand || !mid || !thumb || !pinky) return null;
    const o = at(hand), f = at(mid).sub(o).normalize(), across = at(thumb).sub(at(pinky)).normalize();
    const n = new T.Vector3().crossVectors(f, across).normalize();
    if (n.x * (side === "Left" ? -1 : 1) < 0) n.negate();                                  // la paume regarde vers l'axe du corps au repos (modèle : +X = côté gauche)
    const a = new T.Vector3().crossVectors(f, n).normalize();                              // X = Y × Z
    return { bone: hand, o, f, a, n, side };
  }
  const mat = (key, make) => env.mats(key, make);
  const geo = (key, make) => env.geos(key, make);
  const std = (c, o = {}) => mat(`ap${c}${JSON.stringify(o)}`, () => new T.MeshStandardMaterial({ color: c, roughness: 0.55, ...o }));

  /** Pose `obj` à (avant, travers, normale) du repère `fr` avec une rotation locale supplémentaire, puis le rattache à l'os (le monde ne bouge pas). */
  function mount(obj, fr, [pf, pa, pn], [rx, ry, rz] = [0, 0, 0]) {
    const basis = new T.Matrix4().makeBasis(fr.a, fr.f, fr.n);                             // X = travers, Y = avant, Z = normale
    obj.quaternion.setFromRotationMatrix(basis).multiply(new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz)));
    obj.position.copy(fr.o).addScaledVector(fr.f, pf).addScaledVector(fr.a, pa).addScaledVector(fr.n, pn);
    model.add(obj); model.updateWorldMatrix(true, true); fr.bone.attach(obj);
    obj.traverse((m) => { if (m.isMesh) { m.castShadow = true; own.add(m); } }); own.add(obj);
    obj.visible = false;
    return obj;
  }
  const part = (g, m, x = 0, y = 0, z = 0) => { const k = new T.Mesh(g, m); k.position.set(x, y, z); return k; };

  const right = handFrame("Right"), left = handFrame("Left");
  if (right) {
    const phone = new T.Group(); phone.name = "Prop_Phone";
    phone.add(part(geo("ap_phone", () => new T.BoxGeometry(0.072, 0.147, 0.009)), std(0x0b1220, { roughness: 0.3, metalness: 0.4 })));
    phone.add(part(geo("ap_screen", () => new T.PlaneGeometry(0.064, 0.133)), mat("ap_screenm", () => new T.MeshStandardMaterial({ color: 0x0b1220, emissive: 0x1d4ed8, emissiveIntensity: 0.55 })), 0, 0, 0.0047));
    props.Prop_Phone = mount(phone, right, [0.075, 0, 0.03], [0, 0, 0]);
    const cup = new T.Group(); cup.name = "Prop_Cup";
    cup.add(part(geo("ap_cup", () => new T.CylinderGeometry(0.036, 0.028, 0.09, 18)), std(0xf8fafc, { roughness: 0.35 })));
    const coffee = part(geo("ap_coffee", () => new T.CircleGeometry(0.032, 18)), std(0x3b2417, { roughness: 0.4 }), 0, 0.0452, 0); coffee.rotation.x = -Math.PI / 2; cup.add(coffee);
    props.Prop_Cup = mount(cup, right, [0.06, 0, 0.04], [0, 0, Math.PI / 2]);
    const folder = new T.Group(); folder.name = "Prop_Folder";
    folder.add(part(geo("ap_folder", () => new T.BoxGeometry(0.24, 0.32, 0.014)), std(deptColor, { roughness: 0.6 })));
    folder.add(part(geo("ap_sheets", () => new T.BoxGeometry(0.225, 0.305, 0.012)), std(0xf3f4f6, { roughness: 0.9 }), 0, 0.004, 0.003));
    props.Prop_Folder = mount(folder, right, [0.12, 0, 0.03], [0, 0, 0]);
  }
  if (left) {
    const doc = new T.Group(); doc.name = "Prop_Doc";
    doc.add(part(geo("ap_doc", () => new T.BoxGeometry(0.21, 0.297, 0.003)), std(0xf3f4f6, { roughness: 0.9 })));
    doc.add(part(geo("ap_docl", () => new T.PlaneGeometry(0.17, 0.22)), mat("ap_docm", () => new T.MeshBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.55 })), 0, 0.01, 0.0017));
    props.Prop_Doc = mount(doc, left, [0.11, 0, 0.035], [0, 0, 0]);
  }

  // badge de département : cordon en V + carte portée sur le sternum (couleur du département : repère visuel d'équipe, sans effet de jeu)
  const spine = bone("Spine2"), neck = bone("Neck");
  let badge = null;
  if (spine && neck) {
    const sp = at(spine), nk = at(neck), y = sp.y + (nk.y - sp.y) * 0.05 - 0.05, zFront = sp.z + 0.145;
    badge = new T.Group(); badge.name = "Badge";
    const cord = std(deptColor, { roughness: 0.7 }), card = std(0xf8fafc, { roughness: 0.5 });
    for (const s of [-1, 1]) { const c = part(geo("ap_cord", () => new T.BoxGeometry(0.012, 0.17, 0.003)), cord, s * 0.045, 0.085, 0); c.rotation.z = s * -0.5; badge.add(c); }
    badge.add(part(geo("ap_card", () => new T.BoxGeometry(0.056, 0.08, 0.004)), card, 0, -0.01, 0.0005));
    badge.add(part(geo("ap_cardband", () => new T.BoxGeometry(0.056, 0.02, 0.0055)), cord, 0, 0.022, 0.0005));
    badge.position.set(sp.x, y, zFront); badge.rotation.x = -0.06;
    model.add(badge); model.updateWorldMatrix(true, true); spine.attach(badge);
    badge.traverse((m) => { if (m.isMesh) own.add(m); }); own.add(badge);
  }
  const qp = new T.Quaternion();
  return {
    props, badge, owns: (o) => own.has(o),
    /** Garde un objet à la verticale du monde (tasse) quelle que soit l'orientation de la main qui le porte. */
    keepUpright(obj) { obj.parent.getWorldQuaternion(qp); obj.quaternion.copy(qp.invert()); },
    dispose() { /* géométries et matières mises en cache par l'environnement du bureau */ },
  };
}
