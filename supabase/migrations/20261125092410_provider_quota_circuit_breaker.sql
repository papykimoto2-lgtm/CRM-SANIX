alter table public.ai_governance
  add column if not exists provider_pause_until timestamptz,
  add column if not exists provider_pause_reason text;

comment on column public.ai_governance.provider_pause_until is 'Pause globale des appels IA jusqu au reinitialisation du quota fournisseur';
comment on column public.ai_governance.provider_pause_reason is 'Motif lisible de la pause du fournisseur IA';
