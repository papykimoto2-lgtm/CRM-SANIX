-- Phase 3 : leçons par résultat. Chaque jalon commercial (réponse, avancement, perte, mise en veille) crée un souvenir PARTAGÉ factuel,
-- calculé en SQL (aucun coût IA, aucun texte libre du prospect). Statut « à vérifier » : la direction valide ou invalide dans le Centre mémoire.
alter table public.ai_agent_memory add column if not exists source text;
create unique index if not exists ai_memory_source_uq on public.ai_agent_memory (source) where source like 'stage:%';

create or replace function public.ai_memoire_lecon(p_hist bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare h public.ai_stage_history; p public.ai_prospects; canal text; nsort int; premier timestamptz; neg boolean; txt text; ent text;
begin
  select * into h from public.ai_stage_history where id = p_hist;
  if h.id is null or h.vers not in ('conversation', 'interesse', 'rdv_confirme', 'demo_realisee', 'offre_transmise', 'contrat_signe', 'paiement_confirme', 'marche_gagne', 'perdu', 'en_veille') then return false; end if;
  select * into p from public.ai_prospects where id = h.prospect_id;
  if p.id is null or p.entreprise ~* '^TEST\M' or p.entreprise ~* 'fiche de test' then return false; end if;
  select m.canal, m.created_at into canal, premier from public.ai_messages m where m.prospect_id = p.id and m.sens = 'sortant' order by m.created_at limit 1;
  select count(*) into nsort from public.ai_messages m where m.prospect_id = p.id and m.sens = 'sortant';
  neg := h.vers in ('perdu', 'en_veille');
  txt := format('[%s] Résultat %s : prospect du secteur « %s » (source « %s », produit %s), %s, %s message(s) envoyé(s) : %s → %s%s.',
    to_char(h.at at time zone 'Africa/Abidjan', 'DD/MM/YYYY'),
    case when neg then 'négatif' else 'positif' end,
    coalesce(left(regexp_replace(coalesce(p.secteur, 'inconnu'), '\s+', ' ', 'g'), 40), 'inconnu'),
    coalesce(left(regexp_replace(coalesce(p.source, 'inconnue'), '\s+', ' ', 'g'), 30), 'inconnue'),
    coalesce(left(regexp_replace(coalesce(p.produits_recommandes[1], 'non défini'), '\s+', ' ', 'g'), 40), 'non défini'),
    case when premier is null then 'aucun message sortant enregistré' else format('1er contact par %s il y a %s j', coalesce(canal, '?'), greatest(0, floor(extract(epoch from (h.at - premier)) / 86400)::int)) end,
    nsort, coalesce(h.de, '?'), h.vers, case when h.par is null then '' else ' (par ' || left(regexp_replace(h.par, '\s+', ' ', 'g'), 30) || ')' end);
  insert into public.ai_agent_memory(agent_id, contenu, tags, importance, source)
    values (null, left(txt, 4000), array['lecon', case when neg then 'negatif' else 'positif' end, h.vers], case when h.vers in ('perdu', 'contrat_signe', 'paiement_confirme', 'marche_gagne') then 4 else 3 end, 'stage:' || h.id)
    on conflict (source) where source like 'stage:%' do nothing;
  -- au plus 200 leçons : les validées d'abord, puis les plus récentes
  delete from public.ai_agent_memory where id in (select id from public.ai_agent_memory where tags @> array['lecon'] and source like 'stage:%' order by statut = 'valide' desc, created_at desc offset 200);
  return true;
end $$;

create or replace function public.ai_memoire_lecon_trg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform public.ai_memoire_lecon(new.id); exception when others then null; end;  -- la mémoire ne doit jamais bloquer un changement d'étape
  return new;
end $$;
drop trigger if exists ai_memoire_lecon_t on public.ai_stage_history;
create trigger ai_memoire_lecon_t after insert on public.ai_stage_history for each row execute function public.ai_memoire_lecon_trg();

revoke all on function public.ai_memoire_lecon(bigint), public.ai_memoire_lecon_trg() from public, anon, authenticated;

-- Reprise de l'historique existant
select public.ai_memoire_lecon(id) from public.ai_stage_history order by id;
