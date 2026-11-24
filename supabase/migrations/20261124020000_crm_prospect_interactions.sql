-- Journal commercial des prospects : écriture strictement réservée à la direction.
create or replace function public.crm_add_prospect_note(
  p_prospect uuid,
  p_type text,
  p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text := btrim(coalesce(p_note, ''));
  v_type text := coalesce(nullif(btrim(p_type), ''), 'note');
  v_id bigint;
begin
  if auth.uid() is null or not public.ai_is_direction() then
    raise exception 'Accès réservé à la direction' using errcode = '42501';
  end if;
  if p_prospect is null or not exists (select 1 from public.ai_prospects where id = p_prospect) then
    raise exception 'Prospect introuvable' using errcode = 'P0002';
  end if;
  if v_type not in ('note','appel','rendez_vous','email','whatsapp','visite','demo') then
    raise exception 'Type d’interaction invalide' using errcode = '22023';
  end if;
  if char_length(v_note) < 3 or char_length(v_note) > 4000 then
    raise exception 'Le compte rendu doit contenir entre 3 et 4000 caractères' using errcode = '22023';
  end if;
  insert into public.ai_actions(agent, action, prospect_id, payload, ok)
  values ('crm', 'crm_note_added', p_prospect,
          jsonb_build_object('type', v_type, 'note', v_note, 'author_id', auth.uid()), true)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.crm_add_prospect_note(uuid, text, text) from public;
revoke all on function public.crm_add_prospect_note(uuid, text, text) from anon;
grant execute on function public.crm_add_prospect_note(uuid, text, text) to authenticated;
