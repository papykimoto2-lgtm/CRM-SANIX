-- ═══════════════════════════════════════════════════════════════════
--  SANIX AI SALES DIRECTOR — schéma v1
--  Prospection · qualification · omnicanal · offres · validations · audit
--  Agent = service_role (Edge Functions). Humains = auth.users présents dans ai_operators.
-- ═══════════════════════════════════════════════════════════════════
create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- ─── Opérateurs & rôles ────────────────────────────────────────────
create table if not exists public.ai_operators (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  nom              text not null,
  role             text not null check (role in ('direction','commercial','admin')),
  remise_max_pct   numeric(5,2) not null default 0 check (remise_max_pct between 0 and 100),
  telephone        text,
  actif            boolean not null default true,
  created_at       timestamptz not null default now()
);

create or replace function public.ai_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.ai_operators where user_id = auth.uid() and actif
$$;
create or replace function public.ai_is_operator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.ai_operators where user_id = auth.uid() and actif)
$$;
create or replace function public.ai_is_direction() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.ai_role() in ('direction','admin'), false)
$$;
revoke all on function public.ai_role(), public.ai_is_operator(), public.ai_is_direction() from public, anon;
grant execute on function public.ai_role(), public.ai_is_operator(), public.ai_is_direction() to authenticated;

create or replace function public.ai_norm_phone(p text) returns text
language sql immutable as $$
  select nullif(case
    when regexp_replace(coalesce(p,''),'\D','','g') ~ '^225' then regexp_replace(p,'\D','','g')
    when length(regexp_replace(coalesce(p,''),'\D','','g')) = 10 then '225'||regexp_replace(p,'\D','','g')
    else regexp_replace(coalesce(p,''),'\D','','g') end, '')
$$;

create or replace function public.ai_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ─── Catalogue produits (base de connaissances par logiciel) ──────
create table if not exists public.ai_products (
  id                  text primary key,
  nom                 text not null,
  marche_cible        text not null,
  secteurs            text[] not null default '{}',
  mots_cles           text[] not null default '{}',
  fonctionnalites     text[] not null default '{}',   -- UNIQUEMENT les fonctions livrées
  questions_decouverte text[] not null default '{}',
  argumentaire        text,
  demo_url            text,
  video_url           text,
  brochure_url        text,
  actif               boolean not null default true,
  updated_at          timestamptz not null default now()
);
create index if not exists ai_products_secteurs_gin on public.ai_products using gin (secteurs);
create index if not exists ai_products_mots_gin on public.ai_products using gin (mots_cles);
create trigger ai_products_touch before update on public.ai_products for each row execute function public.ai_touch();

-- ─── Grille tarifaire & délégation de remise ──────────────────────
create table if not exists public.ai_pricing (
  id                      uuid primary key default gen_random_uuid(),
  product_id              text not null references public.ai_products(id) on delete cascade,
  poste                   text not null check (poste in ('licence','abonnement_mensuel','installation','formation',
                            'parametrage','migration','hebergement','maintenance','option')),
  libelle                 text not null,
  prix_ht                 numeric(14,0) not null check (prix_ht >= 0),
  unite                   text not null default 'forfait',
  remise_agent_max_pct    numeric(5,2) not null default 5  check (remise_agent_max_pct between 0 and 100),
  remise_direction_max_pct numeric(5,2) not null default 15 check (remise_direction_max_pct between 0 and 100),
  marge_min_pct           numeric(5,2) not null default 30,
  actif                   boolean not null default true,
  unique (product_id, poste, libelle),
  check (remise_agent_max_pct <= remise_direction_max_pct)
);
create index if not exists ai_pricing_product on public.ai_pricing(product_id) where actif;

-- ─── Prospects (fiche enrichie + score /100) ──────────────────────
create table if not exists public.ai_prospects (
  id                   uuid primary key default gen_random_uuid(),
  crm_client_id        bigint,
  entreprise           text not null check (length(entreprise) between 2 and 200),
  secteur              text,
  ville                text,
  commune              text,
  pays                 text not null default 'CI',
  adresse              text,
  decideur             text,
  decideur_fonction    text,
  telephone            text,
  whatsapp             text,
  email                text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  site_web             text,
  reseaux              jsonb not null default '{}'::jsonb,
  logiciel_actuel      text,
  besoins              text[] not null default '{}',
  budget_estime        numeric(14,0),
  potentiel_fcfa       numeric(14,0),
  produits_recommandes text[] not null default '{}',
  -- Critères de qualification (pondération cahier des charges)
  crit_produit         smallint not null default 0 check (crit_produit between 0 and 25),
  crit_besoin          smallint not null default 0 check (crit_besoin between 0 and 20),
  crit_finance         smallint not null default 0 check (crit_finance between 0 and 15),
  crit_decideur        smallint not null default 0 check (crit_decideur between 0 and 15),
  crit_court_terme     smallint not null default 0 check (crit_court_terme between 0 and 15),
  crit_disponibilite   smallint not null default 0 check (crit_disponibilite between 0 and 10),
  score                smallint generated always as
                         (crit_produit+crit_besoin+crit_finance+crit_decideur+crit_court_terme+crit_disponibilite) stored,
  priorite             text generated always as (case
                         when crit_produit+crit_besoin+crit_finance+crit_decideur+crit_court_terme+crit_disponibilite >= 80 then 'prioritaire'
                         when crit_produit+crit_besoin+crit_finance+crit_decideur+crit_court_terme+crit_disponibilite >= 60 then 'interessant'
                         when crit_produit+crit_besoin+crit_finance+crit_decideur+crit_court_terme+crit_disponibilite >= 40 then 'a_developper'
                         else 'a_surveiller' end) stored,
  stage                text not null default 'identifie' check (stage in (
                         'identifie','enregistre','qualifie','premier_contact','conversation','besoin_identifie',
                         'interesse','rdv_propose','rdv_confirme','demo_realisee','offre_transmise','negociation',
                         'offre_acceptee','contrat_transmis','contrat_signe','paiement_attendu','paiement_confirme',
                         'marche_gagne','deploiement','client_fidelise','perdu','en_veille')),
  source               text not null default 'manuel',
  source_url           text,
  opt_out              boolean not null default false,
  opt_out_at           timestamptz,
  consentement         jsonb not null default '{}'::jsonb,   -- {whatsapp:{at,preuve}, email:{...}}
  relances_sans_reponse smallint not null default 0,
  owner_id             uuid references public.ai_operators(user_id) on delete set null,
  mission_id           uuid,
  last_inbound_at      timestamptz,
  last_outbound_at     timestamptz,
  next_action_at       timestamptz,
  resume_ia            text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  phone_norm           text generated always as (public.ai_norm_phone(coalesce(whatsapp, telephone))) stored
);
create unique index if not exists ai_prospects_phone_uq on public.ai_prospects(phone_norm) where phone_norm is not null;
create unique index if not exists ai_prospects_email_uq on public.ai_prospects(lower(email)) where email is not null;
create index if not exists ai_prospects_stage on public.ai_prospects(stage);
create index if not exists ai_prospects_score on public.ai_prospects(score desc);
create index if not exists ai_prospects_next on public.ai_prospects(next_action_at) where not opt_out;
create index if not exists ai_prospects_secteur_ville on public.ai_prospects(secteur, ville);
create trigger ai_prospects_touch before update on public.ai_prospects for each row execute function public.ai_touch();

-- Historique pipeline
create table if not exists public.ai_stage_history (
  id          bigint generated always as identity primary key,
  prospect_id uuid not null references public.ai_prospects(id) on delete cascade,
  de          text, vers text not null,
  par         text not null,           -- 'agent' | uuid opérateur
  at          timestamptz not null default now()
);
create index if not exists ai_stage_history_p on public.ai_stage_history(prospect_id, at desc);

-- Garde-fou : étapes engageantes réservées aux humains habilités (défense en profondeur)
create or replace function public.ai_guard_stage() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role text := coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '');
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    if new.stage in ('contrat_signe','paiement_confirme','marche_gagne') then
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
create trigger ai_prospects_guard before insert or update on public.ai_prospects
  for each row execute function public.ai_guard_stage();

-- ─── Fil de conversation unifié (tous canaux) ─────────────────────
create table if not exists public.ai_messages (
  id           bigint generated always as identity primary key,
  prospect_id  uuid not null references public.ai_prospects(id) on delete cascade,
  canal        text not null check (canal in ('whatsapp','email','telephone','sms','visio','note')),
  sens         text not null check (sens in ('entrant','sortant')),
  auteur       text not null check (auteur in ('agent','humain','prospect')),
  contenu      text not null check (length(contenu) <= 20000),
  statut       text not null default 'envoye' check (statut in ('brouillon','a_valider','a_envoyer','envoye','delivre','lu','echec','recu')),
  external_id  text,
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create unique index if not exists ai_messages_ext_uq on public.ai_messages(canal, external_id) where external_id is not null;
create index if not exists ai_messages_thread on public.ai_messages(prospect_id, created_at desc);

-- Désinscription automatique + horodatage dernier échange
create or replace function public.ai_on_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sens = 'entrant' then
    update public.ai_prospects set
      last_inbound_at = new.created_at,
      relances_sans_reponse = 0,
      opt_out = opt_out or extensions.unaccent(lower(new.contenu)) ~ '^\s*(stop|desinscri|desabonne|ne plus (me )?contacter|unsubscribe)'
    where id = new.prospect_id;
  elsif new.statut in ('envoye','delivre','lu') then
    update public.ai_prospects set last_outbound_at = new.created_at where id = new.prospect_id;
  end if;
  return new;
end $$;
create trigger ai_messages_after after insert on public.ai_messages for each row execute function public.ai_on_message();

-- ─── Objections ───────────────────────────────────────────────────
create table if not exists public.ai_objections (
  code            text primary key,
  objection       text not null,
  diagnostic      text not null,
  reponse         text not null,
  prochaine_etape text not null
);

-- ─── Missions (Lead Hunter / Market Intelligence) ────────────────
create table if not exists public.ai_missions (
  id          uuid primary key default gen_random_uuid(),
  titre       text not null,
  consigne    text not null check (length(consigne) <= 2000),
  product_id  text references public.ai_products(id),
  secteur     text, ville text, pays text not null default 'CI',
  objectif    int not null default 20 check (objectif between 1 and 200),
  statut      text not null default 'en_attente' check (statut in ('en_attente','en_cours','terminee','echec','annulee')),
  trouves     int not null default 0,
  rapport     text,
  created_by  uuid references public.ai_operators(user_id),
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.ai_prospects drop constraint if exists ai_prospects_mission_fk;
alter table public.ai_prospects add constraint ai_prospects_mission_fk
  foreign key (mission_id) references public.ai_missions(id) on delete set null;

-- ─── Validations humaines (remises, contrats, paiements, transferts) ─
create table if not exists public.ai_approvals (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('remise','contrat','paiement','engagement','transfert_humain','message')),
  prospect_id uuid references public.ai_prospects(id) on delete cascade,
  objet_id    uuid,
  motif       text not null,
  payload     jsonb not null default '{}'::jsonb,
  statut      text not null default 'en_attente' check (statut in ('en_attente','approuve','refuse','expire')),
  decided_by  uuid references public.ai_operators(user_id),
  decided_at  timestamptz,
  commentaire text,
  created_at  timestamptz not null default now()
);
create index if not exists ai_approvals_pending on public.ai_approvals(created_at) where statut = 'en_attente';

-- ─── Offres commerciales ──────────────────────────────────────────
create table if not exists public.ai_offers (
  id           uuid primary key default gen_random_uuid(),
  reference    text unique not null default ('OFF-'||to_char(now(),'YYMM')||'-'||upper(substr(gen_random_uuid()::text,1,6))),
  prospect_id  uuid not null references public.ai_prospects(id) on delete cascade,
  product_id   text not null references public.ai_products(id),
  lignes       jsonb not null,           -- [{poste,libelle,qte,pu_ht,montant_ht}]
  total_brut_ht numeric(14,0) not null,
  remise_pct   numeric(5,2) not null default 0,
  total_ht     numeric(14,0) not null,
  tva_pct      numeric(5,2) not null default 18,
  total_ttc    numeric(14,0) not null,
  statut       text not null default 'brouillon' check (statut in ('brouillon','a_valider','validee','envoyee','acceptee','refusee','expiree')),
  approval_id  uuid references public.ai_approvals(id),
  valide_jusqu date not null default (current_date + 30),
  created_at   timestamptz not null default now()
);
create index if not exists ai_offers_prospect on public.ai_offers(prospect_id);

-- ─── Rendez-vous & disponibilités ─────────────────────────────────
create table if not exists public.ai_availability (
  id          bigint generated always as identity primary key,
  operator_id uuid not null references public.ai_operators(user_id) on delete cascade,
  jour        smallint not null check (jour between 1 and 7),   -- ISO : 1 = lundi
  debut       time not null, fin time not null, check (debut < fin)
);
create table if not exists public.ai_appointments (
  id           uuid primary key default gen_random_uuid(),
  prospect_id  uuid not null references public.ai_prospects(id) on delete cascade,
  operator_id  uuid references public.ai_operators(user_id),
  product_id   text references public.ai_products(id),
  debut        timestamptz not null,
  fin          timestamptz not null, check (debut < fin),
  mode         text not null check (mode in ('visio','physique','telephone')),
  lieu         text, lien_visio text,
  statut       text not null default 'confirme' check (statut in ('propose','confirme','realise','annule','absent')),
  fiche_prep   text,
  compte_rendu text,
  rappel_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists ai_appt_operator on public.ai_appointments(operator_id, debut) where statut in ('propose','confirme');
-- Empêche le double-booking d'un commercial
alter table public.ai_appointments drop constraint if exists ai_appt_no_overlap;
alter table public.ai_appointments add constraint ai_appt_no_overlap exclude using gist
  (operator_id with =, tstzrange(debut, fin) with &&) where (statut in ('propose','confirme'));

-- ─── Relances planifiées ─────────────────────────────────────────
create table if not exists public.ai_followups (
  id          uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.ai_prospects(id) on delete cascade,
  due_at      timestamptz not null,
  scenario    text not null,
  canal       text not null default 'whatsapp' check (canal in ('whatsapp','email','telephone')),
  statut      text not null default 'planifiee' check (statut in ('planifiee','faite','annulee')),
  created_at  timestamptz not null default now()
);
create index if not exists ai_followups_due on public.ai_followups(due_at) where statut = 'planifiee';

-- ─── Journal d'audit (append-only) ───────────────────────────────
create table if not exists public.ai_actions (
  id          bigint generated always as identity primary key,
  agent       text not null,           -- director, lead_hunter, whatsapp, ...
  action      text not null,
  prospect_id uuid references public.ai_prospects(id) on delete set null,
  mission_id  uuid references public.ai_missions(id) on delete set null,
  payload     jsonb not null default '{}'::jsonb,
  ok          boolean not null default true,
  tokens_in   int, tokens_out int,
  at          timestamptz not null default now()
);
create index if not exists ai_actions_at on public.ai_actions(at desc);
create index if not exists ai_actions_prospect on public.ai_actions(prospect_id, at desc);
create or replace function public.ai_no_mutation() returns trigger language plpgsql as $$
begin raise exception 'Journal d''audit immuable'; end $$;
create trigger ai_actions_immutable before update or delete on public.ai_actions
  for each row execute function public.ai_no_mutation();

-- ═══ Fonctions métier ═════════════════════════════════════════════
-- Recommandation produit(s) par secteur / besoins (jamais de présentation sans secteur)
create or replace function public.ai_recommend_products(p_secteur text, p_texte text default '')
returns table(product_id text, nom text, pertinence int)
language sql stable set search_path = public as $$
  with q as (select extensions.unaccent(lower(coalesce(p_secteur,'')||' '||coalesce(p_texte,''))) t),
  r as (select p.id, p.nom,
    (select count(*)::int*10 from unnest(p.secteurs) s, q where q.t like '%'||extensions.unaccent(lower(s))||'%')
    + (select count(*)::int*5 from unnest(p.mots_cles) k, q where q.t like '%'||extensions.unaccent(lower(k))||'%') as pertinence
  from public.ai_products p
  where p.actif and coalesce(p_secteur,'') <> '')
  select * from r where pertinence > 0 order by pertinence desc limit 3
$$;

-- Créneaux libres d'un commercial (pas 60 min, jours ouvrés à venir)
create or replace function public.ai_free_slots(p_operator uuid, p_days int default 7, p_duree_min int default 45)
returns table(debut timestamptz, fin timestamptz)
language sql stable set search_path = public as $$
  select s, s + make_interval(mins => p_duree_min)
  from public.ai_availability a,
       generate_series(date_trunc('day', now() at time zone 'Africa/Abidjan') + interval '1 day',
                       date_trunc('day', now() at time zone 'Africa/Abidjan') + make_interval(days => least(p_days,21)),
                       interval '1 day') d,
       generate_series(d + a.debut, d + a.fin - make_interval(mins => p_duree_min), interval '60 min') s0,
       lateral (select (s0 at time zone 'Africa/Abidjan') as s) x
  where a.operator_id = p_operator and extract(isodow from d) = a.jour
    and not exists (select 1 from public.ai_appointments ap
                    where ap.operator_id = p_operator and ap.statut in ('propose','confirme')
                      and tstzrange(ap.debut, ap.fin) && tstzrange(s, s + make_interval(mins => p_duree_min)))
  order by 1
  limit 12
$$;

-- Décision d'une validation (direction) — met à jour l'objet lié de façon atomique
create or replace function public.ai_decide_approval(p_id uuid, p_ok boolean, p_commentaire text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.ai_approvals;
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode='42501'; end if;
  update public.ai_approvals set statut = case when p_ok then 'approuve' else 'refuse' end,
         decided_by = auth.uid(), decided_at = now(), commentaire = p_commentaire
   where id = p_id and statut = 'en_attente' returning * into a;
  if not found then raise exception 'Validation introuvable ou déjà traitée'; end if;
  if a.type = 'remise' and a.objet_id is not null then
    update public.ai_offers set statut = case when p_ok then 'validee' else 'brouillon' end where id = a.objet_id;
  end if;
  insert into public.ai_actions(agent, action, prospect_id, payload)
  values ('direction', 'validation_'||case when p_ok then 'approuvee' else 'refusee' end, a.prospect_id,
          jsonb_build_object('approval', p_id, 'type', a.type, 'commentaire', p_commentaire));
end $$;
revoke all on function public.ai_decide_approval(uuid, boolean, text) from public, anon;
grant execute on function public.ai_decide_approval(uuid, boolean, text) to authenticated;

-- ═══ Tableau de bord direction ════════════════════════════════════
create or replace view public.ai_kpis with (security_invoker = true) as
select
  (select count(*) from public.ai_prospects)                                                    as prospects_total,
  (select count(*) from public.ai_prospects where created_at >= current_date)                   as prospects_jour,
  (select count(*) from public.ai_prospects where score >= 60)                                  as prospects_qualifies,
  (select count(*) from public.ai_prospects where priorite = 'prioritaire')                     as prospects_prioritaires,
  (select count(*) from public.ai_messages where sens='sortant' and canal='whatsapp')           as wa_envoyes,
  (select count(*) from public.ai_messages where sens='sortant' and canal='email')              as emails_envoyes,
  (select count(distinct prospect_id) from public.ai_messages where sens='entrant')             as conversations,
  (select round(100.0 * count(distinct m.prospect_id) filter (where m.sens='entrant')
          / nullif(count(distinct m.prospect_id) filter (where m.sens='sortant'),0),1)
     from public.ai_messages m)                                                                  as taux_reponse_pct,
  (select count(*) from public.ai_appointments where statut in ('propose','confirme'))         as rdv_a_venir,
  (select count(*) from public.ai_appointments where statut = 'realise')                       as demos_realisees,
  (select count(*) from public.ai_offers where statut in ('envoyee','acceptee','refusee'))     as offres_transmises,
  (select count(*) from public.ai_prospects where stage = 'negociation')                       as negociations,
  (select count(*) from public.ai_prospects where stage in ('marche_gagne','deploiement','client_fidelise')) as marches_gagnes,
  (select count(*) from public.ai_prospects where stage = 'perdu')                             as marches_perdus,
  (select coalesce(sum(o.total_ht),0) from public.ai_offers o join public.ai_prospects p on p.id=o.prospect_id
     where o.statut='acceptee' and p.stage in ('marche_gagne','deploiement','client_fidelise')) as ca_gagne_ht,
  (select round(100.0 * count(*) filter (where stage in ('marche_gagne','deploiement','client_fidelise'))
          / nullif(count(*) filter (where stage not in ('identifie','enregistre')),0),1)
     from public.ai_prospects)                                                                   as taux_transformation_pct,
  (select round(avg(extract(epoch from h.at - p.created_at)/86400)::numeric,1)
     from public.ai_stage_history h join public.ai_prospects p on p.id=h.prospect_id
    where h.vers='marche_gagne')                                                                  as cycle_vente_jours,
  (select count(*) from public.ai_approvals where statut='en_attente')                         as validations_en_attente;

create or replace view public.ai_pipeline_par_produit with (security_invoker = true) as
select unnest(produits_recommandes) as product_id, stage, count(*) n, coalesce(sum(potentiel_fcfa),0) potentiel
from public.ai_prospects group by 1,2;

-- ═══ RLS — moindre privilège ══════════════════════════════════════
do $$ declare t text; begin
  foreach t in array array['ai_operators','ai_products','ai_pricing','ai_prospects','ai_stage_history','ai_messages',
    'ai_objections','ai_missions','ai_approvals','ai_offers','ai_availability','ai_appointments','ai_followups','ai_actions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
revoke all on public.ai_kpis, public.ai_pipeline_par_produit from anon;

-- Lecture : opérateurs actifs
create policy op_read on public.ai_operators   for select to authenticated using (public.ai_is_operator());
create policy op_read on public.ai_products    for select to authenticated using (public.ai_is_operator());
create policy op_read on public.ai_pricing     for select to authenticated using (public.ai_is_operator());
create policy op_read on public.ai_objections  for select to authenticated using (public.ai_is_operator());
create policy op_read on public.ai_stage_history for select to authenticated using (public.ai_is_operator());
create policy op_read on public.ai_missions    for select to authenticated using (public.ai_is_operator());
create policy op_read on public.ai_approvals   for select to authenticated using (public.ai_is_operator());
create policy op_read on public.ai_offers      for select to authenticated using (public.ai_is_operator());
create policy op_read on public.ai_availability for select to authenticated using (public.ai_is_operator());
create policy op_read on public.ai_appointments for select to authenticated using (public.ai_is_operator());
create policy op_read on public.ai_followups   for select to authenticated using (public.ai_is_operator());
create policy op_read on public.ai_actions     for select to authenticated using (public.ai_is_direction());
-- Prospects & messages : direction voit tout, commercial ses prospects + non attribués
create policy p_read on public.ai_prospects for select to authenticated
  using (public.ai_is_direction() or (public.ai_is_operator() and (owner_id = auth.uid() or owner_id is null)));
create policy p_write on public.ai_prospects for update to authenticated
  using (public.ai_is_direction() or owner_id = auth.uid()) with check (public.ai_is_operator());
create policy p_insert on public.ai_prospects for insert to authenticated with check (public.ai_is_operator());
create policy m_read on public.ai_messages for select to authenticated
  using (exists (select 1 from public.ai_prospects p where p.id = prospect_id));   -- hérite de p_read
create policy m_insert on public.ai_messages for insert to authenticated
  with check (auteur = 'humain' and exists (select 1 from public.ai_prospects p where p.id = prospect_id));
-- Écriture : direction (catalogue, tarifs, objections, disponibilités)
create policy dir_write on public.ai_products   for all to authenticated using (public.ai_is_direction()) with check (public.ai_is_direction());
create policy dir_write on public.ai_pricing    for all to authenticated using (public.ai_is_direction()) with check (public.ai_is_direction());
create policy dir_write on public.ai_objections for all to authenticated using (public.ai_is_direction()) with check (public.ai_is_direction());
create policy dir_write on public.ai_operators  for all to authenticated using (public.ai_role() = 'admin') with check (public.ai_role() = 'admin');
create policy av_write on public.ai_availability for all to authenticated
  using (operator_id = auth.uid() or public.ai_is_direction()) with check (operator_id = auth.uid() or public.ai_is_direction());
create policy mis_insert on public.ai_missions for insert to authenticated
  with check (public.ai_is_operator() and created_by = auth.uid());
create policy appt_write on public.ai_appointments for update to authenticated
  using (operator_id = auth.uid() or public.ai_is_direction()) with check (public.ai_is_operator());
-- ai_approvals : décision uniquement via ai_decide_approval() (security definer)

-- ═══ Données de référence ═════════════════════════════════════════
insert into public.ai_products(id, nom, marche_cible, secteurs, mots_cles, demo_url) values
 ('aluexpert','Sanix AluExpert ERP','Menuiseries aluminium',array['menuiserie','aluminium','alu','vitrerie'],array['devis','chantier','profilé','vitrage','atelier'],'https://sanix-aluexpet-erp-v2.vercel.app'),
 ('immosuite','ImmoSuite ERP','Promoteurs immobiliers et aménageurs fonciers',array['immobilier','promoteur','promotion immobilière','aménageur','lotissement','foncier'],array['programme','lot','souscripteur','acd','terrain'],'https://immo-suite.vercel.app'),
 ('distripro','Sanix DistriPro','Grossistes, dépôts et distributeurs',array['distribution','grossiste','dépôt','depot','boissons','négoce','commerce de gros'],array['stock','livraison','tournée','dépôt de boissons','casiers'],null),
 ('comptapro','Sanix Compta Pro','Entreprises et cabinets comptables',array['comptabilité','cabinet comptable','expertise comptable','audit'],array['syscohada','bilan','dsf','liasse','tva'],'https://sanix-compta-pro.vercel.app'),
 ('medicor','MedicorERP','Cliniques, centres médicaux, établissements sanitaires',array['santé','clinique','centre médical','hôpital','cabinet médical','laboratoire','pharmacie'],array['patient','consultation','dossier médical','assurance maladie'],null),
 ('avicosuite','AvicoSuite','Fermes avicoles et exploitations agricoles',array['aviculture','avicole','ferme','élevage','agriculture','agro'],array['poulet','pondeuse','lot','œufs','provende','couvoir'],'https://angelsgroups.vercel.app/agro'),
 ('angels','Angel''s','Livraison, logistique, expédition et transport',array['livraison','logistique','expédition','transport','coursier','messagerie'],array['colis','livreur','moto','tournée','suivi','encaissement'],'https://angelsgroups.vercel.app/distribution'),
 ('inox100','100-Inox ERP','Ateliers de menuiserie aluminium et inox',array['inox','menuiserie métallique','chaudronnerie','soudure','métallerie'],array['atelier','fabrication','devis','inox'],null),
 ('snifi','SNIFI','Institutionnels et professionnels du foncier et de la fiscalité immobilière',array['foncier','fiscalité immobilière','cadastre','géomètre','notaire','institution','collectivité'],array['impôt foncier','titre foncier','acd','recouvrement'],null),
 ('cilegrenier','CI-LeGrenier','Marketplace et écosystème commercial',array['commerce','e-commerce','marketplace','boutique','vente en ligne','producteur'],array['vitrine','vendeurs','catalogue','commandes en ligne'],null)
on conflict (id) do nothing;

insert into public.ai_pricing(product_id, poste, libelle, prix_ht, unite, remise_agent_max_pct, remise_direction_max_pct)
select id, 'licence', 'Licence annuelle', prix, 'an', 5, 10 from (values
 ('aluexpert',600000),('immosuite',750000),('distripro',600000),('comptapro',600000),('medicor',1500000),
 ('avicosuite',600000),('angels',600000),('cilegrenier',400000)) v(id,prix)
on conflict do nothing;
insert into public.ai_pricing(product_id, poste, libelle, prix_ht, unite, remise_agent_max_pct, remise_direction_max_pct)
select id, 'abonnement_mensuel', 'Abonnement SaaS', prix, 'mois', 5, 10 from (values
 ('aluexpert',60000),('immosuite',75000),('distripro',60000),('comptapro',60000),('medicor',150000),
 ('avicosuite',60000),('angels',60000),('cilegrenier',40000)) v(id,prix)
on conflict do nothing;
-- NB : fonctionnalités, frais d'installation/formation/migration, 100-Inox et SNIFI à compléter par la direction.
-- Sans ligne tarifaire, l'agent n'émet aucun chiffre et escalade.

insert into public.ai_objections(code, objection, diagnostic, reponse, prochaine_etape) values
 ('deja_logiciel','Nous utilisons déjà un logiciel','Satisfaction partielle probable','Demander ce qui fonctionne bien et ce qui manque ; montrer uniquement le différenciant sur ce manque.','Démo ciblée de 15 min sur le point faible'),
 ('trop_cher','Votre logiciel est trop cher','Valeur non perçue ou mauvais calibrage','Ramener au coût par mois et au temps/pertes évités ; proposer un périmètre de modules réduit ou l''abonnement.','Offre ajustée (modules / SaaS)'),
 ('pas_budget','Pas de budget actuellement','Timing','Valider l''intérêt, identifier la date de prochain budget, proposer l''abonnement mensuel.','Relance datée sur le cycle budgétaire'),
 ('reflechir','Nous devons réfléchir','Doute non exprimé','Demander quel point précis reste à clarifier ; proposer d''y répondre maintenant.','Rappel à 3-5 jours'),
 ('excel','Nous travaillons avec Excel','Habitude, coût de changement','Chiffrer les erreurs et doubles saisies ; montrer l''import Excel et la reprise des données.','Démo import de leur fichier'),
 ('pas_changer','Pas envie de changer notre organisation','Peur du changement','Insister sur le paramétrage selon leurs processus et l''accompagnement / formation inclus.','Visite ou démo avec l''utilisateur clé'),
 ('documentation','Envoyez-nous une documentation','Évitement poli','Envoyer la brochure ciblée et obtenir l''accord pour un échange de 10 min après lecture.','Relance à J+2 avec question précise'),
 ('direction','Je dois consulter la direction','Interlocuteur non décideur','Proposer un résumé écrit pour la direction et une démo avec le décideur.','RDV avec le décideur')
on conflict (code) do nothing;
