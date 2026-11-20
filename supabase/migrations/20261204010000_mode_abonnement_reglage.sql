-- Réglage du mode d'exécution d'un agent depuis le paramétrage (direction seule, journalisé).
create or replace function public.ai_cfg_set_mode_execution(p_agent uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.ai_agents;
begin
  perform public.ai_cfg_check();
  if p_mode not in ('api', 'abonnement') then raise exception 'Mode refusé : api ou abonnement' using errcode = '22023'; end if;
  select * into a from public.ai_agents where id = p_agent for update;
  if a.id is null then raise exception 'Agent introuvable' using errcode = 'P0002'; end if;
  if a.mode_execution <> p_mode then
    update public.ai_agents set mode_execution = p_mode, updated_at = now() where id = p_agent;
    perform public.ai_cfg_audit('cfg_mode_execution', jsonb_build_object('agent', a.code, 'avant', a.mode_execution, 'apres', p_mode));
  end if;
  return jsonb_build_object('ok', true, 'mode', p_mode);
end $$;
revoke all on function public.ai_cfg_set_mode_execution(uuid, text) from public, anon;
grant execute on function public.ai_cfg_set_mode_execution(uuid, text) to authenticated, service_role;
