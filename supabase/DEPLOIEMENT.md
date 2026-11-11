# Déployer les fonctions Edge (sans CLI, sans jeton)

Projet `izgpvhwhbrgeagjfhfli`. Prérequis : schéma appliqué (`setup_all.sql`) et opérateur créé (`ACCES.md`). Sans les fonctions, le bureau affiche déjà les agents (§0) ; les fonctions leur donnent vie : missions, réunions, rapports et dialogue avec le directeur.

## 0. Créer tous les agents (SQL, immédiat)
*SQL Editor* → coller `supabase/seed_agents.sql` → **Run**. Crée les **23 collaborateurs** de l'organisation avec leur cahier des charges (25 avec le directeur général et le directeur commercial) :

| Département | Collaborateurs |
|---|---|
| Direction commerciale | responsable de la prospection ; 3 superviseurs (immobilier et BTP, santé, distribution et livraison) ; 3 chercheurs, analyste de données, qualificateur, WhatsApp, e-mail, rendez-vous, négociateur |
| Marketing | directeur ; rédacteur de contenus ; community manager |
| Intelligence économique | directeur ; étude de marché ; veille concurrentielle |
| Relation client | directeur ; customer success |
| Administration | directeur ; gestionnaire de documents |

Le script passe par les mêmes règles que la création par le directeur IA (hiérarchie, plafond, charte obligatoire), peut être relancé sans doublon et trace l'opération au journal d'audit. Le plafond de gouvernance (25 agents actifs) est atteint : l'augmenter dans *Gouvernance* avant d'autoriser d'autres créations. Aucun message externe ne part sans votre validation. Les agents apparaissent en direct dans le bureau 3D, sans recharger la page.

## 0 bis. Assigner une mission à chaque agent d'après le CRM (SQL, immédiat)
*SQL Editor* → coller `supabase/seed_crm_missions.sql` → **Run** (après le §0). Le script :
1. **importe les prospects du CRM** dans l'entreprise IA (504 fiches sur 511 ; les doublons de numéro ou d'e-mail sont ignorés), avec le produit recommandé par segment ;
2. aligne le superviseur « distribution » sur les segments réels du CRM (**Industrie 213** et **Logistique 30**, absents de l'organisation de départ) ;
3. **assigne une mission à chacun des 25 agents**, formulée avec les chiffres du CRM : 511 prospects (Industrie 213, Santé 173, Immobilier 95, Logistique 30), 486 avec téléphone dont 253 mobiles valides, 118 avec e-mail, 23 sans aucun contact, 8 clients, 9 commandes.

Arbre des missions : président → directeur général → directeurs (commercial, marketing, intelligence, relation client, administration) → responsable de la prospection → 3 superviseurs → agents. Les missions de direction attendent leurs subordonnés (reprise automatique) ; **le contact dépend de la qualification, les rendez-vous du contact, l'offre du rendez-vous**. Aucun message externe ne part sans votre validation. Le script est relançable sans doublon.

Les missions démarrent dès que les fonctions (§1) et les secrets (§2) sont en place. Budget IA par défaut : 20 $ par jour et 5 $ par agent (onglet *Gouvernance*). Les données du CRM quittent le navigateur : elles sont copiées dans **votre** projet Supabase, protégé par la connexion d'opérateur.
Régénération : `node supabase/tools/export_crm.js > crm_export.json && python3 supabase/tools/gen_seed_crm_missions.py crm_export.json`.

## 1. Les trois fonctions (tableau de bord)
Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**. Pour chacune : saisir le nom exact, effacer l'exemple, coller **tout** le fichier (GitHub → fichier → *Copy raw file*), **Deploy**.

| Nom (exact) | Fichier à coller | Verify JWT |
|---|---|---|
| `ai-company` | `supabase/deploy/ai-company/index.ts` | **désactivé** |
| `ai-sales-director` | `supabase/deploy/ai-sales-director/index.ts` | **désactivé** |
| `whatsapp-webhook` | `supabase/deploy/whatsapp-webhook/index.ts` | **désactivé** |

*Verify JWT désactivé* : chaque fonction authentifie elle-même son appelant (JWT opérateur vérifié par Supabase Auth + ligne `ai_operators` ; secret du planificateur `x-cron-secret` ; signature HMAC de Meta). Le contrôle de la plateforme refuserait les clés « publishable » (qui ne sont pas des JWT).

**Depuis un téléphone** : ouvrir le lien brut dans le navigateur (pas dans l'application GitHub), appui long → *Tout sélectionner* → *Copier*, puis coller dans l'éditeur Supabase. Liens : `https://raw.githubusercontent.com/papykimoto2-lgtm/CRM-SANIX/main/supabase/deploy/<nom>/index.ts` (`<nom>` = `ai-company`, `ai-sales-director`, `whatsapp-webhook`). *Verify JWT* se désactive après le premier déploiement : *Edge Functions → la fonction → Details*, interrupteur « Verify JWT », **Save changes**.

Ces fichiers sont générés (`sh supabase/build_functions.sh`, Node requis) : le code partagé de `functions/_shared` y est inclus. Variante CLI : `supabase login`, `supabase link --project-ref izgpvhwhbrgeagjfhfli`, `supabase functions deploy ai-company ai-sales-director whatsapp-webhook --no-verify-jwt`.

## 2. Secrets (Edge Functions → Secrets → Add new secret)
| Nom | Requis | Rôle |
|---|---|---|
| `ANTHROPIC_API_KEY` | oui | clé de la console Anthropic. **Seul endroit où la saisir** (jamais dans le navigateur ni dans le dépôt). |
| `CRON_SECRET` | **non** | rien à saisir : `schedule_cron.sql` (§3) garde le secret du planificateur dans le Vault et les fonctions le lisent par `ai_cron_secret()`. Secret Edge facultatif, utilisé seulement en repli (installation sans Vault). |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | pour les rapports par e-mail | envoi via Resend |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_TEMPLATE_FIRST` | pour WhatsApp | API WhatsApp Cloud (webhook : `https://izgpvhwhbrgeagjfhfli.supabase.co/functions/v1/whatsapp-webhook`) |
| `DEMO_VISIO_URL` | non | lien de visio proposé aux prospects |

`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis par Supabase.

## 3. Planificateur (SQL, sans secret à saisir)
*SQL Editor* → coller `supabase/schedule_cron.sql` → **Run**. Le script :
1. active `pg_cron`, `pg_net` et le Vault ;
2. **génère le secret du planificateur** (64 caractères aléatoires) et le garde dans le Vault : il n'apparaît ni dans les requêtes planifiées ni dans le dépôt ;
3. planifie trois tâches : `ai-company` *tick* chaque minute, *report_tick* toutes les 5 minutes, `ai-sales-director` *tick* toutes les 15 minutes (en-tête `x-cron-secret` lu dans le Vault à chaque appel ; *Verify JWT* désactivé, l'en-tête `Authorization` est inutile) ;
4. crée la fonction SQL `ai_cron_secret()` (lecture du secret **réservée au service** : refusée à `anon` et `authenticated`) et **liste les tâches** planifiées. **Aucun secret à recopier** nulle part.

Relançable sans effet de bord (même secret, mêmes tâches). Arrêter : `select cron.unschedule('ai-company-tick');` (idem `ai-company-reports`, `ai-sales-followups`). Changer le secret : `delete from vault.secrets where name = 'ai_cron_secret';`, relancer le script (les fonctions s'alignent en 30 s). Test : `supabase/functions/tests/schedule_cron_test.sh`.

## 4. Vérifier
**Contrôle d'ensemble, lecture seule** : *SQL Editor* → coller `supabase/verifier_installation.sql` → **Run**. Une ligne par étape (schéma, opérateur, agents, mises à jour, planificateur, réponses des fonctions, temps réel, connecteur CRM, gouvernance) : OK, À FAIRE avec l'action, ou INFO. À relancer après chaque étape. Il ne voit pas la clé `ANTHROPIC_API_KEY` (secret des fonctions Edge) : sa présence se lit à l'incident « cle_ia_absente » et à l'activité des agents.

- *Edge Functions → ai-company → Logs* : un appel par minute. Une réponse `401 Non autorisé` = secret du Vault différent de l'en-tête (relancer `schedule_cron.sql`) ; `500` = ni `ai_cron_secret()` ni `CRON_SECRET` disponibles.
- Dans SANIX AI : cliquer sur le directeur général IA, lui donner une instruction ; la mission et la réponse apparaissent sans recharger la page.
- Sans `ANTHROPIC_API_KEY`, les fonctions répondent mais **tout reste en pause** : le planificateur ne réclame aucune mission, aucun agent n'est sanctionné ni suspendu, et un incident critique « cle_ia_absente » apparaît dans la gouvernance (une seule fois). Les missions reprennent d'elles-mêmes dès que le secret est posé.

## 5. Déploiement automatique (GitHub Actions) : sans CLI, sans formulaire, depuis un téléphone
Alternative aux §1 et §2 quand le déploiement à la main bloque (nom de fonction à retaper, trois collages de 44 à 158 Ko…). Le jeton Supabase reste dans les **secrets chiffrés de GitHub** ; il n'est ni dans le dépôt, ni dans une conversation.

1. Supabase → avatar → *Access Tokens* → *Generate new token* (nom `sanix-deploy`) → copier `sbp_…`.
2. GitHub → dépôt → *Settings → Secrets and variables → Actions → New repository secret* : nom `SUPABASE_ACCESS_TOKEN`, valeur = le jeton (seulement `sbp_…`, sans « Bearer », sans espace).
3. *Actions → Déployer SANIX AI (Supabase) → Run workflow*. Champ facultatif : noms de fonctions parasites à supprimer (ex. `clever-endpoint`).
4. Lire le journal : ✓ / ⚠ / ✗ par étape.
5. **Révoquer le jeton** (Supabase → *Access Tokens*) et supprimer le secret GitHub.

Ce que fait `supabase/tools/deploy_functions.sh` (utilisable aussi en local : `SUPABASE_ACCESS_TOKEN=sbp_… bash supabase/tools/deploy_functions.sh`) :
- vérifie l'accès au projet, déploie `ai-company`, `ai-sales-director`, `whatsapp-webhook` **sous leur nom exact**, *Verify JWT* désactivé et contrôlé ;
- vérifie que le secret du planificateur existe dans le Vault et le copie vers le secret Edge `CRON_SECRET` (repli facultatif, valeur masquée, jamais affichée) : `schedule_cron.sql` (§3) doit avoir été exécuté ;
- signale si `ANTHROPIC_API_KEY` manque (**à saisir toi-même dans *Edge Functions → Secrets***, c'est le seul secret qui ne passe pas par ici) ;
- sonde les fonctions avec un faux secret (401 attendu), puis attend les appels du planificateur et affiche leurs codes de réponse, les agents suspendus, les missions par statut et les incidents récents ;
- ne supprime que les fonctions nommées dans le champ du workflow, jamais les trois fonctions de SANIX AI.

Test : `supabase/functions/tests/deploy_functions_test.sh` (faux serveur de l'API de gestion : multipart exact, repli sur l'API historique, jeton mal formé, suppression encadrée, secrets jamais affichés).

## 6. Déploiement par le connecteur Supabase (Claude)
Quand le connecteur Supabase de Claude est branché sur **le bon compte** (vérifier : `list_projects` doit montrer `izgpvhwhbrgeagjfhfli`), Claude déploie sans jeton à créer :
- chaque fonction est publiée avec un point d'entrée d'une ligne, `import "https://raw.githubusercontent.com/papykimoto2-lgtm/CRM-SANIX/<commit>/supabase/deploy/<nom>/index.ts";`, **épinglé sur un commit** : le code est embarqué à la compilation (aucun appel réseau à l'exécution) et correspond exactement au dépôt ;
- *Verify JWT* désactivé ; les contrôles se font par SQL (`net._http_response` : codes de réponse du planificateur) et par les journaux ;
- seule `ANTHROPIC_API_KEY` reste à saisir par l'exploitant (formulaire du tableau de bord) ;
- les fonctions parasites du tableau de bord (noms aléatoires comme `clever-endpoint`) ne peuvent pas être supprimées par le connecteur : *Edge Functions → la fonction → Delete function*.

## 7. Mettre à jour une installation existante
`setup_all.sql` ne sert qu'aux nouvelles installations. Sur une base déjà en service, appliquer **avant** de redéployer les fonctions (*SQL Editor* ou connecteur Supabase), dans l'ordre :
1. `migrations/20261110000000_ai_sales_followup_queue.sql` : file de relances atomique (`ai_claim_due_followups`, colonnes `attempts`, `locked_at`, `last_error`) ;
2. `migrations/20261110010000_ai_consent_setting.sql` : réglage de gouvernance `consentement_requis` (désactivé par défaut) ;
3. `migrations/20261111000000_crm_ai_connector.sql` : connecteur CRM ↔ IA (base centrale du CRM, événements durables ; voir `CONNECTEUR_CRM_IA.md`). Sans elle, le CRM reste en mode local (« connecteur serveur absent ») et rien n'est perdu ;
4. `migrations/20261112000000_pilotage_budget.sql` (après la précédente) : budget et plan d'actions synchronisés entre appareils, coûts IA, propositions d'actions des agents (écran *Pilotage → Budget & actions*). Sans elle, le budget reste enregistré sur l'appareil, sans erreur ; les coûts IA et les propositions n'apparaissent pas. **Redéployer ensuite les trois fonctions** (§1 : nouvel outil `propose_commercial_action`).
5. `migrations/20261113000000_phase2_fiabilisation.sql` (Phase 2, après la précédente) : une mission n'est « terminée » qu'avec un rapport et un résultat enregistré ; missions par logiciel (`produit`, `resultat_attendu`) ; score /100 selon le cahier des charges avec justification obligatoire ; correspondances de noms de produits du CRM (AviNest Pro = AvicoSuite) et vue `ai_ventes_par_produit` (CA HT par logiciel). **Ordre : appliquer la migration, puis redéployer les trois fonctions** (nouvelle clôture des missions, nouveaux critères de score). Test de mission réelle : `docs/PHASE2_TEST_REEL.md`.
6. `migrations/20261114000000_parametrage.sql` (après la précédente) : **rien de l'organisation ni du catalogue n'est figé dans le code**. Rôles (modèles de postes), cellules par logiciel, rôle de chaque agent, routage du CRM par rôle et par logiciel, fonctions d'administration `ai_cfg_*` (direction seule, journalisées). **Ordre : appliquer la migration, puis redéployer les trois fonctions** (le portefeuille présenté aux agents est le catalogue actif) ; le CRM et SANIX AI se mettent à jour par Vercel. Interface : *SANIX AI → Paramétrage* (logiciels, équipes, agents, rôles). Après `seed_agents.sql`, relancer `select public.ai_defaut_organisation();` (le script le fait déjà).
7. `migrations/20261115000000_phase3_pilote.sql` (après la précédente) : segmentation des prospects par logiciel (règles modifiables, aperçu puis application), sélection du pilote, entonnoir par logiciel (*Paramétrage → Pilote*). Sans coût IA. Procédure : `docs/PHASE3_PILOTE.md`.

**Les fichiers `deploy/*/index.ts` sont générés** : après toute modification de `functions/`, régénérer (`sh supabase/build_functions.sh`) et committer le résultat, sinon les §1, §5 et §6 déploient l'ancien code.

Puis redéployer `ai-company`, `ai-sales-director` et `whatsapp-webhook` (§1, §5 ou §6). **Consentement** : désactivé, la validation du président reste le garde-fou ; activé (*Gouvernance → Exiger une preuve de consentement*), un prospect ne reçoit rien sans `ai_prospects.consentement` daté et justifié pour le canal (`{"email":{"at":"2026-11-10T09:00:00Z","preuve":"formulaire de contact"}}`) ou, pour WhatsApp, sans message entrant de moins de 24 h (le webhook enregistre ce consentement à la première réponse du prospect).
