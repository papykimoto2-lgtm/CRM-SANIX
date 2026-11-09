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

## 1. Les trois fonctions (tableau de bord)
Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**. Pour chacune : saisir le nom exact, effacer l'exemple, coller **tout** le fichier (GitHub → fichier → *Copy raw file*), **Deploy**.

| Nom (exact) | Fichier à coller | Verify JWT |
|---|---|---|
| `ai-company` | `supabase/deploy/ai-company/index.ts` | **désactivé** |
| `ai-sales-director` | `supabase/deploy/ai-sales-director/index.ts` | **désactivé** |
| `whatsapp-webhook` | `supabase/deploy/whatsapp-webhook/index.ts` | **désactivé** |

*Verify JWT désactivé* : chaque fonction authentifie elle-même son appelant (JWT opérateur vérifié par Supabase Auth + ligne `ai_operators` ; secret du planificateur `x-cron-secret` ; signature HMAC de Meta). Le contrôle de la plateforme refuserait les clés « publishable » (qui ne sont pas des JWT).

Ces fichiers sont générés (`sh supabase/build_functions.sh`, Node requis) : le code partagé de `functions/_shared` y est inclus. Variante CLI : `supabase login`, `supabase link --project-ref izgpvhwhbrgeagjfhfli`, `supabase functions deploy ai-company ai-sales-director whatsapp-webhook --no-verify-jwt`.

## 2. Secrets (Edge Functions → Secrets → Add new secret)
| Nom | Requis | Rôle |
|---|---|---|
| `ANTHROPIC_API_KEY` | oui | clé de la console Anthropic. **Seul endroit où la saisir** (jamais dans le navigateur ni dans le dépôt). |
| `CRON_SECRET` | oui | chaîne aléatoire d'au moins 32 caractères ; la même valeur sert dans le SQL du planificateur (§3) |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` | pour les rapports par e-mail | envoi via Resend |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_TEMPLATE_FIRST` | pour WhatsApp | API WhatsApp Cloud (webhook : `https://izgpvhwhbrgeagjfhfli.supabase.co/functions/v1/whatsapp-webhook`) |
| `DEMO_VISIO_URL` | non | lien de visio proposé aux prospects |

`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis par Supabase.

## 3. Planificateur
*Database → Extensions* : activer `pg_cron` et `pg_net`. Puis *SQL Editor* (remplacer `<CRON_SECRET>` ; ce SQL contient un secret : ne pas le garder dans le dépôt). Avec *Verify JWT* désactivé, l'en-tête `Authorization` est inutile :

```sql
select cron.schedule('ai-company-tick', '* * * * *', $$
  select net.http_post('https://izgpvhwhbrgeagjfhfli.supabase.co/functions/v1/ai-company',
    '{"action":"tick"}'::jsonb, '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'))$$);
select cron.schedule('ai-company-reports', '*/5 * * * *', $$
  select net.http_post('https://izgpvhwhbrgeagjfhfli.supabase.co/functions/v1/ai-company',
    '{"action":"report_tick"}'::jsonb, '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'))$$);
select cron.schedule('ai-sales-followups', '*/15 * * * *', $$
  select net.http_post('https://izgpvhwhbrgeagjfhfli.supabase.co/functions/v1/ai-sales-director',
    '{"action":"tick"}'::jsonb, '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'))$$);
```

## 4. Vérifier
- *Edge Functions → ai-company → Logs* : un appel par minute. Une réponse `401 Non autorisé` = `CRON_SECRET` différent entre les secrets et le SQL.
- Dans SANIX AI : cliquer sur le directeur général IA, lui donner une instruction ; la mission et la réponse apparaissent sans recharger la page.
- Sans `ANTHROPIC_API_KEY`, les fonctions répondent mais les agents ne peuvent pas raisonner (incident « llm_indisponible » dans la gouvernance).
