-- Phase 7 : Goal Engine. Objectifs chiffrés suivis sur les DONNÉES RÉELLES du CRM (entonnoir cumulé), jamais sur la déclaration d'un agent.
-- SQL pur, aucun coût IA. Réservé à la direction (création, lecture, clôture).

create or replace function public.ai_stage_rang(p_stage text) returns int language sql immutable as $$
  select coalesce(array_position(array['identifie','enregistre','qualifie','premier_contact','conversation','besoin_identifie','interesse','rdv_propose','rdv_confirme','demo_realisee','offre_transmise','negociation','offre_acceptee','contrat_transmis','contrat_signe','paiement_attendu','paiement_confirme','marche_gagne','deploiement','client_fidelise'], p_stage), 0)
$$;

create table if not exists public.ai_goals (
  id         uuid primary key default gen_random_uuid(),
  titre      text not null check (length(titre) between 3 and 120),
  metrique   text not null check (metrique in ('qualifies', 'contactes', 'conversations', 'rdv', 'demos', 'offres', 'contrats')),
  produit    text check (produit is null or length(produit) <= 40),
  cible      int not null check (cible between 1 and 100000),
  baseline   int not null default 0,
  debut      timestamptz not null default now(),
  echeance   timestamptz not null,
  agent_id   uuid references public.ai_agents(id) on delete set null,
  statut     text not null default 'actif' check (statut in ('actif', 'atteint', 'abandonne')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  cloture_at timestamptz,
  check (echeance > debut)
);
create index if not exists ai_goals_actif_idx on public.ai_goals (statut, echeance);
alter table public.ai_goals enable row level security;
revoke all on public.ai_goals from anon, authenticated;

-- Valeur courante d'un indicateur : prospects ayant atteint au moins l'étape (entonnoir cumulé), fiches de test exclues
create or replace function public.ai_goal_valeur(p_metrique text, p_produit text default null) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.ai_prospects p
   where public.ai_stage_rang(p.stage) >= case p_metrique when 'qualifies' then 3 when 'contactes' then 4 when 'conversations' then 5 when 'rdv' then 9 when 'demos' then 10 when 'offres' then 11 when 'contrats' then 15 else 999 end
     and p.entreprise !~* 'fiche de test' and p.entreprise !~* '^TEST\M'
     and (p_produit is null or p_produit = any (p.produits_recommandes))
$$;

-- Calcul commun (sans contrôle d'accès, non exposé)
create or replace function public.ai_goals_calc() returns table (id uuid, titre text, metrique text, produit text, agent_id uuid, agent_nom text, cible int, baseline int, actuel int, fait int, pct int, temps_pct int, etat text, statut text, debut timestamptz, echeance timestamptz)
language sql stable security definer set search_path = public as $$
  select g.id, g.titre, g.metrique, g.produit, g.agent_id, a.nom, g.cible, g.baseline, v.actuel, v.fait,
         least(100, round(100.0 * v.fait / g.cible))::int, t.tp,
         case when g.statut <> 'actif' then g.statut
              when v.fait >= g.cible then 'atteint'
              when now() > g.echeance then 'echeance_depassee'
              when t.tp >= 20 and round(100.0 * v.fait / g.cible) < t.tp - 15 then 'en_retard'
              else 'en_bonne_voie' end,
         g.statut, g.debut, g.echeance
    from public.ai_goals g
    left join public.ai_agents a on a.id = g.agent_id
    cross join lateral (select public.ai_goal_valeur(g.metrique, g.produit) actuel) c
    cross join lateral (select c.actuel, greatest(0, c.actuel - g.baseline) fait) v
    cross join lateral (select least(100, greatest(0, round(100.0 * extract(epoch from (now() - g.debut)) / extract(epoch from (g.echeance - g.debut)))))::int tp) t
$$;

create or replace function public.ai_goal_creer(p_titre text, p_metrique text, p_cible int, p_echeance timestamptz, p_produit text default null, p_agent uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g public.ai_goals; prod text := nullif(btrim(coalesce(p_produit, '')), '');
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  if p_echeance is null or p_echeance <= now() or p_echeance > now() + interval '400 days' then raise exception 'Échéance invalide (dans le futur, 400 jours maximum)'; end if;
  if prod is not null and not exists (select 1 from public.ai_products where id = prod) then raise exception 'Produit inconnu'; end if;
  if p_agent is not null and not exists (select 1 from public.ai_agents where id = p_agent) then raise exception 'Agent inconnu'; end if;
  insert into public.ai_goals(titre, metrique, produit, cible, baseline, echeance, agent_id)
    values (btrim(p_titre), p_metrique, prod, p_cible, public.ai_goal_valeur(p_metrique, prod), p_echeance, p_agent) returning * into g;
  insert into public.ai_actions(agent, action, agent_id, payload, ok, cout_usd) values ('objectifs', 'objectif_cree', p_agent, jsonb_build_object('id', g.id, 'metrique', g.metrique, 'cible', g.cible), true, 0);
  return jsonb_build_object('ok', true, 'id', g.id, 'baseline', g.baseline);
end $$;

create or replace function public.ai_goals_etat() returns table (id uuid, titre text, metrique text, produit text, agent_id uuid, agent_nom text, cible int, baseline int, actuel int, fait int, pct int, temps_pct int, etat text, statut text, debut timestamptz, echeance timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  return query select * from public.ai_goals_calc() c order by (c.statut = 'actif') desc, c.echeance limit 60;
end $$;

create or replace function public.ai_goal_cloturer(p_id uuid, p_statut text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  if p_statut not in ('atteint', 'abandonne') then raise exception 'Statut invalide'; end if;
  update public.ai_goals set statut = p_statut, cloture_at = now() where id = p_id and statut = 'actif';
  if not found then raise exception 'Objectif introuvable ou déjà clôturé'; end if;
  insert into public.ai_actions(agent, action, payload, ok, cout_usd) values ('objectifs', 'objectif_' || p_statut, jsonb_build_object('id', p_id), true, 0);
end $$;

-- Vérification quotidienne : clôture automatique des objectifs atteints, trace des retards (une fois par semaine et par objectif)
create or replace function public.ai_goals_verifier() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n_ok int := 0; n_ret int := 0;
begin
  for r in select * from public.ai_goals_calc() c where c.statut = 'actif' loop
    if r.etat = 'atteint' then
      update public.ai_goals set statut = 'atteint', cloture_at = now() where id = r.id and statut = 'actif';
      insert into public.ai_actions(agent, action, agent_id, payload, ok, cout_usd) values ('objectifs', 'objectif_atteint', r.agent_id, jsonb_build_object('id', r.id, 'titre', r.titre, 'fait', r.fait, 'cible', r.cible), true, 0);
      n_ok := n_ok + 1;
    elsif r.etat in ('en_retard', 'echeance_depassee')
          and not exists (select 1 from public.ai_actions a where a.action = 'objectif_en_retard' and a.payload->>'id' = r.id::text and a.at > now() - interval '7 days') then
      insert into public.ai_actions(agent, action, agent_id, payload, ok, cout_usd) values ('objectifs', 'objectif_en_retard', r.agent_id, jsonb_build_object('id', r.id, 'titre', r.titre, 'fait', r.fait, 'cible', r.cible, 'temps_pct', r.temps_pct, 'etat', r.etat), true, 0);
      n_ret := n_ret + 1;
    end if;
  end loop;
  return jsonb_build_object('atteints', n_ok, 'en_retard', n_ret);
end $$;

revoke all on function public.ai_stage_rang(text), public.ai_goal_valeur(text, text), public.ai_goals_calc(), public.ai_goals_verifier() from public, anon, authenticated;
revoke all on function public.ai_goal_creer(text, text, int, timestamptz, text, uuid), public.ai_goals_etat(), public.ai_goal_cloturer(uuid, text) from public, anon, authenticated;
grant execute on function public.ai_goal_creer(text, text, int, timestamptz, text, uuid), public.ai_goals_etat(), public.ai_goal_cloturer(uuid, text) to authenticated;
grant execute on function public.ai_goals_verifier() to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ai_goals_quotidien';
    perform cron.schedule('ai_goals_quotidien', '30 7 * * *', 'select public.ai_goals_verifier();');
  end if;
end $$;
