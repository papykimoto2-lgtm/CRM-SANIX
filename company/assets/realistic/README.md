# SANIX AI — humains 3D réalistes du bureau virtuel

Quatre collaborateurs humains (deux femmes, deux hommes, apparences africaines, tenue professionnelle) remplacent les silhouettes géométriques.
Ils sont **texturés** (peau, yeux, cheveux, costumes en matières PBR), **animés** par les 27 clips SANIX et **légers** (≈ 1 à 2 Mo chacun).

| | |
|---|---|
| Générateur | [Ara 3D Gen](https://github.com/olatunde85/3d-gen), commit épinglé `c0abe46261171ad3ec570b39beabe386669cae4d` (code MIT) |
| Données de corps | MakeHuman, jeu « system assets » **CC0 1.0** (domaine public), téléchargé par `npm run setup-assets` du générateur |
| Profils SANIX | `homme_a.json`, `homme_b.json`, `femme_a.json`, `femme_b.json` (morphologie, peau, cheveux, tenue) |
| Résultat livré | `../characters/{homme_a,homme_b,femme_a,femme_b}.glb` |

Ce sont des modèles **MakeHuman texturés**, pas des scans photographiques : la peau, les cheveux et les vêtements sont crédibles, les détails fins (pores, mèches) ne sont pas ceux d'une photo.
Origine : reprise de la PR n° 19 jusqu'au commit `41b46e3`. Les quatre GLB bruts de son dernier commit (`63bc2e0`, 12 à 15 Mo chacun) ne sont volontairement pas repris dans l'historique : les fichiers livrés en dérivent (mêmes profils, même générateur épinglé) et se régénèrent par le workflow ci-dessous.
Réserve de licence : la provenance CC0 est celle annoncée par le générateur et MakeHuman ; elle doit être revérifiée (`scripts/ASSETS_LICENSE.txt` du générateur) avant toute évolution de version.

## Chaîne de fabrication

```
générateur (code tiers)  →  GLB bruts (≈ 13 Mo, 150 000 triangles, 34 formes de visage)
        │  workflow « Construire les avatars humains SANIX » (manuel)
        ▼
tools/optimize.mjs       →  GLB allégés (voir budgets)         ← dépendances épinglées, « npm ci »
tools/validate.mjs       →  contrôle : validateur Khronos, squelette, animations, budgets
```

Ce que fait `optimize.mjs` (et pourquoi) :

| Étape | Raison |
|---|---|
| suppression des 34 formes de visage, des dents et de la langue | non animées / invisibles (bouche fermée) ; elles pesaient plus que le maillage |
| suppression de la peau cachée par les vêtements (torse, bras, jambes, pieds) | ≈ 70 % de la peau ; le visage, le cou, le décolleté et les mains gardent leur finesse |
| **deux niveaux de détail** dans le même fichier : `Corps_LOD0` (≈ 27–38 000 triangles) et `Corps_LOD1` (≈ 10–13 000), même squelette, mêmes matières | le niveau 1 sert aux téléphones et aux personnages éloignés ; textures partagées (aucune mémoire en plus) |
| simplification par pièce, bords verrouillés ; surcouches (barbe, maquillage) relevées de 3 mm | pas de fissure entre pièces ; pas de plaques de peau claire sous la barbe |
| matières unies fusionnées (boutons, lacets, semelles) | moins d'appels de dessin (11 matières par personnage) |
| textures en WebP, 256 à 1 024 px selon le rôle | −75 % de poids, décodage natif des navigateurs |
| géométrie quantifiée (`KHR_mesh_quantization`) | lue nativement par Three.js, sans décodeur |
| mise à 1,76 m par un noeud d'échelle | le moteur applique ensuite les morphologies relatives (`BODY_SCALE`) |

**Pas de Meshopt, de Draco ni de KTX2** : ces formats exigent du WebAssembly côté navigateur, que la politique de sécurité du site (`vercel.json`, directive `script-src` sans `wasm-unsafe-eval`) interdit.
Si la CSP évolue, KTX2 (mémoire GPU ÷ 4 sur Android) est la prochaine optimisation à envisager.

Budgets (contrôlés par `validate.mjs`, voir `tools/config.mjs`) : ≤ 2,5 Mo, ≤ 38 000 triangles (niveau 0), ≤ 13 000 (niveau 1), ≤ 12 matières, textures ≤ 1 024 px.

## Du fichier à l'écran

| Module | Rôle |
|---|---|
| `company/assets.js` | charge les GLB ; décode les textures par `<img>` (la CSP interdit `fetch(blob:)`, utilisé par défaut par `ImageBitmapLoader`) ; surcouches transparentes toujours devant la peau |
| `company/retarget.js` | **recale les clips SANIX sur le squelette de chaque humain** (voir ci-dessous) |
| `company/avatar_glb.js` | un avatar : mixeur d'animation, niveau de détail, état suspendu (matières assombries, copiées seulement à ce moment), regard vers l'orateur |
| `company/avatar_props.js` | accessoires (téléphone, document, tasse, chemise cartonnée) tenus dans le repère de la main, badge de département sur la poitrine |
| `company/office3d.js` | `assignDetail()` : les personnages sélectionnés puis les plus proches de la caméra gardent le niveau 0 ; qualités `high` 90, `low` 6, `eco` 0 |

### Pourquoi un recalage des animations

Les clips ont été créés sur le squelette SANIX. Les noms des 22 os animés existent bien chez les humains, mais :

* les poses de repos diffèrent (os orientés autrement, avant-bras fléchis chez les humains) ;
* les longueurs d'os diffèrent (jambes 21 % plus longues) ;
* les clips portent une piste de **translation sur chaque os** : appliquée telle quelle, elle écraserait les proportions du personnage.

`retarget.js` rejoue, os par os, le mouvement **monde** de la source sur le squelette cible (même geste, mêmes noms de clips), aligne les bras sur la pose de repos de la source,
ne déplace que le bassin (proportionnellement à la hauteur des hanches) et tourne la paume vers le bas quand l'avant-bras est tenu vers l'avant (les clips d'origine n'orientaient pas les paumes).
Calcul unique au chargement : 27 clips × 4 personnages, quelques millisecondes, aucune ressource en plus.

## Tests

| Test | Contrôle |
|---|---|
| `node company/tests/avatars_test.js` | les quatre personnages réels sous la CSP réelle : textures, absence d'erreur, 27 clips recalés, poses mesurées (pieds au sol, assis, mains levées, regard), niveaux de détail, accessoires, état suspendu, appels de dessin ; écrit `company/tests/out/avatars_*.png` |
| `node company/tests/ui_test.js`, `m13_test.js` | l'application et le bureau 3D complets avec ces personnages |
| `cd tools && npm ci && node validate.mjs ../../characters ../../characters/animations.glb` | validité glTF (Khronos), squelette, animations, budgets |

Laboratoire : `company/tests/lab/avatar_lab.html` affiche les quatre personnages côte à côte avec les mêmes modules que l'application.

## Régénérer

Actions → **Construire les avatars humains SANIX** → *Run workflow* (manuel). Deux jobs :

1. `generer` exécute le code tiers (générateur, npm, téléchargement MakeHuman) avec des droits de **lecture seule** et sans jeton conservé ; il ne produit qu'un artefact de GLB.
2. `optimiser` n'exécute que le code du dépôt : allège, valide, puis pousse une **nouvelle branche** `avatars/build-N`. Ouvrir la pull request, lancer `avatars_test.js`, regarder le bureau sur ordinateur et téléphone, puis fusionner.

Le workflow ne touche jamais `main` et ne se déclenche pas à chaque modification.
