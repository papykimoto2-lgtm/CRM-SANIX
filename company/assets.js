// Ressources 3D : personnages GLB (générés avec Blender, voir assets/blender/) et clips d'animation partagés.
// Les clips (animations.glb) s'appliquent à tous les personnages : mêmes noms d'os, mêmes orientations de repos.
export const CHARACTERS = ["homme_a", "femme_a", "homme_b", "femme_b"];
export const BODY_SCALE = { homme_a: 1.03, femme_a: 0.955, homme_b: 0.985, femme_b: 0.99 };   // tailles relatives (les GLB sont exportés à 1,76 m)
export const AV_SCALE = 1.17;                           // 1 unité de scène ≈ 0,85 m : personnages ~2,05 unités
export const BASE_WALK = 2.05;                          // vitesse (unités/s) du clip « Walk » à timeScale 1 : évite le glissement des pieds

// Teintes : l'identité d'un collaborateur (peau, cheveux, tenue) est déduite de son identifiant ; le département colore cravate / badge / chemise.
export const PALETTE = {
  skin: ["#f1c9a5", "#e0ac84", "#c68b64", "#a56b45", "#8c573c", "#6b4226", "#4a2c17"],
  hair: ["#14100e", "#2a1b12", "#3a2a1e", "#5b3a21", "#8a6a3b", "#b8b8b8", "#0b0b0b"],
  top: { homme_a: ["#163b61", "#1f2937", "#263238", "#35415a"], femme_a: ["#22324a", "#5b2a4a", "#2d4a3e", "#3a3f58"], homme_b: ["#d8e4ee", "#cfe0f2", "#e6edf3", "#f1e7d4"], femme_b: ["#1f3550", "#2b2b3a", "#4a2f3d", "#27413a"] },
  bottom: ["#1b2638", "#222831", "#2c3442", "#1d2433"],
};

const BASE = new URL("./assets/characters/", import.meta.url).href;
let cache = null;

/** Charge les modèles et les clips (une seule fois). Rejette si une ressource manque : l'appelant bascule alors sur les avatars procéduraux. */
export function loadAssets(T) {
  if (cache) return cache;
  cache = (async () => {
    const loader = new T.GLTFLoader();
    const get = (n) => loader.loadAsync(`${BASE}${n}.glb`);
    const [anim, ...chars] = await Promise.all([get("animations"), ...CHARACTERS.map(get)]);
    const clips = new Map(anim.animations.map((c) => [c.name, c]));
    const models = new Map(CHARACTERS.map((n, i) => [n, chars[i].scene]));
    for (const m of models.values()) m.traverse((o) => { if (o.isSkinnedMesh) { o.frustumCulled = false; } if (o.name.startsWith("Prop_")) o.visible = false; });
    return { clips, models };
  })();
  cache.catch(() => { cache = null; });
  return cache;
}
