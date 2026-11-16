-- SANIX CRM : chiffres réels pour calibrer le plan de financement. LECTURE SEULE (aucun INSERT/UPDATE/DELETE).
-- À lancer dans Supabase > SQL Editor du projet utilisé par le CRM, puis copier le résultat de chaque bloc.
-- Ne contient aucun nom de client : uniquement des totaux.

-- 1) Volume et ancienneté des données
select entity, count(*) as nb, min(created_at)::date as premier, max(updated_at)::date as dernier
from public.crm_records where deleted_at is null group by entity order by nb desc;

-- 2) Ventes (commandes confirmées / en cours / livrées) par mois : CA HT, nombre, panier moyen, encaissé
select to_char((data->>'date')::date, 'YYYY-MM') as mois,
       count(*) as nb_commandes,
       round(sum(coalesce((data->>'htNet')::numeric, 0))) as ca_ht,
       round(avg(coalesce((data->>'htNet')::numeric, 0))) as panier_moyen_ht,
       round(sum(coalesce((data->>'acompte')::numeric, 0))) as encaisse
from public.crm_records
where entity = 'commandes' and deleted_at is null
  and coalesce(data->>'statut', '') in ('confirmee', 'en_cours', 'livree')
  and coalesce(data->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
group by 1 order by 1;

-- 3) Répartition par logiciel (ce qui se vend vraiment)
select coalesce(data->>'logiciel', '(non renseigné)') as logiciel, count(*) as nb,
       round(sum(coalesce((data->>'htNet')::numeric, 0))) as ca_ht
from public.crm_records
where entity = 'commandes' and deleted_at is null and coalesce(data->>'statut', '') in ('confirmee', 'en_cours', 'livree')
group by 1 order by ca_ht desc;

-- 4) Pipeline : prospects par étape et montants chiffrés
select coalesce(data->>'stage', data->>'etape', data->>'statut', '(?)') as etape, count(*) as nb,
       round(sum(coalesce(nullif(data->>'montant', '')::numeric, 0))) as montant
from public.crm_records where entity = 'deals' and deleted_at is null group by 1 order by nb desc;

-- 5) Licences / abonnements actifs (revenu récurrent réel)
select coalesce(data->>'type', '(?)') as type, coalesce(data->>'statut', '(?)') as statut, count(*) as nb
from public.crm_records where entity = 'licences' and deleted_at is null group by 1, 2 order by nb desc;

-- 6) Contrats de maintenance facturés (renouvellements réellement émis)
select count(*) filter (where coalesce(data->>'renouvellement', 'false') = 'true') as renouvellements_factures,
       count(*) as commandes_total
from public.crm_records where entity = 'commandes' and deleted_at is null;
