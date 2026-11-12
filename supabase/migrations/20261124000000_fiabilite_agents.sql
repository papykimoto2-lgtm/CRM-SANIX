-- Fiabilité des agents : réservations atomiques (outbox, dossier prospect) et verrou de relance adapté à la durée d'un tick.

-- 1. Outbox : un message « a_envoyer » est réservé 10 min (meta.claimed_at) par un seul exécuteur.
create or replace function public.ai_claim_outbox(p_limit integer default 20)
returns table (id bigint, prospect_id uuid, canal text, contenu text, meta jsonb)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return query
  with picked as (
    select m.id from public.ai_messages m
    where m.sens = 'sortant' and m.statut = 'a_envoyer'
      and (m.meta->>'claimed_at' is null or (m.meta->>'claimed_at')::timestamptz < now() - interval '10 minutes')
    order by m.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  update public.ai_messages m
     set meta = coalesce(m.meta, '{}'::jsonb) || jsonb_build_object('claimed_at', now())
    from picked where m.id = picked.id
  returning m.id, m.prospect_id, m.canal, m.contenu, m.meta;
end $$;
revoke all on function public.ai_claim_outbox(integer) from public, anon, authenticated;
grant execute on function public.ai_claim_outbox(integer) to service_role;

-- 2. Dossier prospect : un seul agent à la fois ; un message reçu pendant un run demande une reprise.
alter table public.ai_prospects
  add column if not exists agent_lock_at timestamptz,
  add column if not exists agent_rerun boolean not null default false;

create or replace function public.ai_lock_prospect(p_id uuid, p_ttl_sec integer default 300)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare got boolean;
begin
  update public.ai_prospects set agent_lock_at = now(), agent_rerun = false
   where id = p_id and (agent_lock_at is null or agent_lock_at < now() - make_interval(secs => greatest(30, p_ttl_sec)));
  got := found;
  if not got then update public.ai_prospects set agent_rerun = true where id = p_id; end if;
  return got;
end $$;

-- Libère le verrou ; renvoie true si un message est arrivé entre-temps (reprise nécessaire).
create or replace function public.ai_unlock_prospect(p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare r boolean;
begin
  select agent_rerun into r from public.ai_prospects where id = p_id for update;
  update public.ai_prospects set agent_lock_at = null, agent_rerun = false where id = p_id;
  return coalesce(r, false);
end $$;
revoke all on function public.ai_lock_prospect(uuid, integer), public.ai_unlock_prospect(uuid) from public, anon, authenticated;
grant execute on function public.ai_lock_prospect(uuid, integer), public.ai_unlock_prospect(uuid) to service_role;

-- 3. Relances : verrou périmé à 30 min (un tick traite jusqu'à 10 relances × 12 tours LLM).
create or replace function public.ai_claim_due_followups(p_limit integer default 10)
returns table (id uuid, prospect_id uuid, scenario text, canal text, attempts integer)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  return query
  with picked as (
    select f.id from public.ai_followups f
    where f.statut = 'planifiee' and f.due_at <= now()
      and (f.locked_at is null or f.locked_at < now() - interval '30 minutes')
    order by f.due_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.ai_followups f set locked_at = now(), attempts = f.attempts + 1
    from picked where f.id = picked.id
  returning f.id, f.prospect_id, f.scenario, f.canal, f.attempts;
end $$;
revoke all on function public.ai_claim_due_followups(integer) from public, anon, authenticated;
grant execute on function public.ai_claim_due_followups(integer) to service_role;
