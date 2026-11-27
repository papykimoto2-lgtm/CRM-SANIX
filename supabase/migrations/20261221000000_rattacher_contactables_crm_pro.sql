-- Prospects contactables et à fort potentiel rattachés à SANIX CRM Pro.
-- Critères (réglables) : numéro WhatsApp renseigné, e-mail « vérifié » ou « à confirmer », potentiel ≥ 750 000 FCFA, jamais désinscrit, pas déjà recommandé CRM Pro.
-- Effet : la fiche CRM passe au logiciel « SANIX CRM Pro » (l'ancien logiciel est conservé dans logiciel_precedent) ; téléphone et e-mail vides repris du prospect IA ;
-- « sanixcrmpro » devient le premier produit recommandé du prospect IA. Réversible : crm_annuler_rattachement_contactables(). Direction ou service seulement.
create or replace function public.crm_rattacher_contactables_crm_pro(p_pot_min numeric default 750000, p_appliquer boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p record; v_rid text; v_prec text; liste jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') and not public.ai_is_direction() then
    raise exception 'Réservé à la direction' using errcode = '42501';
  end if;
  for p in
    select ap.* from public.ai_prospects ap
     where not (ap.produits_recommandes @> array['sanixcrmpro']::text[]) and coalesce(btrim(ap.whatsapp), '') <> ''
       and ap.email_statut in ('verifiee', 'a_confirmer') and ap.potentiel_fcfa >= p_pot_min and not coalesce(ap.opt_out, false)
     order by ap.potentiel_fcfa desc, ap.score desc nulls last, ap.entreprise
  loop
    select r.rid, r.data->>'logiciel' into v_rid, v_prec from public.crm_records r
     where r.entity = 'clients' and r.deleted_at is null and (r.rid = p.crm_rid or public.crm_name_norm(r.data->>'nom') = public.crm_name_norm(p.entreprise))
     order by (r.rid = p.crm_rid) desc, r.created_at limit 1;
    liste := liste || jsonb_build_object('entreprise', p.entreprise, 'potentiel', p.potentiel_fcfa, 'avant', v_prec, 'fiche_crm', v_rid is not null);
    if not p_appliquer then continue; end if;
    if v_rid is null then
      v_rid := 'ai_' || replace(p.id::text, '-', '');
      insert into public.crm_records(entity, rid, data, origin, natural_key, created_at, updated_at)
      values ('clients', v_rid, jsonb_strip_nulls(jsonb_build_object('nom', p.entreprise, 'statut', 'prospect', 'logiciel', 'SANIX CRM Pro', 'secteur', p.secteur, 'adresse', p.adresse,
        'ville', p.ville, 'commune', p.commune, 'phone', coalesce(nullif(btrim(p.whatsapp), ''), p.telephone), 'whatsapp', p.whatsapp, 'email', p.email, 'valeur', p.potentiel_fcfa,
        'notes', coalesce(nullif(p.resume_ia, ''), 'Prospect contactable (WhatsApp) à fort potentiel, rattaché à SANIX CRM Pro.'), 'source', p.source, 'ai_prospect_id', p.id, 'interactions', '[]'::jsonb)),
        'ia', 'ai_prospect:' || p.id::text, now(), now())
      on conflict (entity, rid) do nothing;
    else
      update public.crm_records set
        data = data || jsonb_strip_nulls(jsonb_build_object('logiciel', 'SANIX CRM Pro', 'logiciel_precedent', coalesce(v_prec, ''),
          'phone', case when coalesce(btrim(data->>'phone'), '') = '' then coalesce(nullif(btrim(p.whatsapp), ''), p.telephone) end,
          'whatsapp', case when coalesce(btrim(data->>'whatsapp'), '') = '' then p.whatsapp end,
          'email', case when coalesce(btrim(data->>'email'), '') = '' then p.email end)),
        version = version + 1, seq = nextval('public.crm_seq'), updated_at = now(), updated_by = 'rattachement_contactables_crm_pro'
       where entity = 'clients' and rid = v_rid;
    end if;
    update public.ai_prospects set crm_rid = coalesce(crm_rid, v_rid), produits_recommandes = array['sanixcrmpro'] || coalesce(produits_recommandes, '{}'::text[]) where id = p.id;
  end loop;
  return jsonb_build_object('ok', true, 'applique', p_appliquer, 'nombre', jsonb_array_length(liste), 'prospects', liste);
end $$;

create or replace function public.crm_annuler_rattachement_contactables() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; m int;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') and not public.ai_is_direction() then
    raise exception 'Réservé à la direction' using errcode = '42501';
  end if;
  update public.ai_prospects ap set produits_recommandes = array_remove(ap.produits_recommandes, 'sanixcrmpro')
   where ap.crm_rid in (select rid from public.crm_records where entity = 'clients' and updated_by = 'rattachement_contactables_crm_pro' and data ? 'logiciel_precedent');
  get diagnostics m = row_count;
  update public.crm_records set data = (data - 'logiciel_precedent') || jsonb_build_object('logiciel', coalesce(nullif(data->>'logiciel_precedent', ''), data->>'logiciel')),
         version = version + 1, seq = nextval('public.crm_seq'), updated_at = now(), updated_by = 'annulation_rattachement_contactables'
   where entity = 'clients' and updated_by = 'rattachement_contactables_crm_pro' and data ? 'logiciel_precedent';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'fiches_restaurees', n, 'prospects_ia', m);
end $$;
revoke all on function public.crm_rattacher_contactables_crm_pro(numeric, boolean), public.crm_annuler_rattachement_contactables() from public, anon;
grant execute on function public.crm_rattacher_contactables_crm_pro(numeric, boolean), public.crm_annuler_rattachement_contactables() to authenticated, service_role;
