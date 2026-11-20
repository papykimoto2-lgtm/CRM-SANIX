-- Correction des e-mails de prospects par l'agent « Data Analyst » exécuté en mode « abonnement » (routine Claude Code).
-- Écriture CRM la plus étroite possible : SEUL le champ e-mail d'une fiche peut changer. Règles : agent actif en mode abonnement avec l'outil
-- update_prospect, mission en cours, adresse valide (normalisée en minuscules, sans espaces), doublon refusé (index unique), aucun effacement,
-- et un ajout (fiche sans e-mail) exige une source https. Chaque changement est journalisé (avant, après, motif). Réservée au service.
create or replace function public.ai_abonnement_corriger_email(p_task uuid, p_prospect uuid, p_email text, p_motif text, p_source_url text default null)
returns jsonb language plpgsql set search_path = public as $$
declare t public.ai_agent_tasks; a public.ai_agents; p public.ai_prospects; v_new text := lower(btrim(coalesce(p_email, '')));
begin
  select * into t from public.ai_agent_tasks where id = p_task for update;
  if t.id is null then raise exception 'Mission introuvable'; end if;
  select * into a from public.ai_agents where id = t.agent_id;
  if a.mode_execution <> 'abonnement' or a.etat <> 'actif' then raise exception 'L''agent n''est pas actif en mode abonnement'; end if;
  if t.statut <> 'en_cours' then raise exception 'La mission n''est pas en cours (statut : %)', t.statut; end if;
  if not ('update_prospect' = any(a.outils)) then raise exception 'Cet agent n''a pas l''outil update_prospect'; end if;
  if v_new !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_new) > 200 then raise exception 'Adresse invalide : rien n''est modifié'; end if;
  if length(btrim(coalesce(p_motif, ''))) < 5 then raise exception 'Motif de la correction requis'; end if;
  select * into p from public.ai_prospects where id = p_prospect for update;
  if p.id is null then raise exception 'Prospect introuvable'; end if;
  if p.email is null and coalesce(p_source_url, '') !~* '^https://' then raise exception 'Ajout d''une adresse : source_url https obligatoire (page où elle est publiée)'; end if;
  if p.email is not distinct from v_new then return jsonb_build_object('info', 'Adresse déjà identique', 'prospect_id', p.id); end if;
  begin
    update public.ai_prospects set email = v_new, updated_at = now() where id = p.id;
  exception when unique_violation then
    return jsonb_build_object('doublon', true, 'info', 'Cette adresse existe déjà sur une autre fiche : rien n''est modifié');
  end;
  insert into public.ai_actions(agent, action, agent_id, task_id, prospect_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_email_corrige', a.id, t.id, p.id, jsonb_build_object('avant', p.email, 'apres', v_new, 'motif', left(p_motif, 300), 'source', left(p_source_url, 300)), true, 0);
  return jsonb_build_object('ok', true, 'prospect_id', p.id, 'avant', p.email, 'apres', v_new);
end $$;

revoke all on function public.ai_abonnement_corriger_email(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.ai_abonnement_corriger_email(uuid, uuid, text, text, text) to service_role;
