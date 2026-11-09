-- SANIX AI VIRTUAL COMPANY — planificateur (pg_cron + pg_net) : appelle les fonctions Edge à intervalle régulier.
-- À exécuter dans Supabase → SQL Editor, après le déploiement des fonctions (DEPLOIEMENT.md §1). Relançable sans effet de bord.
-- Le secret du planificateur est généré ici (64 caractères aléatoires), gardé dans le Vault Supabase et lu à chaque appel :
-- il n'apparaît dans aucune requête planifiée ni dans le dépôt. La dernière requête l'affiche : à recopier tel quel dans
-- Edge Functions → Secrets → CRON_SECRET.
-- Arrêter : select cron.unschedule('ai-company-tick'); (idem 'ai-company-reports', 'ai-sales-followups').
-- Changer le secret : delete from vault.secrets where name = 'ai_cron_secret'; puis relancer ce script et recopier la nouvelle valeur.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault cascade;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'ai_cron_secret', 'Secret du planificateur SANIX AI (en-tête x-cron-secret)')
 where not exists (select 1 from vault.secrets where name = 'ai_cron_secret');

select cron.schedule('ai-company-tick', '* * * * *', $$
  select net.http_post(
    url := 'https://izgpvhwhbrgeagjfhfli.supabase.co/functions/v1/ai-company',
    body := '{"action":"tick"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ai_cron_secret')))
$$);

select cron.schedule('ai-company-reports', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://izgpvhwhbrgeagjfhfli.supabase.co/functions/v1/ai-company',
    body := '{"action":"report_tick"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ai_cron_secret')))
$$);

select cron.schedule('ai-sales-followups', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://izgpvhwhbrgeagjfhfli.supabase.co/functions/v1/ai-sales-director',
    body := '{"action":"tick"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ai_cron_secret')))
$$);

select decrypted_secret as "CRON_SECRET à copier dans Edge Functions → Secrets"
  from vault.decrypted_secrets where name = 'ai_cron_secret';
