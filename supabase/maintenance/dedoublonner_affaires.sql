-- Nettoyage ponctuel : une seule affaire « générée depuis le prospect » par client (et par logiciel / valeur / étape / commercial).
-- Contexte : avant le correctif du connecteur, chaque appareil créait sa propre affaire pour chaque client (1 474 affaires pour 552 clients en production ; pipeline pondéré surévalué ×2,6).
-- À lancer APRÈS le déploiement du correctif du CRM (sinon un appareil non mis à jour pourrait recréer des doublons). Suppression « douce » (deleted_at) : réversible ; les appareils
-- reçoivent les suppressions à leur prochain échange. On garde l'affaire la plus ancienne de chaque groupe ; les affaires saisies à la main (non générées) ne sont jamais touchées.
-- Utilisation : exécuter le bloc « APERÇU », vérifier les chiffres, puis le bloc « APPLICATION ».

-- ── APERÇU (lecture seule) ───────────────────────────────────────────────────
with d as (
  select rid, created_at, data->>'_client_rid' crid,
         md5(coalesce(data->>'_client_rid', '') || '|' || coalesce(data->>'logiciel', '') || '|' || coalesce(data->>'valeur', '') || '|' || coalesce(data->>'stage', '') || '|' || coalesce(data->>'commercial', '')) cle,
         row_number() over (partition by data->>'_client_rid', data->>'logiciel', data->>'valeur', data->>'stage', data->>'commercial' order by created_at, rid) rn
    from public.crm_records
   where entity = 'deals' and deleted_at is null and coalesce(data->>'fromProspect', 'false') = 'true' and data ? '_client_rid')
select count(*) as affaires_generees, count(*) filter (where rn = 1) as a_garder, count(*) filter (where rn > 1) as doublons_a_supprimer from d;

-- ── APPLICATION ──────────────────────────────────────────────────────────────
-- update public.crm_records r set deleted_at = now(), updated_by = 'maintenance:dedoublonnage_affaires'
--   from (select rid from (
--           select rid, row_number() over (partition by data->>'_client_rid', data->>'logiciel', data->>'valeur', data->>'stage', data->>'commercial' order by created_at, rid) rn
--             from public.crm_records
--            where entity = 'deals' and deleted_at is null and coalesce(data->>'fromProspect', 'false') = 'true' and data ? '_client_rid') x
--          where rn > 1) dup
--  where r.entity = 'deals' and r.rid = dup.rid;
