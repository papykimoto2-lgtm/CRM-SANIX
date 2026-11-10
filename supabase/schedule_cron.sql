-- SANIX AI VIRTUAL COMPANY — planificateur (pg_cron + pg_net) : appelle les fonctions Edge à intervalle régulier.
-- À exécuter dans Supabase → SQL Editor. Relançable sans effet de bord.
-- Le secret du planificateur est généré ici (64 caractères aléatoires) et gardé dans le Vault Supabase. Il n'apparaît dans aucune requête
-- planifiée ni dans le dépôt, et RIEN n'est à recopier dans les secrets Edge : les tâches le lisent dans le Vault à chaque appel, et les
-- fonctions Edge le lisent par ai_cron_secret() (fonction SQL réservée au service). Le secret Edge CRON_SECRET n'est qu'un repli facultatif.
-- Arrêter : select cron.unschedule('ai-company-tick'); (idem 'ai-company-reports', 'ai-sales-followups').
-- Changer le secret : delete from vault.secrets where name = 'ai_cron_secret'; puis relancer ce script (les fonctions s'alignent en 30 s).

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault cascade;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'ai_cron_secret', 'Secret du planificateur SANIX AI (en-tête x-cron-secret)')
 where not exists (select 1 from vault.secrets where name = 'ai_cron_secret');

create or replace function public.ai_cron_secret() returns text
  language sql stable security definer set search_path = ''
  as $$ select decrypted_secret from vault.decrypted_secrets where name = 'ai_cron_secret' $$;
revoke all on function public.ai_cron_secret() from public, anon, authenticated;
grant execute on function public.ai_cron_secret() to service_role;

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

select jobname as "tâche planifiée", schedule as "cadence", active as "active"
  from cron.job where jobname like 'ai-%' order by jobname;
