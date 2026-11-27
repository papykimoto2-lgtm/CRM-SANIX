-- Audit des modifications de fiche prospect, quel que soit le chemin d'écriture (formulaire manuel, agent IA, trigger).
-- Une ligne « prospect_modifie » dans ai_actions : champs modifiés, ancienne et nouvelle valeur, auteur.
--   • humain connecté  : agent = 'utilisateur', payload.origine = 'manuel', author_id + auteur_nom (ai_operators)
--   • sans session     : agent = 'systeme',     payload.origine = 'automatique' (agents IA via service_role, déclencheurs)
-- Les colonnes purement techniques ou déjà tracées ailleurs sont ignorées (dates de mise à jour, derniers messages, normalisation).
create or replace function public.ai_audit_prospect()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_ignore text[] := array['updated_at', 'last_inbound_at', 'last_outbound_at', 'phone_norm', 'relances_sans_reponse', 'agent_lock_at', 'agent_rerun', 'segment_at'];
  v_changes jsonb := '{}'::jsonb;
  k text;
  v_uid uuid := auth.uid();
  v_nom text;
begin
  for k in select jsonb_object_keys(v_new) loop
    continue when k = any(v_ignore);
    if v_old -> k is distinct from v_new -> k then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_object(
        'avant', case when length((v_old -> k)::text) > 600 then to_jsonb(left((v_old -> k)::text, 600) || '…') else v_old -> k end,
        'apres', case when length((v_new -> k)::text) > 600 then to_jsonb(left((v_new -> k)::text, 600) || '…') else v_new -> k end));
    end if;
  end loop;
  if v_changes = '{}'::jsonb then return null; end if;

  if v_uid is not null then
    select nom into v_nom from public.ai_operators where user_id = v_uid;
  end if;
  insert into public.ai_actions(agent, action, prospect_id, payload, ok)
  values (case when v_uid is not null then 'utilisateur' else 'systeme' end, 'prospect_modifie', new.id,
          jsonb_build_object('origine', case when v_uid is not null then 'manuel' else 'automatique' end,
                             'author_id', v_uid, 'auteur_nom', v_nom, 'changements', v_changes), true);
  return null;
end
$function$;

drop trigger if exists ai_prospects_audit on public.ai_prospects;
create trigger ai_prospects_audit
  after update on public.ai_prospects
  for each row when (old.* is distinct from new.*)
  execute function public.ai_audit_prospect();
