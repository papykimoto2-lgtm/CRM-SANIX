-- Centre des coûts IA : une seule lecture pour l'onglet « Coûts IA » de l'entreprise virtuelle.
-- Rien n'est stocké en plus : tout vient du journal d'audit (ai_actions, action = 'llm_turn') et des incidents.
-- Direction uniquement. Relançable.
create or replace function public.ai_cost_center(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_tz constant text := 'Africa/Abidjan';
  v_d0 timestamptz := (date_trunc('day', now() at time zone v_tz) - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365) - 1)) at time zone v_tz;
  v_j0 timestamptz := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  v_m0 timestamptz := date_trunc('month', now() at time zone v_tz) at time zone v_tz;
  v_mois numeric; v_jour numeric; v_periode numeric;
  v_elapsed numeric := greatest(extract(day from (now() at time zone v_tz)), 1);
  v_dim numeric := extract(day from (date_trunc('month', now() at time zone v_tz) + interval '1 month - 1 day'));
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
  select coalesce(sum(cout_usd), 0) into v_jour    from public.ai_actions where action = 'llm_turn' and at >= v_j0;
  select coalesce(sum(cout_usd), 0) into v_mois    from public.ai_actions where action = 'llm_turn' and at >= v_m0;
  select coalesce(sum(cout_usd), 0) into v_periode from public.ai_actions where action = 'llm_turn' and at >= v_d0;
  return jsonb_build_object(
    'jours_periode', v_days,
    'jour_usd', round(v_jour, 4), 'mois_usd', round(v_mois, 4), 'periode_usd', round(v_periode, 4),
    'prevision_fin_mois_usd', round(v_mois / v_elapsed * v_dim, 4),
    'budget_jour_usd', (select budget_jour_usd from public.ai_governance where id = 1),
    'budget_mois_usd', (select budget_mois_usd from public.ai_governance where id = 1),
    -- Un enregistrement par jour de la période, même sans dépense (courbe sans trou)
    'jours', coalesce((select jsonb_agg(jsonb_build_object('jour', to_char(g.j, 'YYYY-MM-DD'), 'cout_usd', round(coalesce(t.c, 0), 4),
                                                           'appels', coalesce(t.n, 0), 'erreurs', coalesce(t.e, 0)) order by g.j)
                         from generate_series((v_d0 at time zone v_tz)::date, (now() at time zone v_tz)::date, interval '1 day') g(j)
                         left join (select (at at time zone v_tz)::date d, sum(cout_usd) c, count(*) n, count(*) filter (where not ok) e
                                      from public.ai_actions where action = 'llm_turn' and at >= v_d0 group by 1) t on t.d = g.j::date), '[]'::jsonb),
    'agents', coalesce((select jsonb_agg(x order by (x->>'cout_usd')::numeric desc, x->>'nom')
                          from (select jsonb_build_object('agent_id', a.id, 'nom', a.nom, 'fonction', a.fonction, 'etat', a.etat, 'activite', a.activite,
                                         'cout_usd', round(coalesce(t.c, 0), 4), 'appels', coalesce(t.n, 0), 'erreurs', coalesce(t.e, 0),
                                         'tokens_in', coalesce(t.ti, 0), 'tokens_out', coalesce(t.to_, 0), 'derniere_activite', t.dernier) x
                                  from public.ai_agents a
                                  left join (select agent_id, sum(cout_usd) c, count(*) n, count(*) filter (where not ok) e,
                                                    sum(tokens_in) ti, sum(tokens_out) to_, max(at) dernier
                                               from public.ai_actions where action = 'llm_turn' and at >= v_d0 and agent_id is not null group by 1) t on t.agent_id = a.id
                                 where a.etat <> 'archive') z), '[]'::jsonb),
    -- Par modèle (le fournisseur est celui des appels : Anthropic)
    'modeles', coalesce((select jsonb_agg(jsonb_build_object('modele', coalesce(m, 'inconnu'), 'cout_usd', round(c, 4), 'appels', n, 'erreurs', e) order by c desc)
                           from (select payload->>'model' m, sum(cout_usd) c, count(*) n, count(*) filter (where not ok) e
                                   from public.ai_actions where action = 'llm_turn' and at >= v_d0 group by 1) t), '[]'::jsonb),
    'disponibilite', coalesce((select jsonb_object_agg(etat, n) from (select etat, count(*) n from public.ai_agents where etat <> 'archive' group by 1) t), '{}'::jsonb),
    'incidents_periode', coalesce((select jsonb_object_agg(gravite, n) from (select gravite, count(*) n from public.ai_incidents where created_at >= v_d0 group by 1) t), '{}'::jsonb),
    'incidents', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'gravite', i.gravite, 'type', i.type, 'message', left(i.message, 300),
                                                               'agent', a.nom, 'at', i.created_at) order by i.created_at desc)
                             from (select * from public.ai_incidents where created_at >= v_d0 order by created_at desc limit 30) i
                             left join public.ai_agents a on a.id = i.agent_id), '[]'::jsonb));
end $$;
revoke all on function public.ai_cost_center(integer) from public, anon;
grant execute on function public.ai_cost_center(integer) to authenticated, service_role;
