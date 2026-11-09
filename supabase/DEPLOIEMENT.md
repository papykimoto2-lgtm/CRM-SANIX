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
| `CRON_SECRET` | oui | valeur **générée par `schedule_cron.sql` (§3)** et affichée à la fin : la recopier ici. Sans elle, les appels du planificateur sont refusés (401). |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | pour les rapports par e-mail | envoi via Resend |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_TEMPLATE_FIRST` | pour WhatsApp | API WhatsApp Cloud (webhook : `https://izgpvhwhbrgeagjfhfli.supabase.co/functions/v1/whatsapp-webhook`) |
| `DEMO_VISIO_URL` | non | lien de visio proposé aux prospects |

`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis par Supabase.

## 3. Planificateur (SQL, sans secret à saisir)
*SQL Editor* → coller `supabase/schedule_cron.sql` → **Run**. Le script :
1. active `pg_cron`, `pg_net` et le Vault ;
2. **génère le secret du planificateur** (64 caractères aléatoires) et le garde dans le Vault : il n'apparaît ni dans les requêtes planifiées ni dans le dépôt ;
3. planifie trois tâches : `ai-company` *tick* chaque minute, *report_tick* toutes les 5 minutes, `ai-sales-director` *tick* toutes les 15 minutes (en-tête `x-cron-secret` lu dans le Vault à chaque appel ; *Verify JWT* désactivé, l'en-tête `Authorization` est inutile) ;
4. **affiche le secret** (dernière requête) : le **recopier tel quel** dans *Edge Functions → Secrets → `CRON_SECRET`* (§2).

Relançable sans effet de bord (même secret, mêmes tâches). Arrêter : `select cron.unschedule('ai-company-tick');` (idem `ai-company-reports`, `ai-sales-followups`). Changer le secret : `delete from vault.secrets where name = 'ai_cron_secret';`, relancer le script, recopier la nouvelle valeur. Test : `supabase/functions/tests/schedule_cron_test.sh`.

## 4. Vérifier
- *Edge Functions → ai-company → Logs* : un appel par minute. Une réponse `401 Non autorisé` = `CRON_SECRET` absent des secrets Edge ou différent de la valeur du Vault (la réafficher : `select decrypted_secret from vault.decrypted_secrets where name = 'ai_cron_secret';`).
- Dans SANIX AI : cliquer sur le directeur général IA, lui donner une instruction ; la mission et la réponse apparaissent sans recharger la page.
- Sans `ANTHROPIC_API_KEY`, les fonctions répondent mais les agents ne peuvent pas raisonner (incident « llm_indisponible » dans la gouvernance).
