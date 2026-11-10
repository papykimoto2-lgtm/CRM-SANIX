-- ═════════════════════════════════════════════════════════════════════════════
--  SANIX AI — PHASE 2 : fiabilisation du moteur (additif et relançable)
--  1. Missions : logiciel concerné (immosuite, aluexpert, avicosuite) et résultat attendu.
--  2. Preuve : une mission (hors échange avec le président) ne peut passer à « terminée » sans rapport substantiel ni résultat enregistré.
--  3. Score /100 selon le cahier des charges : produit 25 · besoin 25 · taille 15 · décideur 15 · maturité numérique 10 · fiabilité des informations 10 ;
--     justification obligatoire dès qu'un score est attribué.
--  4. Chiffre d'affaires : correspondances de noms de produits du CRM (AviNest Pro = AvicoSuite) et vue des ventes HT par logiciel.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── 1. Missions : produit concerné, résultat attendu ────────────────────────
alter table public.ai_agent_tasks add column if not exists produit text references public.ai_products(id);
alter table public.ai_agent_tasks add column if not exists resultat_attendu text;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ai_agent_tasks'::regclass and conname = 'ai_agent_tasks_resultat_attendu_len') then
    alter table public.ai_agent_tasks add constraint ai_agent_tasks_resultat_attendu_len check (resultat_attendu is null or char_length(resultat_attendu) <= 1000);
  end if;
end $$;
create index if not exists ai_agent_tasks_produit on public.ai_agent_tasks(produit) where produit is not null;

-- ─── 2. Pas de mission terminée sans preuve ──────────────────────────────────
create or replace function public.ai_task_proof() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.statut = 'terminee' and old.statut is distinct from 'terminee' and new.type <> 'instruction' then
    if jsonb_typeof(new.resultats) is distinct from 'array' or jsonb_array_length(new.resultats) = 0
       or char_length(btrim(coalesce(new.rapport, ''))) < 40 then
      raise exception 'Mission terminée sans preuve : un rapport (40 caractères au moins) et au moins un résultat enregistré sont obligatoires'
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ai_task_proof on public.ai_agent_tasks;
create trigger ai_task_proof before update on public.ai_agent_tasks for each row execute function public.ai_task_proof();

-- ─── 3. Score /100 : barème du cahier des charges ────────────────────────────
-- Les colonnes gardent leur nom (la somme et les seuils 80 / 60 / 40 sont inchangés) ; leur sens et leurs plafonds changent :
--   crit_produit 25 = correspondance avec le logiciel · crit_besoin 25 = besoin identifié · crit_finance 15 = taille et potentiel
--   crit_decideur 15 = accessibilité du décideur · crit_court_terme 10 = maturité numérique · crit_disponibilite 10 = fiabilité des informations
alter table public.ai_prospects drop constraint if exists ai_prospects_crit_besoin_check;
alter table public.ai_prospects add constraint ai_prospects_crit_besoin_check check (crit_besoin between 0 and 25);
alter table public.ai_prospects drop constraint if exists ai_prospects_crit_court_terme_check;
alter table public.ai_prospects add constraint ai_prospects_crit_court_terme_check check (crit_court_terme between 0 and 10);
comment on column public.ai_prospects.crit_produit is 'Correspondance avec le logiciel (0-25)';
comment on column public.ai_prospects.crit_besoin is 'Besoin potentiel identifié (0-25)';
comment on column public.ai_prospects.crit_finance is 'Taille et potentiel de l''entreprise (0-15)';
comment on column public.ai_prospects.crit_decideur is 'Accessibilité du décideur (0-15)';
comment on column public.ai_prospects.crit_court_terme is 'Maturité numérique (0-10)';
comment on column public.ai_prospects.crit_disponibilite is 'Fiabilité des informations (0-10)';
alter table public.ai_prospects add column if not exists score_justification text;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ai_prospects'::regclass and conname = 'ai_prospects_score_justifie') then
    alter table public.ai_prospects add constraint ai_prospects_score_justifie
      check (score = 0 or char_length(coalesce(score_justification, '')) >= 30) not valid;      -- les lignes existantes ont toutes un score nul
    alter table public.ai_prospects add constraint ai_prospects_score_justification_len check (score_justification is null or char_length(score_justification) <= 2000);
  end if;
end $$;

-- ─── 4. Produits du CRM → logiciels SANIX AI, ventes HT par logiciel ─────────
create table if not exists public.ai_product_aliases (
  alias      text primary key check (alias = lower(alias) and alias = btrim(alias)),
  product_id text not null references public.ai_products(id) on delete cascade
);
alter table public.ai_product_aliases enable row level security;
drop policy if exists ai_product_aliases_read on public.ai_product_aliases;
create policy ai_product_aliases_read on public.ai_product_aliases for select to authenticated using (public.ai_is_operator());
revoke all on public.ai_product_aliases from anon;
revoke insert, update, delete, truncate on public.ai_product_aliases from authenticated;
grant select on public.ai_product_aliases to authenticated;
insert into public.ai_product_aliases(alias, product_id) values
  ('immosuite', 'immosuite'), ('immosuite erp', 'immosuite'),
  ('aluexpert', 'aluexpert'), ('sanix aluexpert', 'aluexpert'), ('sanix aluexpert erp', 'aluexpert'),
  ('avicosuite', 'avicosuite'), ('avinest pro', 'avicosuite'), ('avinest', 'avicosuite')       -- AviNest Pro (nom du CRM) = AvicoSuite
on conflict (alias) do nothing;

create or replace function public.ai_product_of(p_label text) returns text
language sql stable set search_path = public as $$
  select product_id from public.ai_product_aliases where alias = lower(btrim(coalesce(p_label, '')))
$$;

-- Chiffre d'affaires réalisé : commandes confirmées, en cours ou livrées du CRM, en HT (et TTC en regard), par logiciel. Produits hors périmètre regroupés.
create or replace view public.ai_ventes_par_produit with (security_invoker = true) as
select coalesce(public.ai_product_of(r.data->>'logiciel'), 'hors_perimetre') as produit,
       count(*) as commandes,
       coalesce(sum(public.crm_num(r.data->>'htNet')), 0) as ca_ht,
       coalesce(sum(public.crm_num(r.data->>'ttc')), 0)   as ca_ttc
  from public.crm_records r
 where r.entity = 'commandes' and r.deleted_at is null and r.data->>'statut' in ('confirmee', 'en_cours', 'livree')
 group by 1;
revoke all on public.ai_ventes_par_produit from anon;
grant select on public.ai_ventes_par_produit to authenticated;
revoke all on function public.ai_product_of(text) from public, anon;
grant execute on function public.ai_product_of(text) to authenticated, service_role;
