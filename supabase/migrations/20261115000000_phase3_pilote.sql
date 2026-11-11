-- ═════════════════════════════════════════════════════════════════════════════
--  SANIX AI — PHASE 3 (préparation) : segmentation par logiciel, sélection du pilote, entonnoir mesuré par logiciel (additif et relançable)
--  Aucun appel IA, aucun coût : tout est règle ou donnée, modifiable par la direction (pas de logiciel ni de mot-clé figé dans le code).
--  1. ai_prospects.segment : logiciel visé, « a_verifier » (Industrie sans indice d'activité : à confirmer par l'enrichissement) ou « hors_perimetre ».
--  2. ai_segment_rules : règles (champ, motif, segment, priorité) ; la première règle qui correspond l'emporte ; défaut = hors périmètre.
--  3. ai_segmenter_prospects(appliquer) : aperçu (opérateurs) ou application (direction) ; ne touche jamais une fiche déjà travaillée ni un choix manuel.
--  4. ai_pilote + ai_choisir_pilote : sélection reproductible et modifiable du pilote (les plus joignables d'abord) ; jamais forcée.
--  5. ai_pilote_entonnoir : prospects → qualifiés → contactés → réponses → rendez-vous → démonstrations → offres → ventes, coût IA, par logiciel.
-- ═════════════════════════════════════════════════════════════════════════════

do $$ begin
  if to_regprocedure('public.ai_cfg_check()') is null then
    raise exception 'Appliquer d''abord la migration 20261114 (paramétrage)' using errcode = '55000';
  end if;
end $$;

-- ─── 1. Segment du prospect ──────────────────────────────────────────────────
alter table public.ai_prospects add column if not exists segment text;
alter table public.ai_prospects add column if not exists segment_source text;
alter table public.ai_prospects add column if not exists segment_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ai_prospects'::regclass and conname = 'ai_prospects_segment_check') then
    alter table public.ai_prospects add constraint ai_prospects_segment_check check (segment is null or segment ~ '^[a-z0-9_]{2,40}$');
    alter table public.ai_prospects add constraint ai_prospects_segment_source_check check (segment_source is null or segment_source in ('regle', 'manuel'));
  end if;
end $$;
create index if not exists ai_prospects_segment on public.ai_prospects(segment) where segment is not null;

-- ─── 2. Règles de segmentation (configuration, modifiable) ───────────────────
create table if not exists public.ai_segment_rules (
  id       int generated always as identity primary key,
  priorite int not null default 100,
  champ    text not null check (champ in ('secteur', 'entreprise', 'resume_ia')),
  motif    text not null check (char_length(motif) between 2 and 300),
  segment  text not null check (segment ~ '^[a-z0-9_]{2,40}$'),
  actif    boolean not null default true,
  note     text check (note is null or char_length(note) <= 300),
  unique (champ, motif, segment)
);
-- Les motifs sont des expressions régulières PostgreSQL appliquées au texte en minuscules et sans accents (\m = début de mot).
insert into public.ai_segment_rules(priorite, champ, motif, segment, note)
select v.priorite, v.champ, v.motif, v.segment, v.note from (values
  (10, 'secteur',    'immobilier|foncier|promotion', 'immosuite', 'Secteur immobilier ou foncier'),
  (20, 'entreprise', '\malu|menuiser|vitr(erie|age)|miroiter|facade|fenetre|baie vitree|charpente metal|metallerie', 'aluexpert', 'Nom évoquant l''aluminium, la menuiserie, la vitrerie ou la métallerie'),
  (30, 'entreprise', 'avic|poulet|poule|pondeuse|volaille|couvoir|provende|oeuf', 'avicosuite', 'Nom évoquant l''aviculture'),
  (31, 'secteur',    'avicult|avicole|elevage', 'avicosuite', 'Secteur avicole ou élevage'),
  (90, 'secteur',    'sante|logisti|livraison|transport|distribution|pharma|clinique', 'hors_perimetre', 'Secteurs sans logiciel du périmètre commercial actuel'),
  (95, 'secteur',    'industrie', 'a_verifier', 'Industrie sans indice d''activité : à confirmer par l''enrichissement (jamais forcé)')) v(priorite, champ, motif, segment, note)
 where not exists (select 1 from public.ai_segment_rules r where r.priorite = v.priorite and r.champ = v.champ and r.segment = v.segment);   -- relançable même après une correction de motif
alter table public.ai_segment_rules enable row level security;
drop policy if exists seg_read on public.ai_segment_rules;
create policy seg_read on public.ai_segment_rules for select to authenticated using (public.ai_is_operator());
revoke all on public.ai_segment_rules from anon;
revoke insert, update, delete, truncate on public.ai_segment_rules from authenticated;
grant select on public.ai_segment_rules to authenticated;

-- Segment calculé pour un prospect : première règle active (priorité, puis ordre de création) ; défaut « hors_perimetre ».
create or replace function public.ai_segment_of(p public.ai_prospects) returns text
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select coalesce((
    select r.segment from public.ai_segment_rules r
     where r.actif and (case r.champ when 'secteur' then unaccent(lower(coalesce(p.secteur, ''))) when 'entreprise' then unaccent(lower(coalesce(p.entreprise, '')))
                                     else unaccent(lower(coalesce(p.resume_ia, ''))) end) ~ r.motif
     order by r.priorite, r.id limit 1), 'hors_perimetre')
$$;

-- ─── 3. Segmentation : aperçu (opérateurs) ou application (direction) ────────
-- Applique seulement aux fiches « identifié » / « enregistré » (jamais une fiche déjà travaillée) et jamais sur un choix manuel.
-- Le logiciel recommandé suit le segment si ce logiciel est actif ; sinon la liste est vidée (aucune recommandation hors périmètre).
create or replace function public.ai_segmenter_prospects(p_appliquer boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_modifies int := 0;
begin
  if p_appliquer then perform public.ai_cfg_check();
  elsif not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  if p_appliquer then
    update public.ai_prospects p set segment = s.seg, segment_source = 'regle', segment_at = now(),
           produits_recommandes = case when exists (select 1 from public.ai_products x where x.id = s.seg and x.actif) then array[s.seg] else '{}'::text[] end
      from (select pp.id, public.ai_segment_of(pp) seg from public.ai_prospects pp) s
     where p.id = s.id and p.segment_source is distinct from 'manuel' and p.stage in ('identifie', 'enregistre');
    get diagnostics v_modifies = row_count;
    perform public.ai_cfg_audit('cfg_segmentation', jsonb_build_object('fiches_modifiees', v_modifies));
  end if;
  return jsonb_build_object(
    'applique', p_appliquer, 'fiches_modifiees', v_modifies,
    'segments_calcules', (select coalesce(jsonb_object_agg(seg, n), '{}'::jsonb) from (select public.ai_segment_of(pp) seg, count(*) n from public.ai_prospects pp group by 1) t),
    'segments_enregistres', (select coalesce(jsonb_object_agg(coalesce(segment, 'non_segmente'), n), '{}'::jsonb) from (select segment, count(*) n from public.ai_prospects group by 1) t),
    'choix_manuels', (select count(*) from public.ai_prospects where segment_source = 'manuel'),
    'deja_travailles', (select count(*) from public.ai_prospects where stage not in ('identifie', 'enregistre')));
end $$;

-- Choix manuel du segment d'un prospect (prioritaire sur les règles).
create or replace function public.ai_cfg_set_segment(p_prospect uuid, p_segment text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text := lower(btrim(coalesce(p_segment, '')));
begin
  perform public.ai_cfg_check();
  if v !~ '^[a-z0-9_]{2,40}$' then raise exception 'Segment invalide' using errcode = '22023'; end if;
  if v not in ('hors_perimetre', 'a_verifier') and not exists (select 1 from public.ai_products where id = v) then
    raise exception 'Segment inconnu : logiciel absent du catalogue' using errcode = '22023';
  end if;
  update public.ai_prospects set segment = v, segment_source = 'manuel', segment_at = now(),
         produits_recommandes = case when exists (select 1 from public.ai_products x where x.id = v and x.actif) then array[v] else '{}'::text[] end
   where id = p_prospect;
  if not found then raise exception 'Prospect introuvable' using errcode = 'P0002'; end if;
  perform public.ai_cfg_audit('cfg_segment_manuel', jsonb_build_object('prospect', p_prospect, 'segment', v));
  return jsonb_build_object('ok', true);
end $$;

-- Règle de segmentation (création ou modification ; supprimer = désactiver).
create or replace function public.ai_cfg_save_segment_rule(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id int := nullif(p->>'id', '')::int;
begin
  perform public.ai_cfg_check();
  if p ? 'motif' then perform 1 where 'x' ~ (p->>'motif'); end if;               -- une expression invalide échoue ici, avant toute écriture
  if v_id is null then
    insert into public.ai_segment_rules(priorite, champ, motif, segment, actif, note)
    values (coalesce((p->>'priorite')::int, 100), p->>'champ', lower(p->>'motif'), lower(p->>'segment'), coalesce((p->>'actif')::boolean, true), nullif(left(p->>'note', 300), ''))
    returning id into v_id;
  else
    update public.ai_segment_rules set
      priorite = case when p ? 'priorite' then (p->>'priorite')::int else priorite end,
      champ = case when p ? 'champ' then p->>'champ' else champ end,
      motif = case when p ? 'motif' then lower(p->>'motif') else motif end,
      segment = case when p ? 'segment' then lower(p->>'segment') else segment end,
      actif = case when p ? 'actif' then (p->>'actif')::boolean else actif end,
      note = case when p ? 'note' then nullif(left(p->>'note', 300), '') else note end
     where id = v_id;
    if not found then raise exception 'Règle introuvable' using errcode = 'P0002'; end if;
  end if;
  perform public.ai_cfg_audit('cfg_regle_segment', jsonb_build_object('id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ─── 4. Pilote : sélection reproductible, modifiable, jamais forcée ──────────
create table if not exists public.ai_pilote (
  prospect_id uuid primary key references public.ai_prospects(id) on delete cascade,
  product_id  text not null references public.ai_products(id),
  raison      text,
  ajoute_par  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists ai_pilote_produit on public.ai_pilote(product_id);
alter table public.ai_pilote enable row level security;
drop policy if exists pilote_read on public.ai_pilote;
create policy pilote_read on public.ai_pilote for select to authenticated using (public.ai_is_operator());
revoke all on public.ai_pilote from anon;
revoke insert, update, delete, truncate on public.ai_pilote from authenticated;
grant select on public.ai_pilote to authenticated;

-- p_quotas : {"immosuite": 20, "aluexpert": 20, "avicosuite": 10}. Pour chaque logiciel actif : les prospects du segment encore non travaillés, non désinscrits,
-- les plus joignables d'abord (e-mail et téléphone, puis e-mail, puis téléphone), à égalité les plus anciens. Si le segment est plus petit que le quota, on prend ce qui existe.
create or replace function public.ai_choisir_pilote(p_quotas jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare k text; v_n int; v_pris int; res jsonb := '{}'::jsonb; v_dispo int;
begin
  perform public.ai_cfg_check();
  if jsonb_typeof(p_quotas) <> 'object' then raise exception 'Quotas invalides (objet {logiciel: nombre})' using errcode = '22023'; end if;
  for k, v_n in select key, least(greatest(value::int, 0), 200) from jsonb_each_text(p_quotas) loop
    if not exists (select 1 from public.ai_products where id = k and actif) then
      res := res || jsonb_build_object(k, jsonb_build_object('erreur', 'logiciel absent ou inactif')); continue;
    end if;
    insert into public.ai_pilote(prospect_id, product_id, raison, ajoute_par)
    select p.id, k, 'Sélection automatique : ' || case when coalesce(p.email, '') <> '' and coalesce(p.telephone, '') <> '' then 'e-mail et téléphone'
                                                       when coalesce(p.email, '') <> '' then 'e-mail' when coalesce(p.telephone, '') <> '' then 'téléphone' else 'sans coordonnées' end, auth.uid()
      from public.ai_prospects p
     where p.segment = k and p.stage in ('identifie', 'enregistre') and not p.opt_out and not exists (select 1 from public.ai_pilote x where x.prospect_id = p.id)
     order by (coalesce(p.email, '') <> '' and coalesce(p.telephone, '') <> '') desc, (coalesce(p.email, '') <> '') desc, (coalesce(p.telephone, '') <> '') desc, p.created_at, p.id
     limit greatest(v_n - (select count(*) from public.ai_pilote where product_id = k), 0);
    get diagnostics v_pris = row_count;
    select count(*) into v_dispo from public.ai_prospects p where p.segment = k and p.stage in ('identifie', 'enregistre') and not p.opt_out;
    res := res || jsonb_build_object(k, jsonb_build_object('quota', v_n, 'ajoutes', v_pris, 'dans_le_pilote', (select count(*) from public.ai_pilote where product_id = k), 'disponibles_dans_le_segment', v_dispo,
                                                          'manque', greatest(v_n - (select count(*) from public.ai_pilote where product_id = k), 0)));
  end loop;
  perform public.ai_cfg_audit('cfg_pilote', jsonb_build_object('quotas', p_quotas, 'resultat', res));
  return res;
end $$;

-- Ajout ou retrait manuel d'un prospect du pilote.
create or replace function public.ai_cfg_pilote_set(p_prospect uuid, p_on boolean default true) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.ai_prospects;
begin
  perform public.ai_cfg_check();
  select * into p from public.ai_prospects where id = p_prospect;
  if p.id is null then raise exception 'Prospect introuvable' using errcode = 'P0002'; end if;
  if p_on then
    if p.segment is null or p.segment in ('hors_perimetre', 'a_verifier') then raise exception 'Prospect hors périmètre ou à vérifier : le segmenter d''abord' using errcode = '22023'; end if;
    insert into public.ai_pilote(prospect_id, product_id, raison, ajoute_par) values (p.id, p.segment, 'Ajout manuel', auth.uid()) on conflict (prospect_id) do nothing;
  else
    delete from public.ai_pilote where prospect_id = p.id;
  end if;
  perform public.ai_cfg_audit('cfg_pilote_manuel', jsonb_build_object('prospect', p.id, 'actif', p_on));
  return jsonb_build_object('ok', true);
end $$;

-- ─── 5. Entonnoir par logiciel : ce que le pilote doit permettre de mesurer ──
-- Une ligne par segment (logiciels, « a_verifier », « hors_perimetre », « non_segmente »). Tous les chiffres viennent des données réelles.
create or replace view public.ai_pilote_entonnoir with (security_invoker = true) as
select s.segment,
       count(*) as prospects,
       count(*) filter (where pl.prospect_id is not null) as dans_le_pilote,
       count(*) filter (where p.score > 0) as qualifies,
       count(*) filter (where p.score >= 80) as prioritaires,
       count(*) filter (where exists (select 1 from public.ai_messages m where m.prospect_id = p.id and m.sens = 'sortant' and m.statut in ('envoye', 'delivre', 'lu'))) as contactes,
       count(*) filter (where exists (select 1 from public.ai_messages m where m.prospect_id = p.id and m.sens = 'entrant')) as reponses,
       count(*) filter (where exists (select 1 from public.ai_appointments a where a.prospect_id = p.id and a.statut in ('confirme', 'realise'))) as rendez_vous,
       count(*) filter (where exists (select 1 from public.ai_appointments a where a.prospect_id = p.id and a.statut = 'realise')) as demonstrations,
       count(*) filter (where exists (select 1 from public.ai_offers o where o.prospect_id = p.id and o.statut in ('envoyee', 'acceptee', 'refusee'))) as offres,
       count(*) filter (where exists (select 1 from public.ai_offers o where o.prospect_id = p.id and o.statut = 'acceptee')) as offres_acceptees,
       coalesce((select sum(t.cout_usd) from public.ai_agent_tasks t where t.produit = s.segment), 0) as cout_ia_usd,
       coalesce((select v.ca_ht from public.ai_ventes_par_produit v where v.produit = s.segment), 0) as ca_ht_crm
  from public.ai_prospects p
  cross join lateral (select coalesce(p.segment, 'non_segmente') as segment) s
  left join public.ai_pilote pl on pl.prospect_id = p.id
 group by s.segment;
revoke all on public.ai_pilote_entonnoir from anon;
grant select on public.ai_pilote_entonnoir to authenticated;

-- ─── 6. Droits ───────────────────────────────────────────────────────────────
revoke all on function public.ai_segment_of(public.ai_prospects), public.ai_segmenter_prospects(boolean), public.ai_cfg_set_segment(uuid, text),
  public.ai_cfg_save_segment_rule(jsonb), public.ai_choisir_pilote(jsonb), public.ai_cfg_pilote_set(uuid, boolean) from public, anon;
grant execute on function public.ai_segmenter_prospects(boolean), public.ai_cfg_set_segment(uuid, text), public.ai_cfg_save_segment_rule(jsonb),
  public.ai_choisir_pilote(jsonb), public.ai_cfg_pilote_set(uuid, boolean) to authenticated;
