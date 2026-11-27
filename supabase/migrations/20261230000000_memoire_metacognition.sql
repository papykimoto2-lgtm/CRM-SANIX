-- Phase 5 : métacognition (qu'ai-je appris / que sais-je faire / que dois-je apprendre) et révision espacée. SQL pur, aucun coût IA.
alter table public.ai_agent_memory add column if not exists valide_at timestamptz;

-- Un souvenir validé depuis plus de 90 jours est « à revalider » ; revalider = valider de nouveau (date renouvelée)
create or replace function public.ai_memoire_valider(p_id bigint, p_ok boolean, p_motif text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.ai_agent_memory;
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  select * into r from public.ai_agent_memory where id = p_id for update;
  if r.id is null then raise exception 'Souvenir introuvable'; end if;
  if coalesce(p_ok, true) then
    update public.ai_agent_memory set statut = 'valide', valide_at = now(), importance = greatest(importance, 4::smallint), task_id = null where id = p_id;
  else
    insert into public.ai_agent_memory_archive(id, agent_id, contenu, tags, importance, task_id, created_at, motif)
      values (r.id, r.agent_id, r.contenu, r.tags, r.importance, r.task_id, r.created_at, left(nullif(btrim(coalesce(p_motif, '')), ''), 300)) on conflict (id) do nothing;
    delete from public.ai_agent_memory where id = p_id;
  end if;
  insert into public.ai_actions(agent, action, agent_id, payload, ok, cout_usd)
    values ('memoire', case when coalesce(p_ok, true) then 'souvenir_valide' else 'souvenir_archive' end, r.agent_id, jsonb_build_object('id', p_id), true, 0);
  return jsonb_build_object('ok', true, 'statut', case when coalesce(p_ok, true) then 'valide' else 'archive' end);
end $$;

drop function if exists public.ai_memoire_liste(uuid, boolean, text, int);
create function public.ai_memoire_liste(p_agent uuid default null, p_partage boolean default false, p_statut text default null, p_n int default 60)
returns table (id bigint, agent_id uuid, agent_nom text, contenu text, tags text[], importance smallint, statut text, source text, experience boolean, a_revalider boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  return query
    select m.id, m.agent_id, coalesce(a.nom, 'Partagée'), m.contenu, m.tags, m.importance, m.statut, m.source, m.task_id is not null,
           (m.statut = 'valide' and coalesce(m.valide_at, m.created_at) < now() - interval '90 days'), m.created_at
      from public.ai_agent_memory m left join public.ai_agents a on a.id = m.agent_id
     where (p_agent is null or m.agent_id = p_agent) and (not coalesce(p_partage, false) or m.agent_id is null)
       and (p_statut is null or (p_statut = 'valide' and m.statut = 'valide') or (p_statut = 'a_verifier' and m.statut = 'a_verifier' and m.task_id is null)
            or (p_statut = 'experience' and m.task_id is not null) or (p_statut = 'a_revalider' and m.statut = 'valide' and coalesce(m.valide_at, m.created_at) < now() - interval '90 days'))
     order by (m.statut = 'valide' and coalesce(m.valide_at, m.created_at) < now() - interval '90 days') desc, m.statut = 'valide' desc, m.importance desc, m.created_at desc limit greatest(1, least(coalesce(p_n, 60), 200));
end $$;

-- Les trois questions de Jarvis
create or replace function public.ai_memoire_metacognition() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare auj timestamptz := date_trunc('day', now() at time zone 'Africa/Abidjan') at time zone 'Africa/Abidjan';
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  return jsonb_build_object(
    'aujourdhui', jsonb_build_object(
      'souvenirs', (select count(*) from public.ai_agent_memory where created_at >= auj and task_id is null and source is null),
      'experiences', (select count(*) from public.ai_agent_memory where created_at >= auj and task_id is not null),
      'lecons', (select count(*) from public.ai_agent_memory where created_at >= auj and source like 'stage:%'),
      'bilans', (select count(*) from public.ai_agent_memory where created_at >= auj and source like 'bilan:%'),
      'dossiers', (select count(*) from public.ai_prospect_memory where created_at >= auj),
      'exemples', coalesce((select jsonb_agg(left(x.contenu, 140)) from (select contenu from public.ai_agent_memory where created_at >= auj and (task_id is null) order by importance desc, created_at desc limit 3) x), '[]'::jsonb)),
    'nouveau', coalesce((select jsonb_agg(left(x.contenu, 140)) from (select contenu from public.ai_agent_memory where statut = 'valide' and coalesce(valide_at, created_at) >= now() - interval '14 days' order by coalesce(valide_at, created_at) desc limit 4) x), '[]'::jsonb),
    'a_apprendre', jsonb_build_object(
      'erreurs_repetees', (select count(*) from public.ai_agent_memory where tags @> array['erreur_repetee'] and created_at >= now() - interval '14 days'),
      'a_verifier', (select count(*) from public.ai_agent_memory where statut = 'a_verifier' and task_id is null),
      'a_revalider', (select count(*) from public.ai_agent_memory where statut = 'valide' and coalesce(valide_at, created_at) < now() - interval '90 days'),
      'agents_peu_evalues', coalesce((select jsonb_agg(c.nom) from public.ai_competences_mesurees() c where c.insuffisant and c.missions >= 3), '[]'::jsonb)));
end $$;

create or replace function public.ai_memoire_centre() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  return jsonb_build_object(
    'souvenirs', (select count(*) from public.ai_agent_memory),
    'partages', (select count(*) from public.ai_agent_memory where agent_id is null),
    'valides', (select count(*) from public.ai_agent_memory where statut = 'valide'),
    'a_verifier', (select count(*) from public.ai_agent_memory where statut = 'a_verifier' and task_id is null),
    'a_revalider', (select count(*) from public.ai_agent_memory where statut = 'valide' and coalesce(valide_at, created_at) < now() - interval '90 days'),
    'experiences', (select count(*) from public.ai_agent_memory where task_id is not null),
    'archives', (select count(*) from public.ai_agent_memory_archive),
    'jarvis', (select count(*) from public.ai_jarvis_memory),
    'dossiers', (select count(*) from public.ai_prospect_memory),
    'erreurs_repetees', (select count(*) from public.ai_agent_memory where tags @> array['erreur_repetee'] and created_at >= now() - interval '14 days'),
    'par_agent', coalesce((select jsonb_agg(jsonb_build_object('agent_id', x.agent_id, 'nom', coalesce(a.nom, 'Partagée'), 'n', x.n) order by x.n desc)
                             from (select agent_id, count(*) n from public.ai_agent_memory group by agent_id) x left join public.ai_agents a on a.id = x.agent_id), '[]'::jsonb));
end $$;

revoke all on function public.ai_memoire_liste(uuid, boolean, text, int), public.ai_memoire_metacognition(), public.ai_memoire_valider(bigint, boolean, text), public.ai_memoire_centre() from public, anon, authenticated;
grant execute on function public.ai_memoire_liste(uuid, boolean, text, int), public.ai_memoire_metacognition(), public.ai_memoire_valider(bigint, boolean, text), public.ai_memoire_centre() to authenticated;
