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

Les agents chasseurs peuvent créer des prospects via `ai_abonnement_creer_prospect` (migration `20261206000000_abonnement_prospects.sql`) : mêmes règles que le moteur (outil create_prospect, e-mail valide, logiciel actif, source https, 100 fiches maximum par mission, doublons refusés).

L'agent Data Analyst peut corriger l'e-mail d'une fiche via `ai_abonnement_corriger_email` (migration `20261207000000_abonnement_email.sql`) : seul le champ e-mail, adresse valide, doublons refusés, ajout seulement avec une source https, chaque changement journalisé (avant, après, motif).

Ce que l'abonnement ne permet pas : brancher l'abonnement sur l'API (non autorisé par Anthropic). L'exécuteur est une session Claude Code ordinaire.

## Revenir au mode API
Paramétrage → Agents → Modifier → Mode d'exécution → « API ». Les missions en attente sont alors reprises par le moteur à la minute suivante.

## Prompt de l'exécuteur (tâche planifiée)
Voir `docs/prompt_executeur_abonnement.txt` : il est copié tel quel dans la tâche planifiée.

## Correctifs de la revue (migration `20261208000000_abonnement_correctifs.sql`)
- Essais limités : une mission qui échoue en boucle est bloquée avec incident (comme le mode API).
- Clôture complète : rapport ou alerte au donneur d'ordre et au responsable, réponse au chat du président pour une instruction, activité et incidents de l'agent.
- Correction d'e-mail bornée : fiches désinscrites, liées à un client ou à un stade avancé refusées ; source https pour tout changement non trivial ; 40 corrections par mission.
- Plafond de 100 prospects compté par mission ; logiciel reconnu sans accents ni espaces ; délégation limitée à 10 dépendances et 8 objectifs.
- Reprise d'une exécution interrompue après 2 h (migration 20261214 ; 6 h auparavant). Risque résiduel : une exécution qui dépasserait 2 h pourrait être doublée par la suivante (une exécution normale dure quelques minutes).

## Messages et relances (migration `20261209000000_abonnement_messages.sql`)
- `ai_abonnement_message` : la routine n'envoie jamais ; elle place le message dans la file de validation du président (statut `a_valider` + approbation), avec les garde-fous du moteur (gouvernance en mode validation, prospect non désinscrit, consentement si exigé, mention « assistant IA » au premier message, 30 messages par mission).
- `ai_abonnement_relance` : planifie une relance (2 h à 60 jours, la précédente est annulée, 50 par mission).
- Toujours NON couverts en abonnement : prise de rendez-vous, création d'offres, changement d'étape et notation des fiches, escalade vers un humain, actions commerciales proposées.

## Mémoire des agents (migration `20261211000000_memoire_agents.sql`)

Chaque agent a une mémoire de travail, en mode API comme en mode abonnement (table `ai_agent_memory`, mémoire individuelle + mémoire partagée).

- **Automatique** : à la clôture d'une mission (terminée, bloquée, échouée), un souvenir daté (titre + début du rapport) est enregistré pour l'agent, un par mission, 60 au plus par agent (les plus anciens sont retirés).
- **À la réclamation** : `ai_abonnement_reclamer` ajoute `memoire` à chaque mission (8 souvenirs : ceux qui correspondent au titre d'abord, puis par importance et récence ; individuels + partagés).
- **`ai_abonnement_rappeler(mission, mots-clés)`** : recherche plein texte dans la mémoire de l'agent et la mémoire partagée.
- **`ai_abonnement_memoriser(mission, contenu, tags, partage)`** : 5 souvenirs au plus par mission ; la mémoire partagée est réservée aux agents de niveau ≤ 3.
- Le prompt de l'exécuteur contient la règle 14 : mettre à jour les instructions de la routine.
- Amorçage : les 3 dernières missions terminées de chaque agent et 4 faits partagés vérifiés (règles permanentes, e-mails, relances, levée de fonds).

## Mains et compétences (migration `20261212000000_mains_competences.sql`)

**Actions encadrées** (service seulement ; l'acteur est l'agent de la mission en cours ; l'outil doit figurer dans `ai_agents.outils` ; plafonds par mission ; mêmes règles que le moteur) : `ai_abonnement_qualifier` (score /100 avec justification, 40), `ai_abonnement_etape` (pipeline, étapes engageantes refusées, 40), `ai_abonnement_creneaux`, `ai_abonnement_rdv` (créneau réel du commercial, 10), `ai_abonnement_compte_rendu` (10, jamais d'écrasement), `ai_abonnement_offre` (grille officielle, remise > délégation = validation direction, > plafond direction = refus, 10), `ai_abonnement_escalade` (20), `ai_abonnement_action_commerciale` (5). Aucun envoi externe. Remarque : sans opérateur commercial actif (`ai_operators`) et sans disponibilités (`ai_availability`), les rendez-vous sont impossibles et l'agent escalade.

**Compétences** : 17 méthodes de métier (`ai_skills`) rattachées aux 27 agents (`ai_agent_skills`), fournies dans la clé `competences` de chaque mission réclamée (règle 16 du prompt). Elles sont modifiables en base (lecture pour la direction dans le CRM).

## Connexion en masse (migration `20261217000000_abonnement_connecter_tous.sql`)
Paramétrage → Agents → « Connecter tous les agents à l'abonnement Claude » : `ai_cfg_set_mode_execution_tous('abonnement')` (direction seule, journalisé, agents archivés exclus). « Tous en mode API » annule. `ai_abonnement_etat()` renvoie le nombre d'agents par mode, les missions en attente et la dernière activité de l'exécuteur. La tâche planifiée Claude Code (prompt : `docs/prompt_executeur_abonnement.txt`) reste indispensable : le CRM ne peut pas lancer Claude lui-même.
