-- Connexion en masse des agents à l'abonnement Claude (direction seule, journalisé) + état de l'exécuteur.
create or replace function public.ai_cfg_set_mode_execution_tous(p_mode text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform public.ai_cfg_check();
  if p_mode not in ('api', 'abonnement') then raise exception 'Mode refusé : api ou abonnement' using errcode = '22023'; end if;
  update public.ai_agents set mode_execution = p_mode, updated_at = now()
   where etat <> 'archive' and mode_execution <> p_mode;
  get diagnostics n = row_count;
  if n > 0 then perform public.ai_cfg_audit('cfg_mode_execution_tous', jsonb_build_object('apres', p_mode, 'agents', n)); end if;
  return jsonb_build_object('ok', true, 'mode', p_mode, 'agents', n);
end $$;
revoke all on function public.ai_cfg_set_mode_execution_tous(text) from public, anon;
grant execute on function public.ai_cfg_set_mode_execution_tous(text) to authenticated, service_role;

-- Dernière activité de l'exécuteur planifié (direction seule) : permet de savoir si l'abonnement est réellement connecté.
create or replace function public.ai_abonnement_etat() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.ai_cfg_check();
  return (select jsonb_build_object(
    'agents_abonnement', count(*) filter (where a.mode_execution = 'abonnement'),
    'agents_api', count(*) filter (where a.mode_execution = 'api'),
    'missions_en_attente', (select count(*) from public.ai_agent_tasks t join public.ai_agents x on x.id = t.agent_id
                             where x.mode_execution = 'abonnement' and t.statut = 'a_faire'),
    'derniere_activite', (select max(t.started_at) from public.ai_agent_tasks t join public.ai_agents x on x.id = t.agent_id
                           where x.mode_execution = 'abonnement'))
    from public.ai_agents a where a.etat <> 'archive');
end $$;
revoke all on function public.ai_abonnement_etat() from public, anon;
grant execute on function public.ai_abonnement_etat() to authenticated, service_role;
