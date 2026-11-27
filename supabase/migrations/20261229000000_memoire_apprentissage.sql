-- Phase 4 : apprentissage mesuré, 100 % SQL (aucun coût IA).
-- 1. Bilan hebdomadaire par agent -> souvenir « à vérifier » ; 2. erreurs répétées -> souvenir d'importance 5 (toujours rappelé) ;
-- 3. compétences mesurées à partir des évaluations réelles (jamais de points gratuits) ; 4. les leçons VALIDÉES (mémoire partagée) sont déjà transmises à tous les agents par le rappel existant.

create or replace function public.ai_apprentissage_bilan(p_jours int default 7) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; sem text := to_char(now() at time zone 'Africa/Abidjan', 'IYYY-"S"IW'); n_bilan int := 0; n_err int := 0; f record; ech text;
begin
  for r in
    select t.agent_id, a.nom,
           count(*) filter (where t.statut = 'terminee') ok, count(*) filter (where t.statut = 'echouee') ko, count(*) filter (where t.statut = 'bloquee') bl,
           round(avg(t.evaluation) filter (where t.evaluation is not null), 0) eva, count(*) filter (where t.evaluation is not null) n_eva
      from public.ai_agent_tasks t join public.ai_agents a on a.id = t.agent_id
     where t.finished_at >= now() - make_interval(days => greatest(1, least(coalesce(p_jours, 7), 31))) and t.statut in ('terminee', 'echouee', 'bloquee') and a.etat <> 'archive'
     group by t.agent_id, a.nom having count(*) >= 2 loop
    select string_agg(x.t, ' ; ') into ech from (select left(regexp_replace(k.titre, '\s+', ' ', 'g'), 60) t from public.ai_agent_tasks k
       where k.agent_id = r.agent_id and k.statut in ('echouee', 'bloquee') and k.finished_at >= now() - make_interval(days => greatest(1, least(coalesce(p_jours, 7), 31))) order by k.finished_at desc limit 3) x;
    insert into public.ai_agent_memory(agent_id, contenu, tags, importance, source)
      values (r.agent_id, left(format('[Bilan %s] %s mission(s) terminée(s), %s échouée(s), %s bloquée(s)%s%s',
        sem, r.ok, r.ko, r.bl,
        case when r.eva is null then ', aucune évaluation' else format(', évaluation moyenne %s/100 (%s mission(s) évaluée(s))', r.eva, r.n_eva) end,
        case when ech is null then '.' else '. À éviter ou revoir : ' || ech || '.' end), 1000), array['bilan', 'apprentissage'], 3, 'bilan:' || r.agent_id || ':' || sem)
      on conflict (source) where source like 'stage:%' or source like 'bilan:%' or source like 'erreur:%' do nothing;
    if found then n_bilan := n_bilan + 1; end if;
  end loop;
  -- erreurs répétées : au moins 3 échecs/blocages de même intitulé (60 premiers caractères) pour un agent en 14 jours
  for f in
    select k.agent_id, left(lower(regexp_replace(k.titre, '\s+', ' ', 'g')), 60) cle, count(*) n, min(left(regexp_replace(k.titre, '\s+', ' ', 'g'), 90)) ex
      from public.ai_agent_tasks k where k.statut in ('echouee', 'bloquee') and k.finished_at >= now() - interval '14 days'
     group by 1, 2 having count(*) >= 3 loop
    insert into public.ai_agent_memory(agent_id, contenu, tags, importance, source)
      values (f.agent_id, left(format('[Erreur répétée %s] « %s » a échoué ou été bloquée %s fois en 14 jours : ne pas reprendre la même approche, vérifier la cause avant de relancer.', sem, f.ex, f.n), 1000),
              array['erreur_repetee', 'apprentissage'], 5, 'erreur:' || f.agent_id || ':' || md5(f.cle) || ':' || sem)
      on conflict (source) where source like 'stage:%' or source like 'bilan:%' or source like 'erreur:%' do nothing;
    if found then n_err := n_err + 1; end if;
  end loop;
  -- plafond : 60 bilans et 40 erreurs par agent conservés (validés d'abord)
  delete from public.ai_agent_memory where id in (select id from (select id, row_number() over (partition by agent_id, split_part(source, ':', 1) order by statut = 'valide' desc, created_at desc) rn, split_part(source, ':', 1) k
      from public.ai_agent_memory where source like 'bilan:%' or source like 'erreur:%') z where (z.k = 'bilan' and z.rn > 60) or (z.k = 'erreur' and z.rn > 40));
  return jsonb_build_object('bilans', n_bilan, 'erreurs_repetees', n_err);
end $$;

-- l'index unique couvre désormais les trois familles de souvenirs calculés
drop index if exists public.ai_memory_source_uq;
create unique index if not exists ai_memory_source_uq on public.ai_agent_memory (source) where source like 'stage:%' or source like 'bilan:%' or source like 'erreur:%';

-- Compétences mesurées (direction) : niveau 0-100 = moyenne des évaluations réelles sur 30 jours ; « insuffisant » sous 5 évaluations
create or replace function public.ai_competences_mesurees() returns table (agent_id uuid, nom text, fonction text, missions int, terminees int, taux int, evaluees int, niveau int, insuffisant boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  return query
    select a.id, a.nom, a.fonction, count(t.id)::int, (count(t.id) filter (where t.statut = 'terminee'))::int,
           case when count(t.id) = 0 then 0 else round(100.0 * count(t.id) filter (where t.statut = 'terminee') / count(t.id))::int end,
           (count(t.id) filter (where t.evaluation is not null))::int,
           case when count(t.id) filter (where t.evaluation is not null) >= 5 then round(avg(t.evaluation))::int end,
           count(t.id) filter (where t.evaluation is not null) < 5
      from public.ai_agents a left join public.ai_agent_tasks t on t.agent_id = a.id and t.finished_at >= now() - interval '30 days' and t.statut in ('terminee', 'echouee', 'bloquee')
     where a.etat <> 'archive' group by a.id, a.nom, a.fonction order by 8 desc nulls last, 4 desc;
end $$;

-- Compteur d'erreurs répétées dans le Centre mémoire
create or replace function public.ai_memoire_centre() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  return jsonb_build_object(
    'souvenirs', (select count(*) from public.ai_agent_memory),
    'partages', (select count(*) from public.ai_agent_memory where agent_id is null),
    'valides', (select count(*) from public.ai_agent_memory where statut = 'valide'),
    'a_verifier', (select count(*) from public.ai_agent_memory where statut = 'a_verifier' and task_id is null),
    'experiences', (select count(*) from public.ai_agent_memory where task_id is not null),
    'archives', (select count(*) from public.ai_agent_memory_archive),
    'jarvis', (select count(*) from public.ai_jarvis_memory),
    'dossiers', (select count(*) from public.ai_prospect_memory),
    'erreurs_repetees', (select count(*) from public.ai_agent_memory where tags @> array['erreur_repetee'] and created_at >= now() - interval '14 days'),
    'par_agent', coalesce((select jsonb_agg(jsonb_build_object('agent_id', x.agent_id, 'nom', coalesce(a.nom, 'Partagée'), 'n', x.n) order by x.n desc)
                             from (select agent_id, count(*) n from public.ai_agent_memory group by agent_id) x left join public.ai_agents a on a.id = x.agent_id), '[]'::jsonb));
end $$;

revoke all on function public.ai_apprentissage_bilan(int), public.ai_competences_mesurees(), public.ai_memoire_centre() from public, anon, authenticated;
grant execute on function public.ai_competences_mesurees(), public.ai_memoire_centre() to authenticated;
grant execute on function public.ai_apprentissage_bilan(int) to service_role;

-- Bilan chaque lundi 06:00 (heure d'Abidjan = UTC)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ai_apprentissage_hebdo';
    perform cron.schedule('ai_apprentissage_hebdo', '0 6 * * 1', 'select public.ai_apprentissage_bilan(7);');
  end if;
end $$;
