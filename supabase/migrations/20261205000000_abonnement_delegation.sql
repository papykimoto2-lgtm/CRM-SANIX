-- Délégation encadrée pour les responsables exécutés en mode « abonnement » (routine Claude Code).
-- Mêmes règles que le moteur (tools.ts : assigner_mission, attendre_sous_taches, evaluer_tache) : hiérarchie descendante uniquement,
-- agent cible actif, dépendances limitées aux sous-missions de la mission mère, logiciel du catalogue actif, plafonds de gouvernance
-- (sous-missions, profondeur, missions par agent : triggers ai_tasks_before), mission identique refusée (index unique), reprise de la mission
-- mère à la fin des sous-missions (trigger ai_tasks_after). Réservées au service ; l'acteur est toujours l'agent de la mission réclamée.

create or replace function public.ai_abonnement_assigner(
  p_parent uuid, p_agent_code text, p_titre text, p_description text, p_objectifs jsonb, p_priorite int,
  p_echeance_heures int default null, p_entrees text default null, p_depend_de uuid[] default '{}', p_produit text default null, p_resultat_attendu text default null)
returns jsonb language plpgsql set search_path = public as $$
declare par public.ai_agent_tasks; act public.ai_agents; tgt public.ai_agents; v_produit text; v_id uuid; d uuid; nb int; v_obj jsonb;
begin
  select * into par from public.ai_agent_tasks where id = p_parent for update;
  if par.id is null then raise exception 'Mission mère introuvable'; end if;
  if par.statut <> 'en_cours' then raise exception 'La mission mère n''est pas en cours (statut : %)', par.statut; end if;
  select * into act from public.ai_agents where id = par.agent_id;
  if act.mode_execution <> 'abonnement' or act.etat <> 'actif' then raise exception 'L''agent de la mission mère n''est pas actif en mode abonnement'; end if;
  select * into tgt from public.ai_agents where code = p_agent_code;
  if tgt.id is null then raise exception 'Agent « % » introuvable', left(coalesce(p_agent_code, ''), 60); end if;
  if tgt.niveau <= 1 or tgt.id = act.id or not exists (
       with recursive d as (select id from public.ai_agents where manager_id = act.id union select a.id from public.ai_agents a join d on a.manager_id = d.id)
       select 1 from d where d.id = tgt.id) then
    raise exception 'Autorité insuffisante : % n''est pas un subordonné de %', tgt.nom, act.nom;
  end if;
  if tgt.etat <> 'actif' then raise exception '% n''est pas actif (%)', tgt.nom, tgt.etat; end if;
  if length(btrim(coalesce(p_titre, ''))) < 3 or length(btrim(coalesce(p_description, ''))) < 3 then raise exception 'Titre et description requis'; end if;
  v_obj := case when jsonb_typeof(coalesce(p_objectifs, 'null'::jsonb)) = 'array' then p_objectifs else '[]'::jsonb end;
  foreach d in array coalesce(p_depend_de, '{}') loop
    if not exists (select 1 from public.ai_agent_tasks where id = d and parent_id = p_parent) then
      raise exception 'depend_de : uniquement des missions créées dans la mission mère';
    end if;
  end loop;
  v_produit := par.produit;
  if nullif(btrim(coalesce(p_produit, '')), '') is not null then
    select id into v_produit from public.ai_products where id = lower(btrim(p_produit)) and actif;
    if v_produit is null then raise exception 'Logiciel hors périmètre commercial actuel : seuls les logiciels actifs du catalogue sont autorisés'; end if;
  end if;
  begin
    insert into public.ai_agent_tasks(produit, resultat_attendu, parent_id, agent_id, donneur_agent_id, type, titre, description, objectifs, entrees, priorite, echeance)
    values (v_produit, nullif(left(btrim(coalesce(p_resultat_attendu, '')), 1000), ''), p_parent, tgt.id, act.id, case when act.niveau <= 3 then 'mission' else 'tache' end,
            left(btrim(p_titre), 200), left(btrim(p_description), 8000), v_obj, left(p_entrees, 20000), greatest(1, least(coalesce(p_priorite, 3), 5)),
            case when p_echeance_heures is not null then now() + make_interval(hours => greatest(1, least(p_echeance_heures, 2160))) end)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Une mission identique est déjà ouverte pour cet agent : ne la recrée pas';
  end;
  foreach d in array coalesce(p_depend_de, '{}') loop insert into public.ai_task_dependencies(task_id, depend_de) values (v_id, d); end loop;
  insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_assignation', act.id, par.id, jsonb_build_object('vers', tgt.code, 'sous_mission', v_id, 'titre', left(p_titre, 120)), true, 0);
  return jsonb_build_object('task_id', v_id, 'agent', tgt.code, 'statut', 'a_faire');
end $$;

-- Met la mission en attente de ses sous-missions (reprise automatique à leur fin, comme dans le moteur).
create or replace function public.ai_abonnement_attendre(p_task uuid) returns jsonb
language plpgsql set search_path = public as $$
declare t public.ai_agent_tasks; a public.ai_agents; ouvertes int;
begin
  select * into t from public.ai_agent_tasks where id = p_task for update;
  if t.id is null then raise exception 'Mission introuvable'; end if;
  select * into a from public.ai_agents where id = t.agent_id;
  if a.mode_execution <> 'abonnement' then raise exception 'Cet agent n''est pas en mode abonnement'; end if;
  if t.statut <> 'en_cours' then raise exception 'La mission n''est pas en cours (statut : %)', t.statut; end if;
  select count(*) into ouvertes from public.ai_agent_tasks c where c.parent_id = t.id and c.statut in ('a_faire','en_cours','attente_sous_taches','attente_validation');
  if ouvertes = 0 then raise exception 'Aucune sous-mission en cours : conclus avec ai_abonnement_cloturer'; end if;
  update public.ai_agent_tasks set statut = 'attente_sous_taches', updated_at = now() where id = t.id and statut = 'en_cours';
  insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_attente', a.id, t.id, jsonb_build_object('ouvertes', ouvertes), true, 0);
  return jsonb_build_object('ok', true, 'statut', 'attente_sous_taches', 'sous_missions_ouvertes', ouvertes);
end $$;

-- Évalue (0-100) le travail terminé d'un subordonné ; l'acteur est l'agent de la mission mère p_parent.
create or replace function public.ai_abonnement_evaluer(p_parent uuid, p_task uuid, p_note int, p_commentaire text) returns jsonb
language plpgsql set search_path = public as $$
declare par public.ai_agent_tasks; act public.ai_agents; t public.ai_agent_tasks; note int := greatest(0, least(coalesce(p_note, 0), 100));
begin
  select * into par from public.ai_agent_tasks where id = p_parent;
  if par.id is null or par.statut <> 'en_cours' then raise exception 'La mission de l''évaluateur doit être en cours'; end if;
  select * into act from public.ai_agents where id = par.agent_id;
  if act.mode_execution <> 'abonnement' or act.etat <> 'actif' then raise exception 'L''évaluateur n''est pas actif en mode abonnement'; end if;
  select * into t from public.ai_agent_tasks where id = p_task;
  if t.id is null then raise exception 'Mission introuvable'; end if;
  if t.statut not in ('terminee', 'echouee', 'bloquee') then raise exception 'Seule une mission terminée peut être évaluée'; end if;
  if not (t.donneur_agent_id = act.id or exists (
       with recursive d as (select id from public.ai_agents where manager_id = act.id union select a.id from public.ai_agents a join d on a.manager_id = d.id)
       select 1 from d where d.id = t.agent_id)) then raise exception 'Autorité insuffisante pour évaluer cette mission'; end if;
  if length(btrim(coalesce(p_commentaire, ''))) < 3 then raise exception 'Commentaire requis'; end if;
  update public.ai_agent_tasks set evaluation = note, evaluation_commentaire = left(btrim(p_commentaire), 2000) where id = t.id;
  insert into public.ai_agent_communications(de_agent_id, vers_agent_id, task_id, type, objet, contenu)
    values (act.id, t.agent_id, t.id, 'decision', left('Évaluation : ' || note || '/100 — ' || t.titre, 200), left(btrim(p_commentaire), 8000));
  insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_evaluation', act.id, t.id, jsonb_build_object('note', note), true, 0);
  return jsonb_build_object('ok', true, 'note', note);
end $$;

revoke all on function public.ai_abonnement_assigner(uuid, text, text, text, jsonb, int, int, text, uuid[], text, text), public.ai_abonnement_attendre(uuid), public.ai_abonnement_evaluer(uuid, uuid, int, text) from public, anon, authenticated;
grant execute on function public.ai_abonnement_assigner(uuid, text, text, text, jsonb, int, int, text, uuid[], text, text), public.ai_abonnement_attendre(uuid), public.ai_abonnement_evaluer(uuid, uuid, int, text) to service_role;
