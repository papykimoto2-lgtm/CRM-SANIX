"""Génère les personnages et les animations : python build_characters.py [dossier_sortie] [--only=<nom>] [--anim-only] [--quick]
Prérequis : pip install bpy  (Blender 4.2+ / 5.x en module Python : aucun logiciel à installer).

  characters/<nom>.glb       maillage + squelette + accessoires (sans animation)
  characters/animations.glb  squelette + tous les clips (partagés par les personnages : mêmes noms d'os, mêmes orientations de repos)
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import bpy
import numpy  # requis par l'exporteur glTF de Blender
import humanoid as H, animations as A

# Quatre silhouettes ; les teintes (peau, cheveux, couleur de département) sont rappliquées à l'exécution (assets.js).
VARIANTS = [
    dict(name="homme_a", build="homme_a", outfit="suit", hair="short", colors=dict(skin="#8c573c", top="#163b61", hair="#1b1613")),
    dict(name="femme_a", build="femme_a", outfit="blouse", hair="long", tie=False, hem=0.93, colors=dict(skin="#c68b64", top="#22324a", bottom="#1d2433", hair="#2a1b12")),
    dict(name="homme_b", build="homme_b", outfit="shirt", hair="short", beard=True, glasses=True, sleeve=0.45, tie=False, colors=dict(skin="#e0b08a", top="#d8e4ee", bottom="#2c3442", hair="#3a2a1e")),
    dict(name="femme_b", build="femme_b", outfit="suit", hair="bun", tie=False, colors=dict(skin="#6b4226", top="#1f3550", bottom="#19202d", hair="#120d0b")),
]

def export(path, animations):
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_animations=animations, export_animation_mode="NLA_TRACKS",
                              export_optimize_animation_size=True, export_image_format="NONE", export_apply=False, export_yup=True, export_skins=True, export_vertex_color="ACTIVE")
    if not os.path.isfile(path) or os.path.getsize(path) < 1024:
        raise RuntimeError("Export GLB échoué ou fichier incomplet : " + path)

def build_character(v, out):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ob, arm, b, G = H.build_character(v); H.add_props(arm, b, G, v["name"])
    path = os.path.join(out, v["name"] + ".glb"); export(path, False)
    print("OK", v["name"], os.path.getsize(path) // 1024, "Ko", "triangles", sum(len(p.vertices) - 2 for p in ob.data.polygons))

def build_animations(out, quick=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    b = H.BUILDS["homme_a"]; skin, G = H.build_skin(b); bpy.data.meshes.remove(skin)
    arm = H.build_armature(b, G)
    A.bake_all(arm, 1.0, names=(["Walk", "Sit_typing", "Sit_idle", "Stand_idle", "Sit_headset", "Stand_talk"] if quick else None))
    path = os.path.join(out, "animations.glb"); export(path, True)
    print("OK animations", os.path.getsize(path) // 1024, "Ko,", len(bpy.data.actions), "clips")

if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    out = next((a for a in args if not a.startswith("--")), os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "characters"))
    only = next((a.split("=")[1] for a in args if a.startswith("--only=")), None)
    os.makedirs(out, exist_ok=True)
    if "--anim-only" not in args:
        for v in VARIANTS:
            if not only or v["name"] == only: build_character(v, out)
    if not only or "--anim-only" in args: build_animations(out, "--quick" in args)
