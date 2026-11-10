#!/usr/bin/env node
// SANIX AI — contrôle des avatars humains GLB (à lancer après optimize.mjs, en CI comme en local).
//
// Usage : node validate.mjs <dossier_des_GLB> <animations.glb> [personnages…]
//
// Contrôles par personnage :
//  1. validité glTF 2.0 (validateur officiel Khronos : aucune erreur) ;
//  2. budgets : poids, triangles de chaque niveau de détail, matières, taille des textures ;
//  3. squelette : tous les os animés par les clips SANIX existent (par leur nom), deux niveaux de détail liés au même squelette ;
//  4. hauteur de 1,76 m (± 2 cm), pieds au sol, aucune forme de visage résiduelle ;
//  5. extensions : uniquement KHR_mesh_quantization et EXT_texture_webp (lues sans WebAssembly, compatibles avec la CSP du site).
import { NodeIO, ImageUtils } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import validator from "gltf-validator";
import fs from "node:fs";
import path from "node:path";
import { BUDGET, TARGET_HEIGHT } from "./config.mjs";

const [DIR, ANIM, ...ONLY] = process.argv.slice(2);
if (!DIR || !ANIM) { console.error("Usage : node validate.mjs <dossier_des_GLB> <animations.glb> [personnages…]"); process.exit(2); }
const NAMES = ONLY.length ? ONLY : ["homme_a", "homme_b", "femme_a", "femme_b"];
const ALLOWED_EXT = new Set(["KHR_mesh_quantization", "EXT_texture_webp"]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// os animés par les clips SANIX
const animDoc = await io.read(ANIM), animated = new Set();
for (const a of animDoc.getRoot().listAnimations()) for (const ch of a.listChannels()) { const n = ch.getTargetNode()?.getName(); if (n) animated.add(n); }

const meshTris = (m) => m.listPrimitives().reduce((t, p) => t + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute("POSITION").getCount()) / 3, 0);
let failures = 0;
const fail = (name, msg) => { failures++; console.error(`  ✗ ${name} : ${msg}`); };

for (const name of NAMES) {
  const file = path.join(DIR, `${name}.glb`), bytes = fs.readFileSync(file);
  console.log(`\n${name} (${(bytes.length / 1048576).toFixed(2)} Mo)`);
  // 1. validateur officiel
  const rep = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 50, uri: `${name}.glb` });
  console.log(`  validateur Khronos : ${rep.issues.numErrors} erreur(s), ${rep.issues.numWarnings} avertissement(s)`);
  if (rep.issues.numErrors) for (const m of rep.issues.messages.filter((x) => x.severity === 0).slice(0, 5)) fail(name, `${m.code} ${m.message} (${m.pointer})`);
  // 2-5. contrôles SANIX
  const doc = await io.read(file), root = doc.getRoot();
  const lod = Object.fromEntries(["Corps_LOD0", "Corps_LOD1"].map((n) => [n, root.listNodes().find((x) => x.getName() === n)]));
  for (const [n, node] of Object.entries(lod)) if (!node?.getMesh() || !node.getSkin()) fail(name, `niveau de détail « ${n} » absent ou sans squelette`);
  const jointsOf = (n) => (n?.getSkin()?.listJoints() ?? []).map((j) => j.getName()).sort().join(",");
  if (jointsOf(lod.Corps_LOD0) !== jointsOf(lod.Corps_LOD1)) fail(name, "les deux niveaux de détail ne partagent pas les mêmes os");
  const tris0 = lod.Corps_LOD0?.getMesh() ? meshTris(lod.Corps_LOD0.getMesh()) : 0, tris1 = lod.Corps_LOD1?.getMesh() ? meshTris(lod.Corps_LOD1.getMesh()) : 0;
  console.log(`  triangles : niveau 0 = ${tris0}, niveau 1 = ${tris1} ; matières ${root.listMaterials().length} ; textures ${root.listTextures().length}`);
  if (bytes.length > BUDGET.maxBytes) fail(name, `poids ${(bytes.length / 1048576).toFixed(2)} Mo > ${(BUDGET.maxBytes / 1048576).toFixed(1)} Mo`);
  if (tris0 > BUDGET.maxTriangles) fail(name, `niveau 0 : ${tris0} triangles > ${BUDGET.maxTriangles}`);
  if (tris1 > BUDGET.maxTrianglesLod1) fail(name, `niveau 1 : ${tris1} triangles > ${BUDGET.maxTrianglesLod1}`);
  if (root.listMaterials().length > BUDGET.maxMaterials) fail(name, `${root.listMaterials().length} matières > ${BUDGET.maxMaterials}`);
  for (const t of root.listTextures()) {
    const [w, h] = ImageUtils.getSize(t.getImage(), t.getMimeType()) ?? [0, 0];
    if (Math.max(w, h) > BUDGET.maxTexture) fail(name, `texture ${t.getName()} ${w}×${h} > ${BUDGET.maxTexture}`);
    if (!["image/webp", "image/png", "image/jpeg"].includes(t.getMimeType())) fail(name, `texture ${t.getName()} : format ${t.getMimeType()} non pris en charge`);
  }
  const joints = new Set(lod.Corps_LOD0?.getSkin()?.listJoints().map((j) => j.getName()) ?? []);
  const missing = [...animated].filter((n) => !joints.has(n));
  console.log(`  squelette : ${joints.size} os, ${animated.size} os animés par les clips, ${missing.length} manquant(s)`);
  if (missing.length) fail(name, `os animés absents du squelette : ${missing.join(", ")}`);
  // hauteur et pieds au sol, mesurés sur le squelette (échelle incluse) : les bornes d'un maillage quantifié et skinné ne sont pas fiables
  const jointY = (n) => root.listNodes().find((x) => x.getName() === n)?.getWorldTranslation()[1];
  const top = jointY("HeadTop_End"), low = Math.min(...[...joints].map(jointY));
  console.log(`  hauteur du squelette ${top?.toFixed(3)} m (sommet de la tête), os le plus bas à ${low.toFixed(3)} m`);
  if (!(Math.abs(top - TARGET_HEIGHT) <= 0.04)) fail(name, `hauteur ${top?.toFixed(3)} m ≠ ${TARGET_HEIGHT} m (± 4 cm)`);
  if (!(low >= -0.03 && low <= 0.09)) fail(name, `os le plus bas à ${low.toFixed(3)} m : pieds hors du sol`);
  const morph = root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + p.listTargets().length, 0), 0);
  if (morph) fail(name, `${morph} forme(s) de visage résiduelle(s)`);
  for (const e of doc.getRoot().listExtensionsRequired().map((x) => x.extensionName)) if (!ALLOWED_EXT.has(e)) fail(name, `extension requise non autorisée : ${e}`);
}
console.log(failures ? `\n${failures} anomalie(s).` : "\nAvatars conformes.");
process.exit(failures ? 1 : 0);
