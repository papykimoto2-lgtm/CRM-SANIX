-- Mémoire des agents : chaque agent se souvient de ses missions, en mode API comme en mode abonnement.
-- 1. Mémoire automatique : à la clôture d'une mission (terminée, bloquée, échouée), un souvenir court est enregistré pour l'agent (un par mission).
-- 2. Mode abonnement : la réclamation fournit les 8 souvenirs les plus pertinents (agent + mémoire partagée) ; ai_abonnement_memoriser / ai_abonnement_rappeler
--    reprennent les règles du moteur (5 mémorisations par mission, mémoire partagée réservée aux niveaux 3 et moins).
alter table public.ai_agent_memory add column if not exists task_id uuid references public.ai_agent_tasks(id) on delete set null;
create unique index if not exists ai_memory_task_uq on public.ai_agent_memory(task_id) where task_id is not null;

create or replace function public.ai_memoire_mission() returns trigger language plpgsql set search_path = public as $$
declare lib text;
begin
  if new.statut not in ('terminee', 'bloquee', 'echouee') or old.statut is not distinct from new.statut then return new; end if;
  lib := case new.statut when 'terminee' then 'terminée' when 'bloquee' then 'bloquée' else 'échouée' end;
  insert into public.ai_agent_memory(agent_id, contenu, tags, importance, task_id)
  values (new.agent_id,
          left(format('[%s] Mission « %s » %s. %s', to_char(coalesce(new.finished_at, now()) at time zone 'Africa/Abidjan', 'DD/MM/YYYY'), left(new.titre, 120), lib, coalesce(left(regexp_replace(coalesce(new.rapport, ''), '\s+', ' ', 'g'), 600), '')), 4000),
          array['mission', new.statut], case when new.statut = 'terminee' then 2 else 3 end, new.id)
  on conflict (task_id) where task_id is not null do nothing;
  -- au plus 60 souvenirs automatiques par agent : les plus anciens et les moins importants sont retirés
  delete from public.ai_agent_memory where id in (select id from public.ai_agent_memory where agent_id = new.agent_id and task_id is not null order by importance desc, created_at desc offset 60);
  return new;
end $$;
drop trigger if exists ai_memoire_mission_trg on public.ai_agent_tasks;
create trigger ai_memoire_mission_trg after update of statut on public.ai_agent_tasks for each row execute function public.ai_memoire_mission();

-- Réclamation avec mémoire
create or replace function public.ai_abonnement_reclamer(p_n int default 1) returns jsonb
language plpgsql set search_path = public as $$
declare g public.ai_governance; r record; got public.ai_agent_tasks; out jsonb := '[]'::jsonb; n int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('ai_claim_tasks'));
  select * into g from public.ai_governance where id = 1;
  if not coalesce(g.actif, true) then return out; end if;
  update public.ai_agent_tasks t set statut = 'a_faire',
         progression = left(coalesce(t.progression,'') || E'\n[Système] Exécution par abonnement interrompue, reprise.', 8000)
   where t.statut = 'en_cours' and t.started_at < now() - interval '6 hours'
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
                                     from public.ai_agent_memory m where m.agent_id = got.agent_id or m.agent_id is null) q where q.rang <= 8), '[]'::jsonb)));
    insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok, cout_usd)
      values ('abonnement', 'abonnement_reclamee', got.agent_id, got.id, jsonb_build_object('titre', got.titre), true, 0);
  end loop;
  return out;
end $$;

create or replace function public.ai_abonnement_memoriser(p_task uuid, p_contenu text, p_tags text[] default '{}', p_partage boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare t public.ai_agent_tasks; a public.ai_agents; n int; v text := btrim(coalesce(p_contenu, ''));
begin
  select * into t from public.ai_agent_tasks where id = p_task for update;
  if t.id is null then raise exception 'Mission introuvable'; end if;
  select * into a from public.ai_agents where id = t.agent_id;
  if a.mode_execution <> 'abonnement' or a.etat <> 'actif' then raise exception 'L''agent n''est pas actif en mode abonnement'; end if;
  if t.statut <> 'en_cours' then raise exception 'La mission n''est pas en cours (statut : %)', t.statut; end if;
  if length(v) < 3 then raise exception 'Contenu trop court'; end if;
  if coalesce(p_partage, false) and a.niveau > 3 then raise exception 'La mémoire partagée est réservée aux niveaux ≤ 3'; end if;
  select count(*) into n from public.ai_actions where action = 'abonnement_memorisation' and task_id = t.id;
  if n >= 5 then raise exception 'Limite de 5 mémorisations par mission'; end if;
  insert into public.ai_agent_memory(agent_id, contenu, tags, importance) values (case when coalesce(p_partage, false) then null else a.id end, left(v, 4000), coalesce(array(select left(btrim(x), 40) from unnest(coalesce(p_tags, '{}')) x where btrim(x) <> '' limit 6), '{}'), 3);
  insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_memorisation', a.id, t.id, jsonb_build_object('partage', coalesce(p_partage, false)), true, 0);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.ai_abonnement_rappeler(p_task uuid, p_requete text)
returns jsonb language plpgsql set search_path = public as $$
declare t public.ai_agent_tasks; a public.ai_agents; r jsonb;
begin
  select * into t from public.ai_agent_tasks where id = p_task;
  if t.id is null then raise exception 'Mission introuvable'; end if;
  select * into a from public.ai_agents where id = t.agent_id;
  if a.mode_execution <> 'abonnement' then raise exception 'Cet agent n''est pas en mode abonnement'; end if;
  if length(btrim(coalesce(p_requete, ''))) < 2 then raise exception 'Requête trop courte'; end if;
  select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into r from public.ai_memory_search(a.id, left(p_requete, 300), 8) s;
  return case when jsonb_array_length(r) = 0 then jsonb_build_object('info', 'Rien en mémoire sur ce sujet') else r end;
end $$;

revoke all on function public.ai_abonnement_memoriser(uuid, text, text[], boolean), public.ai_abonnement_rappeler(uuid, text) from public, anon, authenticated;
grant execute on function public.ai_abonnement_memoriser(uuid, text, text[], boolean), public.ai_abonnement_rappeler(uuid, text) to service_role;
