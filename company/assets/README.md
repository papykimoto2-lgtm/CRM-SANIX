# Ressources 3D de SANIX AI VIRTUAL COMPANY

Personnages de production : **humains réalistes texturés** (MakeHuman CC0 via Ara 3D Gen, allégés par `realistic/tools/optimize.mjs`) : voir [`realistic/README.md`](realistic/README.md).
Les scripts Blender ci-dessous construisent la **silhouette procédurale** d'origine ; elle reste la référence des clips (`animations.glb`) et le repli hors ligne (`avatar.js`).
Chaîne : **GLB → Three.js**. Rien n'est téléchargé à l'exécution : les modèles et le moteur 3D sont servis par le site.

| Fichier | Contenu |
|---|---|
| `characters/homme_a.glb`, `femme_a.glb`, `homme_b.glb`, `femme_b.glb` | 4 humains réalistes (1 à 2 Mo, deux niveaux de détail 27–38 k / 10–13 k triangles, 69 os, textures WebP, 1,76 m) |
| `characters/animations.glb` | 27 clips SANIX (30 i/s, boucles), recalés au chargement sur chaque squelette (`../retarget.js`) |
| `realistic/` | profils des quatre humains, outils de fabrication et de contrôle, documentation |
| `blender/humanoid.py` | Génération d'un personnage : corps (modificateur Skin + Subdivision), vêtements par zones, visage, cheveux, squelette, poids de peau, accessoires |
| `blender/animations.py` | Clips écrits en rotations « monde », convertis en rotations d'os (indépendant du roulis des os) |
| `blender/build_characters.py` | Construit et exporte tout (`python build_characters.py`) |
| `../vendor/three.bundle.js` | Three.js 0.170 + GLTFLoader, SkeletonUtils, RoomEnvironment, RoundedBoxGeometry (`../tools/build-vendor.sh`) |

## Régénérer les modèles

Humains réalistes : workflow manuel « Construire les avatars humains SANIX » (voir `realistic/README.md`). Silhouettes procédurales (Blender) :

```bash
python -m venv .venv && . .venv/bin/activate
pip install bpy            # Blender en module Python (aucune installation de Blender) ; Python 3.11 (bpy 4.5/5.0) ou 3.13 (bpy 5.1+)
python company/assets/blender/build_characters.py             # tout
python company/assets/blender/build_characters.py --only=femme_a   # un personnage
python company/assets/blender/build_characters.py --anim-only      # clips seulement
```

Le résultat s'ouvre aussi dans Blender (import glTF) pour retouche manuelle.

## Conventions

* **Squelette** : noms Mixamo sans préfixe (`Hips`, `Spine`…`Spine2`, `Neck`, `Head`, `LeftShoulder`, `LeftArm`, `LeftForeArm`, `LeftHand`, `LeftUpLeg`, `LeftLeg`, `LeftFoot`, `LeftToeBase`, et `Right…`). Repos en A-pose, personnage tourné vers +Z après export.
* **Matériaux** `<personnage>_<emplacement>` : `skin`, `top`, `bottom`, `shoes`, `hair`, `eye`, `dark`, `shirt`, `accent`. À l'exécution (`avatar_glb.js`) : peau, cheveux, haut, bas déduits de l'identifiant de l'agent ; `accent` (cravate, badge, chemise cartonnée) = couleur du département.
* **Accessoires** : nœuds `Prop_Phone`, `Prop_Doc`, `Prop_Cup`, `Prop_Folder`, `Prop_Headset`, enfants des os de la main / de la tête, masqués par défaut et affichés selon l'activité. Les humains réalistes n'en embarquent pas : `avatar_props.js` les crée au chargement (et un badge de département).
* **Clips** : `Walk`, `Sit_<mouvement>`, `Stand_<mouvement>`. Mouvements : `idle`, `screen`, `multiscreen`, `documents`, `typing`, `terminal`, `headset`, `talk`, `present`, `meeting`, `speak`, `celebrate`, `alert`, `pause`, `relax` (+ `watch`, `handover` debout).

| Activité publiée par le moteur | Animation | Clip (assis / debout) | Accessoire |
|---|---|---|---|
| recherche de prospects / web | `screen` | `Sit_screen` | — |
| analyse de données | `multiscreen` | `Sit_multiscreen` | écrans supplémentaires |
| rédaction d'e-mail | `typing` | `Sit_typing` | — |
| conversation WhatsApp | `terminal` | `Sit_terminal` | téléphone |
| appel | `headset` | `Sit_headset` | téléphone à l'oreille |
| négociation, collaboration, département | `talk` | `Sit_talk` / `Stand_talk` | — |
| organisation des équipes | `present` | `Sit_present` | — |
| préparation de rapport, documents, rendez-vous | `documents` | `Sit_documents` | document |
| réunion (écoute / parole) | `meeting` / `speak` | `Sit_meeting` / `Sit_speak` | — |
| mission terminée | `celebrate` | `Sit_celebrate` | — |
| difficulté | `alert` | `Sit_alert` | — |
| attente, agent suspendu | `pause` | `Sit_pause` | — |
| détente | `relax` | `Sit_relax` / `Stand_relax` | tasse |
| supervision / remise de dossier | `watch` / `handover` | `Stand_watch` / `Stand_handover` | chemise cartonnée |

## Utiliser Mixamo ou d'autres modèles

Mixamo exige un compte Adobe : les clips livrés ici sont donc écrits en code. Pour les remplacer :

1. Télécharger l'animation Mixamo (FBX, « sans skin »), l'importer dans Blender, la renommer selon la convention ci-dessus (`Sit_typing`, `Walk`…), l'exporter dans `characters/animations.glb`.
2. Si le squelette Mixamo est préfixé (`mixamorig:`), retirer le préfixe à l'import, ou utiliser `SkeletonUtils.retargetClip` (vendor bundle) pour recaler les rotations.
3. Pour un autre personnage : exporter un GLB dont les os portent les noms ci-dessus et dont les matériaux suivent la convention `<nom>_<emplacement>` ; l'ajouter à `CHARACTERS` / `BODY_SCALE` dans `assets.js`.

Sans ressources GLB (hors ligne, fichier absent), le bureau bascule automatiquement sur les avatars procéduraux (`avatar.js`) : l'interface reste utilisable.

## Licences

Modèles et animations : générés par les scripts de ce dépôt (propriété du projet). Three.js : licence MIT (`../vendor/three.bundle.js.LEGAL.txt`).
