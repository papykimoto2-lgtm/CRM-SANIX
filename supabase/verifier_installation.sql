-- SANIX AI — contrôle de mise en service. LECTURE SEULE : aucune écriture, aucune valeur de secret affichée.
-- Supabase → SQL Editor → coller tout le fichier → Run. Une ligne par contrôle : OK, À FAIRE (avec l'action à faire) ou INFO.
-- À relancer après chaque étape. Ne teste pas la clé ANTHROPIC_API_KEY (secret des fonctions Edge, invisible depuis SQL) :
-- voir la ligne « Incident cle_ia_absente » et DEPLOIEMENT.md §4.
with q(ord, etape, controle, rel, req, min, rx, action) as (values
  (10, '1 Base', 'Schéma SANIX AI appliqué', 'public.ai_agents', $$select 'présent' c$$, null::numeric, '^présent$',
    'Nouvelle installation : coller supabase/setup_all.sql dans le SQL Editor.'),
  (11, '1 Base', 'Opérateur créé (compte de connexion)', 'public.ai_operators', $$select count(*) c from public.ai_operators where actif$$, 1, null,
    'Authentication → Users → Add user, puis insert into ai_operators (voir ACCES.md).'),
  (20, '2 Données', 'Agents actifs (25 attendus)', 'public.ai_agents', $$select count(*) c from public.ai_agents where etat <> 'archive'$$, 25, null,
    'SQL Editor : supabase/seed_agents.sql.'),
  (21, '2 Données', 'Missions créées (25 avec seed_crm_missions.sql, facultatif)', 'public.ai_agent_tasks', $$select count(*) c from public.ai_agent_tasks$$, null, null,
    'SQL Editor : supabase/seed_crm_missions.sql (après seed_agents.sql). Facultatif : le directeur général IA peut aussi en créer.'),
  (22, '2 Données', 'Prospects importés du CRM (environ 500, facultatif)', 'public.ai_prospects', $$select count(*) c from public.ai_prospects$$, null, null,
    'supabase/seed_crm_missions.sql, ou le connecteur CRM ↔ IA.'),
  (30, '3 Mises à jour', 'Relances atomiques (migration 20261110000000)', null,
    $$select count(*) c from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'ai_claim_due_followups'$$, 1, null,
    'Appliquer supabase/migrations/20261110000000_ai_sales_followup_queue.sql.'),
  (31, '3 Mises à jour', 'Réglage de consentement (migration 20261110010000)', null,
    $$select count(*) c from information_schema.columns where table_schema = 'public' and table_name = 'ai_governance' and column_name = 'consentement_requis'$$, 1, null,
    'Appliquer supabase/migrations/20261110010000_ai_consent_setting.sql.'),
  (40, '4 Planificateur', 'Extensions pg_cron, pg_net et Vault (3 attendues)', null,
    $$select count(*) c from pg_extension where extname in ('pg_cron', 'pg_net', 'supabase_vault')$$, 3, null,
    'Exécuter supabase/schedule_cron.sql (il active les trois extensions). À faire AVANT la migration du connecteur.'),
  (41, '4 Planificateur', 'Secret du planificateur dans le Vault (valeur jamais affichée)', 'vault.secrets',
    $$select count(*) c from vault.secrets where name = 'ai_cron_secret'$$, 1, null, 'Exécuter supabase/schedule_cron.sql.'),
  (42, '4 Planificateur', 'Tâches planifiées actives (3 attendues)', 'cron.job',
    $$select count(*) c from cron.job where active and jobname in ('ai-company-tick', 'ai-company-reports', 'ai-sales-followups')$$, 3, null,
    'Exécuter supabase/schedule_cron.sql.'),
  (50, '5 Connecteur CRM ↔ IA', 'Migration du connecteur (20261111000000)', null,
    $$select count(*) c from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'crm_sync_status'$$, 1, null,
    'Appliquer supabase/migrations/20261111000000_crm_ai_connector.sql (après schedule_cron.sql).'),
  (51, '5 Connecteur CRM ↔ IA', 'Tâches du connecteur (2 attendues)', 'cron.job',
    $$select count(*) c from cron.job where active and jobname in ('crm-ai-events', 'crm-ai-purge')$$, 2, null,
    'pg_cron était inactif lors de la migration : exécuter select cron.schedule(''crm-ai-events'', ''* * * * *'', ''select public.crm_process_events(100)''); select cron.schedule(''crm-ai-purge'', ''17 3 * * *'', ''select public.crm_purge_old(30)'');'),
  (52, '5 Connecteur CRM ↔ IA', 'Outil de compte rendu ouvert aux agents « rendez-vous » et « négociation » (2 attendus)', 'public.ai_agents',
    $$select count(*) c from public.ai_agents where code in ('ia_rdv_1', 'ia_nego_1') and 'record_appointment_report' = any(outils)$$, 2, null,
    'Après le redéploiement des fonctions : update ai_agents set outils = array_append(outils, ''record_appointment_report'') where code in (''ia_rdv_1'', ''ia_nego_1'') and not (''record_appointment_report'' = any(outils));'),
  (60, '6 Fonctions Edge', 'Réponses du planificateur, 15 dernières minutes (attendu : 200 uniquement)', 'net._http_response',
    $$select coalesce(string_agg(code || ' ×' || n, ', ' order by code), 'aucun appel') c from (select coalesce(status_code::text, 'sans réponse') code, count(*) n from net._http_response where created > now() - interval '15 minutes' group by 1) t$$,
    null, '^200 ×[0-9]+$',
    '404 : fonction non déployée (DEPLOIEMENT.md §1, §5 ou §6). 401 : secret différent, relancer schedule_cron.sql. 500 : ni Vault ni CRON_SECRET. « sans réponse » : fonction trop lente ou injoignable (timeout), voir Edge Functions → Logs. Aucun appel : tâches absentes ou pg_net inactif.'),
  (70, '7 Temps réel', 'Tables diffusées au bureau 3D (7 attendues)', 'pg_catalog.pg_publication_tables',
    $$select count(*) c from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename in ('ai_agents', 'ai_agent_tasks', 'ai_agent_meetings', 'ai_executive_messages', 'ai_approvals', 'ai_agent_events', 'ai_meeting_participants')$$,
    7, null, 'Database → Publications → supabase_realtime : activer ces tables (ou réappliquer les migrations du 9 novembre).'),
  (80, '8 Gouvernance', 'Réglages actuels (modifiables : SANIX AI → Gouvernance)', 'public.ai_governance',
    $$select format('modèle %s · budget %s $/jour, %s $/mois, %s $/agent/jour · agents max %s · missions actives max %s · contact externe : %s · interrupteur actif : %s', modele, budget_jour_usd, budget_mois_usd, budget_agent_jour_usd, max_agents_actifs, max_missions_actives, communication_externe, actif) c from public.ai_governance where id = 1$$,
    null, null, 'Voir l''étape 1 (schéma).'),
  (90, '9 Activité', 'Incident « cle_ia_absente » (clé IA manquante) : s''il est postérieur à la pose de la clé, elle manque encore', 'public.ai_incidents',
    $$select case when count(*) = 0 then 'aucun' else count(*) || ' incident(s), dernier : ' || to_char(max(created_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') end c from public.ai_incidents where type = 'cle_ia_absente'$$, null, null, 'Voir l''étape 1 (schéma).'),
  (91, '9 Activité', 'Missions par statut', 'public.ai_agent_tasks',
    $$select coalesce(string_agg(statut || ' ' || n, ', ' order by statut), 'aucune') c from (select statut, count(*) n from public.ai_agent_tasks group by statut) t$$, null, null, 'Voir l''étape 1 (schéma).'),
  (92, '9 Activité', 'Dernier événement de présence des agents (le bureau 3D s''anime à partir d''eux)', 'public.ai_agent_events',
    $$select coalesce(to_char(max(created_at) at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'), 'jamais') c from public.ai_agent_events$$, null, null, 'Voir l''étape 1 (schéma).')
), r as (
  select q.*, (q.rel is not null and to_regclass(q.rel) is null) as absent,
         case when q.rel is null or to_regclass(q.rel) is not null
              then (xpath('/row/c/text()', query_to_xml(q.req, false, true, '')))[1]::text end as v
  from q
), s as (
  select r.*, case when r.absent then 'À FAIRE'
                   when r.min is null and r.rx is null then 'INFO'
                   when r.rx is not null and r.v ~ r.rx then 'OK'
                   when r.min is not null and r.v ~ '^[0-9]+$' and r.v::numeric >= r.min then 'OK'
                   else 'À FAIRE' end as etat
  from r
)
select etape as "étape", controle as "contrôle", case when absent then 'absent' else v end as "résultat", etat as "état",
       case when etat = 'À FAIRE' then action end as "action"
from s order by ord;
