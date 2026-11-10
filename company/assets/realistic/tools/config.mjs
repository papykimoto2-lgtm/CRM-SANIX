// Constantes communes à optimize.mjs (fabrication) et validate.mjs (contrôle) : le contrôle vérifie ce que la fabrication promet.
export const TARGET_HEIGHT = 1.76;   // mètres : taille de référence des personnages SANIX (le moteur applique ensuite BODY_SCALE)
export const BUDGET = {
  maxBytes: 2.5 * 1024 * 1024,       // poids d'un personnage
  maxTriangles: 38000,               // niveau de détail 0 (personnage proche)
  maxTrianglesLod1: 13000,           // niveau de détail 1 (téléphones, personnage éloigné)
  maxMaterials: 12,                  // matières (≈ appels de dessin) par personnage
  maxTexture: 1024,                  // côté maximal d'une texture, en pixels
};
