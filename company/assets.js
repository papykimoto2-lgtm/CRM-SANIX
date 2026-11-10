// Ressources 3D : personnages humains réalistes et clips d'animation.
//  - Personnages : humains texturés dérivés de MakeHuman (CC0) via Ara 3D Gen, allégés par assets/realistic/tools/optimize.mjs
//    (≈ 1 à 2 Mo chacun, deux niveaux de détail « Corps_LOD0 » / « Corps_LOD1 », textures WebP, taille de référence 1,76 m).
//  - Clips : créés sur le squelette SANIX (animations.glb), recalés au chargement sur le squelette de chaque personnage (retarget.js).
import { retargetClips } from "./retarget.js";

export const CHARACTERS = ["homme_a", "femme_a", "homme_b", "femme_b"];
export const BODY_SCALE = { homme_a: 1.03, femme_a: 0.955, homme_b: 0.985, femme_b: 0.99 };   // tailles relatives (les GLB sont tous remis à 1,76 m)
export const AV_SCALE = 1.17;                           // 1 unité de scène ≈ 0,85 m : personnages ~2,05 unités
export const BASE_WALK = 2.05;                          // vitesse (unités/s) du clip « Walk » à timeScale 1 : évite le glissement des pieds

// Teintes de repli (avatars procéduraux sans ressources GLB) : l'identité d'un collaborateur est déduite de son identifiant.
export const PALETTE = {
  skin: ["#f1c9a5", "#e0ac84", "#c68b64", "#a56b45", "#8c573c", "#6b4226", "#4a2c17"],
  hair: ["#14100e", "#2a1b12", "#3a2a1e", "#5b3a21", "#8a6a3b", "#b8b8b8", "#0b0b0b"],
  top: { homme_a: ["#163b61", "#1f2937", "#263238", "#35415a"], femme_a: ["#22324a", "#5b2a4a", "#2d4a3e", "#3a3f58"], homme_b: ["#d8e4ee", "#cfe0f2", "#e6edf3", "#f1e7d4"], femme_b: ["#1f3550", "#2b2b3a", "#4a2f3d", "#27413a"] },
  bottom: ["#1b2638", "#222831", "#2c3442", "#1d2433"],
};

const BASE = new URL("./assets/characters/", import.meta.url).href;
let cache = null;

/** Matières partagées par tous les avatars d'un même personnage : surcouches transparentes (barbe, maquillage, cils) toujours devant la peau. */
function prepareMaterials(model) {
  const seen = new Set();
  model.traverse((o) => {
    if (o.isSkinnedMesh) o.frustumCulled = false;
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (seen.has(m)) continue; seen.add(m);
      if (m.transparent) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
      if (m.map) m.map.anisotropy = 4;
    }
    o.castShadow = !(Array.isArray(o.material) ? o.material[0] : o.material)?.transparent;   // les surcouches transparentes ne projettent pas d'ombre
    o.receiveShadow = true;
  });
}

/** Charge les modèles et les clips (une seule fois). Rejette si une ressource manque : l'appelant bascule alors sur les avatars procéduraux. */
export function loadAssets(T) {
  if (cache) return cache;
  cache = (async () => {
    const loader = new T.GLTFLoader();
    // La politique de sécurité du site (CSP, vercel.json) n'autorise pas fetch() sur « blob: » : GLTFLoader décode par défaut les textures avec
    // ImageBitmapLoader (donc fetch de blob:), ce qui les ferait toutes échouer. On force le décodage par <img>, couvert par « img-src blob: ».
    loader.register((parser) => { parser.textureLoader = new T.TextureLoader(parser.options.manager); return { name: "SANIX_textures_img" }; });
    const get = (n) => loader.loadAsync(`${BASE}${n}.glb`);
    const [anim, ...chars] = await Promise.all([get("animations"), ...CHARACTERS.map(get)]);
    const clips = new Map(anim.animations.map((c) => [c.name, c]));          // clips d'origine (squelette SANIX)
    const models = new Map(CHARACTERS.map((n, i) => [n, chars[i].scene]));
    const clipsOf = new Map(), report = new Map();                           // clips recalés par personnage
    for (const [n, m] of models) {
      prepareMaterials(m);
      const r = retargetClips(T, anim.scene, anim.animations, m);
      clipsOf.set(n, r.clips); report.set(n, { bones: r.bones, hipsRatio: r.hipsRatio });
    }
    return { clips, clipsOf, models, report };
  })();
  cache.catch(() => { cache = null; });
  return cache;
}
