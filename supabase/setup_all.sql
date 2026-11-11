-- SANIX AI — schéma complet : toutes les migrations dans l'ordre (généré par build_setup_sql.sh, ne pas modifier à la main).
-- Supabase → SQL Editor → coller ce fichier en une fois → Run. Équivalent de « supabase db push ».

-- ═══ 20261109000000_ai_sales_director.sql ═══
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

-- ═══ 20261109020000_ai_virtual_company.sql ═══
-- ═══════════════════════════════════════════════════════════════════
--  SANIX AI VIRTUAL COMPANY — v1
--  Gouvernance · Agent Factory · organisation · missions & dépendances · communications
--  réunions & PV · performance · mémoire · incidents · rapports · bureau du président
--
--  Rationalisation du modèle demandé (normalisation, zéro doublon) :
--   ai_agent_profiles   → colonnes de ai_agents (relation 1:1)
--   ai_agent_hierarchy  → ai_agents.manager_id (niveaux strictement croissants ⇒ aucun cycle possible)
--   ai_agent_resources  → ai_agents.outils + ai_agents.budget_jour_usd
--   ai_agent_budget     → ai_governance + ai_agents.budget_jour_usd ; consommation = ai_actions.cout_usd
--   ai_agent_approvals  → ai_approvals (file de validation unique pour toute l'entreprise)
--   ai_daily_reports    → historise tous les types de rapports (quotidien, hebdo, mensuel, incident)
-- ═══════════════════════════════════════════════════════════════════

-- ─── Gouvernance (autonomie contrôlée) ────────────────────────────
create table if not exists public.ai_governance (
  id                          smallint primary key default 1 check (id = 1),
  actif                       boolean not null default true,     -- interrupteur général
  creation_autonome           boolean not null default true,     -- false ⇒ chaque création validée
  communication_externe       text not null default 'validation'
                                check (communication_externe in ('interdite','validation','autonome')), -- contact externe : jamais | file d'approbation | autonome
  validation_outils_externes  boolean not null default true,     -- agent doté d'outils externes ⇒ validation
  max_agents_actifs           int not null default 25 check (max_agents_actifs between 1 and 500),
  max_creations_jour          int not null default 10 check (max_creations_jour between 0 and 200),
  budget_jour_usd             numeric(10,2) not null default 20 check (budget_jour_usd >= 0),
  budget_mois_usd             numeric(10,2) not null default 400 check (budget_mois_usd >= 0),
  budget_agent_jour_usd       numeric(10,2) not null default 5 check (budget_agent_jour_usd >= 0),
  max_missions_actives        int not null default 60 check (max_missions_actives between 1 and 2000),
  max_taches_agent            int not null default 5 check (max_taches_agent between 1 and 50),
  max_sous_taches             int not null default 10 check (max_sous_taches between 1 and 100),
  max_profondeur              smallint not null default 6 check (max_profondeur between 1 and 10),
  max_tours_execution         smallint not null default 8 check (max_tours_execution between 1 and 30),
  max_executions_tache        smallint not null default 4 check (max_executions_tache between 1 and 20),
  max_participants_reunion    smallint not null default 6 check (max_participants_reunion between 2 and 12),
  taches_par_tick             smallint not null default 3 check (taches_par_tick between 1 and 20),
  suspension_apres_incidents  smallint not null default 3 check (suspension_apres_incidents between 1 and 20),
  modele                      text not null default 'claude-opus-5-5'
                                check (modele in ('claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5')),
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references auth.users(id) on delete set null
);
insert into public.ai_governance(id) values (1) on conflict (id) do nothing;

create or replace function public.ai_governance_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by); return new; end $$;
create trigger ai_governance_touch before update on public.ai_governance
  for each row execute function public.ai_governance_touch();

-- ─── Départements ─────────────────────────────────────────────────
create table if not exists public.ai_departments (
  id             text primary key check (id ~ '^[a-z_]{3,40}$'),
  nom            text not null,
  mission        text not null,
  couleur        text not null check (couleur ~ '^#[0-9a-fA-F]{6}$'),
  ordre          smallint not null default 0,
  responsable_id uuid
);

-- ─── Collaborateurs IA (identité, profil, ressources, état) ──────
create table if not exists public.ai_agents (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique check (code ~ '^[a-z0-9_]{3,60}$'),
  nom                   text not null check (length(nom) between 2 and 80),
  fonction              text not null check (length(fonction) between 2 and 120),
  departement_id        text not null references public.ai_departments(id),
  manager_id            uuid references public.ai_agents(id) on delete restrict,
  niveau                smallint not null check (niveau between 1 and 5), -- 1 DG · 2 directeur · 3 responsable · 4 superviseur · 5 agent
  personnalite          text check (length(personnalite) <= 500),
  specialite            text check (length(specialite) <= 500),
  outils                text[] not null default '{}',
  etat                  text not null default 'actif' check (etat in ('actif','attente_validation','suspendu','archive')),
  activite              text not null default 'disponible' check (activite in
                          ('disponible','en_mission','en_reunion','en_analyse','attente_validation','en_difficulte','mission_terminee')),
  activite_depuis       timestamptz not null default now(),
  temporaire            boolean not null default false,
  expire_at             timestamptz,
  effort                text not null default 'medium' check (effort in ('low','medium','high')),
  budget_jour_usd       numeric(10,2) check (budget_jour_usd >= 0),     -- null = défaut gouvernance
  charte_version        int not null default 0,
  incidents_consecutifs smallint not null default 0,
  cree_par_agent        uuid references public.ai_agents(id) on delete set null,
  cree_par_user         uuid references auth.users(id) on delete set null,
  avatar                jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  check (temporaire = (expire_at is not null)),
  check ((niveau = 1) = (manager_id is null))
);
create unique index if not exists ai_agents_dg_unique on public.ai_agents((true)) where niveau = 1 and etat <> 'archive';
create index if not exists ai_agents_manager on public.ai_agents(manager_id);
create index if not exists ai_agents_dept on public.ai_agents(departement_id) where etat <> 'archive';
alter table public.ai_departments drop constraint if exists ai_departments_responsable_fk;
alter table public.ai_departments add constraint ai_departments_responsable_fk
  foreign key (responsable_id) references public.ai_agents(id) on delete set null;

create or replace function public.ai_agents_guard() returns trigger
language plpgsql set search_path = public as $$
declare g public.ai_governance; m public.ai_agents; n int;
begin
  select * into g from public.ai_governance where id = 1;
  if new.manager_id is not null then
    select * into m from public.ai_agents where id = new.manager_id;
    if m.niveau >= new.niveau then
      raise exception 'Hiérarchie invalide : le responsable doit être d''un niveau supérieur' using errcode = 'P0001';
    end if;
    if tg_op = 'INSERT' and m.etat = 'archive' then raise exception 'Responsable archivé' using errcode = 'P0001'; end if;
  end if;
  if tg_op = 'INSERT' then
    select count(*) into n from public.ai_agents where etat in ('actif','attente_validation');
    if n >= g.max_agents_actifs then
      raise exception 'Gouvernance : % agents actifs maximum', g.max_agents_actifs using errcode = 'P0001';
    end if;
    if new.cree_par_agent is not null then
      select count(*) into n from public.ai_agents
       where cree_par_agent is not null
         and created_at >= date_trunc('day', now() at time zone 'Africa/Abidjan') at time zone 'Africa/Abidjan';
      if n >= g.max_creations_jour then
        raise exception 'Gouvernance : % créations d''agents par jour maximum', g.max_creations_jour using errcode = 'P0001';
      end if;
    end if;
  else
    new.updated_at := now();
    if new.activite is distinct from old.activite then new.activite_depuis := now(); end if;
    if new.etat = 'archive' and old.etat <> 'archive' then new.archived_at := now(); end if;
  end if;
  return new;
end $$;
create trigger ai_agents_guard before insert or update on public.ai_agents
  for each row execute function public.ai_agents_guard();

-- ─── Cahiers des charges (versionnés, 15 rubriques) ───────────────
create table if not exists public.ai_agent_charters (
  agent_id        uuid not null references public.ai_agents(id) on delete cascade,
  version         int not null check (version >= 1),
  contenu         jsonb not null,
  motif           text,
  redige_par      uuid references public.ai_agents(id) on delete set null,
  redige_par_user uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (agent_id, version),
  check (contenu ?& array['identite','fonction','departement','mission_principale','missions_secondaires','competences',
    'outils','donnees','objectifs','delais','indicateurs','procedures','limites','responsable','reporting'])
);
create or replace function public.ai_charter_version() returns trigger language plpgsql set search_path = public as $$
begin
  update public.ai_agents set charte_version = new.version where id = new.agent_id and charte_version < new.version;
  return new;
end $$;
create trigger ai_charter_version after insert on public.ai_agent_charters
  for each row execute function public.ai_charter_version();

-- ─── Réunions ─────────────────────────────────────────────────────
create table if not exists public.ai_agent_meetings (
  id               uuid primary key default gen_random_uuid(),
  titre            text not null check (length(titre) between 3 and 200),
  ordre_du_jour    text not null check (length(ordre_du_jour) <= 4000),
  convoque_par     uuid not null references public.ai_agents(id),
  demande_par_user uuid references auth.users(id) on delete set null,
  statut           text not null default 'planifiee' check (statut in ('planifiee','en_cours','terminee','annulee','echouee')),
  cout_usd         numeric(12,6) not null default 0,
  debut_at         timestamptz,
  fin_at           timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists ai_meetings_statut on public.ai_agent_meetings(statut, created_at);
create table if not exists public.ai_meeting_participants (
  meeting_id   uuid not null references public.ai_agent_meetings(id) on delete cascade,
  agent_id     uuid not null references public.ai_agents(id) on delete cascade,
  ordre        smallint not null default 0,
  contribution text check (length(contribution) <= 12000),
  primary key (meeting_id, agent_id)
);
create table if not exists public.ai_meeting_minutes (
  meeting_id  uuid primary key references public.ai_agent_meetings(id) on delete cascade,
  synthese    text not null,
  decisions   jsonb not null default '[]'::jsonb,
  plan_action jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

-- ─── Missions & tâches (arbre de délégation) ─────────────────────
create table if not exists public.ai_agent_tasks (
  id                     uuid primary key default gen_random_uuid(),
  parent_id              uuid references public.ai_agent_tasks(id) on delete cascade,
  racine_id              uuid references public.ai_agent_tasks(id) on delete cascade,
  reunion_id             uuid references public.ai_agent_meetings(id) on delete set null,
  agent_id               uuid not null references public.ai_agents(id),
  donneur_agent_id       uuid references public.ai_agents(id) on delete set null,
  donneur_user_id        uuid references auth.users(id) on delete set null,
  type                   text not null default 'mission' check (type in ('instruction','mission','tache')),
  titre                  text not null check (length(titre) between 3 and 200),
  titre_norm             text generated always as (lower(regexp_replace(btrim(titre), '\s+', ' ', 'g'))) stored,
  description            text not null check (length(description) <= 8000),
  objectifs              jsonb not null default '[]'::jsonb check (jsonb_typeof(objectifs) = 'array'),
  entrees                text check (length(entrees) <= 20000),
  priorite               smallint not null default 3 check (priorite between 1 and 5),   -- 1 = urgent
  echeance               timestamptz,
  profondeur             smallint not null default 0,
  statut                 text not null default 'a_faire' check (statut in
                           ('a_faire','en_cours','attente_sous_taches','attente_validation','bloquee','terminee','echouee','annulee')),
  executions             smallint not null default 0,
  reprises               smallint not null default 0,
  progression            text check (length(progression) <= 8000),
  rapport                text check (length(rapport) <= 20000),
  resultats              jsonb not null default '[]'::jsonb,
  evaluation             smallint check (evaluation between 0 and 100),
  evaluation_commentaire text check (length(evaluation_commentaire) <= 2000),
  cout_usd               numeric(12,6) not null default 0,
  created_at             timestamptz not null default now(),
  started_at             timestamptz,
  finished_at            timestamptz,
  updated_at             timestamptz not null default now()
);
-- Anti-redondance : un agent ne peut pas avoir deux missions ouvertes de même intitulé
create unique index if not exists ai_tasks_dedupe on public.ai_agent_tasks(agent_id, titre_norm)
  where statut in ('a_faire','en_cours','attente_sous_taches','attente_validation');
create index if not exists ai_tasks_queue on public.ai_agent_tasks(priorite, created_at) where statut = 'a_faire';
create index if not exists ai_tasks_agent on public.ai_agent_tasks(agent_id, statut);
create index if not exists ai_tasks_parent on public.ai_agent_tasks(parent_id);
create index if not exists ai_tasks_racine on public.ai_agent_tasks(racine_id);
create index if not exists ai_tasks_finished on public.ai_agent_tasks(finished_at) where finished_at is not null;
create index if not exists ai_tasks_reunion on public.ai_agent_tasks(reunion_id) where reunion_id is not null;

create or replace function public.ai_tasks_before() returns trigger
language plpgsql set search_path = public as $$
declare g public.ai_governance; p public.ai_agent_tasks; v_etat text; n int;
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if new.statut is distinct from old.statut and new.statut in ('terminee','echouee','annulee') then
      new.finished_at := now();
    end if;
    if new.agent_id is distinct from old.agent_id then
      select etat into v_etat from public.ai_agents where id = new.agent_id;
      if v_etat <> 'actif' then raise exception 'Agent destinataire indisponible (%)', v_etat using errcode = 'P0001'; end if;
    end if;
    return new;
  end if;

  select * into g from public.ai_governance where id = 1;
  select etat into v_etat from public.ai_agents where id = new.agent_id;
  if v_etat in ('suspendu','archive') then
    raise exception 'Agent indisponible (%)', v_etat using errcode = 'P0001';
  end if;
  if new.parent_id is not null then
    select * into p from public.ai_agent_tasks where id = new.parent_id;
    new.racine_id  := coalesce(p.racine_id, p.id);
    new.profondeur := p.profondeur + 1;
    select count(*) into n from public.ai_agent_tasks where parent_id = new.parent_id;
    if n >= g.max_sous_taches then
      raise exception 'Gouvernance : % sous-tâches maximum par mission', g.max_sous_taches using errcode = 'P0001';
    end if;
  else
    new.racine_id := null;
    if new.reunion_id is not null then
      new.profondeur := 1;
      select count(*) into n from public.ai_agent_tasks where reunion_id = new.reunion_id;
      if n >= g.max_sous_taches then
        raise exception 'Gouvernance : % missions maximum par réunion', g.max_sous_taches using errcode = 'P0001';
      end if;
    else
      new.profondeur := 0;
    end if;
  end if;
  if new.profondeur > g.max_profondeur then
    raise exception 'Gouvernance : profondeur de délégation % atteinte (anti-boucle)', g.max_profondeur using errcode = 'P0001';
  end if;
  select count(*) into n from public.ai_agent_tasks
   where agent_id = new.agent_id and statut in ('a_faire','en_cours','attente_sous_taches','attente_validation');
  if n >= g.max_taches_agent then
    raise exception 'Gouvernance : agent déjà chargé (% missions ouvertes)', g.max_taches_agent using errcode = 'P0001';
  end if;
  select count(*) into n from public.ai_agent_tasks where statut in ('a_faire','en_cours','attente_sous_taches','attente_validation');
  if n >= g.max_missions_actives then
    raise exception 'Gouvernance : % missions actives maximum', g.max_missions_actives using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger ai_tasks_before before insert or update on public.ai_agent_tasks
  for each row execute function public.ai_tasks_before();

-- Reprise automatique du parent quand toutes ses sous-tâches sont closes ; blocage des dépendants d'un échec
create or replace function public.ai_tasks_after() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.statut is distinct from old.statut and new.statut in ('terminee','echouee','annulee','bloquee') then
    if new.parent_id is not null then
      update public.ai_agent_tasks p set statut = 'a_faire', reprises = p.reprises + 1
       where p.id = new.parent_id and p.statut = 'attente_sous_taches'
         and not exists (select 1 from public.ai_agent_tasks c where c.parent_id = p.id
                          and c.statut in ('a_faire','en_cours','attente_sous_taches','attente_validation'));
    end if;
    if new.statut in ('echouee','annulee') then
      update public.ai_agent_tasks t set statut = 'bloquee',
             progression = left(coalesce(t.progression,'') || E'\n[Système] Dépendance « ' || new.titre || ' » ' || new.statut, 8000)
       where t.statut = 'a_faire' and t.id in (select d.task_id from public.ai_task_dependencies d where d.depend_de = new.id);
    end if;
  end if;
  return null;
end $$;
create trigger ai_tasks_after after update of statut on public.ai_agent_tasks
  for each row execute function public.ai_tasks_after();

alter table public.ai_agent_meetings add column if not exists task_id uuid references public.ai_agent_tasks(id) on delete set null;

-- Agents ayant déjà reçu une mission dans la chaîne (anti-boucle : pas de retour à l'expéditeur)
create or replace function public.ai_task_chain_agents(p_task uuid) returns setof uuid
language sql stable set search_path = public as $$
  with recursive up(id, parent_id, agent_id, d) as (
    select id, parent_id, agent_id, 0 from public.ai_agent_tasks where id = p_task
    union all
    select t.id, t.parent_id, t.agent_id, up.d + 1 from public.ai_agent_tasks t join up on t.id = up.parent_id where up.d < 12)
  select distinct agent_id from up
$$;

-- ─── Dépendances entre tâches (graphe acyclique) ─────────────────
create table if not exists public.ai_task_dependencies (
  task_id   uuid not null references public.ai_agent_tasks(id) on delete cascade,
  depend_de uuid not null references public.ai_agent_tasks(id) on delete cascade,
  primary key (task_id, depend_de),
  check (task_id <> depend_de)
);
create index if not exists ai_deps_reverse on public.ai_task_dependencies(depend_de);
create or replace function public.ai_dep_no_cycle() returns trigger language plpgsql set search_path = public as $$
begin
  if exists (
    with recursive r(id) as (
      select new.depend_de
      union
      select d.depend_de from public.ai_task_dependencies d join r on d.task_id = r.id)
    select 1 from r where id = new.task_id) then
    raise exception 'Dépendance circulaire refusée' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger ai_dep_no_cycle before insert or update on public.ai_task_dependencies
  for each row execute function public.ai_dep_no_cycle();

-- ─── Communications inter-agents (traçables) ─────────────────────
create table if not exists public.ai_agent_communications (
  id            bigint generated always as identity primary key,
  de_agent_id   uuid references public.ai_agents(id) on delete set null,   -- null = système / direction
  vers_agent_id uuid not null references public.ai_agents(id) on delete cascade,
  task_id       uuid references public.ai_agent_tasks(id) on delete set null,
  type          text not null check (type in ('transmission','sollicitation','rapport','alerte','decision','information')),
  objet         text not null check (length(objet) <= 200),
  contenu       text not null check (length(contenu) <= 8000),
  donnees       jsonb not null default '{}'::jsonb,
  lu_at         timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists ai_comms_inbox on public.ai_agent_communications(vers_agent_id, created_at desc);
create index if not exists ai_comms_unread on public.ai_agent_communications(vers_agent_id) where lu_at is null;

-- ─── Performance (instantanés quotidiens) ────────────────────────
create table if not exists public.ai_agent_performance (
  agent_id            uuid not null references public.ai_agents(id) on delete cascade,
  jour                date not null,
  missions_attribuees int not null default 0,
  missions_terminees  int not null default 0,
  taux_realisation    numeric(5,1),
  qualite             numeric(5,1),
  respect_delais      numeric(5,1),
  productivite        int not null default 0,
  cout_usd            numeric(12,4) not null default 0,
  incidents           int not null default 0,
  score               numeric(5,1),
  primary key (agent_id, jour)
);

-- ─── Mémoire (recherche plein texte ; pgvector quand un fournisseur d'embeddings sera retenu) ─
create table if not exists public.ai_agent_memory (
  id         bigint generated always as identity primary key,
  agent_id   uuid references public.ai_agents(id) on delete cascade,   -- null = mémoire partagée
  contenu    text not null check (length(contenu) between 3 and 4000),
  tags       text[] not null default '{}',
  importance smallint not null default 3 check (importance between 1 and 5),
  fts        tsvector generated always as (to_tsvector('french'::regconfig, contenu)) stored,
  created_at timestamptz not null default now()
);
create index if not exists ai_memory_fts on public.ai_agent_memory using gin (fts);
create index if not exists ai_memory_agent on public.ai_agent_memory(agent_id, created_at desc);

create or replace function public.ai_memory_search(p_agent uuid, p_q text, p_n int default 5)
returns table(id bigint, contenu text, tags text[], importance smallint, partage boolean, created_at timestamptz)
language sql stable set search_path = public as $$
  select m.id, m.contenu, m.tags, m.importance, (m.agent_id is null), m.created_at
    from public.ai_agent_memory m
   where (m.agent_id = p_agent or m.agent_id is null)
     and m.fts @@ websearch_to_tsquery('french'::regconfig, left(coalesce(p_q, ''), 300))
   order by m.importance desc, ts_rank(m.fts, websearch_to_tsquery('french'::regconfig, left(coalesce(p_q, ''), 300))) desc, m.created_at desc
   limit greatest(1, least(p_n, 20))
$$;

-- ─── Incidents ───────────────────────────────────────────────────
create table if not exists public.ai_incidents (
  id         bigint generated always as identity primary key,
  gravite    text not null check (gravite in ('info','attention','critique')),
  type       text not null check (length(type) <= 60),
  agent_id   uuid references public.ai_agents(id) on delete set null,
  task_id    uuid references public.ai_agent_tasks(id) on delete set null,
  message    text not null check (length(message) <= 4000),
  notifie_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ai_incidents_pending on public.ai_incidents(created_at) where notifie_at is null;
create index if not exists ai_incidents_at on public.ai_incidents(created_at desc);

-- ─── Bureau du président (instructions ⇄ directeur général IA) ───
create table if not exists public.ai_executive_messages (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete set null,
  auteur     text not null check (auteur in ('president','directeur')),
  contenu    text not null check (length(contenu) between 1 and 20000),
  task_id    uuid references public.ai_agent_tasks(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ai_exec_at on public.ai_executive_messages(created_at desc);

-- ─── Rapports ────────────────────────────────────────────────────
create table if not exists public.ai_report_settings (
  type          text primary key check (type in ('quotidien','hebdomadaire','mensuel','incident')),
  actif         boolean not null default true,
  heure         time not null default '18:00',
  fuseau        text not null default 'Africa/Abidjan' check (length(fuseau) <= 60),
  jour_semaine  smallint not null default 5 check (jour_semaine between 1 and 7),   -- hebdomadaire (ISO, 5 = vendredi)
  jour_mois     smallint not null default 1 check (jour_mois between 1 and 28),     -- mensuel
  format        text not null default 'html_pdf' check (format in ('html','html_pdf')),
  dernier_envoi timestamptz
);
insert into public.ai_report_settings(type, heure) values
  ('quotidien','18:00'), ('hebdomadaire','18:00'), ('mensuel','08:00'), ('incident','00:00')
on conflict (type) do nothing;

create table if not exists public.ai_report_recipients (
  id        uuid primary key default gen_random_uuid(),
  email     text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200),
  nom       text check (length(nom) <= 120),
  types     text[] not null default '{quotidien,hebdomadaire,mensuel,incident}'
              check (types <@ array['quotidien','hebdomadaire','mensuel','incident']::text[]),
  principal boolean not null default false,
  actif     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists ai_recipients_email on public.ai_report_recipients(lower(email));

create table if not exists public.ai_daily_reports (
  id            uuid primary key default gen_random_uuid(),
  type          text not null check (type in ('quotidien','hebdomadaire','mensuel','incident')),
  periode_debut timestamptz not null,
  periode_fin   timestamptz not null,
  donnees       jsonb not null,
  recommandations text,
  html          text not null,
  pdf_path      text,
  destinataires text[] not null default '{}',
  statut        text not null default 'genere' check (statut in ('genere','envoye','echec')),
  erreur        text,
  cout_usd      numeric(12,6) not null default 0,
  created_at    timestamptz not null default now(),
  envoye_at     timestamptz
);
create index if not exists ai_reports_at on public.ai_daily_reports(type, created_at desc);

-- ─── Extensions des tables commerciales (v1 Sales Director) ──────
alter table public.ai_approvals add column if not exists agent_id uuid references public.ai_agents(id) on delete set null;
alter table public.ai_approvals add column if not exists task_id  uuid references public.ai_agent_tasks(id) on delete set null;
alter table public.ai_approvals drop constraint if exists ai_approvals_type_check;
alter table public.ai_approvals add constraint ai_approvals_type_check check (type in
  ('remise','contrat','paiement','engagement','transfert_humain','message','creation_agent','ressources','mission','outil_externe'));
alter table public.ai_actions add column if not exists agent_id uuid references public.ai_agents(id) on delete set null;
alter table public.ai_actions add column if not exists task_id  uuid references public.ai_agent_tasks(id) on delete set null;
alter table public.ai_actions add column if not exists cout_usd numeric(12,6);
create index if not exists ai_actions_llm_cost on public.ai_actions(at) include (cout_usd, agent_id) where action = 'llm_turn';
create index if not exists ai_actions_agent on public.ai_actions(agent_id, at desc) where agent_id is not null;

-- ═══ Fonctions moteur (service_role) ══════════════════════════════
-- Budget : contrôlé avant chaque appel IA
create or replace function public.ai_budget_check(p_agent uuid default null) returns jsonb
language plpgsql stable set search_path = public as $$
declare g public.ai_governance; v_jour numeric; v_mois numeric; v_agent numeric := 0; v_lim numeric;
  d0 timestamptz := date_trunc('day',   now() at time zone 'Africa/Abidjan') at time zone 'Africa/Abidjan';
  m0 timestamptz := date_trunc('month', now() at time zone 'Africa/Abidjan') at time zone 'Africa/Abidjan';
begin
  select * into g from public.ai_governance where id = 1;
  select coalesce(sum(cout_usd),0) into v_jour from public.ai_actions where action = 'llm_turn' and at >= d0;
  select coalesce(sum(cout_usd),0) into v_mois from public.ai_actions where action = 'llm_turn' and at >= m0;
  if p_agent is not null then
    select coalesce(sum(cout_usd),0) into v_agent from public.ai_actions where action = 'llm_turn' and at >= d0 and agent_id = p_agent;
    select coalesce(a.budget_jour_usd, g.budget_agent_jour_usd) into v_lim from public.ai_agents a where a.id = p_agent;
  end if;
  return jsonb_build_object(
    'ok', g.actif and v_jour < g.budget_jour_usd and v_mois < g.budget_mois_usd and (p_agent is null or v_agent < coalesce(v_lim, g.budget_agent_jour_usd)),
    'raison', case when not g.actif then 'Entreprise virtuelle en pause (gouvernance)'
                   when v_jour >= g.budget_jour_usd then 'Budget IA quotidien atteint'
                   when v_mois >= g.budget_mois_usd then 'Budget IA mensuel atteint'
                   when p_agent is not null and v_agent >= coalesce(v_lim, g.budget_agent_jour_usd) then 'Budget quotidien de l''agent atteint'
                   else null end,
    'jour_usd', round(v_jour, 4), 'mois_usd', round(v_mois, 4), 'agent_jour_usd', round(v_agent, 4),
    'modele', g.modele);
end $$;

-- Incident (+ suspension automatique après N échecs consécutifs)
create or replace function public.ai_register_incident(p_agent uuid, p_task uuid, p_type text, p_gravite text, p_message text, p_echec boolean default true)
returns void language plpgsql set search_path = public as $$
declare g public.ai_governance; a public.ai_agents;
begin
  select * into g from public.ai_governance where id = 1;
  insert into public.ai_incidents(gravite, type, agent_id, task_id, message)
  values (p_gravite, left(p_type, 60), p_agent, p_task, left(p_message, 4000));
  if p_agent is null or not p_echec then return; end if;
  update public.ai_agents set incidents_consecutifs = incidents_consecutifs + 1,
         activite = 'en_difficulte'
   where id = p_agent returning * into a;
  if a.incidents_consecutifs >= g.suspension_apres_incidents and a.niveau > 1 and a.etat = 'actif' then
    update public.ai_agents set etat = 'suspendu' where id = p_agent;
    insert into public.ai_incidents(gravite, type, agent_id, message)
    values ('critique', 'suspension_auto', p_agent,
            a.nom || ' suspendu automatiquement après ' || a.incidents_consecutifs || ' incidents consécutifs');
    if a.manager_id is not null then
      insert into public.ai_agent_communications(vers_agent_id, type, objet, contenu)
      values (a.manager_id, 'alerte', 'Suspension automatique : ' || a.nom,
              'Agent suspendu après ' || a.incidents_consecutifs || ' incidents consécutifs. Réviser son cahier des charges, le remplacer ou le réactiver.');
    end if;
  end if;
end $$;

-- Changement d'état d'un agent (suspension, réactivation, archivage) — logique unique IA / direction
create or replace function public.ai_agent_change_etat(p_agent uuid, p_etat text, p_motif text, p_par text)
returns void language plpgsql set search_path = public as $$
declare a public.ai_agents; v_annulees int;
begin
  if p_etat not in ('actif','suspendu','archive') then raise exception 'État invalide' using errcode = 'P0001'; end if;
  select * into a from public.ai_agents where id = p_agent for update;
  if not found then raise exception 'Agent introuvable' using errcode = 'P0001'; end if;
  if a.niveau = 1 and p_etat <> 'actif' then
    raise exception 'Le directeur général ne peut être ni suspendu ni archivé' using errcode = 'P0001';
  end if;
  if a.etat = 'archive' then raise exception 'Agent archivé : créer un nouvel agent' using errcode = 'P0001'; end if;
  if p_etat = 'actif' and a.etat <> 'actif' and
     (select count(*) from public.ai_agents where etat in ('actif','attente_validation'))
       >= (select max_agents_actifs from public.ai_governance where id = 1) then
    raise exception 'Gouvernance : plafond d''agents actifs atteint, réactivation impossible' using errcode = 'P0001';
  end if;
  update public.ai_agents set etat = p_etat,
         incidents_consecutifs = case when p_etat = 'actif' then 0 else incidents_consecutifs end,
         activite = case when p_etat = 'actif' then 'disponible' else activite end
   where id = p_agent;
  if p_etat = 'archive' then
    update public.ai_agent_tasks set statut = 'annulee',
           progression = left(coalesce(progression,'') || E'\n[Système] Agent archivé : ' || coalesce(p_motif,''), 8000)
     where agent_id = p_agent and statut in ('a_faire','attente_validation','attente_sous_taches','bloquee');
    get diagnostics v_annulees = row_count;
    update public.ai_departments set responsable_id = null where responsable_id = p_agent;
    if a.manager_id is not null and v_annulees > 0 then
      insert into public.ai_agent_communications(vers_agent_id, type, objet, contenu)
      values (a.manager_id, 'alerte', 'Missions à réattribuer : ' || a.nom,
              v_annulees || ' mission(s) de ' || a.nom || ' annulée(s) suite à son archivage. Réattribuer si nécessaire.');
    end if;
  end if;
  insert into public.ai_actions(agent, action, agent_id, payload)
  values (left(coalesce(p_par,'systeme'), 60), 'agent_' || p_etat, p_agent, jsonb_build_object('motif', p_motif));
end $$;

create or replace function public.ai_expire_agents() returns int language plpgsql set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.ai_agents where temporaire and expire_at < now() and etat <> 'archive' loop
    perform public.ai_agent_change_etat(r.id, 'archive', 'Fin de mission temporaire', 'systeme');
    n := n + 1;
  end loop;
  update public.ai_agents set activite = 'disponible'
   where activite = 'mission_terminee' and activite_depuis < now() - interval '30 minutes';
  return n;
end $$;

-- Prise en charge atomique des tâches exécutables (1 tâche à la fois par agent)
create or replace function public.ai_claim_tasks(p_n int) returns setof public.ai_agent_tasks
language plpgsql set search_path = public as $$
declare g public.ai_governance; r record;
begin
  perform pg_advisory_xact_lock(hashtext('ai_claim_tasks'));
  select * into g from public.ai_governance where id = 1;
  -- Reprise après interruption (fonction coupée) : la tâche repart, la tentative est comptée
  update public.ai_agent_tasks set statut = 'a_faire',
         progression = left(coalesce(progression,'') || E'\n[Système] Exécution interrompue, reprise.', 8000)
   where statut = 'en_cours' and started_at < now() - interval '15 minutes';
  -- Trop de tentatives ⇒ blocage + incident
  for r in select id, agent_id, titre from public.ai_agent_tasks
            where statut = 'a_faire' and executions - reprises >= g.max_executions_tache loop
    update public.ai_agent_tasks set statut = 'bloquee' where id = r.id;
    perform public.ai_register_incident(r.agent_id, r.id, 'tentatives_epuisees', 'attention',
      'Mission « ' || r.titre || ' » bloquée après ' || g.max_executions_tache || ' exécutions', true);
  end loop;
  if not (public.ai_budget_check(null)->>'ok')::boolean then return; end if;

  return query
  with spend as (
    select x.agent_id, sum(x.cout_usd) as s from public.ai_actions x
     where x.action = 'llm_turn' and x.agent_id is not null
       and x.at >= date_trunc('day', now() at time zone 'Africa/Abidjan') at time zone 'Africa/Abidjan'
     group by x.agent_id),
  cand as (
    select t.id, t.priorite, t.created_at,
           row_number() over (partition by t.agent_id order by t.priorite, t.created_at) as rn
      from public.ai_agent_tasks t join public.ai_agents a on a.id = t.agent_id
      left join spend on spend.agent_id = a.id
     where t.statut = 'a_faire' and a.etat = 'actif' and a.activite <> 'en_reunion'
       and coalesce(spend.s, 0) < coalesce(a.budget_jour_usd, g.budget_agent_jour_usd)
       and not exists (select 1 from public.ai_agent_tasks y where y.agent_id = t.agent_id and y.statut = 'en_cours')
       and not exists (select 1 from public.ai_task_dependencies d join public.ai_agent_tasks x on x.id = d.depend_de
                        where d.task_id = t.id and x.statut <> 'terminee')),
  pick as (select id from cand where rn = 1 order by priorite, created_at
            limit greatest(0, least(p_n, 20) - (select count(*) from public.ai_agent_tasks where statut = 'en_cours')))
  update public.ai_agent_tasks t set statut = 'en_cours', started_at = now(), executions = t.executions + 1
    from pick where t.id = pick.id and t.statut = 'a_faire'
  returning t.*;
end $$;

create or replace function public.ai_claim_meetings(p_n int) returns setof public.ai_agent_meetings
language plpgsql set search_path = public as $$
begin
  update public.ai_agent_meetings set statut = 'echouee', fin_at = now()
   where statut = 'en_cours' and debut_at < now() - interval '20 minutes';
  update public.ai_agents a set activite = 'disponible'
   where a.activite = 'en_reunion'
     and not exists (select 1 from public.ai_meeting_participants p join public.ai_agent_meetings m on m.id = p.meeting_id
                      where p.agent_id = a.id and m.statut = 'en_cours');
  if not (public.ai_budget_check(null)->>'ok')::boolean then return; end if;
  return query
  update public.ai_agent_meetings m set statut = 'en_cours', debut_at = now()
   where m.id in (select id from public.ai_agent_meetings where statut = 'planifiee'
                   order by created_at for update skip locked limit greatest(1, least(p_n, 5)))
  returning m.*;
end $$;

-- Statistiques par agent sur une période (évaluation, rapports, outil de performance)
create or replace function public.ai_agent_stats(p_debut timestamptz, p_fin timestamptz)
returns table(agent_id uuid, nom text, fonction text, departement_id text, etat text, activite text,
  attribuees int, terminees int, echouees int, ouvertes int, taux numeric, qualite numeric, respect_delais numeric,
  productivite int, cout_usd numeric, incidents int, score numeric)
language sql stable set search_path = public as $$
  with t as (
    select a.id,
      count(k.id) filter (where k.created_at >= p_debut and k.created_at < p_fin) as attr,
      count(k.id) filter (where k.statut = 'terminee' and k.finished_at >= p_debut and k.finished_at < p_fin) as term,
      count(k.id) filter (where k.statut in ('echouee','bloquee') and k.updated_at >= p_debut and k.updated_at < p_fin) as ech,
      count(k.id) filter (where k.statut in ('a_faire','en_cours','attente_sous_taches','attente_validation')) as ouv,
      avg(k.evaluation) filter (where k.evaluation is not null and k.finished_at >= p_debut and k.finished_at < p_fin) as qual,
      100.0 * count(k.id) filter (where k.statut = 'terminee' and k.echeance is not null and k.finished_at <= k.echeance
                                     and k.finished_at >= p_debut and k.finished_at < p_fin)
        / nullif(count(k.id) filter (where k.statut = 'terminee' and k.echeance is not null
                                       and k.finished_at >= p_debut and k.finished_at < p_fin), 0) as delais
    from public.ai_agents a left join public.ai_agent_tasks k on k.agent_id = a.id
    where a.etat <> 'archive' or a.archived_at >= p_debut
    group by a.id),
  c as (select x.agent_id, sum(x.cout_usd) as cout, count(*) filter (where x.action <> 'llm_turn' and x.ok) as prod
          from public.ai_actions x where x.at >= p_debut and x.at < p_fin and x.agent_id is not null group by x.agent_id),
  i as (select y.agent_id, count(*) as n from public.ai_incidents y
         where y.created_at >= p_debut and y.created_at < p_fin and y.agent_id is not null group by y.agent_id)
  select a.id, a.nom, a.fonction, a.departement_id, a.etat, a.activite,
    t.attr::int, t.term::int, t.ech::int, t.ouv::int,
    round(least(100, 100.0 * t.term / nullif(t.attr, 0)), 1),
    round(t.qual, 1), round(t.delais, 1),
    coalesce(c.prod, 0)::int, round(coalesce(c.cout, 0), 4), coalesce(i.n, 0)::int,
    case when t.term + t.ech = 0 and coalesce(i.n, 0) = 0 then null else round(
        0.3 * least(100, coalesce(100.0 * t.term / nullif(t.attr, 0), case when t.term > 0 then 100 else 0 end))
      + 0.3 * coalesce(t.qual, 70) + 0.2 * coalesce(t.delais, 100)
      + 0.2 * greatest(0, 100 - 25 * coalesce(i.n, 0)), 1) end
  from public.ai_agents a join t on t.id = a.id
  left join c on c.agent_id = a.id left join i on i.agent_id = a.id
$$;

create or replace function public.ai_compute_performance(p_jour date) returns int
language plpgsql set search_path = public as $$
declare n int;
begin
  insert into public.ai_agent_performance as p (agent_id, jour, missions_attribuees, missions_terminees, taux_realisation,
    qualite, respect_delais, productivite, cout_usd, incidents, score)
  select s.agent_id, p_jour, s.attribuees, s.terminees, s.taux, s.qualite, s.respect_delais, s.productivite, s.cout_usd, s.incidents, s.score
    from public.ai_agent_stats(p_jour::timestamp at time zone 'Africa/Abidjan', (p_jour + 1)::timestamp at time zone 'Africa/Abidjan') s
  on conflict (agent_id, jour) do update set
    missions_attribuees = excluded.missions_attribuees, missions_terminees = excluded.missions_terminees,
    taux_realisation = excluded.taux_realisation, qualite = excluded.qualite, respect_delais = excluded.respect_delais,
    productivite = excluded.productivite, cout_usd = excluded.cout_usd, incidents = excluded.incidents, score = excluded.score;
  get diagnostics n = row_count;
  return n;
end $$;

-- Données des rapports (sections A à E + G ; F = analyse du directeur IA)
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
    'valeur_opportunites', (select coalesce(sum(potentiel_fcfa), 0) from ai_prospects
                              where stage not in ('perdu','en_veille','marche_gagne','deploiement','client_fidelise')),
    'devis_transmis_ht',   (select coalesce(sum(total_ht), 0) from ai_offers where created_at >= p_debut and created_at < p_fin
                              and statut in ('validee','envoyee','acceptee','refusee')),
    'marches_conclus',     (select count(*) from ai_stage_history where vers = 'marche_gagne' and at >= p_debut and at < p_fin),
    'ca_signe_ht',         (select coalesce(sum(o.total_ht), 0) from ai_offers o where o.statut = 'acceptee' and o.prospect_id in
                              (select h.prospect_id from ai_stage_history h where h.vers = 'contrat_signe' and h.at >= p_debut and h.at < p_fin)),
    'ca_encaisse_ht',      (select coalesce(sum(o.total_ht), 0) from ai_offers o where o.statut = 'acceptee' and o.prospect_id in
                              (select h.prospect_id from ai_stage_history h where h.vers = 'paiement_confirme' and h.at >= p_debut and h.at < p_fin)),
    'prevision_ponderee',  (select coalesce(round(sum(potentiel_fcfa * case stage
                               when 'contrat_transmis' then 0.85 when 'offre_acceptee' then 0.8 when 'negociation' then 0.6
                               when 'offre_transmise' then 0.4 when 'demo_realisee' then 0.3 when 'rdv_confirme' then 0.2
                               when 'interesse' then 0.15 else 0.05 end)), 0)
                              from ai_prospects where stage not in ('perdu','en_veille','marche_gagne','deploiement','client_fidelise'))),
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

-- ═══ Fonctions direction (authenticated) ══════════════════════════
create or replace function public.ai_set_agent_etat(p_agent uuid, p_etat text, p_motif text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  perform public.ai_agent_change_etat(p_agent, p_etat, left(p_motif, 500), 'direction:' || auth.uid()::text);
end $$;

-- Décision d'une validation : applique l'effet métier et relance la mission en attente
create or replace function public.ai_decide_approval(p_id uuid, p_ok boolean, p_commentaire text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.ai_approvals; v_param text; v_val numeric;
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  update public.ai_approvals set statut = case when p_ok then 'approuve' else 'refuse' end,
         decided_by = auth.uid(), decided_at = now(), commentaire = left(p_commentaire, 1000)
   where id = p_id and statut = 'en_attente' returning * into a;
  if not found then raise exception 'Validation introuvable ou déjà traitée'; end if;

  if a.type = 'remise' and a.objet_id is not null then
    update public.ai_offers set statut = case when p_ok then 'validee' else 'brouillon' end where id = a.objet_id;
  end if;
  if a.type in ('creation_agent','outil_externe') and a.agent_id is not null then
    update public.ai_agents set etat = case when p_ok then 'actif' else 'archive' end
     where id = a.agent_id and etat = 'attente_validation';
  end if;
  if a.type = 'ressources' and p_ok then
    v_param := a.payload->>'parametre';
    v_val := nullif(a.payload->>'valeur', '')::numeric;
    if v_val is null or v_val < 0 then raise exception 'Valeur demandée invalide'; end if;
    case v_param
      when 'budget_jour_usd'      then update public.ai_governance set budget_jour_usd = v_val where id = 1;
      when 'budget_mois_usd'      then update public.ai_governance set budget_mois_usd = v_val where id = 1;
      when 'max_agents_actifs'    then update public.ai_governance set max_agents_actifs = v_val::int where id = 1;
      when 'max_creations_jour'   then update public.ai_governance set max_creations_jour = v_val::int where id = 1;
      when 'max_missions_actives' then update public.ai_governance set max_missions_actives = v_val::int where id = 1;
      when 'budget_agent_jour_usd' then
        if a.agent_id is null then raise exception 'Agent non précisé'; end if;
        update public.ai_agents set budget_jour_usd = v_val where id = a.agent_id;
      else raise exception 'Paramètre de ressource non pris en charge : %', v_param;
    end case;
  end if;
  if a.type = 'outil_externe' and p_ok and a.payload ? 'add_tools' and a.agent_id is not null then
    update public.ai_agents set outils = (
      select coalesce(array_agg(distinct x), '{}') from unnest(outils || array(select jsonb_array_elements_text(a.payload->'add_tools'))) x)
     where id = a.agent_id;
  end if;
  if a.type = 'message' and a.payload ? 'message_id' then
    update public.ai_messages set statut = case when p_ok then 'a_envoyer' else 'echec' end
     where id = (a.payload->>'message_id')::bigint and statut = 'a_valider';
  end if;
  if a.task_id is not null then
    update public.ai_agent_tasks set statut = 'a_faire', reprises = reprises + 1,
           progression = left(coalesce(progression, '') || E'\n[Décision du président] ' ||
                         case when p_ok then 'APPROUVÉ' else 'REFUSÉ' end || coalesce(' — ' || p_commentaire, ''), 8000)
     where id = a.task_id and statut = 'attente_validation';
    insert into public.ai_agent_communications(vers_agent_id, task_id, type, objet, contenu)
    select t.agent_id, t.id, 'decision', 'Décision : ' || a.type,
           case when p_ok then 'Demande approuvée' else 'Demande refusée' end || coalesce(' — ' || p_commentaire, '')
      from public.ai_agent_tasks t where t.id = a.task_id;
  end if;
  insert into public.ai_actions(agent, action, prospect_id, agent_id, task_id, payload)
  values ('direction', 'validation_' || case when p_ok then 'approuvee' else 'refusee' end, a.prospect_id, a.agent_id, a.task_id,
          jsonb_build_object('approval', p_id, 'type', a.type, 'commentaire', p_commentaire));
end $$;

create or replace function public.ai_decide_approvals_batch(p_ids uuid[], p_ok boolean, p_commentaire text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_id uuid; n int := 0;
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  if coalesce(array_length(p_ids, 1), 0) > 200 then raise exception 'Lot limité à 200 validations'; end if;
  foreach v_id in array p_ids loop
    begin
      perform public.ai_decide_approval(v_id, p_ok, p_commentaire);
      n := n + 1;
    exception when others then null;   -- déjà traitée ou invalide : on continue
    end;
  end loop;
  return n;
end $$;

-- Consommation des ressources (écran Gouvernance + moteur)
create or replace function public.ai_budget_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g public.ai_governance; b jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.ai_is_direction() then
    raise exception 'Réservé à la direction' using errcode = '42501';
  end if;
  select * into g from public.ai_governance where id = 1;
  b := public.ai_budget_check(null);
  return b || jsonb_build_object(
    'budget_jour_usd', g.budget_jour_usd, 'budget_mois_usd', g.budget_mois_usd,
    'agents_actifs', (select count(*) from public.ai_agents where etat in ('actif','attente_validation')),
    'max_agents_actifs', g.max_agents_actifs,
    'missions_actives', (select count(*) from public.ai_agent_tasks where statut in ('a_faire','en_cours','attente_sous_taches','attente_validation')),
    'max_missions_actives', g.max_missions_actives,
    'creations_jour', (select count(*) from public.ai_agents where cree_par_agent is not null
       and created_at >= date_trunc('day', now() at time zone 'Africa/Abidjan') at time zone 'Africa/Abidjan'),
    'max_creations_jour', g.max_creations_jour);
end $$;

-- Prise atomique d'un rapport échu (évite l'envoi en double entre deux passages du planificateur)
create or replace function public.ai_report_claim(p_type text, p_at timestamptz, p_now timestamptz default now())
returns boolean language plpgsql set search_path = public as $$
declare n int;
begin
  update public.ai_report_settings set dernier_envoi = p_now
   where type = p_type and (dernier_envoi is null or dernier_envoi < p_at);
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.ai_report_claim(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_report_claim(text, timestamptz, timestamptz) to service_role;

-- ═══ Droits d'exécution ═══════════════════════════════════════════
revoke all on function public.ai_memory_search(uuid, text, int) from public, anon, authenticated;
grant execute on function public.ai_memory_search(uuid, text, int) to service_role;
revoke all on function public.ai_budget_check(uuid), public.ai_register_incident(uuid, uuid, text, text, text, boolean),
  public.ai_agent_change_etat(uuid, text, text, text), public.ai_expire_agents(), public.ai_claim_tasks(int),
  public.ai_claim_meetings(int), public.ai_compute_performance(date) from public, anon, authenticated;
grant execute on function public.ai_budget_check(uuid), public.ai_register_incident(uuid, uuid, text, text, text, boolean),
  public.ai_agent_change_etat(uuid, text, text, text), public.ai_expire_agents(), public.ai_claim_tasks(int),
  public.ai_claim_meetings(int), public.ai_compute_performance(date) to service_role;
revoke all on function public.ai_agent_stats(timestamptz, timestamptz), public.ai_report_data(timestamptz, timestamptz),
  public.ai_set_agent_etat(uuid, text, text), public.ai_decide_approvals_batch(uuid[], boolean, text),
  public.ai_budget_status(), public.ai_task_chain_agents(uuid) from public, anon;
grant execute on function public.ai_agent_stats(timestamptz, timestamptz), public.ai_report_data(timestamptz, timestamptz),
  public.ai_set_agent_etat(uuid, text, text), public.ai_decide_approvals_batch(uuid[], boolean, text),
  public.ai_budget_status() to authenticated, service_role;
grant execute on function public.ai_task_chain_agents(uuid) to service_role;

-- ═══ RLS ══════════════════════════════════════════════════════════
do $$ declare t text; begin
  foreach t in array array['ai_governance','ai_departments','ai_agents','ai_agent_charters','ai_agent_meetings',
    'ai_meeting_participants','ai_meeting_minutes','ai_agent_tasks','ai_task_dependencies','ai_agent_communications',
    'ai_agent_performance','ai_agent_memory','ai_incidents','ai_executive_messages','ai_report_settings',
    'ai_report_recipients','ai_daily_reports']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
  foreach t in array array['ai_governance','ai_departments','ai_agents','ai_agent_charters','ai_agent_meetings',
    'ai_meeting_participants','ai_meeting_minutes','ai_agent_tasks','ai_task_dependencies','ai_agent_communications',
    'ai_agent_performance','ai_incidents']
  loop
    execute format('create policy op_read on public.%I for select to authenticated using (public.ai_is_operator())', t);
  end loop;
  foreach t in array array['ai_agent_memory','ai_executive_messages','ai_report_settings','ai_report_recipients','ai_daily_reports']
  loop
    execute format('create policy dir_read on public.%I for select to authenticated using (public.ai_is_direction())', t);
  end loop;
end $$;
create policy dir_update on public.ai_governance for update to authenticated
  using (public.ai_is_direction()) with check (public.ai_is_direction());
create policy dir_update on public.ai_report_settings for update to authenticated
  using (public.ai_is_direction()) with check (public.ai_is_direction());
create policy dir_write on public.ai_report_recipients for all to authenticated
  using (public.ai_is_direction()) with check (public.ai_is_direction());
create policy dir_update on public.ai_departments for update to authenticated
  using (public.ai_is_direction()) with check (public.ai_is_direction());

-- Realtime (bureau 3D) : statuts des agents, missions, réunions, échanges avec le président
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ai_agents, public.ai_agent_tasks,
      public.ai_agent_meetings, public.ai_executive_messages, public.ai_approvals;
  end if;
end $$;

-- Stockage privé des rapports PDF (lecture : direction)
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id, name, public) values ('ai-reports', 'ai-reports', false) on conflict (id) do nothing;
    execute $p$create policy ai_reports_dir_read on storage.objects for select to authenticated
      using (bucket_id = 'ai-reports' and public.ai_is_direction())$p$;
  end if;
end $$;

-- ═══ Données de référence ═════════════════════════════════════════
insert into public.ai_departments(id, nom, mission, couleur, ordre) values
 ('direction',       'Direction générale',      'Décisions, coordination, arbitrages',                '#1E3A8A', 1),
 ('commercial',      'Direction commerciale',   'Prospection, négociation, conclusion des ventes',    '#2563EB', 2),
 ('marketing',       'Direction marketing',     'Campagnes, contenus, communication',                 '#DB2777', 3),
 ('intelligence',    'Intelligence économique', 'Études de marché, veille, signaux d''affaires',      '#7C3AED', 4),
 ('relation_client', 'Relation client',         'Déploiement, satisfaction, fidélisation, upsell',    '#059669', 5),
 ('administratif',   'Administration',          'Documents, contrats, conformité',                    '#D97706', 6)
on conflict (id) do nothing;

insert into public.ai_agents(code, nom, fonction, departement_id, niveau, personnalite, specialite, outils, effort, avatar)
values ('sanix_ai_general_director', 'SANIX AI GENERAL DIRECTOR', 'Directeur général IA', 'direction', 1,
  'Stratège, calme, exigeant sur les résultats, économe des ressources',
  'Organisation, planification, arbitrage, pilotage par les indicateurs',
  array['creer_agent','modifier_agent','changer_etat_agent','assigner_mission','attendre_sous_taches','evaluer_tache',
        'consulter_performance','convoquer_reunion','consulter_indicateurs','demander_ressources','repondre_president'],
  'high', '{"couleur":"#1E3A8A","forme":"directeur"}')
on conflict (code) do nothing;

insert into public.ai_agents(code, nom, fonction, departement_id, niveau, manager_id, personnalite, specialite, outils, effort, avatar)
select 'sanix_ai_sales_director', 'SANIX AI SALES DIRECTOR', 'Directeur commercial IA', 'direction', 2, dg.id,
  'Orienté résultats, méthodique, éthique, pédagogue avec ses équipes',
  'Stratégie commerciale multi-produits, pipeline, négociation B2B en Afrique de l''Ouest',
  array['creer_agent','modifier_agent','changer_etat_agent','assigner_mission','attendre_sous_taches','evaluer_tache',
        'consulter_performance','convoquer_reunion','consulter_indicateurs','demander_ressources','transmettre',
        'lister_prospects','get_prospect','recommend_products','get_product'],
  'high', '{"couleur":"#2563EB","forme":"directeur"}'
from public.ai_agents dg where dg.code = 'sanix_ai_general_director'
on conflict (code) do nothing;

insert into public.ai_agent_charters(agent_id, version, contenu, motif)
select a.id, 1, c.contenu, 'Charte initiale'
from public.ai_agents a join (values
 ('sanix_ai_general_director', '{
   "identite":"SANIX AI GENERAL DIRECTOR — directeur général de SANIX AI VIRTUAL COMPANY",
   "fonction":"Directeur général IA",
   "departement":"Direction générale",
   "mission_principale":"Traduire les instructions du président en plans d''action, organiser l''entreprise virtuelle et atteindre les objectifs de SANIX AFRICA dans le budget fixé.",
   "missions_secondaires":["Créer, organiser et faire évoluer les équipes IA","Attribuer et superviser les missions","Animer les réunions de direction","Évaluer les performances et réorganiser","Rendre compte au président"],
   "competences":["Planification stratégique","Conception d''organisation","Pilotage par indicateurs","Arbitrage coût / résultat"],
   "outils":["Agent Factory","Attribution de missions","Réunions","Évaluation","Indicateurs"],
   "donnees":["Organisation et missions","Indicateurs CRM agrégés","Performances et coûts des agents"],
   "objectifs":["Atteindre les objectifs fixés par le président","Rester dans le budget IA","Aucune mission orpheline ni redondante"],
   "delais":"Plan d''action en réponse à chaque instruction ; revue quotidienne des résultats",
   "indicateurs":["CA signé","Taux de transformation","Taux de réalisation des missions","Coût IA par résultat"],
   "procedures":["Analyser, planifier, organiser, attribuer, superviser, rendre compte","Réutiliser un agent existant avant d''en créer un","Déléguer aux directeurs plutôt que micro-gérer"],
   "limites":["Limites de gouvernance strictes","Validation du président au-delà des délégations","Aucun engagement juridique ou financier"],
   "responsable":"Président — Direction SANIX AFRICA",
   "reporting":"Réponse à chaque instruction ; synthèse quotidienne à 18 h (Abidjan)"}'::jsonb),
 ('sanix_ai_sales_director', '{
   "identite":"SANIX AI SALES DIRECTOR — directeur commercial de SANIX AI VIRTUAL COMPANY",
   "fonction":"Directeur commercial IA",
   "departement":"Direction générale (pôle commercial)",
   "mission_principale":"Construire et diriger les équipes commerciales, marketing et intelligence économique pour vendre les logiciels SANIX.",
   "missions_secondaires":["Créer les responsables de départements","Fixer et répartir les objectifs de vente par produit","Superviser le pipeline et les négociations","Organiser la fidélisation et la vente additionnelle"],
   "competences":["Stratégie commerciale B2B","Prospection multicanale","Négociation","Management d''équipes"],
   "outils":["Agent Factory","Attribution de missions","Réunions","Lecture CRM","Évaluation"],
   "donnees":["Prospects, pipeline et offres","Catalogue et grille tarifaire","Performances commerciales"],
   "objectifs":["Objectifs de licences fixés par le directeur général","Taux de transformation croissant","Coût d''acquisition maîtrisé"],
   "delais":"Organisation des équipes sous 24 h après un objectif ; revue quotidienne du pipeline",
   "indicateurs":["Prospects qualifiés","RDV obtenus","Offres transmises","Marchés gagnés","CA signé"],
   "procedures":["Secteur et besoins identifiés avant toute présentation produit","Chaîne recherche, enrichissement, qualification, contact, rendez-vous, offre","Escalader toute remise hors délégation"],
   "limites":["Aucun engagement contractuel ou financier","Aucune promesse de fonctionnalité non livrée","Respect des désinscriptions"],
   "responsable":"SANIX AI GENERAL DIRECTOR",
   "reporting":"Rapport à la fin de chaque mission ; points d''alerte immédiats"}'::jsonb)
) as c(code, contenu) on c.code = a.code
on conflict do nothing;

update public.ai_departments d set responsable_id = a.id
  from public.ai_agents a where a.code = 'sanix_ai_general_director' and d.id = 'direction' and d.responsable_id is null;

-- ═══ 20261109030000_ai_virtual_office_3d.sql ═══
-- ═══════════════════════════════════════════════════════════════════
--  SANIX AI VIRTUAL COMPANY — Module 13 : présence et animation 3D temps réel
--  Principe : le moteur IA écrit l'état réel (activité détaillée, lieu) et publie des événements ;
--  le bureau 3D se synchronise via Realtime et reconstruit l'état à la réouverture.
--  Les animations représentent le statut déclaré par le moteur, pas chaque opération technique.
-- ═══════════════════════════════════════════════════════════════════

-- ─── État de présence persistant (survit à la fermeture de l'interface) ───
alter table public.ai_agents
  add column if not exists activite_detail  text check (activite_detail is null or activite_detail ~ '^[a-z_]{3,40}$'),
  add column if not exists lieu             text not null default 'poste'
    check (lieu in ('poste','poste_agent','reunion','supervision','collaboration','detente','departement')),
  add column if not exists lieu_cible_agent uuid references public.ai_agents(id) on delete set null,
  add column if not exists lieu_cible_dept  text references public.ai_departments(id) on delete set null,
  add column if not exists lieu_depuis      timestamptz,
  add column if not exists lieu_jusqua      timestamptz;
alter table public.ai_agents drop constraint if exists ai_agents_lieu_cible_check;
alter table public.ai_agents add constraint ai_agents_lieu_cible_check check (
  (lieu <> 'poste_agent' or lieu_cible_agent is not null) and (lieu <> 'departement' or lieu_cible_dept is not null));

create or replace function public.ai_agents_presence_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.lieu is distinct from old.lieu or new.lieu_cible_agent is distinct from old.lieu_cible_agent
     or new.lieu_cible_dept is distinct from old.lieu_cible_dept then
    new.lieu_depuis := now();
  end if;
  if new.lieu = 'poste' then
    new.lieu_cible_agent := null; new.lieu_cible_dept := null; new.lieu_jusqua := null;
  end if;
  if new.etat = 'archive' then new.lieu := 'poste'; new.activite_detail := null; end if;
  return new;
end $$;
drop trigger if exists ai_agents_presence_guard on public.ai_agents;
create trigger ai_agents_presence_guard before update on public.ai_agents
  for each row execute function public.ai_agents_presence_guard();

-- ─── Réunions en direct : phase et orateur ───
alter table public.ai_agent_meetings
  add column if not exists phase text check (phase is null or phase in ('convocation','installation','echanges','synthese','cloture')),
  add column if not exists orateur_id uuid references public.ai_agents(id) on delete set null;

-- ─── Flux d'événements (historique des activités + synchronisation temps réel) ───
create table if not exists public.ai_agent_events (
  id              bigint generated always as identity primary key,
  agent_id        uuid not null references public.ai_agents(id) on delete cascade,
  kind            text not null check (kind in ('activite','deplacement','briefing','reunion','parole')),
  activity        text check (activity is null or activity ~ '^[a-z_]{3,40}$'),
  animation       text check (animation is null or animation ~ '^[a-z_]{3,40}$'),
  status          text,                         -- état grossier de l'agent au moment de l'événement
  department      text,
  location        text check (location is null or location in ('poste','poste_agent','reunion','supervision','collaboration','detente','departement')),
  target_agent_id uuid references public.ai_agents(id) on delete set null,
  target_dept     text,
  task_id         uuid references public.ai_agent_tasks(id) on delete set null,
  meeting_id      uuid references public.ai_agent_meetings(id) on delete set null,
  participants    uuid[] not null default '{}',
  payload         jsonb not null default '{}'::jsonb,
  duration_ms     int check (duration_ms is null or duration_ms between 0 and 1800000),
  created_at      timestamptz not null default now()
);
create index if not exists ai_events_at on public.ai_agent_events(created_at desc);
create index if not exists ai_events_agent on public.ai_agent_events(agent_id, created_at desc);

alter table public.ai_agent_events enable row level security;
alter table public.ai_agent_events force row level security;
revoke all on public.ai_agent_events from anon;
drop policy if exists op_read on public.ai_agent_events;
create policy op_read on public.ai_agent_events for select to authenticated using (public.ai_is_operator());

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ai_agent_events;
  end if;
exception when duplicate_object then null; end $$;

-- ─── Publication d'un événement de présence (une seule écriture atomique) ───
--  p_kind = activite     : met à jour l'activité détaillée
--  p_kind = deplacement  : le lieu de l'agent change pour p_duree_ms (retour automatique au poste)
--  p_kind = briefing     : idem, collaboration de plusieurs agents (p_participants)
--  p_kind = reunion      : l'agent rejoint la salle de réunion
--  p_kind = parole       : prise de parole en réunion (bulle de texte, aucun changement d'état)
create or replace function public.ai_agent_presence(
  p_agent uuid, p_kind text, p_activity text default null, p_animation text default null,
  p_lieu text default null, p_cible_agent uuid default null, p_cible_dept text default null,
  p_task uuid default null, p_meeting uuid default null, p_participants uuid[] default '{}',
  p_duree_ms int default null, p_payload jsonb default '{}'::jsonb)
returns bigint language plpgsql set search_path = public as $$
declare a public.ai_agents; v_id bigint;
begin
  select * into a from public.ai_agents where id = p_agent;
  if not found or a.etat = 'archive' then return null; end if;
  if p_kind = 'activite' then
    update public.ai_agents set activite_detail = p_activity where id = p_agent and activite_detail is distinct from p_activity;
  elsif p_kind in ('deplacement','briefing','reunion') then
    update public.ai_agents set lieu = coalesce(p_lieu, 'poste'), lieu_cible_agent = p_cible_agent, lieu_cible_dept = p_cible_dept,
           lieu_jusqua = case when coalesce(p_lieu, 'poste') = 'poste' then null else now() + make_interval(secs => greatest(1, coalesce(p_duree_ms, 10000)) / 1000.0) end
     where id = p_agent;
  end if;
  insert into public.ai_agent_events(agent_id, kind, activity, animation, status, department, location, target_agent_id, target_dept,
                                      task_id, meeting_id, participants, payload, duration_ms)
  values (p_agent, p_kind, p_activity, p_animation, a.activite, a.departement_id, p_lieu, p_cible_agent, p_cible_dept,
          p_task, p_meeting, coalesce(p_participants, '{}'), coalesce(p_payload, '{}'::jsonb), p_duree_ms)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.ai_agent_presence(uuid, text, text, text, text, uuid, text, uuid, uuid, uuid[], int, jsonb) from public, anon, authenticated;
grant execute on function public.ai_agent_presence(uuid, text, text, text, text, uuid, text, uuid, uuid, uuid[], int, jsonb) to service_role;

-- ─── Entretien : retours au poste, activités périmées, purge de l'historique ───
create or replace function public.ai_expire_agents() returns int language plpgsql set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.ai_agents where temporaire and expire_at < now() and etat <> 'archive' loop
    perform public.ai_agent_change_etat(r.id, 'archive', 'Fin de mission temporaire', 'systeme');
    n := n + 1;
  end loop;
  update public.ai_agents set activite = 'disponible', activite_detail = null
   where activite = 'mission_terminee' and activite_depuis < now() - interval '30 minutes';
  -- déplacement terminé : retour au poste
  update public.ai_agents set lieu = 'poste' where lieu <> 'poste' and lieu_jusqua is not null and lieu_jusqua < now();
  -- exécution interrompue (processus arrêté) : l'agent n'est plus « en mission » sans mission en cours
  update public.ai_agents a set activite = 'disponible', activite_detail = null
   where a.activite in ('en_mission','en_analyse') and a.activite_depuis < now() - interval '20 minutes'
     and not exists (select 1 from public.ai_agent_tasks t where t.agent_id = a.id and t.statut = 'en_cours');
  delete from public.ai_agent_events where id in (select id from public.ai_agent_events where created_at < now() - interval '14 days' limit 5000);
  return n;
end $$;

-- ═══ 20261109031000_ai_realtime_participants.sql ═══
-- Bureau 3D : les participants d'une réunion sont diffusés en temps réel (les agents rejoignent la table dès la convocation).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.ai_meeting_participants;
  end if;
exception when duplicate_object then null; end $$;

-- ═══ 20261110000000_ai_sales_followup_queue.sql ═══
-- Fiabilisation du planificateur de relances SANIX AI SALES DIRECTOR.
-- Réservation atomique : deux exécutions concurrentes ne peuvent pas prendre la même relance.
alter table public.ai_followups
  add column if not exists attempts integer not null default 0 check (attempts >= 0),
  add column if not exists locked_at timestamptz,
  add column if not exists last_error text;

create index if not exists ai_followups_locked_idx
  on public.ai_followups(locked_at)
  where statut = 'planifiee';

create or replace function public.ai_claim_due_followups(p_limit integer default 10)
returns table (
  id uuid,
  prospect_id uuid,
  scenario text,
  canal text,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select f.id
    from public.ai_followups f
    where f.statut = 'planifiee'
      and f.due_at <= now()
      and (f.locked_at is null or f.locked_at < now() - interval '10 minutes')
    order by f.due_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  update public.ai_followups f
     set locked_at = now(),
         attempts = f.attempts + 1
    from picked
   where f.id = picked.id
  returning f.id, f.prospect_id, f.scenario, f.canal, f.attempts;
end;
$$;

revoke all on function public.ai_claim_due_followups(integer) from public, anon, authenticated;
grant execute on function public.ai_claim_due_followups(integer) to service_role;

-- ═══ 20261110010000_ai_consent_setting.sql ═══
-- Réglage de gouvernance : preuve de consentement exigée avant tout envoi commercial (WhatsApp, e-mail).
-- Désactivé par défaut : la validation du président (communication_externe = 'validation') reste le garde-fou.
-- Activé, un agent ne peut écrire à un prospect que si ai_prospects.consentement porte une preuve datée pour le canal
-- ({"email":{"at":"…","preuve":"…"}}) ou, pour WhatsApp, si le prospect a écrit lui-même depuis moins de 24 h.
alter table public.ai_governance
  add column if not exists consentement_requis boolean not null default false;

-- ═══ 20261111000000_crm_ai_connector.sql ═══
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
  -- l'identifiant du prospect figure dans la consigne : le moteur l'ajoute au périmètre de l'agent (sans lui, l'agent ne pourrait pas agir sur le dossier)
  v_task := public.crm_make_task(rt.agent_code, rt.task_type, public.crm_tpl(rt.titre_tpl, v_vars),
              public.crm_tpl(rt.desc_tpl, v_vars) || case when p.id is not null then E'\n\nDossier SANIX AI : prospect_id = ' || p.id else '' end, rt.priorite, rt.echeance_h, p.id, ev.id);
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
  values (p_agent, auth.uid(), 'mission', left(btrim(p_titre), 200),
          left(coalesce(nullif(btrim(p_description), ''), p_titre) || case when p_prospect is not null then E'\n\nDossier SANIX AI : prospect_id = ' || p_prospect else '' end, 8000), '[]'::jsonb,
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

-- ═══ 20261112000000_pilotage_budget.sql ═══
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

-- ═══ 20261113000000_phase2_fiabilisation.sql ═══
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

-- ═══ 20261114000000_parametrage.sql ═══
-- ═════════════════════════════════════════════════════════════════════════════
--  SANIX AI — PARAMÉTRAGE : rôles, équipes (cellules par logiciel), agents et logiciels configurables (additif et relançable)
--  Rien de l'organisation ni du catalogue n'est figé dans le code : tout est donnée, modifiable par la direction.
--  1. ai_roles        : modèles de postes (niveau, département, outils, personnalité, charte type).
--  2. ai_agents.role_code : le poste que tient un agent.
--  3. ai_cells / ai_cell_members : une cellule par logiciel (n'importe lequel du catalogue) ; qui y tient quel rôle. Les agents peuvent être mutualisés.
--  4. ai_agent_for(logiciel, rôle) : résolution de l'agent (cellule du logiciel, puis tout agent actif portant le rôle).
--  5. Routage CRM ↔ IA par rôle : crm_ai_routing et crm_ai_stage_owner gardent le code d'agent en repli.
--  6. Fonctions d'administration (direction seule) : logiciels, équivalences de noms, rôles, cellules, création et modification d'agents.
--  Les contenus ci-dessous (rôles, cellules des trois logiciels) sont une configuration PAR DÉFAUT : la direction peut tout changer sans code.
-- ═════════════════════════════════════════════════════════════════════════════

do $$ begin
  if to_regclass('public.crm_ai_routing') is null or to_regprocedure('public.ai_product_of(text)') is null then
    raise exception 'Appliquer d''abord les migrations 20261111 (connecteur) et 20261113 (Phase 2)' using errcode = '55000';
  end if;
end $$;

-- ─── 1. Rôles (modèles de postes) ────────────────────────────────────────────
create table if not exists public.ai_roles (
  code          text primary key check (code ~ '^[a-z0-9_]{3,40}$'),
  libelle       text not null check (char_length(libelle) between 2 and 120),
  description   text not null default '' check (char_length(description) <= 1000),
  niveau        smallint not null check (niveau between 1 and 5),
  departement_id text references public.ai_departments(id),
  outils        text[] not null default '{}',
  effort        text not null default 'medium' check (effort in ('low', 'medium', 'high')),
  personnalite  text check (personnalite is null or char_length(personnalite) <= 500),
  specialite    text check (specialite is null or char_length(specialite) <= 500),
  actif         boolean not null default true,
  updated_at    timestamptz not null default now()
);
insert into public.ai_roles(code, libelle, description, niveau, departement_id, outils, effort) values
  ('directeur_general', 'Directeur général IA', 'Coordonne l''organisation, reçoit les objectifs du président, crée et contrôle les missions.', 1, 'direction',
     array['creer_agent','modifier_agent','changer_etat_agent','assigner_mission','attendre_sous_taches','evaluer_tache','consulter_performance','convoquer_reunion','consulter_indicateurs','demander_ressources','repondre_president'], 'high'),
  ('directeur_commercial', 'Directeur commercial IA', 'Responsable de la performance commerciale : objectifs par logiciel, répartition, suivi des opportunités.', 2, 'direction',
     array['creer_agent','modifier_agent','changer_etat_agent','assigner_mission','attendre_sous_taches','evaluer_tache','consulter_performance','convoquer_reunion','consulter_indicateurs','demander_ressources','transmettre','lister_prospects','get_prospect','recommend_products','get_product','propose_commercial_action'], 'high'),
  ('directeur_administratif', 'Directeur administratif IA', 'Responsable de l''administration : facturation, encaissements, documents.', 2, 'administratif',
     array['creer_agent','modifier_agent','changer_etat_agent','assigner_mission','attendre_sous_taches','evaluer_tache','consulter_performance','consulter_indicateurs','convoquer_reunion','demander_ressources','transmettre'], 'high'),
  ('responsable_prospection', 'Responsable de la prospection', 'Coordonne les cellules commerciales : recherche, enrichissement, qualification, prise de contact.', 3, 'commercial',
     array['assigner_mission','attendre_sous_taches','evaluer_tache','consulter_performance','consulter_indicateurs','convoquer_reunion','demander_ressources','transmettre','lister_prospects','get_prospect','recommend_products','get_product','schedule_followup','escalate_to_human','propose_commercial_action'], 'medium'),
  ('superviseur_cellule', 'Superviseur de cellule', 'Supervise une cellule commerciale (un logiciel) : répartition des prospects, contrôle des argumentaires.', 4, 'commercial',
     array['assigner_mission','attendre_sous_taches','evaluer_tache','consulter_performance','transmettre','lister_prospects','get_prospect','get_product'], 'medium'),
  ('market_intelligence', 'Market Intelligence', 'Étudie les marchés, identifie les segments prioritaires et les arguments différenciants.', 3, 'intelligence',
     array['recherche_web','lister_prospects','transmettre'], 'medium'),
  ('lead_hunter', 'Lead Hunter', 'Identifie les entreprises susceptibles d''acheter un logiciel, distingue le vérifié du supposé, enregistre la source.', 5, 'commercial',
     array['recherche_web','create_prospect','transmettre'], 'medium'),
  ('lead_enrichment', 'Lead Enrichment', 'Enrichit les prospects du CRM : existence, activité, localisation, décideurs publics, sources et date de vérification. Ne jamais inventer.', 5, 'commercial',
     array['recherche_web','get_prospect','update_prospect','transmettre'], 'medium'),
  ('qualification', 'Qualification', 'Note le potentiel commercial sur 100 avec justification et choisit l''étape du pipeline.', 5, 'commercial',
     array['lister_prospects','get_prospect','update_prospect','set_stage','get_product','recommend_products','transmettre'], 'medium'),
  ('commercial_produit', 'Commercial produit', 'Transforme les informations en opportunités : besoins, argumentaire et démonstration d''un logiciel.', 5, 'commercial',
     array['lister_prospects','get_prospect','get_product','recommend_products','get_objection','schedule_followup','escalate_to_human','transmettre'], 'medium'),
  ('communication', 'Communication', 'Prépare les messages commerciaux personnalisés (WhatsApp, e-mail) ; envois soumis à la gouvernance.', 5, 'commercial',
     array['send_message','get_prospect','get_product','get_objection','schedule_followup','transmettre'], 'medium'),
  ('appointment_manager', 'Appointment Manager', 'Transforme l''intérêt en rendez-vous : créneaux, invitations, compte rendu.', 5, 'commercial',
     array['get_prospect','list_free_slots','book_appointment','record_appointment_report','schedule_followup','transmettre'], 'medium'),
  ('followup_manager', 'Follow-up Manager', 'Suit les opportunités : prospects sans réponse, relances, objections, cas sensibles.', 5, 'commercial',
     array['lister_prospects','get_prospect','schedule_followup','escalate_to_human','transmettre'], 'medium'),
  ('proposal_generator', 'Proposal Generator', 'Prépare les propositions commerciales depuis le catalogue et la grille tarifaire validée.', 5, 'commercial',
     array['get_prospect','get_product','recommend_products','create_offer','transmettre'], 'medium'),
  ('negotiation_manager', 'Negotiation Manager', 'Assiste la négociation : objections, offres, stratégie. Tout prix ou engagement reste soumis à validation.', 5, 'commercial',
     array['get_prospect','get_product','recommend_products','get_objection','create_offer','record_appointment_report','escalate_to_human','transmettre'], 'medium'),
  ('customer_success', 'Customer Success', 'Accompagne les clients après la vente : satisfaction, déploiement, extension, renouvellement.', 3, 'relation_client',
     array['lister_prospects','get_prospect','get_product','recommend_products','schedule_followup','transmettre'], 'medium'),
  ('sales_analyst', 'Sales Analyst', 'Mesure les performances commerciales : entonnoir, coûts, rentabilité.', 5, 'commercial',
     array['lister_prospects','get_prospect','transmettre'], 'low'),
  ('gestion_documents', 'Gestionnaire de documents', 'Prépare et contrôle les contrats et documents de commande.', 3, 'administratif',
     array['get_prospect','get_product','transmettre'], 'low')
on conflict (code) do nothing;

-- ─── 2. Rôle tenu par chaque agent ───────────────────────────────────────────
alter table public.ai_agents add column if not exists role_code text references public.ai_roles(code);
create index if not exists ai_agents_role on public.ai_agents(role_code) where role_code is not null;

-- ─── 3. Cellules (une par logiciel du catalogue) et leurs membres ────────────
create table if not exists public.ai_cells (
  id                   text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  nom                  text not null check (char_length(nom) between 2 and 120),
  product_id           text not null references public.ai_products(id),
  responsable_agent_id uuid references public.ai_agents(id) on delete set null,
  description          text check (description is null or char_length(description) <= 1000),
  actif                boolean not null default true,
  updated_at           timestamptz not null default now()
);
create unique index if not exists ai_cells_produit_actif on public.ai_cells(product_id) where actif;
create table if not exists public.ai_cell_members (
  cell_id   text not null references public.ai_cells(id) on delete cascade,
  role_code text not null references public.ai_roles(code),
  agent_id  uuid not null references public.ai_agents(id) on delete cascade,
  ordre     smallint not null default 0,
  primary key (cell_id, role_code, agent_id)
);
create index if not exists ai_cell_members_agent on public.ai_cell_members(agent_id);

-- Organisation PAR DÉFAUT (rôles des agents connus, trois cellules, membres) : relançable sans effet de bord, à relancer après seed_agents.sql.
-- La direction la modifie ensuite sans code (écran Paramétrage ou fonctions ai_cfg_*) ; relancer cette fonction ne retire jamais un choix déjà fait.
create or replace function public.ai_defaut_organisation() returns void
language plpgsql security definer set search_path = public, pg_temp as $f$
begin
update public.ai_agents a set role_code = m.role
  from (values
    ('sanix_ai_general_director', 'directeur_general'), ('sanix_ai_sales_director', 'directeur_commercial'), ('ia_dir_admin', 'directeur_administratif'),
    ('ia_resp_prospection', 'responsable_prospection'), ('ia_sup_immo', 'superviseur_cellule'), ('ia_sup_sante', 'superviseur_cellule'), ('ia_sup_distribution', 'superviseur_cellule'),
    ('ia_market', 'market_intelligence'), ('ia_hunter_1', 'lead_hunter'), ('ia_hunter_2', 'lead_hunter'), ('ia_hunter_3', 'lead_hunter'),
    ('ia_enrich_1', 'lead_enrichment'), ('ia_qualif_1', 'qualification'), ('ia_wa_1', 'communication'), ('ia_mail_1', 'communication'),
    ('ia_rdv_1', 'appointment_manager'), ('ia_nego_1', 'negotiation_manager'), ('ia_success', 'customer_success'), ('ia_docs', 'gestion_documents')
  ) m(code, role)
 where a.code = m.code and a.role_code is null;


-- Configuration par défaut des trois cellules (modifiable : aucun code ne s'y réfère). Les agents existants sont mutualisés.
insert into public.ai_cells(id, nom, product_id, responsable_agent_id, description)
select c.id, c.nom, c.product_id, (select a.id from public.ai_agents a where a.code = c.resp), c.descr
  from (values
    ('immosuite', 'Cellule ImmoSuite ERP', 'immosuite', 'ia_sup_immo', 'Professionnels de l''immobilier et du foncier'),
    ('aluexpert', 'Cellule menuiserie aluminium — AluExpert', 'aluexpert', 'ia_resp_prospection', 'Menuiseries aluminium, façades, vitrage, ateliers de transformation'),
    ('avicosuite', 'Cellule avicole — AvicoSuite', 'avicosuite', 'ia_resp_prospection', 'Exploitations avicoles : poulets de chair et pondeuses')
  ) c(id, nom, product_id, resp, descr)
 where exists (select 1 from public.ai_products p where p.id = c.product_id)
on conflict (id) do nothing;
insert into public.ai_cell_members(cell_id, role_code, agent_id, ordre)
select c.cell, c.role, a.id, c.ordre
  from (values
    ('immosuite', 'market_intelligence', 'ia_market', 0), ('immosuite', 'lead_hunter', 'ia_hunter_1', 0), ('immosuite', 'lead_enrichment', 'ia_enrich_1', 0),
    ('immosuite', 'qualification', 'ia_qualif_1', 0), ('immosuite', 'communication', 'ia_wa_1', 0), ('immosuite', 'communication', 'ia_mail_1', 1),
    ('immosuite', 'appointment_manager', 'ia_rdv_1', 0), ('immosuite', 'negotiation_manager', 'ia_nego_1', 0), ('immosuite', 'proposal_generator', 'ia_nego_1', 0),
    ('aluexpert', 'market_intelligence', 'ia_market', 0), ('aluexpert', 'lead_enrichment', 'ia_enrich_1', 0), ('aluexpert', 'qualification', 'ia_qualif_1', 0),
    ('aluexpert', 'communication', 'ia_wa_1', 0), ('aluexpert', 'communication', 'ia_mail_1', 1), ('aluexpert', 'appointment_manager', 'ia_rdv_1', 0),
    ('aluexpert', 'negotiation_manager', 'ia_nego_1', 0), ('aluexpert', 'proposal_generator', 'ia_nego_1', 0),
    ('avicosuite', 'market_intelligence', 'ia_market', 0), ('avicosuite', 'lead_enrichment', 'ia_enrich_1', 0), ('avicosuite', 'qualification', 'ia_qualif_1', 0),
    ('avicosuite', 'communication', 'ia_wa_1', 0), ('avicosuite', 'communication', 'ia_mail_1', 1), ('avicosuite', 'appointment_manager', 'ia_rdv_1', 0),
    ('avicosuite', 'negotiation_manager', 'ia_nego_1', 0), ('avicosuite', 'proposal_generator', 'ia_nego_1', 0)
  ) c(cell, role, agent, ordre)
  join public.ai_agents a on a.code = c.agent
 where exists (select 1 from public.ai_cells x where x.id = c.cell)
on conflict do nothing;

end $f$;
revoke all on function public.ai_defaut_organisation() from public, anon, authenticated;
select public.ai_defaut_organisation();

-- ─── 4. Résolution : qui tient ce rôle pour ce logiciel ? ────────────────────
create or replace function public.ai_agent_for(p_product text, p_role text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select x.agent_id from (
    select m.agent_id, 0 as rang, m.ordre
      from public.ai_cells c join public.ai_cell_members m on m.cell_id = c.id
     where c.actif and c.product_id = p_product and m.role_code = p_role
    union all
    select a.id, 1, 0 from public.ai_agents a where a.role_code = p_role          -- repli : tout agent portant ce rôle
  ) x join public.ai_agents a on a.id = x.agent_id
 where a.etat = 'actif' and a.archived_at is null and p_role is not null
 order by x.rang, x.ordre, a.created_at
 limit 1
$$;

-- ─── 5. Routage CRM ↔ IA par rôle (le code d'agent historique reste en repli) ─
alter table public.crm_ai_routing add column if not exists role_code text references public.ai_roles(code);
alter table public.crm_ai_routing alter column agent_code drop not null;
alter table public.crm_ai_stage_owner add column if not exists role_code text references public.ai_roles(code);
alter table public.crm_ai_stage_owner alter column agent_code drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.crm_ai_routing'::regclass and conname = 'crm_ai_routing_cible') then
    alter table public.crm_ai_routing add constraint crm_ai_routing_cible check (agent_code is not null or role_code is not null);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.crm_ai_stage_owner'::regclass and conname = 'crm_ai_stage_owner_cible') then
    alter table public.crm_ai_stage_owner add constraint crm_ai_stage_owner_cible check (agent_code is not null or role_code is not null);
  end if;
end $$;
update public.crm_ai_routing r set role_code = m.role
  from (values ('ia_qualif_1', 'qualification'), ('ia_success', 'customer_success'), ('ia_docs', 'gestion_documents'), ('ia_rdv_1', 'appointment_manager'), ('ia_dir_admin', 'directeur_administratif')) m(code, role)
 where r.agent_code = m.code and r.role_code is null;
update public.crm_ai_stage_owner r set role_code = m.role
  from (values ('ia_qualif_1', 'qualification'), ('ia_success', 'customer_success'), ('ia_docs', 'gestion_documents'), ('ia_rdv_1', 'appointment_manager'),
               ('ia_dir_admin', 'directeur_administratif'), ('ia_mail_1', 'communication'), ('ia_nego_1', 'negotiation_manager')) m(code, role)
 where r.agent_code = m.code and r.role_code is null;

-- Propriétaire de l'étape : l'agent qui tient le rôle dans la cellule du logiciel du prospect.
create or replace function public.crm_prospect_owner() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    select coalesce(public.ai_agent_for(new.produits_recommandes[1], o.role_code),
                    (select a.id from public.ai_agents a where a.code = o.agent_code and a.archived_at is null and a.etat <> 'archive'))
      into v_id from public.crm_ai_stage_owner o where o.stage = new.stage;
    if v_id is not null then new.agent_id := v_id; end if;
  end if;
  return new;
end $$;

-- Routage d'un événement du CRM : même résolution par rôle et par logiciel.
create or replace function public.crm_h_crm_event(ev public.crm_ai_events) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  rt public.crm_ai_routing; rec public.crm_records; p public.ai_prospects; v_client text; v_vars jsonb; v_task uuid; a public.ai_agents; v_data jsonb; v_inter jsonb; v_code text;
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
  -- l'identifiant du prospect figure dans la consigne : le moteur l'ajoute au périmètre de l'agent (sans lui, l'agent ne pourrait pas agir sur le dossier)
  -- paramétrage : l'agent est celui qui porte le rôle dans la cellule du logiciel du dossier (repli : agent de tout rôle équivalent, puis code historique)
  v_code := coalesce((select ag.code from public.ai_agents ag where ag.id = public.ai_agent_for(coalesce(public.ai_product_of(v_data->>'logiciel'), p.produits_recommandes[1]), rt.role_code)), rt.agent_code);
  v_task := public.crm_make_task(v_code, rt.task_type, public.crm_tpl(rt.titre_tpl, v_vars),
              public.crm_tpl(rt.desc_tpl, v_vars) || case when p.id is not null then E'\n\nDossier SANIX AI : prospect_id = ' || p.id else '' end, rt.priorite, rt.echeance_h, p.id, ev.id);
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


-- ─── 6. Lecture par les opérateurs ; écriture uniquement par les fonctions d'administration ci-dessous ───
do $$ declare t text; begin
  foreach t in array array['ai_roles', 'ai_cells', 'ai_cell_members'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists cfg_read on public.%I', t);
    execute format('create policy cfg_read on public.%I for select to authenticated using (public.ai_is_operator())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ─── 7. Fonctions d'administration (direction seule, journalisées) ───────────
create or replace function public.ai_cfg_check() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
end $$;
create or replace function public.ai_cfg_audit(p_action text, p_payload jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.ai_actions(agent, action, payload) values ('operateur', p_action, coalesce(p_payload, '{}'::jsonb))
$$;
create or replace function public.ai_cfg_arr(j jsonb, p_max int default 40, p_len int default 200) returns text[]
language sql immutable as $$
  select coalesce(array(select left(btrim(x), p_len) from jsonb_array_elements_text(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end) x
                         where btrim(x) <> '' limit p_max), '{}'::text[])
$$;

-- Logiciel du catalogue : création (inactive par défaut : jamais proposée avant activation) ou modification.
create or replace function public.ai_cfg_save_product(p_id text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id text := lower(btrim(coalesce(p_id, ''))); cur public.ai_products;
begin
  perform public.ai_cfg_check();
  if v_id !~ '^[a-z0-9_]{2,40}$' then raise exception 'Identifiant de logiciel invalide (a-z, 0-9 et _ ; 2 à 40 caractères)' using errcode = '22023'; end if;
  select * into cur from public.ai_products where id = v_id;
  if cur.id is null then
    if btrim(coalesce(p->>'nom', '')) = '' or btrim(coalesce(p->>'marche_cible', '')) = '' then
      raise exception 'Nom et marché cible obligatoires pour un nouveau logiciel' using errcode = '22023';
    end if;
    insert into public.ai_products(id, nom, marche_cible, secteurs, mots_cles, fonctionnalites, questions_decouverte, argumentaire, demo_url, video_url, brochure_url, actif)
    values (v_id, left(btrim(p->>'nom'), 120), left(btrim(p->>'marche_cible'), 300), public.ai_cfg_arr(p->'secteurs', 30, 80), public.ai_cfg_arr(p->'mots_cles', 40, 80),
            public.ai_cfg_arr(p->'fonctionnalites', 60, 300), public.ai_cfg_arr(p->'questions_decouverte', 20, 300), left(p->>'argumentaire', 4000),
            nullif(btrim(p->>'demo_url'), ''), nullif(btrim(p->>'video_url'), ''), nullif(btrim(p->>'brochure_url'), ''), coalesce((p->>'actif')::boolean, false));
  else
    update public.ai_products set
      nom = case when p ? 'nom' and btrim(p->>'nom') <> '' then left(btrim(p->>'nom'), 120) else nom end,
      marche_cible = case when p ? 'marche_cible' and btrim(p->>'marche_cible') <> '' then left(btrim(p->>'marche_cible'), 300) else marche_cible end,
      secteurs = case when p ? 'secteurs' then public.ai_cfg_arr(p->'secteurs', 30, 80) else secteurs end,
      mots_cles = case when p ? 'mots_cles' then public.ai_cfg_arr(p->'mots_cles', 40, 80) else mots_cles end,
      fonctionnalites = case when p ? 'fonctionnalites' then public.ai_cfg_arr(p->'fonctionnalites', 60, 300) else fonctionnalites end,
      questions_decouverte = case when p ? 'questions_decouverte' then public.ai_cfg_arr(p->'questions_decouverte', 20, 300) else questions_decouverte end,
      argumentaire = case when p ? 'argumentaire' then left(p->>'argumentaire', 4000) else argumentaire end,
      demo_url = case when p ? 'demo_url' then nullif(btrim(p->>'demo_url'), '') else demo_url end,
      video_url = case when p ? 'video_url' then nullif(btrim(p->>'video_url'), '') else video_url end,
      brochure_url = case when p ? 'brochure_url' then nullif(btrim(p->>'brochure_url'), '') else brochure_url end,
      actif = case when p ? 'actif' then (p->>'actif')::boolean else actif end,
      updated_at = now()
     where id = v_id;
  end if;
  perform public.ai_cfg_audit('cfg_logiciel', jsonb_build_object('id', v_id, 'champs', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p) k)));
  return (select jsonb_build_object('ok', true, 'id', x.id, 'actif', x.actif, 'tarif_officiel', exists (select 1 from public.ai_pricing t where t.product_id = x.id and t.actif))
            from public.ai_products x where x.id = v_id);
end $$;

-- Équivalences de noms (nom du logiciel dans le CRM → logiciel du catalogue).
create or replace function public.ai_cfg_set_alias(p_alias text, p_product text, p_on boolean default true) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_alias text := lower(btrim(coalesce(p_alias, '')));
begin
  perform public.ai_cfg_check();
  if v_alias = '' then raise exception 'Nom à faire correspondre obligatoire' using errcode = '22023'; end if;
  if p_on then
    insert into public.ai_product_aliases(alias, product_id) values (v_alias, p_product) on conflict (alias) do update set product_id = excluded.product_id;
  else
    delete from public.ai_product_aliases where alias = v_alias;
  end if;
  perform public.ai_cfg_audit('cfg_alias', jsonb_build_object('alias', v_alias, 'produit', p_product, 'actif', p_on));
  return jsonb_build_object('ok', true);
end $$;

-- Rôle (modèle de poste).
create or replace function public.ai_cfg_save_role(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text := lower(btrim(coalesce(p->>'code', ''))); cur public.ai_roles;
begin
  perform public.ai_cfg_check();
  if v_code !~ '^[a-z0-9_]{3,40}$' then raise exception 'Code de rôle invalide (a-z, 0-9 et _ ; 3 à 40 caractères)' using errcode = '22023'; end if;
  select * into cur from public.ai_roles where code = v_code;
  if cur.code is null then
    if btrim(coalesce(p->>'libelle', '')) = '' or (p->>'niveau') is null then raise exception 'Libellé et niveau obligatoires pour un nouveau rôle' using errcode = '22023'; end if;
    insert into public.ai_roles(code, libelle, description, niveau, departement_id, outils, effort, personnalite, specialite, actif)
    values (v_code, left(btrim(p->>'libelle'), 120), left(coalesce(p->>'description', ''), 1000), (p->>'niveau')::smallint, nullif(p->>'departement_id', ''),
            public.ai_cfg_arr(p->'outils', 40, 60), coalesce(nullif(p->>'effort', ''), 'medium'), nullif(left(p->>'personnalite', 500), ''), nullif(left(p->>'specialite', 500), ''),
            coalesce((p->>'actif')::boolean, true));
  else
    update public.ai_roles set
      libelle = case when p ? 'libelle' and btrim(p->>'libelle') <> '' then left(btrim(p->>'libelle'), 120) else libelle end,
      description = case when p ? 'description' then left(coalesce(p->>'description', ''), 1000) else description end,
      niveau = case when p ? 'niveau' then (p->>'niveau')::smallint else niveau end,
      departement_id = case when p ? 'departement_id' then nullif(p->>'departement_id', '') else departement_id end,
      outils = case when p ? 'outils' then public.ai_cfg_arr(p->'outils', 40, 60) else outils end,
      effort = case when p ? 'effort' then p->>'effort' else effort end,
      personnalite = case when p ? 'personnalite' then nullif(left(p->>'personnalite', 500), '') else personnalite end,
      specialite = case when p ? 'specialite' then nullif(left(p->>'specialite', 500), '') else specialite end,
      actif = case when p ? 'actif' then (p->>'actif')::boolean else actif end,
      updated_at = now()
     where code = v_code;
  end if;
  perform public.ai_cfg_audit('cfg_role', jsonb_build_object('code', v_code));
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

-- Cellule (un logiciel du catalogue).
create or replace function public.ai_cfg_save_cell(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id text := lower(btrim(coalesce(p->>'id', ''))); cur public.ai_cells;
begin
  perform public.ai_cfg_check();
  if v_id !~ '^[a-z0-9_]{2,40}$' then raise exception 'Identifiant de cellule invalide (a-z, 0-9 et _ ; 2 à 40 caractères)' using errcode = '22023'; end if;
  select * into cur from public.ai_cells where id = v_id;
  if cur.id is null then
    if btrim(coalesce(p->>'nom', '')) = '' or coalesce(p->>'product_id', '') = '' then raise exception 'Nom et logiciel obligatoires pour une nouvelle cellule' using errcode = '22023'; end if;
    insert into public.ai_cells(id, nom, product_id, responsable_agent_id, description, actif)
    values (v_id, left(btrim(p->>'nom'), 120), p->>'product_id', nullif(p->>'responsable_agent_id', '')::uuid, nullif(left(p->>'description', 1000), ''), coalesce((p->>'actif')::boolean, true));
  else
    update public.ai_cells set
      nom = case when p ? 'nom' and btrim(p->>'nom') <> '' then left(btrim(p->>'nom'), 120) else nom end,
      product_id = case when p ? 'product_id' and coalesce(p->>'product_id', '') <> '' then p->>'product_id' else product_id end,
      responsable_agent_id = case when p ? 'responsable_agent_id' then nullif(p->>'responsable_agent_id', '')::uuid else responsable_agent_id end,
      description = case when p ? 'description' then nullif(left(p->>'description', 1000), '') else description end,
      actif = case when p ? 'actif' then (p->>'actif')::boolean else actif end,
      updated_at = now()
     where id = v_id;
  end if;
  perform public.ai_cfg_audit('cfg_cellule', jsonb_build_object('id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Membre d'une cellule : qui tient quel rôle.
create or replace function public.ai_cfg_set_member(p_cell text, p_role text, p_agent uuid, p_on boolean default true, p_ordre smallint default 0) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.ai_cfg_check();
  if p_on then
    insert into public.ai_cell_members(cell_id, role_code, agent_id, ordre) values (p_cell, p_role, p_agent, coalesce(p_ordre, 0))
    on conflict (cell_id, role_code, agent_id) do update set ordre = excluded.ordre;
  else
    delete from public.ai_cell_members where cell_id = p_cell and role_code = p_role and agent_id = p_agent;
  end if;
  perform public.ai_cfg_audit('cfg_membre', jsonb_build_object('cellule', p_cell, 'role', p_role, 'agent', p_agent, 'actif', p_on));
  return jsonb_build_object('ok', true);
end $$;

-- Création d'un agent depuis un rôle (modèle de poste) ; tout champ du modèle est modifiable à la création.
create or replace function public.ai_cfg_create_agent(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  r public.ai_roles; m public.ai_agents; v_nom text := btrim(coalesce(p->>'nom', '')); v_fonction text; v_dept text; v_niveau smallint; v_outils text[]; v_c jsonb := coalesce(p->'charte', '{}'::jsonb);
  v_code text; v_base text; v_i int := 1; v_id uuid;
begin
  perform public.ai_cfg_check();
  select * into r from public.ai_roles where code = p->>'role_code' and actif;
  if r.code is null then raise exception 'Rôle inconnu ou inactif' using errcode = '22023'; end if;
  if char_length(v_nom) < 2 then raise exception 'Nom obligatoire' using errcode = '22023'; end if;
  v_fonction := coalesce(nullif(btrim(p->>'fonction'), ''), r.libelle);
  v_dept := coalesce(nullif(p->>'departement_id', ''), r.departement_id);
  v_niveau := coalesce((p->>'niveau')::smallint, r.niveau);
  v_outils := case when p ? 'outils' then public.ai_cfg_arr(p->'outils', 40, 60) else r.outils end;
  if v_niveau > 1 then
    select * into m from public.ai_agents where id = nullif(p->>'manager_id', '')::uuid and archived_at is null;
    if m.id is null then raise exception 'Responsable (manager_id) obligatoire et existant' using errcode = '22023'; end if;
  end if;
  v_base := left('ia_' || trim(both '_' from regexp_replace(lower(unaccent(v_nom)), '[^a-z0-9]+', '_', 'g')), 50);
  v_code := v_base;
  while exists (select 1 from public.ai_agents where code = v_code) loop v_i := v_i + 1; v_code := v_base || '_' || v_i; end loop;
  insert into public.ai_agents(code, nom, fonction, departement_id, manager_id, niveau, personnalite, specialite, outils, effort, etat, budget_jour_usd, role_code, cree_par_user, avatar)
  values (v_code, left(v_nom, 80), left(v_fonction, 120), v_dept, m.id, v_niveau, coalesce(nullif(left(p->>'personnalite', 500), ''), r.personnalite), coalesce(nullif(left(p->>'specialite', 500), ''), r.specialite),
          v_outils, coalesce(nullif(p->>'effort', ''), r.effort), 'actif', nullif(p->>'budget_jour_usd', '')::numeric, r.code, auth.uid(), '{}'::jsonb)
  returning id into v_id;
  insert into public.ai_agent_charters(agent_id, version, contenu, motif, redige_par_user)
  values (v_id, 1, jsonb_build_object(
    'identite', left(v_nom, 80) || ' — ' || v_fonction || ', collaborateur IA de SANIX AI VIRTUAL COMPANY',
    'fonction', v_fonction, 'departement', (select d.nom from public.ai_departments d where d.id = v_dept),
    'mission_principale', coalesce(nullif(btrim(v_c->>'mission_principale'), ''), nullif(r.description, ''), v_fonction),
    'missions_secondaires', coalesce(v_c->'missions_secondaires', '[]'::jsonb), 'competences', coalesce(v_c->'competences', '[]'::jsonb),
    'outils', to_jsonb(v_outils), 'donnees', coalesce(v_c->'donnees', '["Prospects et données du CRM"]'::jsonb),
    'objectifs', coalesce(v_c->'objectifs', '["Atteindre les objectifs fixés dans chaque mission"]'::jsonb),
    'delais', coalesce(nullif(btrim(v_c->>'delais'), ''), 'Selon l''échéance de chaque mission'),
    'indicateurs', coalesce(v_c->'indicateurs', '["Missions terminées avec résultat", "Coût IA par mission"]'::jsonb),
    'procedures', coalesce(v_c->'procedures', '[]'::jsonb),
    'limites', coalesce(v_c->'limites', '["Aucun engagement financier, juridique ou contractuel", "Aucun envoi externe sans validation", "Aucune information inventée"]'::jsonb),
    'responsable', coalesce(m.nom || ' — ' || m.fonction, 'Direction'),
    'reporting', coalesce(nullif(btrim(v_c->>'reporting'), ''), 'Rapport de fin de mission : réalisé, chiffres, difficultés, suites')),
    'Création par la direction', auth.uid());
  if nullif(p->>'cell_id', '') is not null then
    insert into public.ai_cell_members(cell_id, role_code, agent_id) values (p->>'cell_id', r.code, v_id) on conflict do nothing;
  end if;
  perform public.ai_cfg_audit('cfg_agent_cree', jsonb_build_object('code', v_code, 'role', r.code));
  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code);
end $$;

-- Modification d'un agent : poste, rattachement, outils, effort, budget. Les outils modifiés produisent une nouvelle version de la charte.
create or replace function public.ai_cfg_update_agent(p_agent uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.ai_agents; v_outils_avant text[];
begin
  perform public.ai_cfg_check();
  select * into a from public.ai_agents where id = p_agent for update;
  if a.id is null then raise exception 'Agent introuvable' using errcode = 'P0002'; end if;
  if a.niveau = 1 and (p ? 'manager_id' or p ? 'niveau') then raise exception 'Le directeur général ne peut pas être rattaché à un responsable' using errcode = '22023'; end if;
  v_outils_avant := a.outils;
  update public.ai_agents set
    nom = case when p ? 'nom' and char_length(btrim(p->>'nom')) >= 2 then left(btrim(p->>'nom'), 80) else nom end,
    fonction = case when p ? 'fonction' and char_length(btrim(p->>'fonction')) >= 2 then left(btrim(p->>'fonction'), 120) else fonction end,
    manager_id = case when p ? 'manager_id' then nullif(p->>'manager_id', '')::uuid else manager_id end,
    niveau = case when p ? 'niveau' then (p->>'niveau')::smallint else niveau end,
    departement_id = case when p ? 'departement_id' then p->>'departement_id' else departement_id end,
    outils = case when p ? 'outils' then public.ai_cfg_arr(p->'outils', 40, 60) else outils end,
    effort = case when p ? 'effort' then p->>'effort' else effort end,
    budget_jour_usd = case when p ? 'budget_jour_usd' then nullif(p->>'budget_jour_usd', '')::numeric else budget_jour_usd end,
    role_code = case when p ? 'role_code' then nullif(p->>'role_code', '') else role_code end,
    personnalite = case when p ? 'personnalite' then nullif(left(p->>'personnalite', 500), '') else personnalite end,
    specialite = case when p ? 'specialite' then nullif(left(p->>'specialite', 500), '') else specialite end
   where id = p_agent returning * into a;
  if a.outils is distinct from v_outils_avant then
    insert into public.ai_agent_charters(agent_id, version, contenu, motif, redige_par_user)
    select c.agent_id, c.version + 1, c.contenu || jsonb_build_object('outils', to_jsonb(a.outils)), 'Outils modifiés par la direction', auth.uid()
      from public.ai_agent_charters c where c.agent_id = p_agent order by c.version desc limit 1;
  end if;
  perform public.ai_cfg_audit('cfg_agent_modifie', jsonb_build_object('code', a.code, 'champs', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p) k)));
  return jsonb_build_object('ok', true, 'id', a.id, 'code', a.code);
end $$;

-- ─── 8. Droits ───────────────────────────────────────────────────────────────
revoke all on function public.ai_cfg_check(), public.ai_cfg_audit(text, jsonb), public.ai_cfg_arr(jsonb, int, int) from public, anon, authenticated;
revoke all on function public.ai_cfg_save_product(text, jsonb), public.ai_cfg_set_alias(text, text, boolean), public.ai_cfg_save_role(jsonb), public.ai_cfg_save_cell(jsonb),
  public.ai_cfg_set_member(text, text, uuid, boolean, smallint), public.ai_cfg_create_agent(jsonb), public.ai_cfg_update_agent(uuid, jsonb), public.ai_agent_for(text, text) from public, anon;
grant execute on function public.ai_cfg_save_product(text, jsonb), public.ai_cfg_set_alias(text, text, boolean), public.ai_cfg_save_role(jsonb), public.ai_cfg_save_cell(jsonb),
  public.ai_cfg_set_member(text, text, uuid, boolean, smallint), public.ai_cfg_create_agent(jsonb), public.ai_cfg_update_agent(uuid, jsonb) to authenticated;
grant execute on function public.ai_agent_for(text, text) to authenticated, service_role;


-- ═══ 20261115000000_phase3_pilote.sql ═══
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
insert into public.ai_segment_rules(priorite, champ, motif, segment, note) values
  (10, 'secteur',    'immobilier|foncier|promotion', 'immosuite', 'Secteur immobilier ou foncier'),
  (20, 'entreprise', '\malu|menuiser|vitr(erie|age)|miroiter|facade|fenetre|baie vitree|charpente metal|metallerie', 'aluexpert', 'Nom évoquant l''aluminium, la menuiserie, la vitrerie ou la métallerie'),
  (30, 'entreprise', 'avic|poulet|poule|pondeuse|volaille|couvoir|provende|oeuf', 'avicosuite', 'Nom évoquant l''aviculture'),
  (31, 'secteur',    'avicult|avicole|elevage', 'avicosuite', 'Secteur avicole ou élevage'),
  (90, 'secteur',    'sante|logisti|livraison|transport|distribution|pharma|clinique', 'hors_perimetre', 'Secteurs sans logiciel du périmètre commercial actuel'),
  (95, 'secteur',    'industrie', 'a_verifier', 'Industrie sans indice d''activité : à confirmer par l''enrichissement (jamais forcé)')
on conflict (champ, motif, segment) do nothing;
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

-- ═══ 20261116000000_unifier_avicosuite_angels_agro.sql ═══
-- ═════════════════════════════════════════════════════════════════════════════
--  SANIX AI — AvicoSuite = Angel's Agro (un seul logiciel, deux noms)
--  Le CRM vend l'ERP avicole sous le nom « Angel's Agro » (anciennement « AviNest Pro ») ; SANIX AI le gère sous « AvicoSuite ».
--  1. Les noms utilisés dans le CRM sont rattachés à AvicoSuite (chiffre d'affaires par logiciel, routage des missions).
--  2. La fiche AvicoSuite reprend les fonctionnalités réelles du catalogue du CRM (aucune donnée inventée).
--  Additif et relançable ; ne modifie ni les prix ni le statut du logiciel.
-- ═════════════════════════════════════════════════════════════════════════════

do $$ begin
  if to_regclass('public.ai_product_aliases') is null then
    raise exception 'Appliquer d''abord la migration 20261113 (Phase 2)' using errcode = '55000';
  end if;
end $$;

insert into public.ai_product_aliases(alias, product_id)
select v.alias, 'avicosuite' from (values
  ('angel''s agro'), ('angels agro'), ('angel agro')
) v(alias)
where exists (select 1 from public.ai_products where id = 'avicosuite')
on conflict (alias) do update set product_id = excluded.product_id;

-- Fonctionnalités : modules du logiciel « Angel's Agro » du catalogue du CRM (index.html, id log_angels_agro). Ne remplace pas une liste déjà renseignée.
update public.ai_products set
  fonctionnalites = array['Lots et élevage', 'Suivi quotidien (mortalité, aliment, eau, pesée, œufs)', 'Prophylaxie avec délai d''attente bloquant la vente',
                          'Programme nutritionnel par souche', 'Couvoir', 'Conditionnement des œufs', 'Stock et fabrication d''aliment', 'Achats',
                          'Ventes et créances', 'Trésorerie et rentabilité par lot', 'Comptabilité SYSCOHADA', 'Rapports WhatsApp', 'Application hors ligne (PWA)'],
  updated_at = now()
 where id = 'avicosuite' and coalesce(cardinality(fonctionnalites), 0) = 0;

-- ═══ 20261117000000_angels_livraison_quatrieme_logiciel.sql ═══
-- ═════════════════════════════════════════════════════════════════════════════
--  SANIX AI — Angel's Livraison devient le 4ᵉ logiciel commercial (décision de la direction : plus d'opportunité sur la livraison)
--  Périmètre : ImmoSuite ERP, Sanix AluExpert, AvicoSuite (= Angel's Agro) et Angel's Livraison. Angel's Transport reste hors périmètre.
--  Additif et relançable. Aucune donnée inventée : fonctionnalités et prix viennent du catalogue du CRM et de la grille officielle (ai_pricing).
--  1. Fiche : le produit `angels` (suspendu, trop large) devient « Angel's Livraison » (livraison à moto, coursiers, messagerie) et est activé.
--  2. Noms du CRM rattachés au logiciel (chiffre d'affaires par logiciel, routage des missions).
--  3. Règle de segmentation : secteur logistique / livraison / coursier / messagerie / expédition → angels (avant la règle « hors périmètre »).
--  4. Cellule dédiée, avec les mêmes agents partagés que les cellules AluExpert et AvicoSuite (aucun agent supplémentaire à activer).
-- ═════════════════════════════════════════════════════════════════════════════

do $$ begin
  if to_regprocedure('public.ai_segment_of(public.ai_prospects)') is null or to_regclass('public.ai_cells') is null then
    raise exception 'Appliquer d''abord les migrations 20261114 (paramétrage) et 20261115 (Phase 3)' using errcode = '55000';
  end if;
end $$;

-- 1. Fiche du logiciel
update public.ai_products set
  nom = 'Angel''s Livraison',
  marche_cible = 'Livraison à moto, coursiers, messagerie et expédition',
  secteurs = array['livraison', 'logistique', 'expédition', 'coursier', 'messagerie'],
  fonctionnalites = case when coalesce(cardinality(fonctionnalites), 0) = 0 then array[
    'Clients et adresses', 'Commandes à 12 statuts', 'Centre de livraison et affectation', 'Tournées multi-livraisons',
    'Application livreur mobile avec carte et GPS', 'Preuve de livraison par code et signature', 'Paiement à la livraison et reversement',
    'Commissions des livreurs', 'Rentabilité par livreur, zone et moto', 'Entretien des motos', 'Vendeurs partenaires', 'Étiquettes QR',
    'Notifications WhatsApp', 'Application hors ligne (PWA)'] else fonctionnalites end,
  actif = true,
  updated_at = now()
 where id = 'angels';

-- 2. Noms du CRM
insert into public.ai_product_aliases(alias, product_id)
select v.alias, 'angels' from (values ('angel''s livraison'), ('angels livraison'), ('angel livraison')) v(alias)
where exists (select 1 from public.ai_products where id = 'angels')
on conflict (alias) do update set product_id = excluded.product_id;

-- 3. Règle de segmentation (la priorité 85 passe avant la règle 90 « hors périmètre »)
insert into public.ai_segment_rules(priorite, champ, motif, segment, note)
select 85, 'secteur', 'logisti|livraison|coursier|messagerie|expedition', 'angels', 'Secteur de la livraison et de la logistique : Angel''s Livraison'
where exists (select 1 from public.ai_products where id = 'angels')
on conflict (champ, motif, segment) do nothing;

-- 4. Cellule Angel's Livraison (mêmes agents partagés que AvicoSuite)
insert into public.ai_cells(id, nom, product_id, responsable_agent_id, description)
select 'angels', 'Cellule livraison — Angel''s Livraison', 'angels', (select a.id from public.ai_agents a where a.code = 'ia_resp_prospection'),
       'Entreprises de livraison à moto, coursiers, messagerie et expédition'
 where exists (select 1 from public.ai_products where id = 'angels')
on conflict (id) do nothing;
insert into public.ai_cell_members(cell_id, role_code, agent_id, ordre)
select 'angels', c.role, a.id, c.ordre
  from (values
    ('market_intelligence', 'ia_market', 0), ('lead_enrichment', 'ia_enrich_1', 0), ('qualification', 'ia_qualif_1', 0),
    ('communication', 'ia_wa_1', 0), ('communication', 'ia_mail_1', 1), ('appointment_manager', 'ia_rdv_1', 0),
    ('negotiation_manager', 'ia_nego_1', 0), ('proposal_generator', 'ia_nego_1', 0)
  ) c(role, agent, ordre)
  join public.ai_agents a on a.code = c.agent
 where exists (select 1 from public.ai_cells x where x.id = 'angels')
on conflict do nothing;

-- ═══ 20261118000000_references_clients.sql ═══
-- ═════════════════════════════════════════════════════════════════════════════
--  SANIX AI — Références clients par logiciel (citables seulement sur feu vert de la direction)
--  Les agents n'ont le droit de nommer à un prospect QUE les références marquées « citables » (accord du client à citer). Par défaut : internes.
--  1. ai_product_references : un client par logiciel, citable = false tant que la direction n'a pas donné son feu vert (date et auteur conservés).
--  2. ai_cfg_save_reference / ai_cfg_delete_reference : direction seule, journalisées.
--  3. Références de départ fournies par la direction (non citables) : ImmoSuite = Zahara Multiservices, Menko Holding ; AluExpert = 100% INOX, Beda Alu ;
--     AvicoSuite = Ferme Jolan. Ce sont des clients réels du CRM ; aucune performance ni témoignage n'est inventé.
--  Additif et relançable.
-- ═════════════════════════════════════════════════════════════════════════════

do $$ begin
  if to_regprocedure('public.ai_cfg_check()') is null then
    raise exception 'Appliquer d''abord la migration 20261114 (paramétrage)' using errcode = '55000';
  end if;
end $$;

create table if not exists public.ai_product_references (
  id         uuid primary key default gen_random_uuid(),
  product_id text not null references public.ai_products(id) on delete cascade,
  client     text not null check (char_length(btrim(client)) between 2 and 120),
  note       text check (note is null or char_length(note) <= 300),
  citable    boolean not null default false,
  citable_le timestamptz,
  citable_par uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists ai_product_references_uniq on public.ai_product_references(product_id, lower(btrim(client)));
alter table public.ai_product_references enable row level security;
drop policy if exists ref_read on public.ai_product_references;
create policy ref_read on public.ai_product_references for select to authenticated using (public.ai_is_operator());
revoke all on public.ai_product_references from anon;
revoke insert, update, delete, truncate on public.ai_product_references from authenticated;
grant select on public.ai_product_references to authenticated;

-- Création ou modification (p : id optionnel, product_id, client, note, citable). Le feu vert (citable) est daté et signé.
create or replace function public.ai_cfg_save_reference(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_cit boolean; r public.ai_product_references;
begin
  perform public.ai_cfg_check();
  if v_id is null then
    if not exists (select 1 from public.ai_products where id = p->>'product_id') then raise exception 'Logiciel inconnu' using errcode = '22023'; end if;
    v_cit := coalesce((p->>'citable')::boolean, false);
    insert into public.ai_product_references(product_id, client, note, citable, citable_le, citable_par)
    values (p->>'product_id', btrim(p->>'client'), nullif(left(p->>'note', 300), ''), v_cit, case when v_cit then now() end, case when v_cit then auth.uid() end)
    returning * into r;
  else
    select * into r from public.ai_product_references where id = v_id;
    if r.id is null then raise exception 'Référence introuvable' using errcode = 'P0002'; end if;
    v_cit := coalesce((p->>'citable')::boolean, r.citable);
    update public.ai_product_references set
      client = case when p ? 'client' then btrim(p->>'client') else client end,
      note = case when p ? 'note' then nullif(left(p->>'note', 300), '') else note end,
      citable = v_cit,
      citable_le = case when v_cit and not r.citable then now() when not v_cit then null else citable_le end,
      citable_par = case when v_cit and not r.citable then auth.uid() when not v_cit then null else citable_par end
     where id = v_id returning * into r;
  end if;
  perform public.ai_cfg_audit('cfg_reference', jsonb_build_object('id', r.id, 'produit', r.product_id, 'client', r.client, 'citable', r.citable));
  return jsonb_build_object('ok', true, 'id', r.id, 'citable', r.citable);
end $$;

create or replace function public.ai_cfg_delete_reference(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.ai_product_references;
begin
  perform public.ai_cfg_check();
  delete from public.ai_product_references where id = p_id returning * into r;
  if r.id is null then raise exception 'Référence introuvable' using errcode = 'P0002'; end if;
  perform public.ai_cfg_audit('cfg_reference_supprimee', jsonb_build_object('produit', r.product_id, 'client', r.client));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.ai_cfg_save_reference(jsonb), public.ai_cfg_delete_reference(uuid) from public, anon;
grant execute on function public.ai_cfg_save_reference(jsonb), public.ai_cfg_delete_reference(uuid) to authenticated;

-- Références de départ (internes : citable = false)
insert into public.ai_product_references(product_id, client, note)
select v.product_id, v.client, v.note
  from (values
    ('immosuite', 'Zahara Multiservices', 'Client actuel d''ImmoSuite ERP'),
    ('immosuite', 'Menko Holding', 'Client actuel d''ImmoSuite ERP'),
    ('aluexpert', '100% INOX', 'Client actuel de Sanix AluExpert ERP'),
    ('aluexpert', 'Beda Alu', 'Client actuel de Sanix AluExpert ERP'),
    ('avicosuite', 'Ferme Jolan', 'Client actuel d''AvicoSuite (ex-AviNest Pro)')
  ) v(product_id, client, note)
 where exists (select 1 from public.ai_products p where p.id = v.product_id)
on conflict do nothing;
