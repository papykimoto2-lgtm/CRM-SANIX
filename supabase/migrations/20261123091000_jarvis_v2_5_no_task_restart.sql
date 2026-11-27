-- V2.5 hardening: never attach task_id to the approval row.
-- ai_decide_approval resumes any task_id attached to an approval; incident decisions must not restart missions.
create or replace function public.ai_create_incident_approval(
  p_action text, p_recommendation text, p_reason text default null,
  p_task_id uuid default null, p_agent_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  if nullif(btrim(p_action), '') is null or nullif(btrim(p_recommendation), '') is null then
    raise exception 'Action et correction proposée obligatoires';
  end if;
  if length(p_action) > 120 or length(p_recommendation) > 2000 or length(coalesce(p_reason,'')) > 1000 then
    raise exception 'Demande trop longue';
  end if;
  insert into public.ai_approvals(type, agent_id, task_id, motif, payload)
  values ('incident', p_agent_id, null, left('Correction incident : ' || btrim(p_action), 1000),
    jsonb_build_object('action', btrim(p_action), 'recommendation', btrim(p_recommendation),
      'reason', left(coalesce(p_reason, 'Demande de correction'), 1000),
      'related_task_id', p_task_id, 'execution_enabled', false))
  returning id into v_id;
  insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok)
  values ('direction', 'incident_approval_requested', p_agent_id, p_task_id,
    jsonb_build_object('approval_id', v_id, 'incident_action', btrim(p_action)), true);
  return v_id;
end;
$$;
revoke all on function public.ai_create_incident_approval(text,text,text,uuid,uuid) from public, anon;
grant execute on function public.ai_create_incident_approval(text,text,text,uuid,uuid) to authenticated;
