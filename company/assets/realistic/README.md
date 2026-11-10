# SANIX AI — modèles humains réalistes

Les quatre avatars de production sont générés à partir du générateur open source Ara 3D Gen, construit sur les ressources MakeHuman dédiées CC0 1.0.

- Générateur : https://github.com/olatunde85/3d-gen
- Version épinglée : c0abe46261171ad3ec570b39beabe386669cae4d
- Code du générateur : MIT
- Données de personnages MakeHuman : CC0 1.0 (domaine public)
- Pipeline : `.github/workflows/build-human-avatars.yml`
- Profils SANIX : `company/assets/realistic/*.json`

Les profils produisent quatre adultes ivoiriens/africains en tenue professionnelle, cheveux texturés et rig game compatible Mixamo. Les animations SANIX existantes sont conservées dans `animations.glb` et sont chargées séparément.

Les modèles générés sont des humains texturés haute définition issus d'un système de morphologie MakeHuman. Ils améliorent nettement l'anatomie, la peau, les cheveux et les vêtements par rapport aux formes géométriques procédurales SANIX. Ils ne doivent toutefois pas être présentés comme des scans photographiques réels.
