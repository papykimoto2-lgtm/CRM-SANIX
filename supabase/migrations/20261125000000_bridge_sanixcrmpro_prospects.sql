-- Relie les prospects IA importés pour SANIX CRM Pro à la liste historique Clients & Prospects.
-- Idempotent : conserve les fiches CRM existantes, n'émet aucun événement de contact.
DO $$
DECLARE p record; v_rid text;
BEGIN
  FOR p IN
    SELECT ap.*
    FROM public.ai_prospects ap
    WHERE ap.produits_recommandes @> ARRAY['sanixcrmpro']::text[]
      AND ap.crm_rid IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.crm_records r
        WHERE r.entity = 'clients'
          AND r.deleted_at IS NULL
          AND public.crm_name_norm(r.data->>'nom') = public.crm_name_norm(ap.entreprise)
      )
    ORDER BY ap.created_at, ap.id
  LOOP
    v_rid := 'ai_' || replace(p.id::text, '-', '');
    INSERT INTO public.crm_records(entity, rid, data, origin, natural_key, created_at, updated_at)
    VALUES (
      'clients',
      v_rid,
      jsonb_strip_nulls(jsonb_build_object(
        'nom', p.entreprise,
        'statut', 'prospect',
        'logiciel', 'SANIX CRM Pro',
        'secteur', p.secteur,
        'adresse', p.adresse,
        'ville', p.ville,
        'commune', p.commune,
        'phone', p.telephone,
        'whatsapp', p.whatsapp,
        'email', p.email,
        'site_web', p.site_web,
        'valeur', p.potentiel_fcfa,
        'notes', coalesce(nullif(p.resume_ia, ''), nullif(p.score_justification, ''), 'Prospect importé dans SANIX CRM Pro depuis la base SANIX AI.'),
        'source', p.source,
        'source_url', p.source_url,
        'ai_prospect_id', p.id,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'interactions', '[]'::jsonb
      )),
      'ia',
      'ai_prospect:' || p.id::text,
      p.created_at,
      p.updated_at
    )
    ON CONFLICT (entity, rid) DO NOTHING;

    UPDATE public.ai_prospects SET crm_rid = v_rid
    WHERE id = p.id AND crm_rid IS NULL;
  END LOOP;
END $$;
