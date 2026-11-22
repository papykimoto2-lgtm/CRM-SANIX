-- Reprise d'une mission « abonnement » interrompue : 2 h au lieu de 6 h.
-- Une exécution de la routine qui s'arrête sans clôturer laissait la mission « en cours » pendant 6 h, donc inutilisable ; 2 h suffisent largement (une mission dure quelques minutes ; les responsables en attente de leurs équipes sont en « attente_sous_taches », pas « en_cours »).
create or replace function public.ai_abonnement_reclamer(p_n int default 1) returns jsonb
language plpgsql set search_path = public as $$
declare g public.ai_governance; r record; got public.ai_agent_tasks; out jsonb := '[]'::jsonb; n int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('ai_claim_tasks'));
  select * into g from public.ai_governance where id = 1;
  if not coalesce(g.actif, true) then return out; end if;
  update public.ai_agent_tasks t set statut = 'a_faire',
         progression = left(coalesce(t.progression,'') || E'\n[Système] Exécution par abonnement interrompue, reprise.', 8000)
   where t.statut = 'en_cours' and t.started_at < now() - interval '2 hours'
     and exists (select 1 from public.ai_agents a where a.id = t.agent_id and a.mode_execution = 'abonnement');
  -- trop de tentatives ⇒ blocage + incident (comme ai_claim_tasks pour le mode API)
  for r in select t.id, t.agent_id, t.titre from public.ai_agent_tasks t join public.ai_agents a on a.id = t.agent_id
            where a.mode_execution = 'abonnement' and t.statut = 'a_faire' and t.executions - t.reprises >= g.max_executions_tache loop
    update public.ai_agent_tasks set statut = 'bloquee' where id = r.id;
    perform public.ai_register_incident(r.agent_id, r.id, 'tentatives_epuisees', 'attention',
      'Mission « ' || r.titre || ' » bloquée après ' || g.max_executions_tache || ' exécutions (mode abonnement)', true);
  end loop;
  for r in select t.id from public.ai_agent_tasks t join public.ai_agents a on a.id = t.agent_id
            where t.statut = 'a_faire' and a.etat = 'actif' and a.mode_execution = 'abonnement' and a.activite <> 'en_reunion'
              and not exists (select 1 from public.ai_task_dependencies d join public.ai_agent_tasks x on x.id = d.depend_de
                               where d.task_id = t.id and x.statut <> 'terminee')
            order by t.priorite, t.created_at loop
    exit when n >= greatest(1, least(p_n, 5));
    got := null;
    update public.ai_agent_tasks t set statut = 'en_cours', started_at = now(), executions = t.executions + 1
     where t.id = r.id and t.statut = 'a_faire'
       and not exists (select 1 from public.ai_agent_tasks y where y.agent_id = t.agent_id and y.statut = 'en_cours')
    returning t.* into got;
    if got.id is null then continue; end if;
    n := n + 1;
    out := out || jsonb_build_array(jsonb_build_object(
      'tache', jsonb_build_object('id', got.id, 'titre', got.titre, 'type', got.type, 'description', got.description, 'objectifs', got.objectifs,
                                 'entrees', got.entrees, 'priorite', got.priorite, 'echeance', got.echeance, 'progression', got.progression, 'executions', got.executions),
      'agent', (select jsonb_build_object('code', a.code, 'nom', a.nom, 'fonction', a.fonction, 'niveau', a.niveau, 'outils', a.outils, 'specialite', a.specialite, 'personnalite', a.personnalite)
                  from public.ai_agents a where a.id = got.agent_id),
      'charte', (select c.contenu from public.ai_agent_charters c where c.agent_id = got.agent_id order by c.version desc limit 1),
      -- mémoire : les souvenirs les plus importants et récents de l'agent + la mémoire partagée, plus ceux qui correspondent aux mots de la mission
      'memoire', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'contenu', q.contenu, 'tags', q.tags, 'partage', q.agent_id is null, 'date', q.created_at) order by q.rang)
                             from (select m.*, row_number() over (order by (m.fts @@ websearch_to_tsquery('french'::regconfig, left(got.titre, 300))) desc, m.importance desc, m.created_at desc) rang
                                     from public.ai_agent_memory m where m.agent_id = got.agent_id or m.agent_id is null) q where q.rang <= 8), '[]'::jsonb),
      -- compétences : méthodes de métier rattachées à l'agent (ai_skills)
      'competences', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'nom', s.nom, 'methode', s.contenu) order by k.ordre, s.code)
                                 from public.ai_agent_skills k join public.ai_skills s on s.code = k.skill_code and s.actif where k.agent_id = got.agent_id), '[]'::jsonb)));
    insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok, cout_usd)
      values ('abonnement', 'abonnement_reclamee', got.agent_id, got.id, jsonb_build_object('titre', got.titre), true, 0);
  end loop;
  return out;
end $$;

-- ===== Contenu des compétences (méthodes générales ; aucun chiffre ni fait propre à SANIX n'y est inventé : les faits viennent de la base et des sources lues) =====
