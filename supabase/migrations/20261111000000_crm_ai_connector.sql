-- ═════════════════════════════════════════════════════════════════════════════
--  SANIX — CONNECTEUR BIDIRECTIONNEL CRM ↔ SANIX AI · schéma v1
--  Une seule base (PostgreSQL). Le CRM garde une copie locale pour travailler hors ligne et la synchronise ; les agents IA
--  travaillent côté serveur, sans navigateur ouvert. Tout échange passe par un journal d'événements durable, daté, traçable
--  et idempotent (crm_ai_events), traité par crm_process_events() (pg_cron) et non par un navigateur.
--  ADDITIF : aucune table, aucune ligne, aucune fonction existante n'est supprimée. Les anciennes tables crm_* (accès « anon »
--  ouvert, colonnes incomplètes) ne sont plus utilisées par ce connecteur : voir supabase/lockdown_crm_legacy.sql.
--  Documentation et mapping exact des objets du CRM : supabase/CONNECTEUR_CRM_IA.md
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── 1. Fonctions utilitaires ────────────────────────────────────────────────
create or replace function public.crm_name_norm(p text) returns text
language sql stable set search_path = public, extensions as $$
  select nullif(regexp_replace(lower(extensions.unaccent(coalesce(p, ''))), '[^a-z0-9]+', '', 'g'), '')
$$;

create or replace function public.crm_num(p text) returns numeric
language sql immutable as $$
  select case when p ~ '^-?[0-9]+(\.[0-9]+)?$' then p::numeric else 0 end
$$;

create or replace function public.crm_html_esc(p text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;

-- Texte issu de l'IA (noms trouvés sur le web, comptes rendus) : les caractères qui permettent d'injecter du HTML ou du JavaScript dans
-- les gabarits du CRM (balises, guillemets d'attribut) sont remplacés par leurs équivalents typographiques ; le sens reste lisible.
create or replace function public.crm_clean(p text) returns text
language sql immutable as $$
  select translate(p, '<>"`', '‹›”’')
$$;
create or replace function public.crm_clean_json(j jsonb, p_skip text[] default array['html']) returns jsonb
language plpgsql immutable as $$
declare k text; v jsonb; r jsonb;
begin
  if jsonb_typeof(j) = 'string' then return to_jsonb(public.crm_clean(j #>> '{}')); end if;
  if jsonb_typeof(j) = 'object' then
    r := '{}'::jsonb;
    for k, v in select * from jsonb_each(j) loop
      r := r || jsonb_build_object(k, case when k = any(p_skip) then v else public.crm_clean_json(v, p_skip) end);
    end loop;
    return r;
  end if;
  if jsonb_typeof(j) = 'array' then
    select coalesce(jsonb_agg(public.crm_clean_json(e, p_skip) order by ord), '[]'::jsonb) into r from jsonb_array_elements(j) with ordinality as t(e, ord);
    return r;
  end if;
  return j;
end $$;

-- Clé naturelle d'un client : téléphone normalisé + nom normalisé (deux appareils qui créent le même client convergent ;
-- deux entreprises distinctes qui partagent un standard téléphonique ne sont jamais fusionnées).
create or replace function public.crm_natural_key(p_entity text, p_data jsonb) returns text
language sql stable set search_path = public, extensions as $$
  select case when p_entity = 'clients'
               and public.ai_norm_phone(p_data->>'phone') is not null
               and public.crm_name_norm(p_data->>'nom') is not null
              then public.ai_norm_phone(p_data->>'phone') || '|' || public.crm_name_norm(p_data->>'nom') end
$$;

-- Union de deux tableaux d'événements (interactions, historique) sans doublon, par ordre chronologique.
create or replace function public.crm_union_arrays(a jsonb, b jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(e order by coalesce(e->>'date', ''), ord), '[]'::jsonb)
  from (
    select distinct on (md5(e::text)) e, ord
    from (
      select e, ord from jsonb_array_elements(case when jsonb_typeof(a) = 'array' then a else '[]'::jsonb end) with ordinality as t(e, ord)
      union all
      select e, 1000000 + ord from jsonb_array_elements(case when jsonb_typeof(b) = 'array' then b else '[]'::jsonb end) with ordinality as t(e, ord)
    ) u
    order by md5(e::text), ord
  ) d
$$;

-- Champs que le serveur (l'IA) peut modifier : une copie locale périmée du navigateur ne doit jamais les écraser.
create or replace function public.crm_server_keys(p_entity text) returns text[]
language sql immutable as $$
  select case p_entity
    when 'clients'   then array['statut', 'ia', 'converted_at']
    when 'deals'     then array['stage', 'ia']
    when 'rdv'       then array['statut', 'compte_rendu', 'ia']
    when 'documents' then array['ia', 'statut']
    when 'commandes' then array['ia']
    else array[]::text[] end
$$;
create or replace function public.crm_union_keys(p_entity text) returns text[]
language sql immutable as $$
  select case p_entity when 'clients' then array['interactions'] when 'deals' then array['history'] else array[]::text[] end
$$;

-- ─── 2. Stockage central des données métier du CRM ───────────────────────────
create sequence if not exists public.crm_seq;

create table if not exists public.crm_records (
  entity       text   not null check (entity in ('clients','deals','commandes','contrats','licences','documents','presentations','rdv','deployments','apporteurs','ecritures','logiciels','config')),
  rid          text   not null check (rid ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  data         jsonb  not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 1500000),
  natural_key  text,
  version      bigint not null default 1,
  seq          bigint not null default nextval('public.crm_seq'),
  origin       text   not null default 'crm' check (origin in ('crm','ia','import')),
  updated_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  primary key (entity, rid)
);
comment on table public.crm_records is 'Données métier du CRM (une ligne par objet : client, commande, rendez-vous…). Clé stable (entity, rid) ; seq = curseur de synchronisation.';
create unique index if not exists crm_records_nk_uq on public.crm_records(entity, natural_key) where natural_key is not null and deleted_at is null;
create index if not exists crm_records_seq on public.crm_records(seq);
create index if not exists crm_records_client on public.crm_records((data->>'_client_rid')) where data ? '_client_rid';
create index if not exists crm_records_entity_upd on public.crm_records(entity, updated_at desc) where deleted_at is null;

create or replace function public.crm_records_stamp() returns trigger language plpgsql as $$
begin
  new.seq := nextval('public.crm_seq');
  new.updated_at := now();
  new.version := case when tg_op = 'INSERT' then 1 else old.version + 1 end;
  return new;
end $$;
drop trigger if exists crm_records_stamp on public.crm_records;
create trigger crm_records_stamp before insert or update on public.crm_records for each row execute function public.crm_records_stamp();

-- Opérations de synchronisation déjà appliquées (idempotence : un rejeu après une réponse perdue ne crée jamais de doublon).
create table if not exists public.crm_sync_ops (
  device     text not null check (length(device) between 8 and 64),
  op_id      text not null check (length(op_id) between 8 and 64),
  result     jsonb not null,
  user_id    uuid,
  created_at timestamptz not null default now(),
  primary key (device, op_id)
);
create index if not exists crm_sync_ops_at on public.crm_sync_ops(created_at);

-- ─── 3. Journal d'événements durable (outbox / inbox) ────────────────────────
create table if not exists public.crm_ai_events (
  id              uuid primary key default gen_random_uuid(),
  seq             bigint generated always as identity,
  direction       text not null check (direction in ('crm_to_ia','ia_to_crm')),
  type            text not null check (type ~ '^(crm|ia)\.[a-z_]+\.[a-z_]+$'),
  entity          text,
  rid             text,
  prospect_id     uuid,
  payload         jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  status          text not null default 'pending' check (status in ('pending','processing','done','failed','dead','skipped')),
  attempts        smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  result          jsonb,
  trace_id        uuid not null default gen_random_uuid(),
  caused_by       uuid references public.crm_ai_events(id) on delete set null,
  actor           text,
  created_at      timestamptz not null default now(),
  processed_at    timestamptz
);
comment on table public.crm_ai_events is 'Journal des événements CRM ↔ IA : durable, horodaté, traçable (trace_id, caused_by), idempotent (idempotency_key unique).';
create index if not exists crm_ai_events_queue on public.crm_ai_events(next_attempt_at) where status in ('pending','failed');
create index if not exists crm_ai_events_entity on public.crm_ai_events(entity, rid, created_at desc);
create index if not exists crm_ai_events_prospect on public.crm_ai_events(prospect_id, created_at desc) where prospect_id is not null;
create index if not exists crm_ai_events_status on public.crm_ai_events(status, created_at desc);

-- Routage : quel agent traite quel événement du CRM (modifiable sans code).
create table if not exists public.crm_ai_routing (
  event_type  text primary key,
  agent_code  text not null,
  task_type   text not null default 'tache' check (task_type in ('instruction','mission','tache')),
  priorite    smallint not null default 3 check (priorite between 1 and 5),
  titre_tpl   text not null,
  desc_tpl    text not null,
  note_tpl    text not null,
  echeance_h  integer,
  actif       boolean not null default true
);
insert into public.crm_ai_routing(event_type, agent_code, task_type, priorite, titre_tpl, desc_tpl, note_tpl, echeance_h) values
  ('crm.prospect.created',     'ia_qualif_1',   'tache', 2, 'Qualifier le prospect {nom}',
     'Un prospect vient d''être créé dans le CRM : {nom} ({secteur}). Qualifie-le avec la grille de qualification, recommande les produits adaptés et fais avancer son étape. Contexte CRM : {contexte}', 'Qualification confiée à {agent}', 24),
  ('crm.client.created',       'ia_success',    'tache', 3, 'Accueillir le nouveau client {nom}',
     'Un client vient d''être créé dans le CRM : {nom} ({secteur}). Prépare son accueil et son suivi de fidélisation. Contexte CRM : {contexte}', 'Suivi client confié à {agent}', 72),
  ('crm.client.converted',     'ia_success',    'tache', 3, 'Suivi de fidélisation : {nom}',
     '{nom} vient d''être converti en client dans le CRM. Planifie les premières relances de satisfaction et d''usage.', 'Fidélisation confiée à {agent}', 72),
  ('crm.commande.created',     'ia_docs',       'tache', 3, 'Préparer les documents de la commande {ref} ({nom})',
     'Une commande vient d''être créée dans le CRM : {ref} pour {nom} ({montant} FCFA TTC). Vérifie que le contrat et les documents nécessaires existent.', 'Documents de la commande {ref} confiés à {agent}', 48),
  ('crm.rdv.created',          'ia_rdv_1',      'tache', 2, 'Préparer le rendez-vous avec {nom}',
     'Un rendez-vous est planifié dans le CRM avec {nom} : {type} le {quand}. Prépare la fiche de rendez-vous (contexte, besoins, produits à présenter).', 'Préparation du rendez-vous confiée à {agent}', 24),
  ('crm.facture.emise',        'ia_dir_admin',  'tache', 3, 'Suivre l''encaissement de la facture {ref} ({nom})',
     'La facture {ref} vient d''être émise pour {nom} dans le CRM. Suis son encaissement et signale tout retard.', 'Encaissement de la facture {ref} suivi par {agent}', 168),
  ('crm.paiement.enregistre',  'ia_dir_admin',  'tache', 3, 'Enregistrer le paiement de {nom} ({ref})',
     'Un paiement de {montant} FCFA vient d''être enregistré dans le CRM pour {nom} (commande {ref}, solde restant {solde} FCFA). Contrôle la cohérence et prépare le reçu.', 'Paiement {montant} FCFA pris en charge par {agent}', 48),
  ('crm.reclamation.recue',    'ia_success',    'tache', 1, 'Traiter la réclamation de {nom}',
     'Une réclamation vient d''être enregistrée dans le CRM pour {nom} : « {contexte} ». Analyse-la, propose une réponse et escalade si nécessaire.', 'Réclamation confiée à {agent}', 8)
on conflict (event_type) do nothing;

-- Propriétaire de l'étape : l'agent responsable d'un prospect suit son avancement dans l'entonnoir.
create table if not exists public.crm_ai_stage_owner (
  stage      text primary key,
  agent_code text not null
);
insert into public.crm_ai_stage_owner(stage, agent_code) values
  ('identifie', 'ia_qualif_1'), ('enregistre', 'ia_qualif_1'), ('qualifie', 'ia_qualif_1'),
  ('premier_contact', 'ia_mail_1'), ('conversation', 'ia_mail_1'), ('besoin_identifie', 'ia_qualif_1'), ('interesse', 'ia_nego_1'),
  ('rdv_propose', 'ia_rdv_1'), ('rdv_confirme', 'ia_rdv_1'), ('demo_realisee', 'ia_nego_1'),
  ('offre_transmise', 'ia_nego_1'), ('negociation', 'ia_nego_1'), ('offre_acceptee', 'ia_docs'),
  ('contrat_transmis', 'ia_docs'), ('contrat_signe', 'ia_docs'), ('paiement_attendu', 'ia_dir_admin'), ('paiement_confirme', 'ia_dir_admin'),
  ('marche_gagne', 'ia_success'), ('deploiement', 'ia_success'), ('client_fidelise', 'ia_success')
on conflict (stage) do nothing;

-- ─── 4. Relations métier (tables SANIX AI existantes réutilisées, jamais dupliquées) ──
alter table public.ai_prospects
  add column if not exists crm_rid text,
  add column if not exists agent_id uuid references public.ai_agents(id) on delete set null;
comment on column public.ai_prospects.crm_rid is 'Clé stable du dossier dans crm_records (entity = clients). crm_client_id (entier local d''un navigateur) est conservé pour compatibilité.';
comment on column public.ai_prospects.agent_id is 'Agent IA responsable du prospect (suit l''étape de l''entonnoir : crm_ai_stage_owner).';
create unique index if not exists ai_prospects_crm_rid_uq on public.ai_prospects(crm_rid) where crm_rid is not null;
create index if not exists ai_prospects_agent on public.ai_prospects(agent_id) where agent_id is not null;

alter table public.ai_agent_tasks
  add column if not exists prospect_id uuid references public.ai_prospects(id) on delete set null,
  add column if not exists crm_event_id uuid references public.crm_ai_events(id) on delete set null;
create index if not exists ai_tasks_prospect on public.ai_agent_tasks(prospect_id) where prospect_id is not null;

-- ─── 5. Émission et traitement des événements ────────────────────────────────
create or replace function public.crm_emit(
  p_dir text, p_type text, p_entity text, p_rid text, p_key text, p_payload jsonb,
  p_prospect uuid default null, p_actor text default 'system', p_cause uuid default null, p_trace uuid default null
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  insert into public.crm_ai_events(direction, type, entity, rid, prospect_id, payload, idempotency_key, actor, caused_by, trace_id)
  values (p_dir, p_type, p_entity, p_rid, p_prospect, coalesce(p_payload, '{}'::jsonb), p_key, p_actor, p_cause, coalesce(p_trace, gen_random_uuid()))
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id;                                   -- null : l'événement existait déjà (idempotence)
end $$;

create or replace function public.crm_client_rid_of(p_data jsonb) returns text
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare v text; n int;
begin
  v := nullif(p_data->>'_client_rid', '');
  if v is not null and exists (select 1 from public.crm_records where entity = 'clients' and rid = v and deleted_at is null) then return v; end if;
  select count(*), min(rid) into n, v from public.crm_records
   where entity = 'clients' and deleted_at is null
     and public.crm_name_norm(data->>'nom') = public.crm_name_norm(coalesce(p_data->>'client', p_data->>'nom'))
     and public.crm_name_norm(coalesce(p_data->>'client', p_data->>'nom')) is not null;
  return case when n = 1 then v end;             -- nom ambigu : aucun rattachement deviné
end $$;

-- Événements CRM → IA : déclenchés par toute écriture d'un navigateur (origin = 'crm'), jamais par l'import initial ni par l'IA.
create or replace function public.crm_records_emit() returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare el jsonb; v_pay numeric; v_old numeric; v_snap jsonb; v_client text; v_who text;
begin
  if new.origin <> 'crm' or new.deleted_at is not null then return null; end if;
  v_who := 'crm:' || coalesce(new.updated_by, '?');
  v_snap := jsonb_build_object('rid', new.rid, 'entity', new.entity) || (new.data - array['html', 'interactions', 'history', 'lignes']);
  begin
    if new.entity = 'clients' then
      if tg_op = 'INSERT' then
        perform public.crm_emit('crm_to_ia', case when new.data->>'statut' = 'client' then 'crm.client.created' else 'crm.prospect.created' end,
                                'clients', new.rid, 'clients:' || new.rid || ':created', v_snap, null, v_who);
      else
        if coalesce(old.data->>'statut', '') <> 'client' and new.data->>'statut' = 'client' then
          perform public.crm_emit('crm_to_ia', 'crm.client.converted', 'clients', new.rid, 'clients:' || new.rid || ':converted', v_snap, null, v_who);
        end if;
        for el in select e from jsonb_array_elements(case when jsonb_typeof(new.data->'interactions') = 'array' then new.data->'interactions' else '[]'::jsonb end) e loop
          if coalesce(el->>'source', '') <> 'ia'
             and (coalesce(el->>'type', '') || ' ' || coalesce(el->>'note', '')) ~* 'r[ée]clam|plainte|litige|insatisf'
             and not (coalesce(old.data->'interactions', '[]'::jsonb) @> jsonb_build_array(el)) then
            perform public.crm_emit('crm_to_ia', 'crm.reclamation.recue', 'clients', new.rid, 'clients:' || new.rid || ':rec:' || md5(el::text),
                                    v_snap || jsonb_build_object('contexte', left(coalesce(el->>'note', el->>'type'), 500), 'interaction', el), null, v_who);
          end if;
        end loop;
      end if;
    elsif new.entity = 'commandes' then
      v_client := public.crm_client_rid_of(new.data);
      v_pay := public.crm_num(new.data->>'acompte');
      v_old := case when tg_op = 'UPDATE' then public.crm_num(old.data->>'acompte') else 0 end;
      v_snap := v_snap || jsonb_build_object('_client_rid', v_client);
      if tg_op = 'INSERT' then
        perform public.crm_emit('crm_to_ia', 'crm.commande.created', 'commandes', new.rid, 'commandes:' || new.rid || ':created', v_snap, null, v_who);
      end if;
      if v_pay > v_old then
        perform public.crm_emit('crm_to_ia', 'crm.paiement.enregistre', 'commandes', new.rid, 'commandes:' || new.rid || ':pay:' || v_pay::bigint::text,
                                v_snap || jsonb_build_object('montant', v_pay - v_old, 'cumul', v_pay, 'solde', public.crm_num(new.data->>'solde')), null, v_who);
      end if;
    elsif new.entity = 'documents' then
      if tg_op = 'INSERT' and new.data->>'type' = 'facture' then
        perform public.crm_emit('crm_to_ia', 'crm.facture.emise', 'documents', new.rid, 'documents:' || new.rid || ':facture',
                                v_snap || jsonb_build_object('_client_rid', public.crm_client_rid_of(new.data)), null, v_who);
      end if;
    elsif new.entity = 'rdv' then
      if tg_op = 'INSERT' then
        perform public.crm_emit('crm_to_ia', 'crm.rdv.created', 'rdv', new.rid, 'rdv:' || new.rid || ':created',
                                v_snap || jsonb_build_object('_client_rid', public.crm_client_rid_of(new.data)), null, v_who);
      end if;
    end if;
  exception when others then
    raise warning 'crm_records_emit (%/%) : %', new.entity, new.rid, sqlerrm;   -- l'écriture du CRM n'échoue jamais à cause du connecteur
  end;
  return null;
end $$;
drop trigger if exists crm_records_emit on public.crm_records;
create trigger crm_records_emit after insert or update on public.crm_records for each row execute function public.crm_records_emit();

-- ─── 6. Écriture dans les données du CRM (partagée par les navigateurs et par l'IA) ──
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
    if k = any(v_uni) then v_new := jsonb_set(v_new, array[k], public.crm_union_arrays(cur.data->k, p_patch->k), true);
    else v_new := jsonb_set(v_new, array[k], p_patch->k, true); end if;
  end loop;
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

create or replace function public.crm_apply_op(p_device text, op jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_entity text := op->>'entity'; v_rid text := nullif(op->>'rid', ''); v_action text := coalesce(op->>'action', 'upsert');
  v_base bigint := nullif(op->>'base_version', '')::bigint; v_ts timestamptz := nullif(op->>'client_ts', '')::timestamptz;
  v_import boolean := coalesce((op->>'import')::boolean, false); r jsonb; cur public.crm_records;
begin
  if v_entity is null or v_rid is null then raise exception 'Opération invalide (entity et rid requis)' using errcode = '22023'; end if;
  if v_action = 'delete' then
    select * into cur from public.crm_records where entity = v_entity and rid = v_rid for update;
    if cur.rid is null or cur.deleted_at is not null then
      return jsonb_build_object('op_id', op->>'op_id', 'ok', true, 'rid', v_rid, 'unchanged', true);
    end if;
    if v_base is not null and v_base < cur.version and cur.origin = 'ia' then
      return jsonb_build_object('op_id', op->>'op_id', 'ok', false, 'conflict', true, 'rid', v_rid, 'version', cur.version, 'reason', 'modifié par l''IA depuis la dernière synchronisation');
    end if;
    update public.crm_records set deleted_at = now(), origin = 'crm', updated_by = p_device where entity = v_entity and rid = v_rid returning * into cur;
    return jsonb_build_object('op_id', op->>'op_id', 'ok', true, 'rid', v_rid, 'version', cur.version, 'seq', cur.seq, 'deleted', true);
  end if;
  r := public.crm_put(v_entity, v_rid, coalesce(op->'data', '{}'::jsonb), case when v_import then 'import' else 'crm' end, p_device,
                      true, v_base, v_ts, coalesce((op->>'natural')::boolean, true));
  return r || jsonb_build_object('op_id', op->>'op_id', 'ok', true, 'sent_rid', v_rid);
end $$;

create or replace function public.crm_sync_push(p_device text, p_ops jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare op jsonb; res jsonb := '[]'::jsonb; r jsonb; v_prev jsonb;
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  if p_device is null or length(p_device) < 8 then raise exception 'Appareil invalide' using errcode = '22023'; end if;
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 200 then raise exception 'Lot invalide (tableau de 200 opérations au plus)' using errcode = '22023'; end if;
  for op in select value from jsonb_array_elements(p_ops) loop
    if coalesce(op->>'op_id', '') = '' then res := res || jsonb_build_array(jsonb_build_object('ok', false, 'error', 'op_id manquant')); continue; end if;
    select result into v_prev from public.crm_sync_ops where device = p_device and op_id = op->>'op_id';
    if found then res := res || jsonb_build_array(v_prev || jsonb_build_object('replayed', true)); continue; end if;
    begin
      r := public.crm_apply_op(p_device, op);
    exception when others then
      res := res || jsonb_build_array(jsonb_build_object('op_id', op->>'op_id', 'ok', false, 'error', sqlerrm, 'code', sqlstate));   -- non mémorisée : rejouable
      continue;
    end;
    insert into public.crm_sync_ops(device, op_id, result, user_id) values (p_device, op->>'op_id', r, auth.uid()) on conflict do nothing;
    res := res || jsonb_build_array(r);
  end loop;
  return jsonb_build_object('ok', true, 'results', res, 'cursor', (select coalesce(max(seq), 0) from public.crm_records));
end $$;

create or replace function public.crm_sync_pull(p_since bigint default 0, p_limit integer default 500) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_rows jsonb; v_max bigint; v_more boolean;
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('entity', entity, 'rid', rid, 'data', data, 'version', version, 'seq', seq, 'origin', origin,
                                               'deleted', deleted_at is not null, 'updated_at', updated_at) order by seq), '[]'::jsonb), max(seq)
    into v_rows, v_max
    from (select * from public.crm_records where seq > coalesce(p_since, 0) order by seq limit least(greatest(coalesce(p_limit, 500), 1), 1000)) t;
  v_more := v_max is not null and exists (select 1 from public.crm_records where seq > v_max);
  return jsonb_build_object('records', v_rows, 'cursor', coalesce(v_max, coalesce(p_since, 0)), 'more', v_more,
                            'server_cursor', (select coalesce(max(seq), 0) from public.crm_records));
end $$;

-- ─── 7. Dossier CRM ↔ prospect IA : relation unique et vérifiée ──────────────
create or replace function public.crm_stage_etape(p_stage text) returns int
language sql immutable as $$
  select case
    when p_stage in ('identifie', 'enregistre') then 0
    when p_stage in ('qualifie', 'premier_contact', 'conversation', 'besoin_identifie', 'interesse', 'rdv_propose', 'rdv_confirme', 'en_veille') then 1
    when p_stage = 'demo_realisee' then 2
    when p_stage = 'offre_transmise' then 3
    when p_stage in ('negociation', 'offre_acceptee', 'contrat_transmis') then 4
    when p_stage in ('contrat_signe', 'paiement_attendu', 'paiement_confirme', 'marche_gagne', 'deploiement', 'client_fidelise') then 5
    else 0 end
$$;
create or replace function public.crm_stage_deal(p_stage text) returns text
language sql immutable as $$
  select case
    when p_stage in ('rdv_propose', 'rdv_confirme', 'premier_contact', 'conversation', 'besoin_identifie', 'interesse') then 'contact'
    when p_stage = 'demo_realisee' then 'demo'
    when p_stage = 'offre_transmise' then 'proposition'
    when p_stage in ('negociation', 'offre_acceptee', 'contrat_transmis') then 'negociation'
    when p_stage in ('contrat_signe', 'paiement_attendu', 'paiement_confirme', 'marche_gagne', 'deploiement', 'client_fidelise') then 'gagne'
    when p_stage = 'perdu' then 'perdu'
    else null end
$$;
create or replace function public.crm_stage_label(p_stage text) returns text
language sql immutable as $$
  select case p_stage
    when 'identifie' then 'Prospect identifié' when 'enregistre' then 'Prospect enregistré' when 'qualifie' then 'Prospect qualifié par l''IA'
    when 'premier_contact' then 'Premier contact IA' when 'conversation' then 'Conversation en cours' when 'besoin_identifie' then 'Besoin identifié'
    when 'interesse' then 'Prospect intéressé' when 'rdv_propose' then 'Rendez-vous proposé' when 'rdv_confirme' then 'Rendez-vous confirmé'
    when 'demo_realisee' then 'Démonstration réalisée' when 'offre_transmise' then 'Offre transmise' when 'negociation' then 'En négociation'
    when 'offre_acceptee' then 'Offre acceptée' when 'contrat_transmis' then 'Contrat transmis' when 'contrat_signe' then 'Contrat signé'
    when 'paiement_attendu' then 'Paiement attendu' when 'paiement_confirme' then 'Paiement confirmé' when 'marche_gagne' then 'Marché gagné'
    when 'deploiement' then 'Déploiement' when 'client_fidelise' then 'Client fidélisé' when 'perdu' then 'Prospect perdu' when 'en_veille' then 'Mis en veille'
    else p_stage end
$$;

create or replace function public.crm_agent_of(p_code text) returns public.ai_agents
language sql stable security definer set search_path = public as $$
  select a.* from public.ai_agents a where a.code = p_code and a.archived_at is null limit 1
$$;

-- Propriétaire de l'étape (BEFORE : l'agent responsable suit l'entonnoir sans aucune action de l'agent).
create or replace function public.crm_prospect_owner() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    select a.id into v_id from public.crm_ai_stage_owner o join public.ai_agents a on a.code = o.agent_code and a.archived_at is null and a.etat <> 'archive' where o.stage = new.stage;
    if v_id is not null then new.agent_id := v_id; end if;
  end if;
  return new;
end $$;
drop trigger if exists crm_prospect_owner on public.ai_prospects;
create trigger crm_prospect_owner before insert or update of stage on public.ai_prospects for each row execute function public.crm_prospect_owner();

create or replace function public.crm_ensure_prospect(rec public.crm_records) returns public.ai_prospects
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p public.ai_prospects; v_phone text := public.ai_norm_phone(rec.data->>'phone'); v_email text := nullif(btrim(rec.data->>'email'), '');
begin
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_email := null; end if;
  select * into p from public.ai_prospects where crm_rid = rec.rid;
  if p.id is null and v_phone is not null then select * into p from public.ai_prospects where phone_norm = v_phone and crm_rid is null; end if;
  if p.id is null and v_email is not null then select * into p from public.ai_prospects where lower(email) = lower(v_email) and crm_rid is null; end if;
  if p.id is not null then
    if p.crm_rid is null then update public.ai_prospects set crm_rid = rec.rid where id = p.id returning * into p; end if;
    return p;
  end if;
  insert into public.ai_prospects(crm_rid, crm_client_id, entreprise, secteur, adresse, decideur, telephone, email, source, stage, resume_ia, potentiel_fcfa)
  values (rec.rid, case when (rec.data->>'id') ~ '^[0-9]{1,15}$' then (rec.data->>'id')::bigint end,
          left(coalesce(nullif(btrim(rec.data->>'nom'), ''), 'Sans nom'), 200), nullif(rec.data->>'secteur', ''), nullif(rec.data->>'adresse', ''),
          nullif(rec.data->>'contact', ''), nullif(rec.data->>'phone', ''), v_email, 'crm',
          case when rec.data->>'statut' = 'client' then 'client_fidelise' else 'enregistre' end,
          left(nullif(rec.data->>'notes', ''), 2000), nullif(public.crm_num(rec.data->>'valeur'), 0))
  returning * into p;
  return p;
end $$;

create or replace function public.crm_ensure_client(p public.ai_prospects) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_rid text; v_nk text; v_phone text := coalesce(p.whatsapp, p.telephone);
begin
  if p.crm_rid is not null and exists (select 1 from public.crm_records where entity = 'clients' and rid = p.crm_rid and deleted_at is null) then return p.crm_rid; end if;
  v_nk := public.crm_natural_key('clients', jsonb_build_object('phone', v_phone, 'nom', p.entreprise));
  if v_nk is not null then select rid into v_rid from public.crm_records where entity = 'clients' and natural_key = v_nk and deleted_at is null; end if;
  if v_rid is null and p.phone_norm is not null then
    select rid into v_rid from public.crm_records where entity = 'clients' and deleted_at is null and public.ai_norm_phone(data->>'phone') = p.phone_norm order by created_at limit 1;
  end if;
  if v_rid is null then
    v_rid := 'ia_' || replace(p.id::text, '-', '');
    perform public.crm_put('clients', v_rid,
      jsonb_build_object('nom', p.entreprise, 'phone', coalesce(v_phone, ''), 'email', coalesce(p.email, ''), 'secteur', coalesce(p.secteur, ''),
                         'adresse', coalesce(p.adresse, p.ville, ''), 'contact', coalesce(p.decideur, ''), 'statut', 'prospect', 'commercial', 'IA', 'valeur', coalesce(p.potentiel_fcfa, 0),
                         'notes', coalesce(left(p.resume_ia, 500), ''), 'source', 'IA', 'created_at', to_char(p.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                         'interactions', '[]'::jsonb),
      'ia', 'ia:ensure_client', false, null, null, false);
  end if;
  update public.ai_prospects set crm_rid = v_rid where id = p.id and crm_rid is distinct from v_rid
     and not exists (select 1 from public.ai_prospects o where o.crm_rid = v_rid and o.id <> p.id);
  return v_rid;
end $$;

-- Interaction de l'historique du dossier CRM (date = date de l'événement : un rejeu produit la même entrée, dédoublonnée).
create or replace function public.crm_interaction(p_type text, p_note text, p_etape int, p_at timestamptz, p_event uuid) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('date', to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'type', p_type, 'note', left(p_note, 1000),
                                              'etape', p_etape, 'ico', '🤖', 'source', 'ia', 'ia_event', p_event))
$$;

-- Création d'une mission pour un agent (gouvernance du moteur appliquée par les triggers existants).
create or replace function public.crm_make_task(p_agent text, p_type text, p_titre text, p_desc text, p_prio int, p_echeance_h int, p_prospect uuid, p_event uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.ai_agents; v_id uuid; v_titre text := left(btrim(p_titre), 200);
begin
  a := public.crm_agent_of(p_agent);
  if a.id is null then raise exception 'Agent % introuvable', p_agent using errcode = 'P0002'; end if;
  if a.etat <> 'actif' then raise exception 'Agent % indisponible (%)', p_agent, a.etat using errcode = 'P0001'; end if;
  select id into v_id from public.ai_agent_tasks
   where agent_id = a.id and titre_norm = lower(regexp_replace(btrim(v_titre), '\s+', ' ', 'g')) and statut in ('a_faire','en_cours','attente_sous_taches','attente_validation');
  if v_id is not null then return v_id; end if;   -- anti-doublon : la mission ouverte existe déjà
  insert into public.ai_agent_tasks(agent_id, donneur_agent_id, type, titre, description, objectifs, priorite, echeance, prospect_id, crm_event_id)
  values (a.id, a.manager_id, p_type, v_titre, left(p_desc, 8000), '[]'::jsonb, p_prio, case when p_echeance_h is not null then now() + make_interval(hours => p_echeance_h) end, p_prospect, p_event)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.crm_tpl(p_tpl text, p_vars jsonb) returns text
language plpgsql immutable as $$
declare k text; v text := p_tpl;
begin
  for k in select jsonb_object_keys(p_vars) loop v := replace(v, '{' || k || '}', coalesce(p_vars->>k, '')); end loop;
  return v;
end $$;

-- ─── 8. Traitement des événements ────────────────────────────────────────────
create or replace function public.crm_h_crm_event(ev public.crm_ai_events) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  rt public.crm_ai_routing; rec public.crm_records; p public.ai_prospects; v_client text; v_vars jsonb; v_task uuid; a public.ai_agents; v_data jsonb; v_inter jsonb;
begin
  select * into rt from public.crm_ai_routing where event_type = ev.type and actif;
  if rt.event_type is null then return jsonb_build_object('skipped', 'aucune règle de routage active'); end if;
  v_client := case when ev.entity = 'clients' then ev.rid else coalesce(ev.payload->>'_client_rid', public.crm_client_rid_of(ev.payload)) end;
  if v_client is not null then select * into rec from public.crm_records where entity = 'clients' and rid = v_client and deleted_at is null; end if;
  if ev.entity = 'clients' and rec.rid is null then return jsonb_build_object('skipped', 'dossier client supprimé'); end if;
  if rec.rid is not null then p := public.crm_ensure_prospect(rec); end if;
  v_data := coalesce(rec.data, '{}'::jsonb);
  v_vars := jsonb_build_object('nom', coalesce(v_data->>'nom', ev.payload->>'client', ev.payload->>'nom', 'client'), 'secteur', coalesce(nullif(v_data->>'secteur', ''), 'secteur non renseigné'),
            'contexte', left(coalesce(ev.payload->>'contexte', nullif(v_data->>'notes', ''), 'aucune note'), 400), 'ref', coalesce(ev.payload->>'ref', ''),
            'montant', to_char(coalesce(nullif(ev.payload->>'montant', '')::numeric, public.crm_num(ev.payload->>'ttc')), 'FM999G999G999G999'),
            'solde', to_char(public.crm_num(ev.payload->>'solde'), 'FM999G999G999G999'), 'type', coalesce(ev.payload->>'type', 'rendez-vous'),
            'quand', coalesce(ev.payload->>'date', '') || ' ' || coalesce(ev.payload->>'heure', ''));
  v_task := public.crm_make_task(rt.agent_code, rt.task_type, public.crm_tpl(rt.titre_tpl, v_vars), public.crm_tpl(rt.desc_tpl, v_vars), rt.priorite, rt.echeance_h, p.id, ev.id);
  select * into a from public.ai_agents where id = (select agent_id from public.ai_agent_tasks where id = v_task);
  if p.id is not null then
    update public.ai_prospects set agent_id = a.id where id = p.id and (agent_id is distinct from a.id) and ev.type in ('crm.prospect.created', 'crm.client.created');
    v_inter := public.crm_interaction('Pris en charge par l''IA', public.crm_tpl(rt.note_tpl, v_vars || jsonb_build_object('agent', a.nom)), null, ev.created_at, ev.id);
    perform public.crm_put('clients', rec.rid,
      jsonb_build_object('interactions', jsonb_build_array(v_inter),
                         'ia', coalesce(rec.data->'ia', '{}'::jsonb) || jsonb_build_object('prospect_id', p.id, 'agent_code', a.code, 'agent_nom', a.nom, 'stage', p.stage, 'linked_at', ev.created_at)),
      'ia', 'ia:' || ev.type, false, null, null, false);
  end if;
  return jsonb_build_object('task_id', v_task, 'agent', a.code, 'prospect_id', p.id, 'client_rid', rec.rid);
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
      jsonb_build_object('client', p.entreprise, '_client_rid', v_rid, 'logiciel', coalesce(p.produits_recommandes[1], ''), 'valeur', coalesce(p.potentiel_fcfa, 0), 'commercial', 'IA',
        'stage', v_ds, 'notes', 'Affaire suivie par l''IA', 'color', '#7C3AED', 'date', to_char(ev.created_at at time zone 'UTC', 'DD/MM/YYYY'), 'source', 'IA',
        'history', jsonb_build_array(jsonb_build_object('date', ev.created_at, 'type', 'stage_change', 'ico', '🤖', 'label', 'Étape IA : ' || public.crm_stage_label(v_stage), 'note', v_note, 'source', 'ia', 'ia_event', ev.id))),
      'ia', 'ia:' || ev.type, false, null, null, false);
  end if;
  return jsonb_build_object('client_rid', v_rid, 'stage', v_stage, 'converted', v_conv, 'deal', v_deal);
end $$;

create or replace function public.crm_h_rdv(ev public.crm_ai_events) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare ap public.ai_appointments; p public.ai_prospects; v_rid text; v_rdv text; v_mode text; v_cr jsonb;
begin
  select * into ap from public.ai_appointments where id = (ev.payload->>'appointment_id')::uuid;
  if ap.id is null then return jsonb_build_object('skipped', 'rendez-vous supprimé'); end if;
  select * into p from public.ai_prospects where id = ap.prospect_id;
  v_rid := public.crm_ensure_client(p);
  v_rdv := 'ia_' || replace(ap.id::text, '-', '');
  perform public.crm_put('rdv', v_rdv,
    jsonb_strip_nulls(jsonb_build_object('client', p.entreprise, '_client_rid', v_rid,
      'type', case when ap.mode = 'telephone' then 'Appel' else 'Démonstration' end,
      'date', to_char(ap.debut at time zone 'Africa/Abidjan', 'YYYY-MM-DD'), 'heure', to_char(ap.debut at time zone 'Africa/Abidjan', 'HH24:MI'),
      'duree', greatest(round(extract(epoch from ap.fin - ap.debut) / 60)::int, 15), 'visio', case when ap.mode = 'visio' then 'autre' else '' end,
      'lieu', coalesce(case when ap.mode = 'visio' then ap.lien_visio else ap.lieu end, ''), 'notes', coalesce(left(ap.fiche_prep, 1000), ''),
      'statut', case ap.statut when 'realise' then 'fait' when 'annule' then 'annule' when 'absent' then 'annule' else 'prevu' end,
      'compte_rendu', nullif(ap.compte_rendu, ''), 'source', 'IA', 'createdAt', ap.created_at,
      'ia', jsonb_build_object('appointment_id', ap.id, 'prospect_id', p.id, 'statut', ap.statut, 'operator_id', ap.operator_id))),
    'ia', 'ia:' || ev.type, false, null, null, false);
  if coalesce(ap.compte_rendu, '') <> '' and ev.type = 'ia.rdv.report' then
    v_cr := public.crm_interaction('Compte rendu de rendez-vous', ap.compte_rendu, null, ev.created_at, ev.id);
    perform public.crm_put('clients', v_rid, jsonb_build_object('interactions', jsonb_build_array(v_cr)), 'ia', 'ia:' || ev.type, false, null, null, false);
  elsif ev.type = 'ia.rdv.booked' and ap.statut in ('propose', 'confirme') then
    perform public.crm_put('clients', v_rid, jsonb_build_object('interactions', jsonb_build_array(
      public.crm_interaction('RDV fixé par l''IA', case when ap.mode = 'telephone' then 'Appel' else 'Démonstration' end || ' le ' || to_char(ap.debut at time zone 'Africa/Abidjan', 'DD/MM/YYYY à HH24:MI'), 1, ev.created_at, ev.id))),
      'ia', 'ia:' || ev.type, false, null, null, false);
  end if;
  return jsonb_build_object('client_rid', v_rid, 'rdv_rid', v_rdv);
end $$;

create or replace function public.crm_offer_html(o public.ai_offers, p public.ai_prospects, v_produit text) returns text
language plpgsql stable set search_path = public as $$
declare l jsonb; v_rows text := '';
begin
  for l in select value from jsonb_array_elements(case when jsonb_typeof(o.lignes) = 'array' then o.lignes else '[]'::jsonb end) loop
    v_rows := v_rows || '<tr><td style="border:1px solid #ccc;padding:6px">' || public.crm_html_esc(coalesce(l->>'libelle', l->>'poste')) || '</td>'
      || '<td style="border:1px solid #ccc;padding:6px;text-align:right">' || public.crm_html_esc(l->>'qte') || '</td>'
      || '<td style="border:1px solid #ccc;padding:6px;text-align:right">' || to_char(public.crm_num(l->>'pu_ht'), 'FM999G999G999G999') || '</td>'
      || '<td style="border:1px solid #ccc;padding:6px;text-align:right">' || to_char(public.crm_num(l->>'montant_ht'), 'FM999G999G999G999') || '</td></tr>';
  end loop;
  return '<div style="font-family:Arial,sans-serif;font-size:13px"><h2>Offre ' || public.crm_html_esc(o.reference) || ' — ' || public.crm_html_esc(v_produit) || '</h2>'
    || '<p>Client : <b>' || public.crm_html_esc(p.entreprise) || '</b><br>Établie par l''IA commerciale SANIX · valable jusqu''au ' || to_char(o.valide_jusqu, 'DD/MM/YYYY') || '</p>'
    || '<table style="border-collapse:collapse;width:100%"><tr><th style="border:1px solid #ccc;padding:6px;text-align:left">Désignation</th><th style="border:1px solid #ccc;padding:6px">Qté</th><th style="border:1px solid #ccc;padding:6px">P.U. HT</th><th style="border:1px solid #ccc;padding:6px">Montant HT</th></tr>'
    || v_rows || '</table>'
    || '<p style="text-align:right">Total brut HT : ' || to_char(o.total_brut_ht, 'FM999G999G999G999') || ' FCFA<br>Remise : ' || o.remise_pct || ' %<br>Total HT : <b>' || to_char(o.total_ht, 'FM999G999G999G999') || ' FCFA</b><br>TVA ' || o.tva_pct || ' % · Total TTC : <b>' || to_char(o.total_ttc, 'FM999G999G999G999') || ' FCFA</b></p>'
    || '<p style="color:#666">Proforma : ne vaut pas facture. Statut : ' || public.crm_html_esc(o.statut) || '.</p></div>';
end $$;

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
        'commercial', 'IA', 'statut', 'confirmee', 'presId', '', 'notes', 'Offre ' || o.reference || ' acceptée — commande créée par l''IA', 'source', 'IA', 'ia', v_ia),
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

create or replace function public.crm_h_mission(ev public.crm_ai_events) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare t public.ai_agent_tasks; p public.ai_prospects; a public.ai_agents; v_rid text;
begin
  select * into t from public.ai_agent_tasks where id = (ev.payload->>'task_id')::uuid;
  if t.id is null or t.prospect_id is null then return jsonb_build_object('skipped', 'mission sans dossier'); end if;
  select * into p from public.ai_prospects where id = t.prospect_id;
  select * into a from public.ai_agents where id = t.agent_id;
  v_rid := public.crm_ensure_client(p);
  perform public.crm_put('clients', v_rid, jsonb_build_object('interactions', jsonb_build_array(public.crm_interaction(
      case ev.type when 'ia.mission.completed' then 'Mission terminée par l''IA' else 'Mission assignée à l''IA' end,
      a.nom || ' · ' || t.titre || coalesce(' — ' || left(nullif(t.rapport, ''), 400), ''), null, ev.created_at, ev.id))),
    'ia', 'ia:' || ev.type, false, null, null, false);
  return jsonb_build_object('client_rid', v_rid, 'task_id', t.id);
end $$;

create or replace function public.crm_h_alert(ev public.crm_ai_events) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare p public.ai_prospects; v_rid text; v_msg text := coalesce(ev.payload->>'message', 'Anomalie signalée par un agent');
begin
  if ev.prospect_id is null then return jsonb_build_object('alert', true, 'client_rid', null); end if;
  select * into p from public.ai_prospects where id = ev.prospect_id;
  if p.id is null then return jsonb_build_object('alert', true, 'client_rid', null); end if;
  v_rid := public.crm_ensure_client(p);
  perform public.crm_put('clients', v_rid,
    jsonb_build_object('interactions', jsonb_build_array(public.crm_interaction('Alerte IA (' || coalesce(ev.payload->>'niveau', 'attention') || ')', v_msg, null, ev.created_at, ev.id)),
                       'ia', jsonb_build_object('alerte', jsonb_build_object('niveau', coalesce(ev.payload->>'niveau', 'attention'), 'message', left(v_msg, 400), 'at', ev.created_at))),
    'ia', 'ia:' || ev.type, false, null, null, false);
  return jsonb_build_object('alert', true, 'client_rid', v_rid);
end $$;

create or replace function public.crm_handle_event(ev public.crm_ai_events) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if ev.type in ('crm.prospect.created', 'crm.client.created', 'crm.client.converted', 'crm.commande.created', 'crm.rdv.created', 'crm.facture.emise', 'crm.paiement.enregistre', 'crm.reclamation.recue') then
    return public.crm_h_crm_event(ev);
  elsif ev.type in ('ia.prospect.qualified', 'ia.prospect.stage_changed') then return public.crm_h_prospect(ev);
  elsif ev.type in ('ia.rdv.booked', 'ia.rdv.report') then return public.crm_h_rdv(ev);
  elsif ev.type in ('ia.offer.created', 'ia.offer.updated', 'ia.offer.accepted') then return public.crm_h_offer(ev);
  elsif ev.type in ('ia.mission.assigned', 'ia.mission.completed') then return public.crm_h_mission(ev);
  elsif ev.type = 'ia.alert.raised' then return public.crm_h_alert(ev);
  end if;
  raise exception 'Type d''événement inconnu : %', ev.type using errcode = '22023';
end $$;

-- Traitement durable par lots : verrouillage « skip locked », sous-transaction par événement, reprise avec délai croissant,
-- état « dead » après 8 tentatives (visible dans le CRM, rejouable par un opérateur). Appelé par pg_cron, jamais par un navigateur.
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
      if sqlerrm like 'Gouvernance : agent déjà chargé%' or sqlerrm like 'Gouvernance : % missions actives maximum%' then
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

create or replace function public.crm_event_retry(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  update public.crm_ai_events set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null where id = p_id and status in ('failed', 'dead');
end $$;

create or replace function public.crm_purge_old(p_days integer default 30) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a int; b int;
begin
  delete from public.crm_sync_ops where created_at < now() - make_interval(days => p_days); get diagnostics a = row_count;
  delete from public.crm_ai_events where status in ('done', 'skipped') and created_at < now() - make_interval(days => greatest(p_days, 90)); get diagnostics b = row_count;
  return jsonb_build_object('ops', a, 'events', b);
end $$;

-- ─── 9. Événements IA → CRM : déclenchés par le travail des agents (aucun navigateur requis) ──
create or replace function public.crm_ia_prospect_emit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_h bigint;
begin
  begin
    if tg_op = 'UPDATE' and new.stage is distinct from old.stage and (new.crm_rid is not null or new.stage not in ('identifie', 'enregistre', 'en_veille', 'perdu')) then
      select max(id) into v_h from public.ai_stage_history where prospect_id = new.id;
      perform public.crm_emit('ia_to_crm', case when new.stage = 'qualifie' then 'ia.prospect.qualified' else 'ia.prospect.stage_changed' end, 'clients', new.crm_rid,
        'ai_prospects:' || new.id || ':stage:' || new.stage || ':' || coalesce(v_h::text, '0'),
        jsonb_build_object('prospect_id', new.id, 'stage', new.stage, 'old_stage', old.stage, 'score', new.score), new.id, 'agent');
    end if;
  exception when others then raise warning 'crm_ia_prospect_emit : %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists crm_ia_prospect_emit on public.ai_prospects;
create trigger crm_ia_prospect_emit after update on public.ai_prospects for each row execute function public.crm_ia_prospect_emit();

create or replace function public.crm_ia_appointment_emit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p public.ai_prospects;
begin
  begin
    select * into v_p from public.ai_prospects where id = new.prospect_id;
    if tg_op = 'INSERT' or new.statut is distinct from old.statut or new.debut is distinct from old.debut or new.fin is distinct from old.fin then
      perform public.crm_emit('ia_to_crm', 'ia.rdv.booked', 'rdv', 'ia_' || replace(new.id::text, '-', ''),
        'ai_appointments:' || new.id || ':state:' || md5(new.statut || new.debut::text || new.fin::text || coalesce(new.lieu, '') || coalesce(new.lien_visio, '')),
        jsonb_build_object('appointment_id', new.id, 'prospect_id', new.prospect_id, 'statut', new.statut), new.prospect_id, 'agent');
    end if;
    if coalesce(new.compte_rendu, '') <> '' and (tg_op = 'INSERT' or new.compte_rendu is distinct from old.compte_rendu) then
      perform public.crm_emit('ia_to_crm', 'ia.rdv.report', 'rdv', 'ia_' || replace(new.id::text, '-', ''), 'ai_appointments:' || new.id || ':report:' || md5(new.compte_rendu),
        jsonb_build_object('appointment_id', new.id, 'prospect_id', new.prospect_id), new.prospect_id, 'agent');
    end if;
  exception when others then raise warning 'crm_ia_appointment_emit : %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists crm_ia_appointment_emit on public.ai_appointments;
create trigger crm_ia_appointment_emit after insert or update on public.ai_appointments for each row execute function public.crm_ia_appointment_emit();

create or replace function public.crm_ia_offer_emit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.crm_emit('ia_to_crm', 'ia.offer.created', 'documents', 'ia_' || replace(new.id::text, '-', ''), 'ai_offers:' || new.id || ':created:' || new.statut,
        jsonb_build_object('offer_id', new.id, 'prospect_id', new.prospect_id, 'statut', new.statut), new.prospect_id, 'agent');
    elsif new.statut is distinct from old.statut or new.total_ttc is distinct from old.total_ttc then
      perform public.crm_emit('ia_to_crm', case when new.statut = 'acceptee' then 'ia.offer.accepted' else 'ia.offer.updated' end, 'documents', 'ia_' || replace(new.id::text, '-', ''),
        'ai_offers:' || new.id || ':state:' || new.statut || ':' || new.total_ttc::text, jsonb_build_object('offer_id', new.id, 'prospect_id', new.prospect_id, 'statut', new.statut), new.prospect_id, 'agent');
    end if;
  exception when others then raise warning 'crm_ia_offer_emit : %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists crm_ia_offer_emit on public.ai_offers;
create trigger crm_ia_offer_emit after insert or update on public.ai_offers for each row execute function public.crm_ia_offer_emit();

create or replace function public.crm_ia_task_emit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    if new.prospect_id is not null then
      if tg_op = 'INSERT' then
        if new.crm_event_id is not null then return null; end if;
        perform public.crm_emit('ia_to_crm', 'ia.mission.assigned', null, null, 'ai_agent_tasks:' || new.id || ':created',
          jsonb_build_object('task_id', new.id, 'prospect_id', new.prospect_id, 'agent_id', new.agent_id), new.prospect_id, 'agent');
      elsif new.statut is distinct from old.statut and new.statut = 'terminee' then
        perform public.crm_emit('ia_to_crm', 'ia.mission.completed', null, null, 'ai_agent_tasks:' || new.id || ':done',
          jsonb_build_object('task_id', new.id, 'prospect_id', new.prospect_id, 'agent_id', new.agent_id), new.prospect_id, 'agent');
      elsif new.statut is distinct from old.statut and new.statut in ('echouee', 'bloquee') then
        perform public.crm_emit('ia_to_crm', 'ia.alert.raised', null, null, 'ai_agent_tasks:' || new.id || ':' || new.statut,
          jsonb_build_object('task_id', new.id, 'prospect_id', new.prospect_id, 'agent_id', new.agent_id, 'niveau', 'attention',
                             'message', 'Mission « ' || new.titre || ' » ' || case new.statut when 'echouee' then 'en échec' else 'bloquée' end), new.prospect_id, 'agent');
      end if;
    end if;
  exception when others then raise warning 'crm_ia_task_emit : %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists crm_ia_task_emit on public.ai_agent_tasks;
create trigger crm_ia_task_emit after insert or update of statut on public.ai_agent_tasks for each row execute function public.crm_ia_task_emit();

create or replace function public.crm_ia_incident_emit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p uuid;
begin
  begin
    if new.gravite in ('attention', 'critique') then
      select prospect_id into v_p from public.ai_agent_tasks where id = new.task_id;
      perform public.crm_emit('ia_to_crm', 'ia.alert.raised', null, null, 'ai_incidents:' || new.id,
        jsonb_build_object('incident_id', new.id, 'niveau', new.gravite, 'message', left(new.message, 1000), 'type', new.type, 'agent_id', new.agent_id, 'task_id', new.task_id), v_p, 'agent');
    end if;
  exception when others then raise warning 'crm_ia_incident_emit : %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists crm_ia_incident_emit on public.ai_incidents;
create trigger crm_ia_incident_emit after insert on public.ai_incidents for each row execute function public.crm_ia_incident_emit();

-- ─── 10. Lecture pour les interfaces (CRM, bureau 3D, bureau du Président) ───
create or replace function public.crm_sync_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  return jsonb_build_object(
    'cursor', (select coalesce(max(seq), 0) from public.crm_records),
    'records', (select coalesce(jsonb_object_agg(entity, n), '{}'::jsonb) from (select entity, count(*) n from public.crm_records where deleted_at is null group by entity) x),
    'events', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.crm_ai_events group by status) x),
    'last_event_at', (select max(created_at) from public.crm_ai_events), 'last_done_at', (select max(processed_at) from public.crm_ai_events where status = 'done'),
    'failing', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type, 'status', status, 'attempts', attempts, 'last_error', last_error, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
                from (select * from public.crm_ai_events where status in ('failed', 'dead') order by created_at desc limit 20) f));
end $$;

create or replace function public.crm_client_panel(p_rid text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p public.ai_prospects; v jsonb;
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  select * into p from public.ai_prospects where crm_rid = p_rid;
  v := jsonb_build_object('rid', p_rid, 'linked', p.id is not null);
  if p.id is null then
    return v || jsonb_build_object('events', (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'status', status, 'created_at', created_at, 'last_error', last_error) order by created_at desc), '[]'::jsonb)
                                              from (select * from public.crm_ai_events where entity = 'clients' and rid = p_rid order by created_at desc limit 10) e));
  end if;
  return v || jsonb_build_object(
    'prospect', jsonb_build_object('id', p.id, 'stage', p.stage, 'score', p.score, 'priorite', p.priorite, 'produits', to_jsonb(p.produits_recommandes), 'resume', left(p.resume_ia, 600), 'opt_out', p.opt_out),
    'agent', (select jsonb_build_object('id', a.id, 'code', a.code, 'nom', a.nom, 'fonction', a.fonction) from public.ai_agents a where a.id = p.agent_id),
    'missions', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'titre', t.titre, 'statut', t.statut, 'agent', a.nom, 'agent_code', a.code, 'priorite', t.priorite, 'created_at', t.created_at, 'finished_at', t.finished_at, 'echeance', t.echeance, 'rapport', left(t.rapport, 800)) order by t.created_at desc), '[]'::jsonb)
                 from (select * from public.ai_agent_tasks where prospect_id = p.id order by created_at desc limit 15) t join public.ai_agents a on a.id = t.agent_id),
    'rdv', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'debut', r.debut, 'fin', r.fin, 'mode', r.mode, 'statut', r.statut, 'compte_rendu', left(r.compte_rendu, 1500), 'fiche_prep', left(r.fiche_prep, 800)) order by r.debut desc), '[]'::jsonb)
            from (select * from public.ai_appointments where prospect_id = p.id order by debut desc limit 10) r),
    'offres', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'reference', o.reference, 'statut', o.statut, 'total_ttc', o.total_ttc, 'created_at', o.created_at) order by o.created_at desc), '[]'::jsonb)
               from (select * from public.ai_offers where prospect_id = p.id order by created_at desc limit 10) o),
    'validations', (select coalesce(jsonb_agg(jsonb_build_object('id', ap.id, 'type', ap.type, 'motif', ap.motif, 'created_at', ap.created_at) order by ap.created_at), '[]'::jsonb)
                    from public.ai_approvals ap where ap.prospect_id = p.id and ap.statut = 'en_attente'),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('type', e.type, 'direction', e.direction, 'status', e.status, 'attempts', e.attempts, 'created_at', e.created_at, 'processed_at', e.processed_at, 'last_error', e.last_error) order by e.created_at desc), '[]'::jsonb)
               from (select * from public.crm_ai_events where prospect_id = p.id or (entity = 'clients' and rid = p_rid) order by created_at desc limit 20) e));
end $$;

create or replace function public.crm_agent_portfolio(p_agent uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  return jsonb_build_object(
    'prospects', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'entreprise', p.entreprise, 'stage', p.stage, 'score', p.score, 'priorite', p.priorite, 'crm_rid', p.crm_rid,
                    'statut_crm', (select r.data->>'statut' from public.crm_records r where r.entity = 'clients' and r.rid = p.crm_rid)) order by p.updated_at desc), '[]'::jsonb)
                  from (select * from public.ai_prospects where agent_id = p_agent order by updated_at desc limit 25) p),
    'missions', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'titre', t.titre, 'statut', t.statut, 'prospect_id', t.prospect_id,
                    'entreprise', (select entreprise from public.ai_prospects where id = t.prospect_id), 'crm_rid', (select crm_rid from public.ai_prospects where id = t.prospect_id)) order by t.created_at desc), '[]'::jsonb)
                 from (select * from public.ai_agent_tasks where agent_id = p_agent and prospect_id is not null order by created_at desc limit 15) t),
    'validations', (select coalesce(jsonb_agg(jsonb_build_object('id', ap.id, 'type', ap.type, 'motif', ap.motif, 'prospect_id', ap.prospect_id, 'created_at', ap.created_at) order by ap.created_at), '[]'::jsonb)
                    from public.ai_approvals ap where ap.statut = 'en_attente' and (ap.agent_id = p_agent or ap.prospect_id in (select id from public.ai_prospects where agent_id = p_agent))));
end $$;

-- Mission pour un dossier : mêmes règles de gouvernance que les missions du bureau (triggers existants), réservée à la direction.
create or replace function public.crm_assign_mission(p_agent uuid, p_prospect uuid, p_titre text, p_description text, p_priorite integer default 3, p_echeance_h integer default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; a public.ai_agents;
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  select * into a from public.ai_agents where id = p_agent and archived_at is null;
  if a.id is null or a.etat <> 'actif' then raise exception 'Agent indisponible' using errcode = 'P0001'; end if;
  insert into public.ai_agent_tasks(agent_id, donneur_user_id, type, titre, description, objectifs, priorite, echeance, prospect_id)
  values (p_agent, auth.uid(), 'mission', left(btrim(p_titre), 200), left(coalesce(nullif(btrim(p_description), ''), p_titre), 8000), '[]'::jsonb,
          least(greatest(coalesce(p_priorite, 3), 1), 5), case when p_echeance_h is not null then now() + make_interval(hours => p_echeance_h) end, p_prospect)
  returning id into v_id;
  return v_id;
end $$;

-- Arbitrage du Président : annuler ou reprioriser une mission ouverte.
create or replace function public.crm_arbitrate_task(p_task uuid, p_action text, p_priorite integer default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  if p_action = 'cancel' then
    update public.ai_agent_tasks set statut = 'annulee' where id = p_task and statut in ('a_faire', 'en_cours', 'attente_sous_taches', 'attente_validation', 'bloquee');
  elsif p_action = 'prioritize' then
    update public.ai_agent_tasks set priorite = least(greatest(coalesce(p_priorite, 1), 1), 5) where id = p_task and statut in ('a_faire', 'en_cours', 'attente_sous_taches', 'attente_validation', 'bloquee');
  elsif p_action = 'retry' then
    update public.ai_agent_tasks set statut = 'a_faire' where id = p_task and statut in ('echouee', 'bloquee');
  else raise exception 'Action inconnue : %', p_action using errcode = '22023';
  end if;
end $$;

create or replace function public.crm_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_obj numeric;
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  select public.crm_num(data->>'objectifDefaut') into v_obj from public.crm_records where entity = 'config' and rid = 'main' and deleted_at is null;
  v_obj := coalesce(nullif(v_obj, 0), 1500000);
  return jsonb_build_object(
    'objectif_mensuel_fcfa', v_obj,
    'clients', (select count(*) from public.crm_records where entity = 'clients' and deleted_at is null and data->>'statut' = 'client'),
    'prospects', (select count(*) from public.crm_records where entity = 'clients' and deleted_at is null and coalesce(data->>'statut', 'prospect') = 'prospect'),
    'deals', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (select coalesce(data->>'stage', 'prospect') s, count(*) n from public.crm_records where entity = 'deals' and deleted_at is null group by 1) x),
    'ca_commandes_mois', (select coalesce(sum(public.crm_num(data->>'ttc')), 0) from public.crm_records where entity = 'commandes' and deleted_at is null and coalesce(data->>'statut', '') <> 'annulee' and updated_at >= date_trunc('month', now())),
    'encaisse_mois', (select coalesce(sum(public.crm_num(data->>'acompte')), 0) from public.crm_records where entity = 'commandes' and deleted_at is null and coalesce(data->>'statut', '') <> 'annulee' and updated_at >= date_trunc('month', now())),
    'ca_ia_total', (select coalesce(sum(public.crm_num(data->>'ttc')), 0) from public.crm_records where entity = 'commandes' and deleted_at is null and data->>'source' = 'IA'),
    'rdv_a_venir', (select count(*) from public.crm_records where entity = 'rdv' and deleted_at is null and coalesce(data->>'statut', 'prevu') = 'prevu' and (data->>'date') >= to_char(now() at time zone 'Africa/Abidjan', 'YYYY-MM-DD')),
    'offres', (select coalesce(jsonb_object_agg(statut, n), '{}'::jsonb) from (select statut, count(*) n from public.ai_offers group by statut) x),
    'missions_ouvertes', (select count(*) from public.ai_agent_tasks where statut in ('a_faire', 'en_cours', 'attente_sous_taches', 'attente_validation', 'bloquee')),
    'missions_en_retard', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'titre', t.titre, 'agent', a.nom, 'echeance', t.echeance, 'statut', t.statut, 'priorite', t.priorite) order by t.echeance), '[]'::jsonb)
                           from (select * from public.ai_agent_tasks where echeance < now() and statut in ('a_faire', 'en_cours', 'attente_sous_taches', 'attente_validation', 'bloquee') order by echeance limit 15) t join public.ai_agents a on a.id = t.agent_id),
    'validations_en_attente', (select count(*) from public.ai_approvals where statut = 'en_attente'),
    'anomalies', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'type', e.type, 'niveau', e.payload->>'niveau', 'message', e.payload->>'message', 'status', e.status, 'created_at', e.created_at) order by e.created_at desc), '[]'::jsonb)
                  from (select * from public.crm_ai_events where (type = 'ia.alert.raised' or status = 'dead') and created_at >= now() - interval '7 days' order by created_at desc limit 15) e),
    'sync', jsonb_build_object('en_attente', (select count(*) from public.crm_ai_events where status in ('pending', 'processing')),
                               'en_echec', (select count(*) from public.crm_ai_events where status = 'failed'), 'morts', (select count(*) from public.crm_ai_events where status = 'dead')));
end $$;

create or replace function public.crm_missions_overview(p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'titre', t.titre, 'statut', t.statut, 'type', t.type, 'priorite', t.priorite, 'agent', a.nom, 'agent_code', a.code,
            'created_at', t.created_at, 'echeance', t.echeance, 'finished_at', t.finished_at, 'prospect_id', t.prospect_id, 'crm_rid', p.crm_rid, 'entreprise', p.entreprise, 'rapport', left(t.rapport, 600)) order by t.created_at desc), '[]'::jsonb)
          from (select * from public.ai_agent_tasks order by created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) t
          join public.ai_agents a on a.id = t.agent_id left join public.ai_prospects p on p.id = t.prospect_id);
end $$;

-- Délégation explicite d'un dossier existant à l'IA (bouton « Confier » du CRM) : événement durable, aucune écriture directe dans les tables IA.
create or replace function public.crm_delegate(p_rid text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare rec public.crm_records; v_id uuid;
begin
  if not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
  select * into rec from public.crm_records where entity = 'clients' and rid = p_rid and deleted_at is null;
  if rec.rid is null then raise exception 'Dossier introuvable' using errcode = 'P0002'; end if;
  v_id := public.crm_emit('crm_to_ia', 'crm.prospect.created', 'clients', rec.rid, 'clients:' || rec.rid || ':delegated:' || to_char(now(), 'YYYYMMDD'),
                          jsonb_build_object('rid', rec.rid, 'entity', 'clients') || (rec.data - array['html', 'interactions', 'history']), null, 'crm:delegation');
  return jsonb_build_object('event_id', v_id, 'already', v_id is null);
end $$;

-- Rattrapage à la mise en service : émet les événements IA → CRM des objets IA déjà existants (offres, rendez-vous, prospects qualifiés).
create or replace function public.crm_backfill_ia() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n_o int := 0; n_a int := 0; n_p int := 0; r record;
begin
  if not (public.ai_is_direction() or coalesce(auth.role(), '') = 'service_role' or current_user = 'postgres') then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  for r in select * from public.ai_offers loop
    if public.crm_emit('ia_to_crm', case when r.statut = 'acceptee' then 'ia.offer.accepted' else 'ia.offer.created' end, 'documents', 'ia_' || replace(r.id::text, '-', ''),
                       'backfill:ai_offers:' || r.id || ':' || r.statut, jsonb_build_object('offer_id', r.id, 'prospect_id', r.prospect_id), r.prospect_id, 'backfill') is not null then n_o := n_o + 1; end if;
  end loop;
  for r in select * from public.ai_appointments loop
    if public.crm_emit('ia_to_crm', 'ia.rdv.booked', 'rdv', 'ia_' || replace(r.id::text, '-', ''), 'backfill:ai_appointments:' || r.id || ':' || r.statut,
                       jsonb_build_object('appointment_id', r.id, 'prospect_id', r.prospect_id), r.prospect_id, 'backfill') is not null then n_a := n_a + 1; end if;
    if coalesce(r.compte_rendu, '') <> '' then
      perform public.crm_emit('ia_to_crm', 'ia.rdv.report', 'rdv', 'ia_' || replace(r.id::text, '-', ''), 'backfill:ai_appointments:' || r.id || ':report:' || md5(r.compte_rendu),
                              jsonb_build_object('appointment_id', r.id, 'prospect_id', r.prospect_id), r.prospect_id, 'backfill');
    end if;
  end loop;
  for r in select * from public.ai_prospects where crm_rid is not null and stage not in ('identifie', 'enregistre') loop
    if public.crm_emit('ia_to_crm', case when r.stage = 'qualifie' then 'ia.prospect.qualified' else 'ia.prospect.stage_changed' end, 'clients', r.crm_rid,
                       'backfill:ai_prospects:' || r.id || ':' || r.stage, jsonb_build_object('prospect_id', r.id, 'stage', r.stage, 'score', r.score), r.id, 'backfill') is not null then n_p := n_p + 1; end if;
  end loop;
  return jsonb_build_object('offres', n_o, 'rendez_vous', n_a, 'prospects', n_p);
end $$;

-- ─── 11. Droits : écriture uniquement par les fonctions ci-dessus ; lecture réservée aux opérateurs ──
alter table public.crm_records enable row level security;
alter table public.crm_sync_ops enable row level security;
alter table public.crm_ai_events enable row level security;
alter table public.crm_ai_routing enable row level security;
alter table public.crm_ai_stage_owner enable row level security;
do $$ declare t text; begin
  foreach t in array array['crm_records', 'crm_ai_events', 'crm_ai_routing', 'crm_ai_stage_owner'] loop
    execute format('drop policy if exists op_read on public.%I', t);
    execute format('create policy op_read on public.%I for select to authenticated using (public.ai_is_operator())', t);
  end loop;
  drop policy if exists dir_write on public.crm_ai_routing;
  create policy dir_write on public.crm_ai_routing for all to authenticated using (public.ai_is_direction()) with check (public.ai_is_direction());
  drop policy if exists dir_write on public.crm_ai_stage_owner;
  create policy dir_write on public.crm_ai_stage_owner for all to authenticated using (public.ai_is_direction()) with check (public.ai_is_direction());
end $$;
revoke all on public.crm_records, public.crm_sync_ops, public.crm_ai_events, public.crm_ai_routing, public.crm_ai_stage_owner from anon;
revoke insert, update, delete, truncate on public.crm_records, public.crm_sync_ops, public.crm_ai_events from authenticated;
grant select on public.crm_records, public.crm_ai_events, public.crm_ai_routing, public.crm_ai_stage_owner to authenticated;
grant insert, update, delete on public.crm_ai_routing, public.crm_ai_stage_owner to authenticated;

revoke all on function
  public.crm_put(text, text, jsonb, text, text, boolean, bigint, timestamptz, boolean), public.crm_apply_op(text, jsonb), public.crm_emit(text, text, text, text, text, jsonb, uuid, text, uuid, uuid),
  public.crm_client_rid_of(jsonb), public.crm_ensure_prospect(public.crm_records), public.crm_ensure_client(public.ai_prospects), public.crm_make_task(text, text, text, text, int, int, uuid, uuid),
  public.crm_h_crm_event(public.crm_ai_events), public.crm_h_prospect(public.crm_ai_events), public.crm_h_rdv(public.crm_ai_events), public.crm_h_offer(public.crm_ai_events),
  public.crm_h_mission(public.crm_ai_events), public.crm_h_alert(public.crm_ai_events), public.crm_handle_event(public.crm_ai_events), public.crm_process_events(integer), public.crm_purge_old(integer),
  public.crm_agent_of(text), public.crm_records_emit(), public.crm_ia_prospect_emit(), public.crm_ia_appointment_emit(), public.crm_ia_offer_emit(), public.crm_ia_task_emit(), public.crm_ia_incident_emit(), public.crm_prospect_owner()
  from public, anon, authenticated;
revoke all on function public.crm_sync_push(text, jsonb), public.crm_sync_pull(bigint, integer), public.crm_sync_status(), public.crm_client_panel(text), public.crm_agent_portfolio(uuid),
  public.crm_assign_mission(uuid, uuid, text, text, integer, integer), public.crm_arbitrate_task(uuid, text, integer), public.crm_dashboard(), public.crm_missions_overview(integer),
  public.crm_delegate(text), public.crm_event_retry(uuid), public.crm_backfill_ia() from public, anon;
grant execute on function public.crm_sync_push(text, jsonb), public.crm_sync_pull(bigint, integer), public.crm_sync_status(), public.crm_client_panel(text), public.crm_agent_portfolio(uuid),
  public.crm_assign_mission(uuid, uuid, text, text, integer, integer), public.crm_arbitrate_task(uuid, text, integer), public.crm_dashboard(), public.crm_missions_overview(integer),
  public.crm_delegate(text), public.crm_event_retry(uuid), public.crm_backfill_ia() to authenticated;
grant execute on function public.crm_process_events(integer), public.crm_purge_old(integer), public.crm_backfill_ia() to service_role;

-- ─── 12. Planification (pg_cron) : le traitement continue, bureau 3D fermé, navigateurs fermés ──
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('crm-ai-events', 'crm-ai-purge');
    perform cron.schedule('crm-ai-events', '* * * * *', 'select public.crm_process_events(100)');
    perform cron.schedule('crm-ai-purge', '17 3 * * *', 'select public.crm_purge_old(30)');
  end if;
end $$;
