# Paramétrage de SANIX AI : ce qui est donnée, ce qui est code

Principe : **l'organisation, les équipes, les agents et les logiciels vendus sont de la donnée**, modifiable par la direction dans *SANIX AI → Paramétrage* (ou par les fonctions `ai_cfg_*`), sans toucher au code ni redéployer.

## Ce qui se règle, et où

| Élément | Table | Comment le modifier |
|---|---|---|
| Logiciels vendus (nom, marché cible, secteurs, mots-clés, fonctionnalités, argumentaire) | `ai_products` | Paramétrage → Logiciels (`ai_cfg_save_product`). Un logiciel **actif** est présenté et recommandé ; **inactif**, il disparaît du portefeuille des agents (à la minute suivante). Un nouveau logiciel est créé inactif |
| Noms de logiciels du CRM (ex. « AviNest Pro » = AvicoSuite) | `ai_product_aliases` | Fiche du logiciel → « Noms utilisés dans le CRM » (`ai_cfg_set_alias`). Sert au chiffre d'affaires par logiciel et au routage |
| Grille tarifaire officielle | `ai_pricing` | Inchangé (jamais de prix inventé : sans grille, les agents escaladent) ; l'écran signale les logiciels sans grille |
| Modèles de postes (niveau, département, outils, effort, description) | `ai_roles` | Paramétrage → Rôles (`ai_cfg_save_role`) |
| Cellules : un logiciel, un responsable, qui tient quel rôle | `ai_cells`, `ai_cell_members` | Paramétrage → Équipes (`ai_cfg_save_cell`, `ai_cfg_set_member`). Un agent peut servir plusieurs cellules ; un rôle sans agent est un **poste vacant** |
| Agents : création depuis un rôle, rôle tenu, responsable, département, outils, effort, budget | `ai_agents`, `ai_agent_charters` | Paramétrage → Agents (`ai_cfg_create_agent`, `ai_cfg_update_agent`). Les outils modifiés produisent une nouvelle version de la charte. Suspendre/réactiver : bureau 3D ou Organisation |
| Qui traite quel événement du CRM | `crm_ai_routing`, `crm_ai_stage_owner` | Routage **par rôle** : l'agent est celui qui tient le rôle dans la cellule du logiciel du dossier |

## Comment un agent est désigné
`ai_agent_for(logiciel, rôle)` : 1) membre actif de la cellule du logiciel pour ce rôle (premier par ordre) ; 2) à défaut, tout agent actif portant ce rôle ; 3) à défaut, le code d'agent historique du routage. Un agent suspendu ou archivé n'est jamais désigné.

## Configuration par défaut
Les 18 rôles, les trois cellules (ImmoSuite, AluExpert, AvicoSuite) et leurs membres sont la **configuration initiale** (`ai_defaut_organisation()`), réappliquée sans effet de bord et sans retirer un choix déjà fait. Rien dans le moteur ne s'y réfère.

## Ce qui reste volontairement dans le code
- Les **règles de gouvernance** (hiérarchie à 5 niveaux, plafond d'agents, budgets, validation humaine, preuve de clôture) : ce sont des garde-fous, pas de l'organisation.
- Les **outils** (catalogue d'actions que le moteur sait exécuter) ; leur attribution à un rôle ou à un agent est, elle, configurable.
- Le **barème de score** (6 critères, 100 points) et les **étapes du pipeline** : définis par le cahier des charges ; leur rendre configurables est possible, mais touche le calcul de la priorité et les indicateurs.

## Sécurité
Lecture : opérateurs. Écriture : uniquement les fonctions `ai_cfg_*`, réservées à la **direction**, journalisées (`ai_actions`). Aucune écriture directe dans les tables de configuration. L'interface échappe tout texte saisi.
