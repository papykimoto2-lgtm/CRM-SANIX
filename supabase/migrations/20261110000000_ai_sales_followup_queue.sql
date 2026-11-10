-- Fiabilisation du planificateur de relances SANIX AI SALES DIRECTOR.
-- Réservation atomique : deux exécutions concurrentes ne peuvent pas prendre la même relance.
alter table public.ai_followups
  add column if not exists attempts integer not null default 0 check (attempts >= 0),
  add column if not exists locked_at timestamptz,
  add column if not exists last_error text;

create index if not exists ai_followups_locked_idx
  on public.ai_followups(locked_at)
  where statut = 'planifiee';

create or replace function public.ai_claim_due_followups(p_limit integer default 10)
returns table (
  id uuid,
  prospect_id uuid,
  scenario text,
  canal text,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select f.id
    from public.ai_followups f
    where f.statut = 'planifiee'
      and f.due_at <= now()
      and (f.locked_at is null or f.locked_at < now() - interval '10 minutes')
    order by f.due_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.ai_followups f
     set locked_at = now(),
         attempts = f.attempts + 1
    from picked
   where f.id = picked.id
  returning f.id, f.prospect_id, f.scenario, f.canal, f.attempts;
end;
$$;

revoke all on function public.ai_claim_due_followups(integer) from public, anon, authenticated;
grant execute on function public.ai_claim_due_followups(integer) to service_role;
