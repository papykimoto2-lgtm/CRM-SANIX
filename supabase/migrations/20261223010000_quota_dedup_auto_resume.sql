-- Versionne les objets déjà appliqués en production (PR #243) : anti-doublon des remontées Jarvis
-- et reprise automatique des missions bloquées par le plafond fournisseur. Idempotent.
create or replace function public.ai_prevent_jarvis_remontee_spam()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if lower(coalesce(new.titre,'')) like 'remontee de jarvis au directeur general%' and exists (
    select 1
    from public.ai_agent_tasks t
    where t.agent_id = new.agent_id
      and lower(t.titre) like 'remontee de jarvis au directeur general%'
      and t.statut <> 'annulee'
      and t.created_at >= now() - interval '60 minutes'
  ) then
    raise exception using
      errcode = '23505',
      message = 'Remontée Jarvis déjà enregistrée récemment : doublon bloqué (fenêtre 60 minutes).';
  end if;
  return new;
end;
$function$;

drop trigger if exists ai_prevent_jarvis_remontee_spam on public.ai_agent_tasks;
create trigger ai_prevent_jarvis_remontee_spam
  before insert on public.ai_agent_tasks
  for each row execute function public.ai_prevent_jarvis_remontee_spam();

create or replace function public.ai_resume_provider_tasks()
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  g public.ai_governance;
  resumed integer := 0;
  released integer := 0;
begin
  select * into g from public.ai_governance where id=1 for update;
  if g.provider_pause_until is null or g.provider_pause_until > now() then
    return jsonb_build_object('resumed',0,'agents_released',0,'reason','provider_pause_active');
  end if;

  update public.ai_agent_tasks
     set statut='a_faire',
         executions=0,
         started_at=null,
         finished_at=null,
         updated_at=now(),
         progression=left(coalesce(progression,'') || E'\n[Système] Reprise automatique après rétablissement du quota fournisseur. Passage dans la file priorisée ; plafond journalier SANIX conservé.',8000)
   where statut='bloquee'
     and progression ilike '%You have reached your specified API usage limits%';
  get diagnostics resumed = row_count;

  update public.ai_governance
     set provider_pause_until=null, provider_pause_reason=null, updated_at=now()
   where id=1;

  update public.ai_agents a
     set activite='disponible', activite_depuis=now(), activite_detail='Reprise après quota fournisseur'
   where a.etat='actif'
     and a.activite='en_difficulte'
     and exists (
       select 1 from public.ai_agent_tasks t
       where t.agent_id=a.id
         and t.statut='a_faire'
         and t.progression ilike '%Reprise automatique après rétablissement du quota fournisseur%'
     );
  get diagnostics released = row_count;

  return jsonb_build_object('resumed',resumed,'agents_released',released,'reason','provider_pause_expired');
end;
$function$;

-- Planification toutes les 5 min, uniquement si pg_cron est disponible (absent d'une base de test vierge).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ai-provider-auto-resume';
    perform cron.schedule('ai-provider-auto-resume', '*/5 * * * *', 'select public.ai_resume_provider_tasks();');
  end if;
end $$;
