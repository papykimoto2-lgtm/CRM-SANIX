-- Bascule de TOUS les agents actifs en mode api vers l'abonnement tant que la pause du plafond d'API est active
-- (et non plus seulement ceux qui ont déjà une mission bloquée). Retour automatique au mode d'origine à la fin de la pause.

create or replace function public.ai_bascule_plafond_api() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.ai_governance; a record; n_b int := 0; n_r int := 0; v_rel jsonb := '{}'::jsonb;
begin
  select * into g from public.ai_governance where id = 1;
  if g.provider_pause_until is not null and g.provider_pause_until > now() then
    for a in
      select ag.id, ag.code, ag.mode_execution from public.ai_agents ag
       where ag.etat = 'actif' and ag.archived_at is null and ag.mode_execution = 'api'
    loop
      insert into public.ai_bascule_modes(agent_id, mode_avant, raison)
      values (a.id, a.mode_execution, left('Plafond API : ' || coalesce(g.provider_pause_reason, ''), 300))
      on conflict (agent_id) do update set mode_avant = excluded.mode_avant, bascule_at = now(), raison = excluded.raison, restaure_at = null;
      update public.ai_agents set mode_execution = 'abonnement', updated_at = now() where id = a.id;
      insert into public.ai_actions(agent, action, agent_id, payload, ok)
      values ('systeme', 'bascule_abonnement', a.id, jsonb_build_object('agent', a.code, 'jusqu_au', g.provider_pause_until), true);
      n_b := n_b + 1;
    end loop;
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
  v_rel := public.ai_traiter_missions_bloquees(0);
  return jsonb_build_object('bascules', n_b, 'restaures', n_r, 'missions', v_rel, 'pause_jusqu_au', g.provider_pause_until);
end $$;
revoke all on function public.ai_bascule_plafond_api() from public, anon, authenticated;
grant execute on function public.ai_bascule_plafond_api() to service_role;

