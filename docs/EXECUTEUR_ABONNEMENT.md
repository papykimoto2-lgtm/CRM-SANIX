# Mode « abonnement » : missions des agents exécutées par Claude Code

Deux modes d'exécution par agent (Paramétrage → Agents → Modifier → « Mode d'exécution ») :

| Mode | Qui exécute | Coût | Rythme |
|---|---|---|---|
| `api` (défaut) | le moteur `ai-company`, chaque minute, via l'API Anthropic | crédit Console (écran Crédit IA) | continu |
| `abonnement` | une tâche planifiée Claude Code (session lancée par votre abonnement) | limites de l'abonnement, aucun coût API | par vagues (toutes les 2 h) |

Un agent en mode `abonnement` n'est **jamais** lancé par le moteur : ses missions restent `a_faire` jusqu'à ce que l'exécuteur les réclame.
Les fonctions SQL `ai_abonnement_reclamer(n)` et `ai_abonnement_cloturer(...)` (migration `20261204000000_mode_abonnement.sql`) imposent les mêmes règles de clôture que le moteur :
rapport factuel, au moins un résultat vérifiable pour « terminee », une seule mission en cours par agent, reprise après 3 h d'interruption.

Les agents responsables (qui assignent des missions) disposent en plus de la délégation encadrée (migration `20261205000000_abonnement_delegation.sql`) : `ai_abonnement_assigner`, `ai_abonnement_attendre`, `ai_abonnement_evaluer`, avec les règles du moteur (hiérarchie, plafonds, doublons, reprise automatique).

Ce que l'abonnement ne permet pas : brancher l'abonnement sur l'API (non autorisé par Anthropic). L'exécuteur est une session Claude Code ordinaire.

## Revenir au mode API
Paramétrage → Agents → Modifier → Mode d'exécution → « API ». Les missions en attente sont alors reprises par le moteur à la minute suivante.

## Prompt de l'exécuteur (tâche planifiée)
Voir `docs/prompt_executeur_abonnement.txt` : il est copié tel quel dans la tâche planifiée.
