-- Libellé de l'étape « premier_contact » dans le CRM : « Contacté » (avant : « Premier contact IA »).
-- Concerne les nouvelles interactions écrites dans les fiches clients ; l'historique déjà enregistré garde son ancien texte.
create or replace function public.crm_stage_label(p_stage text) returns text
language sql immutable as $$
  select case p_stage
    when 'identifie' then 'Prospect identifié' when 'enregistre' then 'Prospect enregistré' when 'qualifie' then 'Prospect qualifié par l''IA'
    when 'premier_contact' then 'Contacté' when 'conversation' then 'Conversation en cours' when 'besoin_identifie' then 'Besoin identifié'
    when 'interesse' then 'Prospect intéressé' when 'rdv_propose' then 'Rendez-vous proposé' when 'rdv_confirme' then 'Rendez-vous confirmé'
    when 'demo_realisee' then 'Démonstration réalisée' when 'offre_transmise' then 'Offre transmise' when 'negociation' then 'En négociation'
    when 'offre_acceptee' then 'Offre acceptée' when 'contrat_transmis' then 'Contrat transmis' when 'contrat_signe' then 'Contrat signé'
    when 'paiement_attendu' then 'Paiement attendu' when 'paiement_confirme' then 'Paiement confirmé' when 'marche_gagne' then 'Marché gagné'
    when 'deploiement' then 'Déploiement' when 'client_fidelise' then 'Client fidélisé' when 'perdu' then 'Prospect perdu' when 'en_veille' then 'Mis en veille'
    else p_stage end
$$;
