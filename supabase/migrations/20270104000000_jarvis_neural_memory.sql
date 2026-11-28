-- Mémoire collective pour Jarvis : lecture interne globale, toujours filtrée et classée par preuve.
create or replace function public.ai_memoire_collective_interne(p_q text, p_n int default 6)
returns table (
  contenu text,
  statut text,
  experience boolean,
  niveau_preuve smallint,
  fiabilite int,
  source text,
  partage boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select websearch_to_tsquery('french'::regconfig, left(coalesce(p_q, ''), 300)) as ts
  )
  select m.contenu,
         m.statut,
         (m.task_id is not null) as experience,
         m.niveau_preuve,
         public.ai_memoire_fiabilite(m.statut, m.niveau_preuve, coalesce(m.valide_at, m.created_at)) as fiabilite,
         m.source,
         (m.agent_id is null) as partage
    from public.ai_agent_memory m
    cross join q
   where length(btrim(coalesce(p_q, ''))) >= 2
     and m.fts @@ q.ts
   order by (m.statut = 'valide' and m.task_id is null) desc,
            (m.task_id is null) desc,
            public.ai_memoire_fiabilite(m.statut, m.niveau_preuve, coalesce(m.valide_at, m.created_at)) desc,
            m.importance desc,
            m.created_at desc
   limit greatest(1, least(coalesce(p_n, 6), 10));
$$;
revoke all on function public.ai_memoire_collective_interne(text, int) from public, anon, authenticated;
grant execute on function public.ai_memoire_collective_interne(text, int) to service_role;
comment on function public.ai_memoire_collective_interne(text, int)
  is 'Recherche transversale de la mémoire collective pour Jarvis. Résultats qualifiés par statut, preuve et fiabilité ; service_role uniquement.';
