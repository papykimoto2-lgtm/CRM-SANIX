-- Correctifs de la revue d'interconnexion CRM ↔ Virtual Company (17/11/2026). Relançable.
-- 1. paiements fusionnés par identifiant (plus de paiement perdu entre appareils) ; 2. garde-fou d'étape étendu ; 3. événements non tués par un agent suspendu ;
-- 4. l'IA n'écrit plus de montant dans l'affaire (estimation seulement) ; 5. missions bloquées visibles ; 6. historique append-only des enregistrements ; 7. droits excessifs retirés.


create or replace function public.crm_merge_paiements(a jsonb, b jsonb) returns jsonb
language sql immutable as $$
  -- Union par identifiant de paiement. Un paiement marqué « supprime » le reste (tombstone). Sinon la version la plus récente (champ « maj ») l'emporte ; à égalité, celle reçue.
  select coalesce(jsonb_agg(e order by coalesce(e->>'date', ''), e->>'id'), '[]'::jsonb)
  from (
    select distinct on (e->>'id') e
    from (
      select e, 0 as src from jsonb_array_elements(case when jsonb_typeof(a) = 'array' then a else '[]'::jsonb end) e where e ? 'id'
      union all
      select e, 1 as src from jsonb_array_elements(case when jsonb_typeof(b) = 'array' then b else '[]'::jsonb end) e where e ? 'id'
    ) u
    order by e->>'id', (coalesce(e->>'supprime', 'false') = 'true') desc, coalesce(e->>'maj', '') desc, src desc
  ) d
$$;


create or replace function public.crm_union_keys(p_entity text) returns text[]
language sql immutable as $$
  select case p_entity when 'clients' then array['interactions'] when 'deals' then array['history'] when 'commandes' then array['paiements'] else array[]::text[] end
$$;

create or replace function public.crm_put(
  p_entity text, p_rid text, p_patch jsonb, p_origin text, p_actor text,
  p_protect boolean default false, p_base bigint default null, p_client_ts timestamptz default null, p_natural boolean default true
) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  cur public.crm_records; oth public.crm_records; v_nk text; v_new jsonb; k text; v_merged boolean := false;
  v_srv text[] := public.crm_server_keys(p_entity); v_uni text[] := public.crm_union_keys(p_entity); v_nk_ok text;
begin
  if jsonb_typeof(p_patch) <> 'object' then raise exception 'Données invalides (objet attendu)' using errcode = '22023'; end if;
  if p_origin = 'ia' then p_patch := public.crm_clean_json(p_patch); end if;       -- contenu issu du web : neutralisé avant d'entrer dans le CRM
  select * into cur from public.crm_records where entity = p_entity and rid = p_rid for update;
  v_nk := case when p_natural then public.crm_natural_key(p_entity, coalesce(cur.data, '{}'::jsonb) || p_patch) end;
  if cur.rid is null and v_nk is not null then
    select * into oth from public.crm_records where entity = p_entity and natural_key = v_nk and deleted_at is null for update;
    if oth.rid is not null then cur := oth; v_merged := true; end if;
  end if;
  if cur.rid is null then
    insert into public.crm_records(entity, rid, data, natural_key, origin, updated_by)
    values (p_entity, p_rid, p_patch, v_nk, p_origin, p_actor) returning * into cur;
    return jsonb_build_object('rid', cur.rid, 'version', cur.version, 'seq', cur.seq, 'created', true, 'merged', false);
  end if;
  if cur.deleted_at is not null and p_client_ts is not null and p_client_ts <= cur.deleted_at then
    return jsonb_build_object('rid', cur.rid, 'version', cur.version, 'seq', cur.seq, 'deleted', true, 'skipped', 'supprimé après cette modification');
  end if;
  v_new := cur.data;
  for k in select jsonb_object_keys(p_patch) loop
    if p_protect and k = any(v_srv) and cur.data ? k and p_base is distinct from cur.version then continue; end if;   -- copie locale périmée : le serveur garde sa valeur
    if k = 'paiements' and p_entity = 'commandes' then v_new := jsonb_set(v_new, array[k], public.crm_merge_paiements(cur.data->k, p_patch->k), true);
    elsif k = any(v_uni) then v_new := jsonb_set(v_new, array[k], public.crm_union_arrays(cur.data->k, p_patch->k), true);
    else v_new := jsonb_set(v_new, array[k], p_patch->k, true); end if;
  end loop;
  if p_entity = 'commandes' and p_patch ? 'paiements' then       -- acompte et solde se déduisent des paiements fusionnés, jamais de la copie d'un appareil
    v_new := v_new || jsonb_build_object('acompte', coalesce((select sum((e->>'montant')::numeric) from jsonb_array_elements(v_new->'paiements') e where coalesce(e->>'supprime', 'false') <> 'true'), 0));
    v_new := v_new || jsonb_build_object('solde', greatest(0, coalesce((v_new->>'ttc')::numeric, 0) - (v_new->>'acompte')::numeric));
  end if;
  v_nk_ok := case when v_nk is not null and v_nk is distinct from cur.natural_key
                   and not exists (select 1 from public.crm_records where entity = p_entity and natural_key = v_nk and deleted_at is null and rid <> cur.rid)
                  then v_nk end;
  if v_new = cur.data and cur.deleted_at is null and v_nk_ok is null then
    return jsonb_build_object('rid', cur.rid, 'version', cur.version, 'seq', cur.seq, 'unchanged', true, 'merged', v_merged);
  end if;
  update public.crm_records set data = v_new, natural_key = coalesce(v_nk_ok, natural_key), origin = p_origin, updated_by = p_actor, deleted_at = null
   where entity = p_entity and rid = cur.rid returning * into cur;
  return jsonb_build_object('rid', cur.rid, 'version', cur.version, 'seq', cur.seq, 'merged', v_merged);
end $$;
create or replace function public.ai_guard_stage() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role text := coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '');
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    if new.stage in ('contrat_signe','paiement_attendu','paiement_confirme','marche_gagne','deploiement','client_fidelise') then   -- toute étape que le CRM classe « gagné »
      if v_role = 'service_role' or not public.ai_is_direction() then
        raise exception 'Étape % réservée à la direction (validation humaine obligatoire)', new.stage
          using errcode = '42501';
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    insert into public.ai_stage_history(prospect_id, de, vers, par)
    values (new.id, old.stage, new.stage, coalesce(auth.uid()::text, 'agent'));
  end if;
  if new.opt_out and (tg_op = 'INSERT' or not old.opt_out) then new.opt_out_at := now(); end if;
  return new;
end $$;
create or replace function public.crm_process_events(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare ev public.crm_ai_events; r jsonb; n_done int := 0; n_fail int := 0; n_dead int := 0; n_skip int := 0; n_wait int := 0;
begin
  for ev in select * from public.crm_ai_events where status in ('pending', 'failed') and next_attempt_at <= now() order by seq limit greatest(p_limit, 1) for update skip locked loop
    begin
      r := public.crm_handle_event(ev);
      if r ? 'skipped' then
        update public.crm_ai_events set status = 'skipped', attempts = attempts + 1, result = r, last_error = null, processed_at = now() where id = ev.id; n_skip := n_skip + 1;
      else
        update public.crm_ai_events set status = 'done', attempts = attempts + 1, result = r, last_error = null, processed_at = now() where id = ev.id; n_done := n_done + 1;
      end if;
    exception when others then
      if (sqlerrm like 'Agent % indisponible (%' and ev.created_at > now() - interval '3 days') then
        -- agent suspendu ou en pause : l'événement attend sa réactivation (15 min) au lieu de mourir ; abandon seulement après 3 jours
        update public.crm_ai_events set status = 'pending', last_error = 'En attente d''un agent disponible : ' || left(sqlerrm, 300), next_attempt_at = now() + interval '15 minutes' where id = ev.id;
        n_wait := n_wait + 1;
      elsif sqlerrm like 'Gouvernance : agent déjà chargé%' or sqlerrm like 'Gouvernance : % missions actives maximum%' then
        -- contre-pression : le moteur limite les missions ouvertes ; l'événement attend son tour sans compter comme un échec
        update public.crm_ai_events set status = 'pending', last_error = 'En attente de capacité : ' || left(sqlerrm, 300), next_attempt_at = now() + interval '3 minutes' where id = ev.id;
        n_wait := n_wait + 1;
      elsif ev.attempts + 1 >= 8 then
        update public.crm_ai_events set status = 'dead', attempts = attempts + 1, last_error = left(sqlerrm, 1000), processed_at = now() where id = ev.id; n_dead := n_dead + 1;
      else
        update public.crm_ai_events set status = 'failed', attempts = attempts + 1, last_error = left(sqlerrm, 1000),
               next_attempt_at = now() + make_interval(secs => least(power(2, ev.attempts + 1) * 15, 3600)) where id = ev.id; n_fail := n_fail + 1;
      end if;
    end;
  end loop;
  return jsonb_build_object('done', n_done, 'skipped', n_skip, 'failed', n_fail, 'dead', n_dead, 'waiting', n_wait);
end $$;
create or replace function public.crm_h_prospect(ev public.crm_ai_events) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  p public.ai_prospects; v_rid text; v_stage text; a public.ai_agents; v_deal text; v_ds text; rec public.crm_records; v_note text; v_conv boolean; v_patch jsonb;
begin
  select * into p from public.ai_prospects where id = (ev.payload->>'prospect_id')::uuid;
  if p.id is null then return jsonb_build_object('skipped', 'prospect supprimé'); end if;
  v_rid := public.crm_ensure_client(p);
  v_stage := coalesce(ev.payload->>'stage', p.stage);
  select * into a from public.ai_agents where id = p.agent_id;
  v_note := case when ev.type = 'ia.prospect.qualified'
                 then 'Qualification IA : score ' || coalesce(p.score::text, '–') || '/100 (' || coalesce(p.priorite, 'priorité inconnue') || ')'
                      || case when cardinality(p.produits_recommandes) > 0 then ' · produits : ' || array_to_string(p.produits_recommandes, ', ') else '' end
                      || coalesce(' · ' || left(p.resume_ia, 300), '')
                 else 'Étape pipeline : ' || coalesce(public.crm_stage_label(ev.payload->>'old_stage'), '–') || ' → ' || public.crm_stage_label(v_stage) end;
  v_conv := v_stage in ('contrat_signe', 'paiement_confirme', 'marche_gagne', 'deploiement', 'client_fidelise');
  select * into rec from public.crm_records where entity = 'clients' and rid = v_rid;
  v_patch := jsonb_build_object(
    'interactions', jsonb_build_array(public.crm_interaction(public.crm_stage_label(v_stage), v_note, public.crm_stage_etape(v_stage), ev.created_at, ev.id)),
    'ia', coalesce(rec.data->'ia', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('prospect_id', p.id, 'stage', v_stage, 'score', p.score, 'priorite', p.priorite,
          'produits', to_jsonb(p.produits_recommandes), 'resume', left(p.resume_ia, 500), 'agent_code', a.code, 'agent_nom', a.nom, 'updated_at', ev.created_at)));
  if v_conv then
    v_patch := v_patch || jsonb_build_object('statut', 'client', 'converted_at', ev.created_at);
  end if;
  perform public.crm_put('clients', v_rid, v_patch, 'ia', 'ia:' || ev.type, false, null, null, false);
  -- une affaire par prospect, qui suit l'entonnoir
  v_ds := public.crm_stage_deal(v_stage);
  if v_ds is not null then
    v_deal := 'ia_' || replace(p.id::text, '-', '');
    perform public.crm_put('deals', v_deal,
      jsonb_build_object('client', p.entreprise, '_client_rid', v_rid, 'logiciel', coalesce(p.produits_recommandes[1], ''), 'valeurEst', coalesce(p.potentiel_fcfa, 0), 'commercial', 'IA',
        'stage', v_ds, 'notes', 'Affaire suivie par l''IA', 'color', '#7C3AED', 'date', to_char(ev.created_at at time zone 'UTC', 'DD/MM/YYYY'), 'source', 'IA',
        'history', jsonb_build_array(jsonb_build_object('date', ev.created_at, 'type', 'stage_change', 'ico', '🤖', 'label', 'Étape IA : ' || public.crm_stage_label(v_stage), 'note', v_note, 'source', 'ia', 'ia_event', ev.id))),
      'ia', 'ia:' || ev.type, false, null, null, false);
  end if;
  return jsonb_build_object('client_rid', v_rid, 'stage', v_stage, 'converted', v_conv, 'deal', v_deal);
end $$;
create or replace function public.crm_missions_overview(p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'titre', t.titre, 'statut', t.statut, 'type', t.type, 'priorite', t.priorite, 'agent', a.nom, 'agent_code', a.code,
            'created_at', t.created_at, 'echeance', t.echeance, 'finished_at', t.finished_at, 'prospect_id', t.prospect_id, 'crm_rid', p.crm_rid, 'entreprise', p.entreprise, 'rapport', left(t.rapport, 600), 'raison', case when t.statut = 'bloquee' then right(t.rapport, 700) end) order by (t.statut = 'bloquee') desc, t.created_at desc), '[]'::jsonb)
          from (select * from public.ai_agent_tasks order by created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) t
          join public.ai_agents a on a.id = t.agent_id left join public.ai_prospects p on p.id = t.prospect_id);
end $$;

create table if not exists public.crm_records_history (
  id bigint generated always as identity primary key,
  entity text not null, rid text not null, version bigint, op text not null, data jsonb, deleted_at timestamptz, changed_at timestamptz not null default now(), changed_by text
);
create index if not exists crm_records_history_k on public.crm_records_history(entity, rid, changed_at desc);
alter table public.crm_records_history enable row level security;
revoke all on public.crm_records_history from public, anon, authenticated;
grant select on public.crm_records_history to authenticated;
drop policy if exists crm_records_history_lecture on public.crm_records_history;
create policy crm_records_history_lecture on public.crm_records_history for select to authenticated using (public.ai_is_direction());
create or replace function public.crm_records_history_fn() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- ancienne valeur conservée à chaque modification ou suppression : un paiement ou une commande effacé(e) par erreur se récupère
  insert into public.crm_records_history(entity, rid, version, op, data, deleted_at, changed_by)
  values (old.entity, old.rid, old.version, tg_op, old.data, old.deleted_at, coalesce(new.updated_by, old.updated_by));
  return coalesce(new, old);
end $$;
drop trigger if exists crm_records_history on public.crm_records;
create trigger crm_records_history after update or delete on public.crm_records for each row execute function public.crm_records_history_fn();

do $$ declare t record; begin
  for t in select schemaname, tablename from pg_tables where schemaname = 'public' and (tablename like 'ai\_%' or tablename like 'crm\_%') loop
    execute format('revoke truncate, trigger, references on %I.%I from anon, authenticated', t.schemaname, t.tablename);
  end loop;
end $$;

-- ═══ ADDENDA : cohérence des chiffres avec le CRM ═══

-- Une offre acceptée par l'IA crée une commande en BROUILLON : elle n'entre dans le chiffre d'affaires qu'une fois confirmée par un humain (seul un paiement enregistré fait une vente).
create or replace function public.crm_h_offer(ev public.crm_ai_events) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare o public.ai_offers; p public.ai_prospects; v_rid text; v_prod text; v_doc text; v_cmd text; v_ia jsonb;
begin
  select * into o from public.ai_offers where id = (ev.payload->>'offer_id')::uuid;
  if o.id is null then return jsonb_build_object('skipped', 'offre supprimée'); end if;
  select * into p from public.ai_prospects where id = o.prospect_id;
  v_rid := public.crm_ensure_client(p);
  select coalesce(nom, o.product_id) into v_prod from public.ai_products where id = o.product_id;
  v_doc := 'ia_' || replace(o.id::text, '-', '');
  v_ia := jsonb_build_object('offer_id', o.id, 'product_id', o.product_id, 'total_ht', o.total_ht, 'total_ttc', o.total_ttc, 'remise_pct', o.remise_pct, 'valide_jusqu', o.valide_jusqu, 'statut', o.statut);
  perform public.crm_put('documents', v_doc,
    jsonb_build_object('ref', o.reference, 'type', 'proforma', 'client', p.entreprise, '_client_rid', v_rid, 'date', to_char(o.created_at at time zone 'UTC', 'YYYY-MM-DD'),
                       'html', public.crm_offer_html(o, p, v_prod), 'createdAt', o.created_at, 'source', 'IA', 'statut', o.statut, 'montant', o.total_ttc, 'ia', v_ia),
    'ia', 'ia:' || ev.type, false, null, null, false);
  perform public.crm_put('clients', v_rid, jsonb_build_object('interactions', jsonb_build_array(public.crm_interaction(
      case ev.type when 'ia.offer.accepted' then 'Offre acceptée' else 'Offre générée par l''IA' end,
      o.reference || ' · ' || coalesce(v_prod, o.product_id) || ' · ' || to_char(o.total_ttc, 'FM999G999G999G999') || ' FCFA TTC (' || o.statut || ')',
      case ev.type when 'ia.offer.accepted' then 4 else 3 end, ev.created_at, ev.id))), 'ia', 'ia:' || ev.type, false, null, null, false);
  if o.statut = 'acceptee' then
    v_cmd := 'ia_' || replace(o.id::text, '-', '');
    perform public.crm_put('commandes', v_cmd,
      jsonb_build_object('ref', 'IA-' || o.reference, 'client', p.entreprise, '_client_rid', v_rid, 'date', to_char(now() at time zone 'UTC', 'YYYY-MM-DD'), 'logiciel', coalesce(v_prod, o.product_id),
        'typeLicence', '', 'htBrut', o.total_brut_ht, 'remise', o.remise_pct, 'htNet', o.total_ht, 'tva', o.total_ttc - o.total_ht, 'ttc', o.total_ttc, 'acompte', 0, 'solde', o.total_ttc,
        'commercial', 'IA', 'statut', 'brouillon', 'presId', '', 'notes', 'Offre ' || o.reference || ' acceptée — commande créée par l''IA', 'source', 'IA', 'ia', v_ia),
      'ia', 'ia:' || ev.type, false, null, null, false);
    perform public.crm_put('deals', 'ia_' || replace(p.id::text, '-', ''),
      jsonb_build_object('client', p.entreprise, '_client_rid', v_rid, 'logiciel', coalesce(v_prod, ''), 'valeur', o.total_ht, 'commercial', 'IA', 'stage', 'negociation', 'color', '#7C3AED', 'source', 'IA',
        'date', to_char(o.created_at at time zone 'UTC', 'DD/MM/YYYY'), 'notes', 'Offre ' || o.reference || ' acceptée'),
      'ia', 'ia:' || ev.type, false, null, null, false);
  else
    perform public.crm_put('deals', 'ia_' || replace(p.id::text, '-', ''),
      jsonb_build_object('client', p.entreprise, '_client_rid', v_rid, 'logiciel', coalesce(v_prod, ''), 'valeur', o.total_ht, 'commercial', 'IA', 'stage', 'proposition', 'color', '#7C3AED', 'source', 'IA',
        'date', to_char(o.created_at at time zone 'UTC', 'DD/MM/YYYY'), 'notes', 'Offre ' || o.reference),
      'ia', 'ia:' || ev.type, false, null, null, false);
  end if;
  return jsonb_build_object('client_rid', v_rid, 'document', v_doc, 'commande', v_cmd);
end $$;
create or replace function public.ai_report_data(p_debut timestamptz, p_fin timestamptz) returns jsonb
language sql stable set search_path = public as $$
select jsonb_build_object(
  'periode', jsonb_build_object('debut', p_debut, 'fin', p_fin),
  'activite', jsonb_build_object(
    'agents_actifs',       (select count(*) from ai_agents where etat = 'actif'),
    'agents_crees',        (select count(*) from ai_agents where created_at >= p_debut and created_at < p_fin),
    'missions_attribuees', (select count(*) from ai_agent_tasks where created_at >= p_debut and created_at < p_fin),
    'missions_terminees',  (select count(*) from ai_agent_tasks where statut = 'terminee' and finished_at >= p_debut and finished_at < p_fin),
    'missions_en_cours',   (select count(*) from ai_agent_tasks where statut in ('a_faire','en_cours','attente_sous_taches','attente_validation')),
    'missions_bloquees',   (select count(*) from ai_agent_tasks where statut = 'bloquee'),
    'reunions',            (select count(*) from ai_agent_meetings where statut = 'terminee' and fin_at >= p_debut and fin_at < p_fin),
    'cout_ia_usd',         (select coalesce(round(sum(cout_usd), 2), 0) from ai_actions where action = 'llm_turn' and at >= p_debut and at < p_fin)),
  'commercial', jsonb_build_object(
    'nouveaux_prospects',  (select count(*) from ai_prospects where created_at >= p_debut and created_at < p_fin),
    'prospects_qualifies', (select count(*) from ai_stage_history where vers = 'qualifie' and at >= p_debut and at < p_fin),
    'whatsapp_envoyes',    (select count(*) from ai_messages where canal = 'whatsapp' and sens = 'sortant' and created_at >= p_debut and created_at < p_fin),
    'emails_envoyes',      (select count(*) from ai_messages where canal = 'email' and sens = 'sortant' and created_at >= p_debut and created_at < p_fin),
    'reponses_recues',     (select count(*) from ai_messages where sens = 'entrant' and created_at >= p_debut and created_at < p_fin),
    'rdv_obtenus',         (select count(*) from ai_appointments where created_at >= p_debut and created_at < p_fin),
    'demos_programmees',   (select count(*) from ai_appointments where statut in ('propose','confirme') and debut >= p_fin),
    'offres_transmises',   (select count(*) from ai_offers where created_at >= p_debut and created_at < p_fin
                              and statut in ('validee','envoyee','acceptee','refusee')),
    'negociations_en_cours', (select count(*) from ai_prospects where stage = 'negociation')),
  'financier', jsonb_build_object(
    'valeur_opportunites', (select coalesce(sum(potentiel_fcfa), 0) from ai_prospects          -- comme le CRM : un montant ne compte qu'à partir du devis
                              where stage in ('offre_transmise','negociation','offre_acceptee','contrat_transmis')),
    'devis_transmis_ht',   (select coalesce(sum(total_ht), 0) from ai_offers where created_at >= p_debut and created_at < p_fin
                              and statut in ('validee','envoyee','acceptee','refusee')),
    'marches_conclus',     (select count(*) from ai_stage_history where vers = 'marche_gagne' and at >= p_debut and at < p_fin),
    'ca_signe_ht',         (select coalesce(sum(coalesce(nullif((c.data->>'htNet')::numeric, 0), round(coalesce((c.data->>'ttc')::numeric, 0) / 1.18))), 0) from crm_records c   -- source de vérité : les commandes du CRM (HT, hors brouillons, annulées et renouvellements)
                              where c.entity = 'commandes' and c.deleted_at is null and c.data->>'statut' in ('confirmee', 'en_cours', 'livree') and coalesce(c.data->>'renouvellement', 'false') <> 'true'
                                and c.data->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and (c.data->>'date')::date >= p_debut::date and (c.data->>'date')::date < p_fin::date),
    'ca_encaisse_ht',      (select coalesce(round(sum((e->>'montant')::numeric * case when coalesce((c.data->>'ttc')::numeric, 0) > 0 then coalesce(nullif((c.data->>'htNet')::numeric, 0), round(coalesce((c.data->>'ttc')::numeric, 0) / 1.18)) / (c.data->>'ttc')::numeric else 1 end)), 0)   -- paiements du CRM de la période, ramenés en HT
                              from crm_records c, jsonb_array_elements(case when jsonb_typeof(c.data->'paiements') = 'array' then c.data->'paiements' else '[]'::jsonb end) e
                              where c.entity = 'commandes' and c.deleted_at is null and c.data->>'statut' in ('confirmee', 'en_cours', 'livree') and coalesce(e->>'supprime', 'false') <> 'true'
                                and e->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and (e->>'date')::date >= p_debut::date and (e->>'date')::date < p_fin::date),
    'prevision_ponderee',  (select coalesce(round(sum(potentiel_fcfa * case stage
                               when 'contrat_transmis' then 0.85 when 'offre_acceptee' then 0.8 when 'negociation' then 0.6
                               when 'offre_transmise' then 0.4 when 'demo_realisee' then 0.3 when 'rdv_confirme' then 0.2
                               when 'interesse' then 0.15 else 0.05 end)), 0)
                              from ai_prospects where stage in ('offre_transmise','negociation','offre_acceptee','contrat_transmis'))),
  'agents', (select coalesce(jsonb_agg(to_jsonb(s) order by s.score desc nulls last, s.nom), '[]'::jsonb)
               from ai_agent_stats(p_debut, p_fin) s where s.etat <> 'archive'),
  'difficultes', jsonb_build_object(
    'agents_en_difficulte', (select coalesce(jsonb_agg(jsonb_build_object('nom', nom, 'fonction', fonction, 'etat', etat, 'activite', activite)), '[]'::jsonb)
                               from ai_agents where etat = 'suspendu' or (etat = 'actif' and activite = 'en_difficulte')),
    'missions_bloquees',    (select coalesce(jsonb_agg(jsonb_build_object('titre', t.titre, 'agent', a.nom,
                               'note', right(coalesce(t.progression, ''), 300))), '[]'::jsonb)
                               from ai_agent_tasks t join ai_agents a on a.id = t.agent_id where t.statut = 'bloquee'),
    'incidents',            (select coalesce(jsonb_agg(jsonb_build_object('gravite', q.gravite, 'type', q.type,
                               'message', left(q.message, 300), 'at', q.created_at) order by q.created_at desc), '[]'::jsonb)
                               from (select * from ai_incidents where created_at >= p_debut and created_at < p_fin
                                     order by created_at desc limit 20) q),
    'validations_en_attente', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'motif', left(motif, 200),
                               'depuis', created_at) order by created_at), '[]'::jsonb)
                               from ai_approvals where statut = 'en_attente')),
  'programme', jsonb_build_object(
    'missions_prioritaires', (select coalesce(jsonb_agg(jsonb_build_object('titre', q.titre, 'agent', q.nom,
                               'priorite', q.priorite, 'echeance', q.echeance) order by q.priorite, q.echeance nulls last), '[]'::jsonb)
                               from (select t.titre, a.nom, t.priorite, t.echeance from ai_agent_tasks t join ai_agents a on a.id = t.agent_id
                                      where t.statut in ('a_faire','en_cours','attente_sous_taches')
                                      order by t.priorite, t.echeance nulls last limit 8) q),
    'rdv_prevus',           (select coalesce(jsonb_agg(jsonb_build_object('prospect', q.entreprise, 'debut', q.debut, 'mode', q.mode)
                               order by q.debut), '[]'::jsonb)
                               from (select p.entreprise, ap.debut, ap.mode from ai_appointments ap join ai_prospects p on p.id = ap.prospect_id
                                      where ap.statut = 'confirme' and ap.debut >= p_fin and ap.debut < p_fin + interval '2 days'
                                      order by ap.debut limit 10) q))
)
$$;