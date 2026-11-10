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
