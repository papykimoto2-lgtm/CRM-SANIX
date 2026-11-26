-- ═══ Module TERRAIN : prospection physique des commerciaux ═══════════════════════════════════════════
-- Feuille de route (tournée + étapes sur prospects du CRM), géolocalisation PENDANT la tournée seulement et avec consentement,
-- vérification de présence chez le prospect, rapport de mission à la direction, indicateurs par commercial.
-- Vie privée : aucune position hors tournée « en_cours » ; consentement daté ; conservation 30 jours ; lecture réservée au commercial et à la direction.
-- Écriture uniquement par les fonctions ci-dessous (security definer, search_path fixé). Relançable.

create table if not exists public.terrain_profils (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  mobilite          text not null default 'moto' check (mobilite in ('pied', 'velo', 'moto', 'voiture', 'transport')),
  objectif_visites_jour int not null default 8 check (objectif_visites_jour between 1 and 60),
  geoloc_consent_at timestamptz,
  updated_at        timestamptz not null default now()
);

create table if not exists public.terrain_tournees (
  id          uuid primary key default gen_random_uuid(),
  commercial  uuid not null references auth.users(id) on delete cascade,
  jour        date not null,
  titre       text not null check (char_length(titre) between 2 and 120),
  zone        text check (char_length(zone) <= 120),
  statut      text not null default 'planifiee' check (statut in ('planifiee', 'en_cours', 'terminee', 'annulee')),
  cree_par    uuid not null references auth.users(id),
  debut_at    timestamptz,
  fin_at      timestamptz,
  km_total    numeric(8, 2),
  created_at  timestamptz not null default now()
);
create index if not exists terrain_tournees_com_jour on public.terrain_tournees (commercial, jour desc);
create index if not exists terrain_tournees_statut on public.terrain_tournees (statut, jour desc);
create unique index if not exists terrain_tournees_une_en_cours on public.terrain_tournees (commercial) where statut = 'en_cours';

create table if not exists public.terrain_etapes (
  id          uuid primary key default gen_random_uuid(),
  tournee_id  uuid not null references public.terrain_tournees(id) on delete cascade,
  ordre       int not null check (ordre between 1 and 100),
  client_rid  text check (client_rid ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  nom         text not null check (char_length(nom) between 1 and 160),
  adresse     text check (char_length(adresse) <= 240),
  lat         numeric(9, 6) check (lat between -90 and 90),
  lng         numeric(9, 6) check (lng between -180 and 180),
  statut      text not null default 'a_visiter' check (statut in ('a_visiter', 'visite', 'absent', 'reporte', 'refuse')),
  issue       text check (issue in ('interesse', 'demo_prevue', 'rdv_pris', 'devis', 'vente', 'sans_suite')),
  arrivee_at  timestamptz,
  depart_at   timestamptz,
  distance_m  int,
  presence_verifiee boolean not null default false,
  note        text check (char_length(note) <= 1000),
  rdv_at      timestamptz,
  valeur_fcfa bigint check (valeur_fcfa between 0 and 1000000000),
  unique (tournee_id, ordre)
);
create index if not exists terrain_etapes_client on public.terrain_etapes (client_rid) where client_rid is not null;

create table if not exists public.terrain_positions (
  id          bigint generated always as identity primary key,
  tournee_id  uuid not null references public.terrain_tournees(id) on delete cascade,
  user_id     uuid not null,
  lat         numeric(9, 6) not null check (lat between -90 and 90),
  lng         numeric(9, 6) not null check (lng between -180 and 180),
  precision_m int,
  vitesse_ms  numeric(6, 2),
  at          timestamptz not null default now()
);
create index if not exists terrain_positions_tournee on public.terrain_positions (tournee_id, at);
create index if not exists terrain_positions_at on public.terrain_positions (at);

create table if not exists public.terrain_rapports (
  tournee_id  uuid primary key references public.terrain_tournees(id) on delete cascade,
  commercial  uuid not null,
  resume      text check (char_length(resume) <= 3000),
  difficultes text check (char_length(difficultes) <= 2000),
  stats       jsonb not null default '{}'::jsonb,
  statut      text not null default 'soumis' check (statut in ('soumis', 'valide', 'a_revoir')),
  valide_par  uuid,
  valide_at   timestamptz,
  commentaire text check (char_length(commentaire) <= 1000),
  created_at  timestamptz not null default now()
);
create index if not exists terrain_rapports_statut on public.terrain_rapports (statut, created_at desc);

-- ─── Droits : lecture (commercial concerné ou direction), aucune écriture directe ───
do $$ declare t text; begin
  foreach t in array array['terrain_profils', 'terrain_tournees', 'terrain_etapes', 'terrain_positions', 'terrain_rapports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists lecture on public.%I', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy lecture on public.terrain_profils for select to authenticated using (user_id = auth.uid() or public.ai_is_direction());
create policy lecture on public.terrain_tournees for select to authenticated using (commercial = auth.uid() or public.ai_is_direction());
create policy lecture on public.terrain_etapes for select to authenticated
  using (exists (select 1 from public.terrain_tournees t where t.id = tournee_id and (t.commercial = auth.uid() or public.ai_is_direction())));
create policy lecture on public.terrain_positions for select to authenticated using (user_id = auth.uid() or public.ai_is_direction());
create policy lecture on public.terrain_rapports for select to authenticated using (commercial = auth.uid() or public.ai_is_direction());

-- ─── Utilitaires ───
create or replace function public.terrain_distance_m(a_lat numeric, a_lng numeric, b_lat numeric, b_lng numeric) returns numeric
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case when a_lat is null or a_lng is null or b_lat is null or b_lng is null then null else
    2 * 6371000 * asin(least(1, sqrt(power(sin(radians(b_lat - a_lat) / 2), 2)
      + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)))) end
$$;

create or replace function public.terrain_journal(p_action text, p_payload jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.ai_actions(agent, action, payload, ok) values ('terrain', p_action, coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('par', auth.uid()), true)
$$;
revoke all on function public.terrain_journal(text, jsonb) from public, anon, authenticated;

create or replace function public.terrain_exiger_operateur() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.ai_is_operator() then raise exception 'Accès réservé aux opérateurs' using errcode = '42501'; end if;
end $$;
revoke all on function public.terrain_exiger_operateur() from public, anon, authenticated;

-- ─── Profil et consentement ───
create or replace function public.terrain_consentir(p_mobilite text default null, p_objectif int default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.terrain_profils;
begin
  perform public.terrain_exiger_operateur();
  if p_mobilite is not null and p_mobilite not in ('pied', 'velo', 'moto', 'voiture', 'transport') then raise exception 'Mobilité inconnue' using errcode = '22023'; end if;
  insert into public.terrain_profils(user_id, mobilite, objectif_visites_jour, geoloc_consent_at)
  values (auth.uid(), coalesce(p_mobilite, 'moto'), coalesce(p_objectif, 8), now())
  on conflict (user_id) do update set mobilite = coalesce(p_mobilite, terrain_profils.mobilite),
    objectif_visites_jour = coalesce(p_objectif, terrain_profils.objectif_visites_jour),
    geoloc_consent_at = coalesce(terrain_profils.geoloc_consent_at, now()), updated_at = now()
  returning * into r;
  perform public.terrain_journal('terrain_consentement', jsonb_build_object('mobilite', r.mobilite));
  return to_jsonb(r);
end $$;

create or replace function public.terrain_retirer_consentement() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.terrain_exiger_operateur();
  update public.terrain_profils set geoloc_consent_at = null, updated_at = now() where user_id = auth.uid();
  perform public.terrain_journal('terrain_consentement_retire', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.terrain_regler_profil(p_commercial uuid, p_mobilite text, p_objectif int) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  if p_mobilite not in ('pied', 'velo', 'moto', 'voiture', 'transport') or p_objectif not between 1 and 60 then raise exception 'Valeurs refusées' using errcode = '22023'; end if;
  if not exists (select 1 from public.ai_operators where user_id = p_commercial and actif) then raise exception 'Commercial inconnu' using errcode = 'P0002'; end if;
  insert into public.terrain_profils(user_id, mobilite, objectif_visites_jour) values (p_commercial, p_mobilite, p_objectif)
  on conflict (user_id) do update set mobilite = p_mobilite, objectif_visites_jour = p_objectif, updated_at = now();
  perform public.terrain_journal('terrain_profil', jsonb_build_object('commercial', p_commercial, 'mobilite', p_mobilite, 'objectif', p_objectif));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.terrain_equipe() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'nom', o.nom, 'role', o.role, 'mobilite', coalesce(p.mobilite, 'moto'),
           'objectif', coalesce(p.objectif_visites_jour, 8), 'consentement', p.geoloc_consent_at is not null) order by o.nom)
    from public.ai_operators o left join public.terrain_profils p on p.user_id = o.user_id where o.actif), '[]'::jsonb);
end $$;

-- ─── Feuille de route ───
create or replace function public.terrain_planifier(p_commercial uuid, p_jour date, p_titre text, p_zone text, p_etapes jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; e jsonb; i int := 0; v_lat numeric; v_lng numeric;
begin
  perform public.terrain_exiger_operateur();
  if p_commercial is distinct from auth.uid() and not public.ai_is_direction() then raise exception 'Seule la direction planifie pour un autre commercial' using errcode = '42501'; end if;
  if not exists (select 1 from public.ai_operators where user_id = p_commercial and actif) then raise exception 'Commercial inconnu ou inactif' using errcode = 'P0002'; end if;
  if p_jour is null or p_jour < current_date - 1 or p_jour > current_date + 60 then raise exception 'Date hors plage' using errcode = '22023'; end if;
  if jsonb_typeof(p_etapes) is distinct from 'array' or jsonb_array_length(p_etapes) not between 1 and 60 then raise exception 'Une tournée compte de 1 à 60 prospects' using errcode = '22023'; end if;
  insert into public.terrain_tournees(commercial, jour, titre, zone, cree_par) values (p_commercial, p_jour, btrim(p_titre), nullif(btrim(coalesce(p_zone, '')), ''), auth.uid()) returning id into v_id;
  for e in select * from jsonb_array_elements(p_etapes) loop
    i := i + 1;
    v_lat := case when (e->>'lat') ~ '^-?[0-9]{1,2}(\.[0-9]+)?$' then (e->>'lat')::numeric end;
    v_lng := case when (e->>'lng') ~ '^-?[0-9]{1,3}(\.[0-9]+)?$' then (e->>'lng')::numeric end;
    if v_lat not between -90 and 90 or v_lng not between -180 and 180 then v_lat := null; v_lng := null; end if;
    insert into public.terrain_etapes(tournee_id, ordre, client_rid, nom, adresse, lat, lng)
    values (v_id, i, nullif(e->>'client_rid', ''), left(btrim(coalesce(e->>'nom', '')), 160), left(e->>'adresse', 240), round(v_lat, 6), round(v_lng, 6));
  end loop;
  perform public.terrain_journal('terrain_planifiee', jsonb_build_object('tournee', v_id, 'commercial', p_commercial, 'etapes', i));
  return v_id;
end $$;

create or replace function public.terrain_annuler(p_tournee uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.terrain_tournees;
begin
  perform public.terrain_exiger_operateur();
  select * into t from public.terrain_tournees where id = p_tournee for update;
  if t.id is null or (t.commercial <> auth.uid() and not public.ai_is_direction()) then raise exception 'Tournée introuvable' using errcode = 'P0002'; end if;
  if t.statut not in ('planifiee', 'en_cours') then raise exception 'Tournée déjà clôturée' using errcode = '22023'; end if;
  update public.terrain_tournees set statut = 'annulee', fin_at = now() where id = p_tournee;
  perform public.terrain_journal('terrain_annulee', jsonb_build_object('tournee', p_tournee));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.terrain_demarrer(p_tournee uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.terrain_tournees;
begin
  perform public.terrain_exiger_operateur();
  select * into t from public.terrain_tournees where id = p_tournee for update;
  if t.id is null or t.commercial <> auth.uid() then raise exception 'Tournée introuvable' using errcode = 'P0002'; end if;
  if t.statut <> 'planifiee' then raise exception 'Tournée déjà démarrée ou clôturée' using errcode = '22023'; end if;
  if not exists (select 1 from public.terrain_profils where user_id = auth.uid() and geoloc_consent_at is not null) then
    raise exception 'Consentement à la géolocalisation requis' using errcode = '42501';
  end if;
  update public.terrain_tournees set statut = 'en_cours', debut_at = now() where id = p_tournee;
  perform public.terrain_journal('terrain_demarree', jsonb_build_object('tournee', p_tournee));
  return jsonb_build_object('ok', true, 'debut_at', now());
exception when unique_violation then raise exception 'Une autre tournée est déjà en cours' using errcode = '22023';
end $$;

-- Position : uniquement pendant une tournée en cours, au plus un point toutes les 8 s, précision exploitable (≤ 500 m).
create or replace function public.terrain_position(p_tournee uuid, p_lat numeric, p_lng numeric, p_precision int default null, p_vitesse numeric default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.terrain_tournees; v_dernier timestamptz;
begin
  perform public.terrain_exiger_operateur();
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Coordonnées invalides' using errcode = '22023'; end if;
  select * into t from public.terrain_tournees where id = p_tournee;
  if t.id is null or t.commercial <> auth.uid() or t.statut <> 'en_cours' then raise exception 'Aucune tournée en cours' using errcode = '22023'; end if;
  if coalesce(p_precision, 0) > 500 then return jsonb_build_object('ok', true, 'ignore', 'precision'); end if;
  select max(at) into v_dernier from public.terrain_positions where tournee_id = p_tournee;
  if v_dernier is not null and v_dernier > now() - interval '8 seconds' then return jsonb_build_object('ok', true, 'ignore', 'cadence'); end if;
  insert into public.terrain_positions(tournee_id, user_id, lat, lng, precision_m, vitesse_ms)
  values (p_tournee, auth.uid(), round(p_lat, 6), round(p_lng, 6), p_precision, case when p_vitesse between 0 and 99 then round(p_vitesse, 2) end);
  return jsonb_build_object('ok', true);
end $$;

-- Arrivée chez le prospect : distance GPS au prospect, présence vérifiée si ≤ max(150 m, précision). Prospect sans coordonnées : la position (si ≤ 60 m) les fixe.
create or replace function public.terrain_arrivee(p_etape uuid, p_lat numeric, p_lng numeric, p_precision int default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.terrain_etapes; t public.terrain_tournees; v_d numeric; v_ok boolean := false; v_fixe boolean := false;
begin
  perform public.terrain_exiger_operateur();
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Coordonnées invalides' using errcode = '22023'; end if;
  select * into e from public.terrain_etapes where id = p_etape for update;
  select * into t from public.terrain_tournees where id = e.tournee_id;
  if e.id is null or t.commercial <> auth.uid() or t.statut <> 'en_cours' then raise exception 'Étape introuvable ou tournée non en cours' using errcode = 'P0002'; end if;
  v_d := public.terrain_distance_m(e.lat, e.lng, p_lat, p_lng);
  if v_d is not null then v_ok := v_d <= greatest(150, coalesce(p_precision, 0));
  elsif coalesce(p_precision, 9999) <= 60 then v_fixe := true; v_ok := true; end if;
  update public.terrain_etapes set arrivee_at = coalesce(arrivee_at, now()), distance_m = round(v_d)::int, presence_verifiee = v_ok,
         lat = case when v_fixe then round(p_lat, 6) else lat end, lng = case when v_fixe then round(p_lng, 6) else lng end
   where id = p_etape;
  return jsonb_build_object('ok', true, 'distance_m', round(v_d), 'presence_verifiee', v_ok, 'position_prospect_fixee', v_fixe,
                            'lat', case when v_fixe then round(p_lat, 6) end, 'lng', case when v_fixe then round(p_lng, 6) end);
end $$;

create or replace function public.terrain_resultat(p_etape uuid, p_statut text, p_issue text default null, p_note text default null,
                                                   p_rdv timestamptz default null, p_valeur bigint default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.terrain_etapes; t public.terrain_tournees;
begin
  perform public.terrain_exiger_operateur();
  if p_statut not in ('visite', 'absent', 'reporte', 'refuse') then raise exception 'Statut refusé' using errcode = '22023'; end if;
  if p_issue is not null and p_issue not in ('interesse', 'demo_prevue', 'rdv_pris', 'devis', 'vente', 'sans_suite') then raise exception 'Issue refusée' using errcode = '22023'; end if;
  if p_issue = 'rdv_pris' and (p_rdv is null or p_rdv < now() - interval '1 hour') then raise exception 'Un rendez-vous pris exige une date à venir' using errcode = '22023'; end if;
  if p_valeur is not null and p_valeur not between 0 and 1000000000 then raise exception 'Montant refusé' using errcode = '22023'; end if;
  select * into e from public.terrain_etapes where id = p_etape for update;
  select * into t from public.terrain_tournees where id = e.tournee_id;
  if e.id is null or t.commercial <> auth.uid() or t.statut <> 'en_cours' then raise exception 'Étape introuvable ou tournée non en cours' using errcode = 'P0002'; end if;
  update public.terrain_etapes set statut = p_statut, issue = case when p_statut = 'visite' then p_issue end, note = left(btrim(coalesce(p_note, '')), 1000),
         rdv_at = case when p_issue = 'rdv_pris' then p_rdv end, valeur_fcfa = p_valeur,
         arrivee_at = case when p_statut = 'visite' then coalesce(arrivee_at, now()) else arrivee_at end, depart_at = now()
   where id = p_etape;
  return jsonb_build_object('ok', true, 'client_rid', e.client_rid, 'nom', e.nom, 'statut', p_statut, 'issue', p_issue, 'presence_verifiee', e.presence_verifiee);
end $$;

-- Clôture : distance parcourue (points précis ≤ 100 m, sauts > 5 km écartés), étapes restantes « reportées », rapport soumis à la direction.
create or replace function public.terrain_terminer(p_tournee uuid, p_resume text, p_difficultes text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.terrain_tournees; v_km numeric; v_stats jsonb;
begin
  perform public.terrain_exiger_operateur();
  select * into t from public.terrain_tournees where id = p_tournee for update;
  if t.id is null or t.commercial <> auth.uid() then raise exception 'Tournée introuvable' using errcode = 'P0002'; end if;
  if t.statut <> 'en_cours' then raise exception 'Tournée non en cours' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_resume, ''))) < 10 then raise exception 'Résumé de mission requis (10 caractères au moins)' using errcode = '22023'; end if;
  update public.terrain_etapes set statut = 'reporte' where tournee_id = p_tournee and statut = 'a_visiter';
  select coalesce(round(sum(d) / 1000, 2), 0) into v_km from (
    select public.terrain_distance_m(lag(lat) over w, lag(lng) over w, lat, lng) as d
      from public.terrain_positions where tournee_id = p_tournee and coalesce(precision_m, 0) <= 100 window w as (order by at)) s
   where d is not null and d <= 5000;
  update public.terrain_tournees set statut = 'terminee', fin_at = now(), km_total = v_km where id = p_tournee;
  select jsonb_build_object('etapes', count(*), 'visites', count(*) filter (where statut = 'visite'), 'absents', count(*) filter (where statut = 'absent'),
         'refus', count(*) filter (where statut = 'refuse'), 'reportes', count(*) filter (where statut = 'reporte'),
         'presence_verifiee', count(*) filter (where statut = 'visite' and presence_verifiee), 'rdv', count(*) filter (where issue = 'rdv_pris'),
         'devis', count(*) filter (where issue = 'devis'), 'ventes', count(*) filter (where issue = 'vente'), 'valeur_fcfa', coalesce(sum(valeur_fcfa), 0),
         'km', v_km) into v_stats from public.terrain_etapes where tournee_id = p_tournee;
  insert into public.terrain_rapports(tournee_id, commercial, resume, difficultes, stats)
  values (p_tournee, t.commercial, left(btrim(p_resume), 3000), left(btrim(coalesce(p_difficultes, '')), 2000), v_stats)
  on conflict (tournee_id) do update set resume = excluded.resume, difficultes = excluded.difficultes, stats = excluded.stats, statut = 'soumis', valide_par = null, valide_at = null;
  perform public.terrain_journal('terrain_terminee', jsonb_build_object('tournee', p_tournee) || v_stats);
  return jsonb_build_object('ok', true, 'stats', v_stats);
end $$;

create or replace function public.terrain_valider_rapport(p_tournee uuid, p_statut text, p_commentaire text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  if p_statut not in ('valide', 'a_revoir') then raise exception 'Statut refusé' using errcode = '22023'; end if;
  update public.terrain_rapports set statut = p_statut, valide_par = auth.uid(), valide_at = now(), commentaire = left(btrim(coalesce(p_commentaire, '')), 1000)
   where tournee_id = p_tournee;
  if not found then raise exception 'Rapport introuvable' using errcode = 'P0002'; end if;
  perform public.terrain_journal('terrain_rapport_' || p_statut, jsonb_build_object('tournee', p_tournee));
  return jsonb_build_object('ok', true);
end $$;

-- ─── Lectures agrégées ───
create or replace function public.terrain_feuille(p_jour date default current_date, p_commercial uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_com uuid;
begin
  perform public.terrain_exiger_operateur();
  v_com := case when public.ai_is_direction() then p_commercial else auth.uid() end;
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'commercial', t.commercial, 'nom', o.nom, 'jour', t.jour, 'titre', t.titre, 'zone', t.zone, 'statut', t.statut,
      'debut_at', t.debut_at, 'fin_at', t.fin_at, 'km_total', t.km_total,
      'rapport', (select to_jsonb(r) - 'commercial' from public.terrain_rapports r where r.tournee_id = t.id),
      'etapes', (select coalesce(jsonb_agg(to_jsonb(x) - 'tournee_id' order by x.ordre), '[]'::jsonb) from public.terrain_etapes x where x.tournee_id = t.id)) order by t.created_at)
    from public.terrain_tournees t join public.ai_operators o on o.user_id = t.commercial
    where t.jour = coalesce(p_jour, current_date) and (v_com is null or t.commercial = v_com)), '[]'::jsonb);
end $$;

create or replace function public.terrain_rapports_a_valider() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('tournee_id', r.tournee_id, 'nom', o.nom, 'jour', t.jour, 'titre', t.titre, 'zone', t.zone, 'resume', r.resume,
      'difficultes', r.difficultes, 'stats', r.stats, 'statut', r.statut, 'commentaire', r.commentaire, 'created_at', r.created_at) order by r.created_at desc)
    from public.terrain_rapports r join public.terrain_tournees t on t.id = r.tournee_id join public.ai_operators o on o.user_id = r.commercial
    where r.statut = 'soumis' or r.created_at > now() - interval '14 days'), '[]'::jsonb);
end $$;

-- Dernière position connue (≤ 30 min) des commerciaux en tournée.
create or replace function public.terrain_live() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('tournee_id', t.id, 'commercial', t.commercial, 'nom', o.nom, 'titre', t.titre, 'mobilite', coalesce(p.mobilite, 'moto'),
      'lat', l.lat, 'lng', l.lng, 'precision_m', l.precision_m, 'at', l.at,
      'visites', (select count(*) from public.terrain_etapes x where x.tournee_id = t.id and x.statut = 'visite'),
      'etapes', (select count(*) from public.terrain_etapes x where x.tournee_id = t.id)) order by o.nom)
    from public.terrain_tournees t join public.ai_operators o on o.user_id = t.commercial left join public.terrain_profils p on p.user_id = t.commercial
    left join lateral (select lat, lng, precision_m, at from public.terrain_positions where tournee_id = t.id order by at desc limit 1) l on true
    where t.statut = 'en_cours'), '[]'::jsonb);
end $$;

-- Indicateurs par commercial (direction : tous ; commercial : lui seul). Score /100 = activité 40 + présence vérifiée 20 + conversion 30 + régularité 10.
create or replace function public.terrain_kpi(p_depuis date, p_jusqua date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_dir boolean; v_depuis date := coalesce(p_depuis, current_date - 29); v_jusqua date := coalesce(p_jusqua, current_date); v_ouvres int;
begin
  perform public.terrain_exiger_operateur();
  if v_jusqua < v_depuis or v_jusqua - v_depuis > 366 then raise exception 'Période invalide' using errcode = '22023'; end if;
  v_dir := public.ai_is_direction();
  select greatest(1, count(*)) into v_ouvres from generate_series(v_depuis, v_jusqua, interval '1 day') g where extract(isodow from g) <= 6;
  return coalesce((select jsonb_agg(k order by (k->>'score')::int desc, k->>'nom') from (
    select jsonb_build_object('commercial', s.commercial, 'nom', s.nom, 'mobilite', s.mobilite, 'objectif', s.objectif, 'tournees', s.tournees, 'terminees', s.terminees,
      'etapes', s.etapes, 'visites', s.visites, 'absents', s.absents, 'refus', s.refus, 'rdv', s.rdv, 'devis', s.devis, 'ventes', s.ventes, 'valeur_fcfa', s.valeur,
      'km', s.km, 'jours_actifs', s.jours, 'visites_par_jour', s.vpj, 'duree_visite_min', s.duree, 'presence_pct', s.pres,
      'taux_realisation_pct', case when s.etapes > 0 then round(100.0 * s.visites / s.etapes) else 0 end,
      'score', round(40 * least(1, s.vpj / s.objectif) + 20 * s.pres / 100.0
                     + 30 * least(1, (s.rdv + s.devis + s.ventes)::numeric / greatest(s.visites, 1) / 0.3) + 10 * least(1, s.jours::numeric / v_ouvres))::int) as k
    from (
      select o.user_id as commercial, o.nom, coalesce(p.mobilite, 'moto') as mobilite, coalesce(p.objectif_visites_jour, 8) as objectif,
        count(distinct t.id) as tournees, count(distinct t.id) filter (where t.statut = 'terminee') as terminees,
        count(x.id) as etapes, count(x.id) filter (where x.statut = 'visite') as visites, count(x.id) filter (where x.statut = 'absent') as absents,
        count(x.id) filter (where x.statut = 'refuse') as refus, count(x.id) filter (where x.issue = 'rdv_pris') as rdv,
        count(x.id) filter (where x.issue = 'devis') as devis, count(x.id) filter (where x.issue = 'vente') as ventes, coalesce(sum(x.valeur_fcfa), 0) as valeur,
        coalesce((select sum(km_total) from public.terrain_tournees k where k.commercial = o.user_id and k.jour between v_depuis and v_jusqua and k.statut = 'terminee'), 0) as km,
        count(distinct t.jour) filter (where t.statut in ('en_cours', 'terminee')) as jours,
        round(count(x.id) filter (where x.statut = 'visite')::numeric / greatest(1, count(distinct t.jour) filter (where t.statut in ('en_cours', 'terminee'))), 1) as vpj,
        coalesce(round(avg(extract(epoch from (x.depart_at - x.arrivee_at)) / 60) filter (where x.statut = 'visite' and x.depart_at > x.arrivee_at and x.depart_at - x.arrivee_at < interval '3 hours')), 0) as duree,
        case when count(x.id) filter (where x.statut = 'visite') = 0 then 0
             else round(100.0 * count(x.id) filter (where x.statut = 'visite' and x.presence_verifiee) / count(x.id) filter (where x.statut = 'visite')) end as pres
      from public.ai_operators o
      left join public.terrain_profils p on p.user_id = o.user_id
      left join public.terrain_tournees t on t.commercial = o.user_id and t.jour between v_depuis and v_jusqua and t.statut <> 'annulee'
      left join public.terrain_etapes x on x.tournee_id = t.id
      where o.actif and o.role = 'commercial' and (v_dir or o.user_id = auth.uid())
      group by o.user_id, o.nom, p.mobilite, p.objectif_visites_jour) s) z), '[]'::jsonb);
end $$;

-- Conservation 30 jours des positions (service seulement ; planifiée chaque nuit si pg_cron est présent).
create or replace function public.terrain_purger_positions() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  delete from public.terrain_positions where at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.terrain_purger_positions() from public, anon, authenticated;
grant execute on function public.terrain_purger_positions() to service_role;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'terrain-purge-positions';
    perform cron.schedule('terrain-purge-positions', '30 3 * * *', 'select public.terrain_purger_positions()');
  end if;
exception when others then null;
end $$;

-- ─── Droits d'exécution : opérateurs connectés seulement ───
do $$ declare f text; begin
  foreach f in array array['terrain_distance_m(numeric,numeric,numeric,numeric)', 'terrain_consentir(text,int)', 'terrain_retirer_consentement()', 'terrain_regler_profil(uuid,text,int)',
    'terrain_equipe()', 'terrain_planifier(uuid,date,text,text,jsonb)', 'terrain_annuler(uuid)', 'terrain_demarrer(uuid)', 'terrain_position(uuid,numeric,numeric,int,numeric)',
    'terrain_arrivee(uuid,numeric,numeric,int)', 'terrain_resultat(uuid,text,text,text,timestamptz,bigint)', 'terrain_terminer(uuid,text,text)', 'terrain_valider_rapport(uuid,text,text)',
    'terrain_feuille(date,uuid)', 'terrain_rapports_a_valider()', 'terrain_live()', 'terrain_kpi(date,date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
