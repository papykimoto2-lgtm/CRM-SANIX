-- Rattache les prospects au logiciel « SANIX CRM Pro » pour que le filtre par logiciel (Messagerie, Marketing, Clients) les liste.
-- 1) Prospects IA recommandés « sanixcrmpro » non encore liés → fiches CRM. 2) Prospects sans logiciel → « SANIX CRM Pro ».
-- Ne touche ni aux fiches déjà rattachées à un autre logiciel, ni aux clients, ni aux interactions. Idempotent. Direction seule (ou migration).
create or replace function public.crm_rattacher_sanixcrmpro() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p record; v_rid text; n_ia int := 0; n_vide int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') and not public.ai_is_direction() then
    raise exception 'Réservé à la direction' using errcode = '42501';
  end if;
  for p in
    select ap.* from public.ai_prospects ap
     where ap.produits_recommandes @> array['sanixcrmpro']::text[] and ap.crm_rid is null
       and not exists (select 1 from public.crm_records r where r.entity = 'clients' and r.deleted_at is null
                        and public.crm_name_norm(r.data->>'nom') = public.crm_name_norm(ap.entreprise))
     order by ap.created_at, ap.id
  loop
    v_rid := 'ai_' || replace(p.id::text, '-', '');
    insert into public.crm_records(entity, rid, data, origin, natural_key, created_at, updated_at)
    values ('clients', v_rid, jsonb_strip_nulls(jsonb_build_object(
      'nom', p.entreprise, 'statut', 'prospect', 'logiciel', 'SANIX CRM Pro', 'secteur', p.secteur, 'adresse', p.adresse, 'ville', p.ville,
      'commune', p.commune, 'phone', p.telephone, 'whatsapp', p.whatsapp, 'email', p.email, 'site_web', p.site_web, 'valeur', p.potentiel_fcfa,
      'notes', coalesce(nullif(p.resume_ia, ''), nullif(p.score_justification, ''), 'Prospect importé dans SANIX CRM Pro depuis la base SANIX AI.'),
      'source', p.source, 'source_url', p.source_url, 'ai_prospect_id', p.id, 'interactions', '[]'::jsonb)),
      'ia', 'ai_prospect:' || p.id::text, p.created_at, p.updated_at)
    on conflict (entity, rid) do nothing;
    update public.ai_prospects set crm_rid = v_rid where id = p.id and crm_rid is null;
    n_ia := n_ia + 1;
  end loop;
  -- Prospects sans logiciel : version et curseur de synchronisation avancés pour que tous les appareils reçoivent le changement.
  update public.crm_records set data = data || jsonb_build_object('logiciel', 'SANIX CRM Pro'),
         version = version + 1, seq = nextval('public.crm_seq'), updated_at = now(), updated_by = 'rattachement_sanixcrmpro'
   where entity = 'clients' and deleted_at is null and data->>'statut' = 'prospect' and coalesce(btrim(data->>'logiciel'), '') = '';
  get diagnostics n_vide = row_count;
  return jsonb_build_object('ok', true, 'prospects_ia_ajoutes', n_ia, 'prospects_sans_logiciel_rattaches', n_vide);
end $$;
revoke all on function public.crm_rattacher_sanixcrmpro() from public, anon;
grant execute on function public.crm_rattacher_sanixcrmpro() to authenticated, service_role;
select public.crm_rattacher_sanixcrmpro();
