# SANIX AI — backend Supabase

Deux ensembles livrés ensemble :

1. **SANIX AI SALES DIRECTOR** — agent commercial (prospection, qualification, conversation WhatsApp, offres, rendez-vous).
2. **SANIX AI VIRTUAL COMPANY** — entreprise virtuelle : directeur général IA, collaborateurs créés par les agents, missions, réunions, rapports, bureau du président.

## Composants

| Élément | Rôle |
|---|---|
| `migrations/20261109000000_ai_sales_director.sql` | Prospects (score /100), fil omnicanal, offres, RDV, relances, validations, audit immuable, RLS |
| `migrations/20261109020000_ai_virtual_company.sql` | Gouvernance, départements, agents hiérarchisés, cahiers des charges versionnés, missions + dépendances, réunions + PV, performance, mémoire, incidents, rapports |
| `functions/ai-company` | Président : instruction, rapports à la demande · Planificateur : `tick`, `report_tick` |
| `functions/ai-sales-director` | Missions de recherche, qualification, relances (CRM) |
| `functions/whatsapp-webhook` | Messages WhatsApp entrants (signature HMAC Meta) |
| `functions/_shared/` | `llm.ts` (appel IA budgété), `company/*` (moteur), `reports/*` (rapports HTML + PDF), `outbox.ts` (envois sous gouvernance) |
| `../company/` | Interface : bureau 3D, bureau du président, organisation, missions, réunions, performance, rapports, gouvernance, validations |
| `../vercel.json` | En-têtes de sécurité (CSP) de `/company/` |

## Déploiement

```bash
supabase db push
supabase secrets set ANTHROPIC_API_KEY=... CRON_SECRET=$(openssl rand -hex 32) \
  ALLOWED_ORIGINS=https://crm-sanix.vercel.app \
  AI_RUN_BUDGET_MS=110000 \
  RESEND_API_KEY=... EMAIL_FROM="SANIX AI <ia@sanix-africa.ci>" EMAIL_REPLY_TO=... \
  WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_APP_SECRET=... WHATSAPP_VERIFY_TOKEN=... \
  WHATSAPP_TEMPLATE_FIRST=sanix_premier_contact DEMO_VISIO_URL=...
supabase functions deploy ai-company
supabase functions deploy ai-sales-director
supabase functions deploy whatsapp-webhook --no-verify-jwt   # authentifié par signature HMAC Meta
```

`AI_RUN_BUDGET_MS` : durée maximale d'une exécution d'agent. Plan gratuit (150 s de limite d'horloge) : 110 000. Plan Pro (400 s) : jusqu'à 330 000.

### Planificateur (pg_cron + pg_net)

```sql
select cron.schedule('ai-company-tick', '* * * * *', $$
  select net.http_post('https://<ref>.supabase.co/functions/v1/ai-company',
    '{"action":"tick"}'::jsonb, '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON_KEY>','x-cron-secret','<CRON_SECRET>'))$$);
select cron.schedule('ai-company-reports', '*/5 * * * *', $$
  select net.http_post('https://<ref>.supabase.co/functions/v1/ai-company',
    '{"action":"report_tick"}'::jsonb, '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON_KEY>','x-cron-secret','<CRON_SECRET>'))$$);
select cron.schedule('ai-sales-followups', '*/15 * * * *', $$
  select net.http_post('https://<ref>.supabase.co/functions/v1/ai-sales-director',
    '{"action":"tick"}'::jsonb, '{}'::jsonb,
    jsonb_build_object('Content-Type','application/json','Authorization','Bearer <ANON_KEY>','x-cron-secret','<CRON_SECRET>'))$$);
```

Les agents travaillent **sur le serveur**, interface fermée : `tick` (chaque minute) prend en charge les missions échues, les réunions, l'envoi des messages approuvés et l'expiration des agents temporaires.

### Webhook WhatsApp

`https://<ref>.supabase.co/functions/v1/whatsapp-webhook` (champ `messages`).

## Mise en service

1. Créer les comptes (Supabase Auth), puis :
   `insert into ai_operators(user_id, nom, role, remise_max_pct) values ('<uuid>', 'Nom', 'direction', 10);`
   Rôles : `direction` (tout), `admin` (+ gestion des opérateurs), `commercial` (lecture, ses prospects).
2. `ai_report_recipients` : adresse du président (principal) et destinataires secondaires. Heure, fuseau et fréquence : onglet *Rapports* (défaut : quotidien à 18 h, Africa/Abidjan).
3. `ai_availability` : créneaux des commerciaux. `ai_products.fonctionnalites` et `ai_pricing` : **l'agent ne cite que ces fonctionnalités et n'annonce que ces prix**.
4. Faire approuver par Meta le modèle `sanix_premier_contact` (1 variable : nom du contact).
5. Ouvrir `https://<site>/company/` (même origine que le CRM : la configuration Supabase du CRM est reprise ; une clé *secrète* est refusée).

## Gouvernance (onglet *Gouvernance*)

| Réglage | Défaut | Effet |
|---|---|---|
| Entreprise active | oui | Interrupteur général (pause) |
| Création d'agents sans validation | oui | Sinon chaque agent attend l'accord du président |
| Validation des outils externes | oui | Un agent doté de `send_message` attend l'accord |
| Communication externe | `validation` | `interdite` · chaque message validé par le président · `autonome` |
| Agents actifs / créations par jour | 25 / 10 | Plafonds (triggers SQL + moteur) |
| Missions actives / par agent / sous-missions / profondeur | 60 / 5 / 10 / 6 | Anti-prolifération et anti-boucle |
| Budget IA jour / mois / agent | 20 $ / 400 $ / 5 $ | Contrôlé avant **chaque** appel IA |
| Suspension automatique | 3 incidents | Agent suspendu, responsable alerté, e-mail d'incident critique |

Un agent peut demander plus de ressources (`demander_ressources`) : la demande apparaît dans *Validations*.

## Garde-fous

- `contrat_signe`, `paiement_confirme`, `marche_gagne` : bloqués en base pour l'agent (direction uniquement).
- Autorité hiérarchique : un agent ne donne d'ordre qu'à ses subordonnés ; la collaboration latérale reste dans sa direction ; privilèges d'outils non transmissibles au-delà de ceux possédés.
- Anti-boucle : chaîne de traitement sans retour à un agent déjà intervenu, missions identiques refusées, profondeur et charge plafonnées, dépendances acycliques (trigger).
- « STOP » → désinscription automatique, relances annulées, envois bloqués.
- Contenus prospects / web / rapports de sous-agents traités comme **données**, jamais comme instructions ; chaque agent n'agit que sur les prospects de son périmètre.
- `ai_actions` append-only : chaque appel IA et chaque outil sont journalisés (tokens et coût inclus).
- Rapports HTML : tout contenu est échappé ; affichage en iframe sans script.

## Tests

```bash
# PostgreSQL local (aucun Supabase requis)
supabase/functions/tests/setup_db.sh        # base modèle migrée « vc_tpl » (PGHOST/PGPORT/PGUSER)
cd supabase/functions
deno test --no-check --import-map=tests/import_map.json --allow-net --allow-env --allow-read --allow-write tests/
deno check ai-company/index.ts ai-sales-director/index.ts whatsapp-webhook/index.ts
```

Les tests exécutent le moteur sur un vrai PostgreSQL (triggers, contraintes, fonctions SQL) avec un faux Claude scripté : chaîne d'instruction → organisation → missions → synthèse, gouvernance, autorité, anti-boucle, communication externe, budget, pannes, suspension automatique, réunions, rapports (fuseaux, PDF, envois, alertes).
**Non couverts :** appels réels à Claude, WhatsApp et Resend ; API REST Supabase (PostgREST) et Realtime.
