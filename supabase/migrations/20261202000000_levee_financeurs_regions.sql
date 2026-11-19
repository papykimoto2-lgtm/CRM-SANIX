-- Annuaire des financeurs : régions du monde, site web, contacts publiés et personnes ressources (avec LinkedIn public).
-- Chaque donnée de contact doit avoir une source publique (la fiche du financeur ou la page qui établit nom + fonction). Relançable.
alter table public.levee_financeurs
  add column if not exists region text,
  add column if not exists site_web text,
  add column if not exists linkedin_url text,
  add column if not exists contact_email text,
  add column if not exists contact_telephone text,
  add column if not exists contact_formulaire text,
  add column if not exists pertinence text,
  add column if not exists verifie_le date;
do $$ begin
  alter table public.levee_financeurs add constraint levee_financeurs_region_check check (region is null or region in
    ('afrique_ouest','afrique_centrale','afrique_est','afrique_nord','afrique_australe','afrique_panafricain','europe','amerique_nord','amerique_latine','asie','moyen_orient','oceanie','international'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.levee_financeurs add constraint levee_financeurs_liens_check check (
    (site_web is null or site_web ~* '^https://') and (contact_formulaire is null or contact_formulaire ~* '^https://')
    and (linkedin_url is null or linkedin_url ~* '^https://([a-z0-9-]+\.)?linkedin\.com/')
    and length(coalesce(contact_email, '')) <= 200 and length(coalesce(contact_telephone, '')) <= 60 and length(coalesce(pertinence, '')) <= 500);
exception when duplicate_object then null; end $$;
create index if not exists levee_financeurs_region on public.levee_financeurs(region, nom_norm);

create table if not exists public.levee_contacts (
  id            uuid primary key default gen_random_uuid(),
  financeur_id  uuid not null references public.levee_financeurs(id) on delete cascade,
  nom           text not null check (length(nom) between 2 and 160),
  nom_norm      text generated always as (lower(regexp_replace(btrim(nom), '\s+', ' ', 'g'))) stored,
  fonction      text check (length(fonction) <= 200),
  linkedin_url  text check (linkedin_url is null or linkedin_url ~* '^https://([a-z0-9-]+\.)?linkedin\.com/'),
  email         text check (length(email) <= 200),
  source_url    text not null check (source_url ~* '^https://'),
  created_at    timestamptz not null default now()
);
create unique index if not exists levee_contacts_unique on public.levee_contacts(financeur_id, nom_norm);
alter table public.levee_contacts enable row level security;
drop policy if exists levee_contacts_direction on public.levee_contacts;
create policy levee_contacts_direction on public.levee_contacts for all to authenticated
  using (public.ai_is_direction()) with check (public.ai_is_direction());
revoke all on public.levee_contacts from anon;
