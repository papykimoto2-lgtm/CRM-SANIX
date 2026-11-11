-- ═════════════════════════════════════════════════════════════════════════════
--  SANIX AI — AvicoSuite = Angel's Agro (un seul logiciel, deux noms)
--  Le CRM vend l'ERP avicole sous le nom « Angel's Agro » (anciennement « AviNest Pro ») ; SANIX AI le gère sous « AvicoSuite ».
--  1. Les noms utilisés dans le CRM sont rattachés à AvicoSuite (chiffre d'affaires par logiciel, routage des missions).
--  2. La fiche AvicoSuite reprend les fonctionnalités réelles du catalogue du CRM (aucune donnée inventée).
--  Additif et relançable ; ne modifie ni les prix ni le statut du logiciel.
-- ═════════════════════════════════════════════════════════════════════════════

do $$ begin
  if to_regclass('public.ai_product_aliases') is null then
    raise exception 'Appliquer d''abord la migration 20261113 (Phase 2)' using errcode = '55000';
  end if;
end $$;

insert into public.ai_product_aliases(alias, product_id)
select v.alias, 'avicosuite' from (values
  ('angel''s agro'), ('angels agro'), ('angel agro')
) v(alias)
where exists (select 1 from public.ai_products where id = 'avicosuite')
on conflict (alias) do update set product_id = excluded.product_id;

-- Fonctionnalités : modules du logiciel « Angel's Agro » du catalogue du CRM (index.html, id log_angels_agro). Ne remplace pas une liste déjà renseignée.
update public.ai_products set
  fonctionnalites = array['Lots et élevage', 'Suivi quotidien (mortalité, aliment, eau, pesée, œufs)', 'Prophylaxie avec délai d''attente bloquant la vente',
                          'Programme nutritionnel par souche', 'Couvoir', 'Conditionnement des œufs', 'Stock et fabrication d''aliment', 'Achats',
                          'Ventes et créances', 'Trésorerie et rentabilité par lot', 'Comptabilité SYSCOHADA', 'Rapports WhatsApp', 'Application hors ligne (PWA)'],
  updated_at = now()
 where id = 'avicosuite' and coalesce(cardinality(fonctionnalites), 0) = 0;
