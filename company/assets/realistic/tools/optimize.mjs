#!/usr/bin/env node
// SANIX AI — allègement des avatars humains générés (MakeHuman via Ara 3D Gen) pour le web et le mobile.
//
// Entrée  : GLB « bruts » du générateur (≈ 13 Mo, 150 000 triangles, 34 formes de visage, textures 2048).
// Sortie  : GLB prêts pour le bureau 3D (≈ 1 à 2 Mo, ≈ 25 000 triangles, textures WebP ≤ 1024), à la taille de référence de 1,76 m.
//
// Usage   : node optimize.mjs <dossier_bruts> <dossier_sortie> [homme_a homme_b …]
// Outils  : @gltf-transform/{core,extensions,functions}, meshoptimizer, sharp (versions épinglées dans tools/package.json).
//
// Choix de conception (voir README) :
//  - formes de visage (morph targets) supprimées : le bureau ne les anime pas, elles pesaient plus que le reste du maillage ;
//  - dents et langue supprimées : bouche fermée, invisibles à toute distance de la caméra du bureau ;
//  - maillage simplifié sans fissure entre pièces (bords verrouillés) ; géométrie quantifiée sans décodeur côté navigateur ;
//  - textures en WebP (décodage natif des navigateurs, aucune extension de sécurité nécessaire) et taille réduite selon leur rôle ;
//  - personnage remis à 1,76 m par un noeud d'échelle (le moteur applique ensuite les morphologies relatives BODY_SCALE) ;
//  - aucune compression Meshopt/Draco/KTX2 : elles exigent du WebAssembly côté navigateur, que la politique de sécurité du site (CSP) interdit.
import { NodeIO, Primitive } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, getBounds, palette, prune, quantize, simplifyPrimitive, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { BUDGET, TARGET_HEIGHT } from "./config.mjs";
import fs from "node:fs";
import path from "node:path";

const [SRC, OUT, ...ONLY] = process.argv.slice(2);
if (!SRC || !OUT) { console.error("Usage : node optimize.mjs <dossier_bruts> <dossier_sortie> [personnages…]"); process.exit(2); }
const NAMES = ONLY.length ? ONLY : ["homme_a", "homme_b", "femme_a", "femme_b"];

// part de triangles conservée selon la pièce (nom du matériau) et erreur tolérée (fraction du rayon de la pièce) :
// grandes surfaces lisses (veste, peau) réduites fortement ; yeux, sourcils, cils et petits détails laissés intacts.
const SIMPLIFY_RULES = [
  [/^(eyes|eyebrows|eyelashes)$/i, { ratio: 1 }],
  [/^skin details$/i, { ratio: 0.35, error: 0.0012 }],   // surcouche (barbe, maquillage) posée sur la peau : doit rester proche d'elle, sinon des plaques de peau claire apparaissent
  [/^skin$/i, { ratio: 0.17, error: 0.002 }],
  [/jacket|blazer/i, { ratio: 0.12, error: 0.006 }],
  [/hair|buzz|braid|cornrow|afro|locs|twist|bob|bun/i, { ratio: 0.15, error: 0.006, lockBorder: false }],   // mèches : surfaces ouvertes, rien ne se simplifie si les bords sont verrouillés
  [/./, { ratio: 0.25, error: 0.004 }],
];
// peau visible : tête, cou, mains et doigts. Le reste du corps de peau (torse, bras, jambes, pieds) est caché par les vêtements :
// ses triangles sont supprimés (≈ 70 % de la peau) au profit du visage et des mains, seules zones vues de près.
const VISIBLE_SKIN = /^(Neck|Head|HeadTop_End|Jaw|LeftEye|RightEye|(Left|Right)Hand.*)$/;
const rule = (name) => SIMPLIFY_RULES.find(([re]) => re.test(name))[1];
// second niveau de détail (téléphones, personnages éloignés) : même squelette, mêmes matières et textures, ≈ 8 000 triangles ;
// surcouches de peau (barbe, maquillage), cils et dos de chemise supprimés.
const LOD1_RULES = [
  [/^(eyelashes|shirt backing)$/i, null],
  [/^skin details$/i, { ratio: 0.1, error: 0.004 }],
  [/^eyes$/i, { ratio: 0.3, error: 0.01 }],
  [/^eyebrows$/i, { ratio: 1 }],
  [/^skin$/i, { ratio: 0.05, error: 0.004 }],
  [/jacket|blazer/i, { ratio: 0.03, error: 0.015 }],
  [/hair|buzz|braid|cornrow|afro|locs|twist|bob|bun/i, { ratio: 0.1, error: 0.012, lockBorder: false }],
  [/./, { ratio: 0.12, error: 0.01 }],
];
const lod1Rule = (name) => LOD1_RULES.find(([re]) => re.test(name))[1];
const DROP_MATERIALS = /^(teeth|tongue)$/i;                          // pièces invisibles (bouche fermée)
// taille maximale des textures selon leur rôle (nom du fichier source) ; ordre = priorité
const TEXTURE_RULES = [
  [/eyes|eyebrow|eyelash/i, 256],
  [/_n\.|normal/i, 512],
  [/^gen_|outfit|look_|roughness/i, 512],
  [/skin_|hair/i, 1024],
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const mb = (n) => (n / 1048576).toFixed(2);

const meshTriangles = (m) => m.listPrimitives().reduce((t, p) => t + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute("POSITION").getCount()) / 3, 0);
const triangles = (doc, only) => doc.getRoot().listNodes().filter((n) => n.getMesh() && (!only || n.getName() === only)).reduce((t, n) => t + meshTriangles(n.getMesh()), 0);
const height = (doc) => { const b = getBounds(doc.getRoot().listScenes()[0]); return b.max[1] - b.min[1]; };

/** Décale une surcouche (barbe, maquillage) de quelques millimètres vers l'extérieur : après simplification la peau peut la recouvrir par endroits. */
function liftOverlay(prim, metres) {
  const pos = prim.getAttribute("POSITION"), nrm = prim.getAttribute("NORMAL");
  if (!pos || !nrm || pos.listParents().filter((p) => p instanceof Primitive).length > 1) return;   // accesseur partagé : on n'y touche pas
  const p = [], n = [];
  for (let v = 0; v < pos.getCount(); v++) { pos.getElement(v, p); nrm.getElement(v, n); pos.setElement(v, [p[0] + n[0] * metres, p[1] + n[1] * metres, p[2] + n[2] * metres]); }
}

/** Supprime les triangles de peau dont aucun sommet n'est dominé par une articulation visible, ni situé au-dessus du milieu du buste (décolleté, épaules). */
function cullHiddenSkin(doc, prim, jointNames, yCut) {
  const J = prim.getAttribute("JOINTS_0"), W = prim.getAttribute("WEIGHTS_0"), P = prim.getAttribute("POSITION"), idx = prim.getIndices().getArray();
  const visible = new Uint8Array(J.getCount()), jv = [], wv = [], pv = [];
  for (let v = 0; v < visible.length; v++) {
    J.getElement(v, jv); W.getElement(v, wv); P.getElement(v, pv);
    let best = 0; for (let k = 1; k < 4; k++) if (wv[k] > wv[best]) best = k;
    visible[v] = VISIBLE_SKIN.test(jointNames[jv[best]] ?? "") || pv[1] > yCut ? 1 : 0;
  }
  const kept = [];
  for (let i = 0; i < idx.length; i += 3) if (visible[idx[i]] || visible[idx[i + 1]] || visible[idx[i + 2]]) kept.push(idx[i], idx[i + 1], idx[i + 2]);
  const acc = doc.createAccessor("indices_peau_visible").setType("SCALAR").setArray(new Uint32Array(kept)).setBuffer(prim.getIndices().getBuffer());
  const before = idx.length / 3; prim.setIndices(acc);
  return { before, after: kept.length / 3 };
}

async function optimize(name) {
  const input = path.join(SRC, `${name}.glb`), output = path.join(OUT, `${name}.glb`);
  const doc = await io.read(input);
  const before = { bytes: fs.statSync(input).size, tris: triangles(doc), h: height(doc) };
  const root = doc.getRoot();

  // 1. formes de visage inutilisées
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) for (const t of prim.listTargets()) { prim.removeTarget(t); t.dispose(); }
    mesh.setWeights([]);
    const ex = mesh.getExtras(); if (ex && "targetNames" in ex) { delete ex.targetNames; mesh.setExtras(ex); }
  }
  // 2. pièces invisibles (dents, langue)
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) if (DROP_MATERIALS.test(prim.getMaterial()?.getName() ?? "")) { mesh.removePrimitive(prim); prim.dispose(); }
  // 3. maillage : soudure puis simplification par pièce (avant « dedup » : veste et pantalon partagent la même matière et ne seraient plus distinguables)
  await MeshoptSimplifier.ready;
  await doc.transform(weld());
  const body = root.listNodes().find((n) => n.getMesh() && n.getSkin());
  const jointNames = body.getSkin().listJoints().map((j) => j.getName());
  const chestY = root.listNodes().find((n) => n.getName() === "Spine1")?.getWorldTranslation()[1] ?? 0;    // milieu du buste (échelle d'origine)
  for (const prim of body.getMesh().listPrimitives()) if (/^skin$/i.test(prim.getMaterial()?.getName() ?? "")) cullHiddenSkin(doc, prim, jointNames, chestY - 0.03);
  const lod0 = body.getMesh(), lod1 = doc.createMesh("Corps_LOD1");
  for (const prim of lod0.listPrimitives()) {
    const r = lod1Rule(prim.getMaterial()?.getName() ?? ""); if (!r) continue;
    const c = prim.clone(); lod1.addPrimitive(c);
    if (r.ratio < 1) simplifyPrimitive(c, { simplifier: MeshoptSimplifier, ratio: r.ratio, error: r.error, lockBorder: r.lockBorder ?? true });
  }
  body.setName("Corps_LOD0");
  const bodyLite = doc.createNode("Corps_LOD1").setMesh(lod1).setSkin(body.getSkin());
  root.listScenes()[0].addChild(bodyLite);
  for (const mesh of [lod0]) for (const prim of mesh.listPrimitives()) {
    const { ratio, error = 0.004, lockBorder = true } = rule(prim.getMaterial()?.getName() ?? "");
    if (ratio < 1) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error, lockBorder });
  }
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) if (/^skin details$/i.test(prim.getMaterial()?.getName() ?? "")) liftOverlay(prim, 0.003);
  await doc.transform(dedup(), prune(), palette({ min: 2 }));      // matières unies (boutons, lacets, semelles…) fusionnées en une seule
  // 4. textures : taille selon le rôle, WebP
  const done = new Set();
  for (const [pattern, size] of TEXTURE_RULES) {
    const names = root.listTextures().filter((t) => !done.has(t) && pattern.test(t.getName() || t.getURI()));
    if (!names.length) continue;
    names.forEach((t) => done.add(t));
    const only = new RegExp("^(" + names.map((t) => (t.getName() || t.getURI()).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")$");
    await doc.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [size, size], quality: size <= 256 ? 90 : 82, pattern: only }));
  }
  // 5. échelle : hauteur mesurée avant la quantification (celle-ci ajoute des matrices qui fausseraient les bornes)
  const scene = root.listScenes()[0], native = height(doc), s = TARGET_HEIGHT / native;
  // 6. géométrie quantifiée (lue nativement par three.js)
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }), prune());
  // 7. remise à 1,76 m (noeud d'échelle englobant, sans toucher au squelette ni aux matrices de liaison)
  const wrap = doc.createNode("SANIX_echelle").setScale([s, s, s]);
  for (const c of scene.listChildren()) { scene.removeChild(c); wrap.addChild(c); }
  scene.addChild(wrap);
  root.getAsset().generator = "SANIX AI optimize.mjs (source : Ara 3D Gen, données MakeHuman CC0)";
  fs.mkdirSync(OUT, { recursive: true });
  await io.write(output, doc);
  const after = { bytes: fs.statSync(output).size, tris: triangles(doc, "Corps_LOD0"), lod1: triangles(doc, "Corps_LOD1"), materials: root.listMaterials().length, textures: root.listTextures().length, h: native * s };
  return { name, before, after, scale: s };
}

const rows = [];
for (const n of NAMES) {
  const r = await optimize(n); rows.push(r);
  console.log(`${n.padEnd(8)} ${mb(r.before.bytes).padStart(6)} Mo → ${mb(r.after.bytes).padStart(5)} Mo | ${String(r.before.tris).padStart(6)} → ${String(r.after.tris).padStart(6)} triangles (+ ${r.after.lod1} niveau 2) | ${r.after.materials} matériaux, ${r.after.textures} textures | hauteur ${r.before.h.toFixed(2)} → ${r.after.h.toFixed(2)} m (échelle ${r.scale.toFixed(4)})`);
}
const bad = rows.flatMap((r) => [r.after.bytes > BUDGET.maxBytes && `${r.name} : ${mb(r.after.bytes)} Mo > ${mb(BUDGET.maxBytes)} Mo`, r.after.tris > BUDGET.maxTriangles && `${r.name} : ${r.after.tris} triangles > ${BUDGET.maxTriangles}`, r.after.lod1 > BUDGET.maxTrianglesLod1 && `${r.name} : niveau 2 ${r.after.lod1} triangles > ${BUDGET.maxTrianglesLod1}`, r.after.materials > BUDGET.maxMaterials && `${r.name} : ${r.after.materials} matériaux > ${BUDGET.maxMaterials}`]).filter(Boolean);
if (bad.length) { console.error("BUDGET DÉPASSÉ :\n  " + bad.join("\n  ")); process.exit(1); }
console.log("Budget respecté (poids, triangles, matériaux).");
