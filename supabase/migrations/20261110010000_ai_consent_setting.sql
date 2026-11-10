-- Réglage de gouvernance : preuve de consentement exigée avant tout envoi commercial (WhatsApp, e-mail).
-- Désactivé par défaut : la validation du président (communication_externe = 'validation') reste le garde-fou.
-- Activé, un agent ne peut écrire à un prospect que si ai_prospects.consentement porte une preuve datée pour le canal
-- ({"email":{"at":"…","preuve":"…"}}) ou, pour WhatsApp, si le prospect a écrit lui-même depuis moins de 24 h.
alter table public.ai_governance
  add column if not exists consentement_requis boolean not null default false;
