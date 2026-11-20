-- Mode d'exécution des agents : « api » (le moteur appelle l'API Anthropic, facturée sur le crédit Console)
-- ou « abonnement » (les missions sont exécutées par Claude Code, sur l'abonnement du président, via une tâche planifiée).
-- Un agent en mode « abonnement » n'est JAMAIS lancé par le moteur : ses missions restent « a_faire » jusqu'à ce que l'exécuteur
-- planifié les réclame (ai_abonnement_reclamer) puis les clôture (ai_abonnement_cloturer, mêmes règles de clôture que le moteur).
alter table public.ai_agents add column if not exists mode_execution text not null default 'api' check (mode_execution in ('api', 'abonnement'));

-- Le moteur ignore les agents en mode « abonnement » (réclamation, reprise et blocage compris).
create or replace function public.ai_claim_tasks(p_n int) returns setof public.ai_agent_tasks
language plpgsql set search_path = public as $$
declare g public.ai_governance; r record;
begin
  perform pg_advisory_xact_lock(hashtext('ai_claim_tasks'));
  select * into g from public.ai_governance where id = 1;
  update public.ai_agent_tasks t set statut = 'a_faire',
         progression = left(coalesce(t.progression,'') || E'\n[Système] Exécution interrompue, reprise.', 8000)
   where t.statut = 'en_cours' and t.started_at < now() - interval '15 minutes'
     and not exists (select 1 from public.ai_agents a where a.id = t.agent_id and a.mode_execution = 'abonnement');
  for r in select t.id, t.agent_id, t.titre from public.ai_agent_tasks t
            where t.statut = 'a_faire' and t.executions - t.reprises >= g.max_executions_tache
              and not exists (select 1 from public.ai_agents a where a.id = t.agent_id and a.mode_execution = 'abonnement') loop
    update public.ai_agent_tasks set statut = 'bloquee' where id = r.id;
    perform public.ai_register_incident(r.agent_id, r.id, 'tentatives_epuisees', 'attention',
      'Mission « ' || r.titre || ' » bloquée après ' || g.max_executions_tache || ' exécutions', true);
  end loop;
  if not (public.ai_budget_check(null)->>'ok')::boolean then return; end if;

  return query
  with spend as (
    select x.agent_id, sum(x.cout_usd) as s from public.ai_actions x
     where x.action = 'llm_turn' and x.agent_id is not null
       and x.at >= date_trunc('day', now() at time zone 'Africa/Abidjan') at time zone 'Africa/Abidjan'
     group by x.agent_id),
  cand as (
    select t.id, t.priorite, t.created_at,
           row_number() over (partition by t.agent_id order by t.priorite, t.created_at) as rn
      from public.ai_agent_tasks t join public.ai_agents a on a.id = t.agent_id
      left join spend on spend.agent_id = a.id
     where t.statut = 'a_faire' and a.etat = 'actif' and a.activite <> 'en_reunion' and a.mode_execution = 'api'
       and coalesce(spend.s, 0) < coalesce(a.budget_jour_usd, g.budget_agent_jour_usd)
       and not exists (select 1 from public.ai_agent_tasks y where y.agent_id = t.agent_id and y.statut = 'en_cours')
       and not exists (select 1 from public.ai_task_dependencies d join public.ai_agent_tasks x on x.id = d.depend_de
                        where d.task_id = t.id and x.statut <> 'terminee')),
  pick as (select id from cand where rn = 1 order by priorite, created_at
            limit greatest(0, least(p_n, 20) - (select count(*) from public.ai_agent_tasks where statut = 'en_cours')))
  update public.ai_agent_tasks t set statut = 'en_cours', started_at = now(), executions = t.executions + 1
    from pick where t.id = pick.id and t.statut = 'a_faire'
  returning t.*;
end $$;

-- Réclame (au plus p_n, 5 maximum) les missions des agents actifs en mode « abonnement » : une mission à la fois par agent,
-- dépendances respectées. Renvoie pour chaque mission la mission, l'agent et sa charte en vigueur. Une exécution restée « en_cours »
-- plus de 3 h (exécuteur interrompu) est remise « a_faire ».
create or replace function public.ai_abonnement_reclamer(p_n int default 1) returns jsonb
language plpgsql set search_path = public as $$
declare g public.ai_governance; r record; got public.ai_agent_tasks; out jsonb := '[]'::jsonb; n int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('ai_claim_tasks'));
  select * into g from public.ai_governance where id = 1;
  if not coalesce(g.actif, true) then return out; end if;   -- entreprise virtuelle en pause
  update public.ai_agent_tasks t set statut = 'a_faire',
         progression = left(coalesce(t.progression,'') || E'\n[Système] Exécution par abonnement interrompue, reprise.', 8000)
   where t.statut = 'en_cours' and t.started_at < now() - interval '3 hours'
     and exists (select 1 from public.ai_agents a where a.id = t.agent_id and a.mode_execution = 'abonnement');
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
      'charte', (select c.contenu from public.ai_agent_charters c where c.agent_id = got.agent_id order by c.version desc limit 1)));
    insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok, cout_usd)
      values ('abonnement', 'abonnement_reclamee', got.agent_id, got.id, jsonb_build_object('titre', got.titre), true, 0);
  end loop;
  return out;
end $$;

-- Clôture une mission réclamée par l'exécuteur « abonnement » : mêmes exigences que le moteur (une mission « terminee » porte un rapport factuel
-- et au moins un résultat vérifiable). Refuse toute mission d'un agent en mode « api » ou qui n'est pas « en_cours ».
create or replace function public.ai_abonnement_cloturer(p_task uuid, p_statut text, p_rapport text, p_resultats jsonb default '[]'::jsonb, p_progression text default null)
returns jsonb language plpgsql set search_path = public as $$
declare t public.ai_agent_tasks; a public.ai_agents;
begin
  if p_statut not in ('terminee', 'bloquee', 'echouee') then raise exception 'Statut refusé : terminee, bloquee ou echouee'; end if;
  select * into t from public.ai_agent_tasks where id = p_task for update;
  if t.id is null then raise exception 'Mission introuvable'; end if;
  select * into a from public.ai_agents where id = t.agent_id;
  if a.mode_execution <> 'abonnement' then raise exception 'Cet agent n''est pas en mode abonnement'; end if;
  if t.statut <> 'en_cours' then raise exception 'La mission n''est pas en cours (statut : %)', t.statut; end if;
  if coalesce(length(btrim(p_rapport)), 0) < 40 or length(p_rapport) > 20000 then raise exception 'Rapport factuel de 40 à 20000 caractères requis'; end if;
  if p_statut = 'terminee' and (jsonb_typeof(coalesce(p_resultats, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_resultats) = 0) then
    raise exception 'Une mission terminée porte au moins un résultat vérifiable (livrable, chiffre, identifiant)';
  end if;
  update public.ai_agent_tasks set statut = p_statut, rapport = p_rapport, resultats = coalesce(p_resultats, '[]'::jsonb),
         progression = left(coalesce(nullif(p_progression, ''), progression), 8000), finished_at = now(), updated_at = now()
   where id = t.id;
  insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_cloturee', t.agent_id, t.id, jsonb_build_object('statut', p_statut, 'titre', t.titre), p_statut = 'terminee', 0);
  return jsonb_build_object('ok', true, 'statut', p_statut);
end $$;

revoke all on function public.ai_abonnement_reclamer(int), public.ai_abonnement_cloturer(uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.ai_abonnement_reclamer(int), public.ai_abonnement_cloturer(uuid, text, text, jsonb, text) to service_role;
