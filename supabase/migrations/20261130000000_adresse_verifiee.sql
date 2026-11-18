-- Qualité des adresses e-mail des prospects : un statut par fiche, alimenté par la vérification du domaine, les retours « non distribué » de Gmail et les réponses reçues.
--   inconnu     : jamais vérifiée
--   a_confirmer : le domaine reçoit du courrier, mais la boîte n'est pas garantie (adresse générique, webmail, jamais de réponse)
--   verifiee    : le prospect a déjà répondu depuis cette adresse
--   invalide    : domaine inexistant ou retour « non distribué » : aucun agent ne lui écrit
alter table public.ai_prospects
  add column if not exists email_statut text not null default 'inconnu',
  add column if not exists email_verifie_at timestamptz,
  add column if not exists email_verif_detail text;
do $$ begin
  alter table public.ai_prospects add constraint ai_prospects_email_statut_check check (email_statut in ('inconnu', 'a_confirmer', 'verifiee', 'invalide'));
exception when duplicate_object then null; end $$;

-- Reprise de l'existant : adresses déjà revenues en erreur, adresses déjà ayant répondu.
update public.ai_prospects p set email_statut = 'invalide', email_verifie_at = now(), email_verif_detail = 'Retour « non distribué » de Gmail'
 where coalesce(p.email, '') <> '' and exists (select 1 from public.crm_mails m where lower(m.to_email) = lower(p.email) and m.status = 'echec' and m.error ilike '%distribu%');
update public.ai_prospects p set email_statut = 'verifiee', email_verifie_at = now(), email_verif_detail = 'Le prospect a répondu depuis cette adresse'
 where coalesce(p.email, '') <> '' and p.email_statut <> 'invalide' and exists (select 1 from public.crm_mails m where lower(m.to_email) = lower(p.email) and m.status = 'repondu');
