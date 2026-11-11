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
