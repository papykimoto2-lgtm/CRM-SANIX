-- Suivi des partenariats (distributeurs, intégrateurs, apporteurs : fiches CRM au secteur « Partenaire… »).
-- Confié au Directeur commercial IA, qui rend compte au Directeur général IA, dont Jarvis est la voix. Aucun nouvel agent
-- (plafond de gouvernance : 26 agents actifs). L'agent ne contacte personne et ne modifie aucune fiche.

insert into public.ai_skills(code, nom, description, contenu) values
('suivi_partenariats', 'Suivi des partenariats',
 'Méthode de suivi des partenaires potentiels (distributeurs, intégrateurs, apporteurs d''affaires).',
 $sk$1. Lis les fiches avec ai_abonnement_partenaires() : jamais d'autre source, jamais de coordonnée inventée.
2. Pour chaque partenaire, établis l'état : jamais contacté, contacté sans réponse (jours écoulés), réponse reçue, rendez-vous, démo, pilote, refus. Appuie-toi sur les interactions enregistrées, pas sur des suppositions.
3. Relances : propose une relance à J+5 après un premier contact sans réponse, une seule relance par cycle, jamais plus de deux au total sans décision de la direction.
4. Signale les données à confirmer (téléphone, e-mail, interlocuteur) et ce qui bloque l'avancement.
5. Distingue les partenaires qui sont aussi des concurrents (intégrateurs ERP) : propose une collaboration complémentaire, jamais une revente directe.
6. Tu ne contactes personne, tu ne modifies aucune fiche, tu ne cites aucun taux de commission : les conditions du partenariat restent à décider par la direction.
7. Rends un rapport court : tableau par partenaire (état, dernier contact, prochaine action proposée), points d'attention, décisions demandées au président.$sk$)
on conflict (code) do update set nom = excluded.nom, description = excluded.description, contenu = excluded.contenu, updated_at = now();

insert into public.ai_agent_skills(agent_id, skill_code, ordre)
select a.id, 'suivi_partenariats', 4 from public.ai_agents a where a.code = 'sanix_ai_sales_director'
on conflict do nothing;

-- Lecture des fiches partenaires pour l'exécuteur (service seulement) : ni téléphone ni e-mail, seulement leur présence.
create or replace function public.ai_abonnement_partenaires() returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'nom'), '[]'::jsonb) from (
    select jsonb_build_object(
      'rid', c.rid, 'nom', c.data->>'nom', 'statut', c.data->>'statut', 'adresse', c.data->>'adresse',
      'a_telephone', coalesce(c.data->>'phone', '') <> '', 'a_email', coalesce(c.data->>'email', '') <> '',
      'notes', left(coalesce(c.data->>'notes', ''), 900),
      'nb_interactions', jsonb_array_length(coalesce(c.data->'interactions', '[]'::jsonb)),
      'dernier_contact', (select jsonb_build_object('date', i->>'date', 'type', i->>'type', 'note', left(coalesce(i->>'note', ''), 200))
                            from jsonb_array_elements(coalesce(c.data->'interactions', '[]'::jsonb)) i order by i->>'date' desc nulls last limit 1),
      'jours_depuis_dernier_contact', (select (current_date - (max(i->>'date'))::timestamptz::date)
                            from jsonb_array_elements(coalesce(c.data->'interactions', '[]'::jsonb)) i where coalesce(i->>'date', '') <> '')
    ) x
    from public.crm_records c
    where c.entity = 'clients' and c.deleted_at is null and lower(coalesce(c.data->>'secteur', '')) like 'partenaire%'
  ) q
$$;
revoke all on function public.ai_abonnement_partenaires() from public, anon, authenticated;
grant execute on function public.ai_abonnement_partenaires() to service_role;
