-- ═════════════════════════════════════════════════════════════════════════════
--  SANIX — PILOTAGE : budget, plan d'actions commercial, coûts IA, propositions des agents · phase 2
--  ADDITIF et relançable. Suppose la migration 20261111000000 (connecteur CRM ↔ IA) déjà appliquée.
--  1. Trois entités de synchronisation (pil_depenses, pil_actions, pil_config) : le budget et le plan d'actions suivent
--     le même chemin que les données du CRM (crm_sync_push / crm_sync_pull, fusion champ par champ, file d'envoi).
--  2. pilotage_ai_costs() : coûts IA par mois et par agent, prévision de fin de mois (lecture seule, opérateurs).
--  3. Propositions d'actions des agents IA : l'agent propose (ai_propose_commercial_action, service seul), un opérateur
--     accepte ou refuse (pilotage_proposal_decide) ; rien n'entre dans le plan sans cette décision humaine.
-- ═════════════════════════════════════════════════════════════════════════════

do $$ begin
  if to_regclass('public.crm_records') is null then
    raise exception 'Appliquer d''abord 20261111000000_crm_ai_connector.sql (connecteur CRM ↔ IA)' using errcode = '55000';
  end if;
end $$;

-- ─── 1. Entités de synchronisation ───────────────────────────────────────────
do $$ declare c text; begin
  for c in select conname from pg_constraint
            where conrelid = 'public.crm_records'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%entity%' and pg_get_constraintdef(oid) like '%clients%' loop
    execute format('alter table public.crm_records drop constraint %I', c);
  end loop;
  alter table public.crm_records add constraint crm_records_entity_check check (entity in (
    'clients','deals','commandes','contrats','licences','documents','presentations','rdv','deployments','apporteurs','ecritures','logiciels','config',
    'pil_depenses','pil_actions','pil_config'));
end $$;

-- ─── 2. Coûts IA (lecture seule, opérateurs) ─────────────────────────────────
-- Source : ai_actions (action = 'llm_turn', cout_usd), la même que le contrôle de budget du moteur.
create or replace function public.pilotage_ai_costs(p_months integer default 6) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_m0 timestamptz := date_trunc('month', now());
  v_from timestamptz := date_trunc('month', now()) - make_interval(months => least(greatest(coalesce(p_months, 6), 1), 24) - 1);
  v_mois numeric; v_jour numeric; v_days numeric := extract(day from (v_m0 + interval '1 month - 1 day'));
  v_elapsed numeric := greatest(extract(day from now()), 1);
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  select coalesce(sum(cout_usd), 0) into v_mois from public.ai_actions where action = 'llm_turn' and at >= v_m0;
  select coalesce(sum(cout_usd), 0) into v_jour from public.ai_actions where action = 'llm_turn' and at >= date_trunc('day', now());
  return jsonb_build_object(
    'mois', coalesce((select jsonb_agg(jsonb_build_object('mois', to_char(m, 'YYYY-MM'), 'cout_usd', round(c, 4)) order by m)
                        from (select date_trunc('month', at) m, sum(cout_usd) c from public.ai_actions
                               where action = 'llm_turn' and at >= v_from group by 1) t), '[]'::jsonb),
    'agents_mois', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'nom', a.nom, 'cout_usd', round(t.c, 4)) order by t.c desc)
                               from (select agent_id, sum(cout_usd) c from public.ai_actions
                                      where action = 'llm_turn' and at >= v_m0 and agent_id is not null group by 1) t
                               join public.ai_agents a on a.id = t.agent_id), '[]'::jsonb),
    'jour_usd', round(v_jour, 4), 'mois_usd', round(v_mois, 4),
    'prevision_fin_mois_usd', round(v_mois / v_elapsed * v_days, 4),
    'budget_jour_usd', (select budget_jour_usd from public.ai_governance where id = 1),
    'budget_mois_usd', (select budget_mois_usd from public.ai_governance where id = 1));
end $$;

-- ─── 3. Propositions d'actions des agents ────────────────────────────────────
create table if not exists public.pilotage_proposals (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid references public.ai_agents(id) on delete set null,
  titre         text not null check (char_length(titre) between 5 and 200),
  justification text check (justification is null or char_length(justification) <= 2000),
  responsable   text check (responsable is null or char_length(responsable) <= 100),
  echeance      date,
  objectif_ca   numeric(14,0) not null default 0 check (objectif_ca >= 0),
  segment       text check (segment is null or char_length(segment) <= 100),
  statut        text not null default 'proposee' check (statut in ('proposee', 'acceptee', 'refusee')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid
);
create index if not exists pilotage_proposals_statut on public.pilotage_proposals(statut, created_at desc);
alter table public.pilotage_proposals enable row level security;
drop policy if exists pilotage_proposals_read on public.pilotage_proposals;
create policy pilotage_proposals_read on public.pilotage_proposals for select to authenticated using (public.ai_is_operator());
revoke all on public.pilotage_proposals from anon;
revoke insert, update, delete, truncate on public.pilotage_proposals from authenticated;
grant select on public.pilotage_proposals to authenticated;

-- L'agent propose (appelée par les fonctions Edge, rôle service). Au plus 20 propositions en attente ; un titre déjà en attente n'est pas redoublé.
create or replace function public.ai_propose_commercial_action(
  p_agent uuid, p_titre text, p_justification text default null, p_responsable text default null,
  p_echeance date default null, p_objectif_ca numeric default 0, p_segment text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_titre text := btrim(public.crm_clean(coalesce(p_titre, ''))); r public.pilotage_proposals;
begin
  if char_length(v_titre) < 5 then raise exception 'Titre trop court (5 caractères au moins)' using errcode = '22023'; end if;
  if (select count(*) from public.pilotage_proposals where statut = 'proposee') >= 20 then
    raise exception 'Trop de propositions en attente (20) : attendre la décision d''un opérateur' using errcode = '53400';
  end if;
  if exists (select 1 from public.pilotage_proposals where statut = 'proposee' and lower(titre) = lower(left(v_titre, 200))) then
    raise exception 'Une proposition identique est déjà en attente' using errcode = '23505';
  end if;
  insert into public.pilotage_proposals(agent_id, titre, justification, responsable, echeance, objectif_ca, segment)
  values (p_agent, left(v_titre, 200), left(public.crm_clean(p_justification), 2000), left(public.crm_clean(p_responsable), 100),
          p_echeance, least(greatest(coalesce(p_objectif_ca, 0), 0), 1e12), left(public.crm_clean(p_segment), 100))
  returning * into r;
  return jsonb_build_object('ok', true, 'id', r.id, 'statut', r.statut);
end $$;

-- Propositions en attente (opérateurs).
create or replace function public.pilotage_proposals_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'titre', p.titre, 'justification', p.justification, 'responsable', p.responsable,
                     'echeance', p.echeance, 'objectif_ca', p.objectif_ca, 'segment', p.segment, 'created_at', p.created_at, 'agent', a.nom) order by p.created_at)
                     from public.pilotage_proposals p left join public.ai_agents a on a.id = p.agent_id where p.statut = 'proposee'), '[]'::jsonb);
end $$;

-- Décision humaine : acceptée → le navigateur de l'opérateur ajoute l'action au plan (et la synchronise) ; refusée → archivée.
create or replace function public.pilotage_proposal_decide(p_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.pilotage_proposals;
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  update public.pilotage_proposals set statut = case when p_accept then 'acceptee' else 'refusee' end, decided_at = now(), decided_by = auth.uid()
   where id = p_id and statut = 'proposee' returning * into r;
  if r.id is null then raise exception 'Proposition introuvable ou déjà traitée' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'statut', r.statut, 'titre', r.titre, 'responsable', r.responsable, 'echeance', r.echeance,
                            'objectif_ca', r.objectif_ca, 'segment', r.segment);
end $$;

-- ─── 4. Droits ───────────────────────────────────────────────────────────────
revoke all on function public.pilotage_ai_costs(integer), public.pilotage_proposals_list(), public.pilotage_proposal_decide(uuid, boolean),
  public.ai_propose_commercial_action(uuid, text, text, text, date, numeric, text) from public, anon;
grant execute on function public.pilotage_ai_costs(integer), public.pilotage_proposals_list(), public.pilotage_proposal_decide(uuid, boolean) to authenticated;
revoke execute on function public.ai_propose_commercial_action(uuid, text, text, text, date, numeric, text) from authenticated;
grant execute on function public.ai_propose_commercial_action(uuid, text, text, text, date, numeric, text) to service_role;

-- ─── 5. Outil ouvert au directeur commercial IA et au responsable de la prospection ───
update public.ai_agents set outils = array_append(outils, 'propose_commercial_action')
 where code in ('sanix_ai_sales_director', 'ia_resp_prospection') and not ('propose_commercial_action' = any(outils));
