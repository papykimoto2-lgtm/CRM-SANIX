# Module Terrain : prospection physique des commerciaux

Menu **Trouver → 📍 Terrain**. Migration `20261220000000_terrain_commerciaux.sql` ; interface `shared/terrain_ui.js` ; logique `shared/terrain.js`.

| Besoin | Fonction |
|---|---|
| Feuille de route | Planification depuis la base de prospects (filtres ville, logiciel, secteur, « non visités depuis 14 j »). Ordre de visite par proximité (plus proche voisin), distance et durée estimées selon la mobilité (pied, vélo, moto, voiture, transport). Itinéraire Google Maps par prospect. |
| Géolocalisation | Position transmise toutes les 10 s **uniquement pendant une tournée démarrée**, après consentement. Précision > 500 m ignorée. Conservation 30 jours (purge nocturne). |
| Géolocalisation des prospects | « Je suis arrivé » : distance GPS au prospect, **présence vérifiée** si ≤ max(150 m, précision). Prospect sans coordonnées : la position (≤ 60 m) est enregistrée dans sa fiche. |
| Interaction avec la base | Chaque résultat ajoute une interaction « Visite terrain » à la fiche du prospect et fait avancer son étape (démo, devis, vente). |
| Rapport de mission | Clôture de tournée : résumé obligatoire, chiffres automatiques (visites, RDV, devis, ventes, km, présence vérifiée). La direction valide ou renvoie « à revoir » avec commentaire. |
| Indicateurs | Par commercial et période (7/30/90 j) : visites, réalisation, RDV, devis, ventes, valeur, km, durée de visite, présence vérifiée, **score /100** (activité 40, présence 20, conversion 30, régularité 10). Export CSV. |
| Supervision | Carte en direct, avancement par commercial, rapports à valider. Réservé à la direction. |

| Installation par QR code | Bouton **📲 Installer l'app sur un téléphone (QR code)** : le QR ouvre `?page=terrain&source=qr`. Après connexion, l'écran Terrain s'affiche et un bandeau propose l'installation (Android : bouton Installer ; iPhone : Safari → Partager → Sur l'écran d'accueil). Lien copiable, partage WhatsApp. Raccourci « Terrain : ma tournée » sur l'icône installée. |

## Vie privée (à valider avec votre conseil)
Le suivi d'un salarié relève de la protection des données personnelles (loi ivoirienne n° 2013-450, ARTCI ; équivalent dans les autres pays OHADA concernés). Mesures intégrées : consentement daté et révocable, suivi limité à la tournée, information affichée pendant la tournée, accès limité au commercial et à la direction, durée de conservation de 30 jours, journal des actions. Prévoir une mention dans le règlement intérieur ou le contrat et, si la loi locale l'exige, une déclaration à l'autorité.

## Limites connues
- Application web : le navigateur suspend le suivi si l'écran est verrouillé ou l'application en arrière-plan. L'écran est maintenu allumé (Wake Lock) quand le navigateur le permet. Un suivi continu en arrière-plan exigerait une application mobile native.
- Hors connexion : les points de position sont perdus, les actions ne sont pas mises en file.
- Prospects sans adresse géocodée : visibles dans la liste, absents de l'optimisation de l'itinéraire jusqu'à leur première visite.
- Tests : `bash supabase/functions/tests/terrain_sql_test.sh` (PostgreSQL réel), `node tests/terrain_test.js`, `node tests/terrain_e2e_test.js`.

## Déploiement
Appliquer la migration, déployer le CRM. Chaque commercial doit exister dans `ai_operators` (rôle `commercial`) et se connecter à l'agent IA (session opérateur).
