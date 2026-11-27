-- Bascule automatique vers l'abonnement Claude quand le plafond d'usage de l'API est atteint.
--
-- Le moteur mémorise la pause fournisseur dans ai_governance.provider_pause_until. Tant qu'elle est active :
--   * chaque agent actif en mode « api » qui a une mission bloquée ou en attente à cause du plafond passe en mode « abonnement »
--     (mode d'origine mémorisé dans ai_bascule_modes) ;
--   * ses missions bloquées par le plafond sont remises en file pour l'exécuteur planifié.
-- Quand la pause est levée : les agents basculés reviennent à leur mode d'origine, dès qu'ils n'ont plus de mission en cours.
-- Les agents passés en « abonnement » à la main (hors cette bascule) ne sont jamais restaurés.

create table if not exists public.ai_bascule_modes (
  agent_id    uuid primary key references public.ai_agents(id) on delete cascade,
  mode_avant  text not null check (mode_avant in ('api', 'abonnement')),
  bascule_at  timestamptz not null default now(),
  raison      text,
  restaure_at timestamptz
);
alter table public.ai_bascule_modes enable row level security;
revoke all on public.ai_bascule_modes from public, anon, authenticated;
grant all on public.ai_bascule_modes to service_role;

create or replace function public.ai_bascule_plafond_api() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.ai_governance; a record; n_b int := 0; n_r int := 0; v_rel jsonb := '{}'::jsonb;
begin
  select * into g from public.ai_governance where id = 1;
  if g.provider_pause_until is not null and g.provider_pause_until > now() then
    for a in
      select ag.id, ag.code, ag.mode_execution from public.ai_agents ag
       where ag.etat = 'actif' and ag.archived_at is null and ag.mode_execution = 'api'
         and exists (select 1 from public.ai_agent_tasks t
                      where t.agent_id = ag.id and t.statut in ('bloquee', 'a_faire') and t.updated_at > now() - interval '7 days'
                        and (coalesce(t.progression, '') || coalesce(t.rapport, '')) ~* '(usage limits|Plafond Anthropic|Plafond API)')
    loop
      insert into public.ai_bascule_modes(agent_id, mode_avant, raison)
      values (a.id, a.mode_execution, left('Plafond API : ' || coalesce(g.provider_pause_reason, ''), 300))
      on conflict (agent_id) do update set mode_avant = excluded.mode_avant, bascule_at = now(), raison = excluded.raison, restaure_at = null;
      update public.ai_agents set mode_execution = 'abonnement', updated_at = now() where id = a.id;
      insert into public.ai_actions(agent, action, agent_id, payload, ok)
      values ('systeme', 'bascule_abonnement', a.id, jsonb_build_object('agent', a.code, 'jusqu_au', g.provider_pause_until), true);
      n_b := n_b + 1;
    end loop;
    if n_b > 0 or exists (select 1 from public.ai_bascule_modes where restaure_at is null) then
      v_rel := public.ai_relancer_missions_bloquees_externes(7);
    end if;
  else
    for a in
      select b.agent_id, b.mode_avant, ag.code from public.ai_bascule_modes b join public.ai_agents ag on ag.id = b.agent_id
       where b.restaure_at is null
         and not exists (select 1 from public.ai_agent_tasks t where t.agent_id = b.agent_id and t.statut = 'en_cours')
    loop
      update public.ai_agents set mode_execution = a.mode_avant, updated_at = now() where id = a.agent_id and mode_execution = 'abonnement';
      update public.ai_bascule_modes set restaure_at = now() where agent_id = a.agent_id;
      insert into public.ai_actions(agent, action, agent_id, payload, ok)
      values ('systeme', 'retour_mode_api', a.agent_id, jsonb_build_object('agent', a.code, 'mode', a.mode_avant), true);
      n_r := n_r + 1;
    end loop;
  end if;
  return jsonb_build_object('bascules', n_b, 'restaures', n_r, 'missions', v_rel, 'pause_jusqu_au', g.provider_pause_until);
end $$;
revoke all on function public.ai_bascule_plafond_api() from public, anon, authenticated;
grant execute on function public.ai_bascule_plafond_api() to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ai_bascule_plafond_api';
    perform cron.schedule('ai_bascule_plafond_api', '2-59/5 * * * *', 'select public.ai_bascule_plafond_api();');
  end if;
end $$;

-- Correctif : l'index ai_tasks_dedupe interdit deux missions ouvertes de même titre pour un agent.
-- On ne remet en file que la plus récente de chaque titre ; les autres bloquées (doublons) sont annulées.
create or replace function public.ai_relancer_missions_bloquees_externes(p_jours int default 5) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n_req int := 0; n_dup int := 0; n_dep int := 0;
begin
  with cand as (
    select t.id,
           row_number() over (partition by t.agent_id, t.titre_norm order by t.updated_at desc) rn,
           exists (select 1 from public.ai_agent_tasks o
                    where o.agent_id = t.agent_id and o.titre_norm = t.titre_norm and o.id <> t.id
                      and o.statut in ('a_faire', 'en_cours', 'attente_sous_taches', 'attente_validation')) deja_ouverte
      from public.ai_agent_tasks t
     where t.statut = 'bloquee' and t.updated_at > now() - make_interval(days => greatest(p_jours, 1))
       and t.agent_id in (select id from public.ai_agents where mode_execution = 'abonnement' and etat = 'actif' and archived_at is null)
       and (coalesce(t.rapport, '') || coalesce(t.progression, '')) ~* '(crédits insuffisants|facturation requise|usage limits|Plafond Anthropic|Plafond API)'),
  dup as (
    update public.ai_agent_tasks t set statut = 'annulee',
           progression = left(coalesce(t.progression, '') || E'\n[Système] Annulée : doublon d''une mission de même titre déjà remise en file ou ouverte.', 8000)
     where t.id in (select id from cand where rn > 1 or deja_ouverte) returning t.id),
  r as (
    update public.ai_agent_tasks t set statut = 'a_faire', reprises = t.executions,
           progression = left(coalesce(t.progression, '') || E'\n[Système] Remise en file : cause externe levée (exécution par abonnement).', 8000)
     where t.id in (select id from cand where rn = 1 and not deja_ouverte) returning t.id)
  select (select count(*) from r), (select count(*) from dup) into n_req, n_dup;
  with d as (
    delete from public.ai_task_dependencies d using public.ai_agent_tasks x
     where d.depend_de = x.id and x.statut = 'annulee' returning 1)
  select count(*) into n_dep from d;
  return jsonb_build_object('remises_en_file', n_req, 'doublons_annules', n_dup, 'dependances_supprimees', n_dep);
end $$;
