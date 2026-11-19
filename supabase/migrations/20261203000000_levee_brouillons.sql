-- Brouillons de messages aux financeurs : rédigés pour validation. Envoi uniquement sur action du président (bouton « Envoyer maintenant » + confirmation, Gmail de l'entreprise) ; jamais automatique.
-- Statuts : brouillon → valide → envoye ; ou abandonne. Direction uniquement. Relançable.
create table if not exists public.levee_brouillons (
  id            uuid primary key default gen_random_uuid(),
  financeur_id  uuid not null references public.levee_financeurs(id) on delete cascade,
  canal         text not null default 'email' check (canal in ('email', 'formulaire', 'autre')),
  destinataire  text check (destinataire is null or length(destinataire) <= 200),
  objet         text not null check (length(objet) between 2 and 300),
  corps         text not null check (length(corps) between 20 and 8000),
  langue        text not null default 'fr' check (langue in ('fr', 'en')),
  statut        text not null default 'brouillon' check (statut in ('brouillon', 'valide', 'envoye', 'abandonne')),
  note          text check (length(note) <= 1000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists levee_brouillons_financeur on public.levee_brouillons(financeur_id, created_at desc);
alter table public.levee_brouillons enable row level security;
drop policy if exists levee_brouillons_direction on public.levee_brouillons;
create policy levee_brouillons_direction on public.levee_brouillons for all to authenticated
  using (public.ai_is_direction()) with check (public.ai_is_direction());
revoke all on public.levee_brouillons from anon;
