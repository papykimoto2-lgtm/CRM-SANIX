-- Mains et compétences des agents exécutés en mode « abonnement ».
-- 1. Actions encadrées (réservées au service, l'acteur est toujours l'agent de la mission en cours, outil exigé dans ai_agents.outils, plafonds par mission,
--    mêmes règles que le moteur : crm_tools.ts) : qualifier (score), étape du pipeline, créneaux, rendez-vous, compte rendu, offre, escalade, proposition d'action.
-- 2. Compétences : bibliothèque de méthodes par métier (ai_skills) rattachées aux agents (ai_agent_skills), fournies avec chaque mission réclamée.

create or replace function public.ai_abo_agent(p_task uuid, p_outil text) returns public.ai_agents
language plpgsql set search_path = public as $$
declare t public.ai_agent_tasks; a public.ai_agents;
begin
  select * into t from public.ai_agent_tasks where id = p_task for update;
  if t.id is null then raise exception 'Mission introuvable'; end if;
  select * into a from public.ai_agents where id = t.agent_id;
  if a.mode_execution <> 'abonnement' or a.etat <> 'actif' then raise exception 'L''agent n''est pas actif en mode abonnement'; end if;
  if t.statut <> 'en_cours' then raise exception 'La mission n''est pas en cours (statut : %)', t.statut; end if;
  if not (p_outil = any(a.outils)) then raise exception 'Cet agent n''a pas l''outil %', p_outil; end if;
  return a;
end $$;

create or replace function public.ai_abo_plafond(p_task uuid, p_action text, p_max int) returns void
language plpgsql set search_path = public as $$
begin
  if (select count(*) from public.ai_actions where action = p_action and task_id = p_task) >= p_max then
    raise exception 'Plafond de % atteint pour cette mission (%) : clôture et rapporte', p_max, p_action;
  end if;
end $$;

-- Qualification : score /100 (produit 25, besoin 25, taille 15, décideur 15, maturité 10, fiabilité 10) avec justification observable.
create or replace function public.ai_abonnement_qualifier(p_task uuid, p_prospect uuid, p_criteres jsonb, p_justification text,
  p_besoins jsonb default null, p_produits text[] default null, p_resume text default null)
returns jsonb language plpgsql set search_path = public as $$
declare a public.ai_agents; p public.ai_prospects; j text := btrim(coalesce(p_justification, '')); prod text[] := '{}'; x text; y text; r record;
begin
  y := null;
  a := public.ai_abo_agent(p_task, 'update_prospect');
  perform public.ai_abo_plafond(p_task, 'abonnement_qualification', 40);
  if jsonb_typeof(coalesce(p_criteres, 'null'::jsonb)) <> 'object' then raise exception 'criteres : objet {produit, besoin, taille, decideur, maturite, fiabilite} requis'; end if;
  if length(j) < 30 then raise exception 'Score non justifié : justification de 30 caractères au moins (sources, faits vérifiés)'; end if;
  select * into p from public.ai_prospects where id = p_prospect for update;
  if p.id is null then raise exception 'Prospect introuvable'; end if;
  if p_produits is not null then
    foreach x in array p_produits loop
      select id into y from public.ai_products where id = lower(btrim(x)) and actif;
      if y is null then raise exception 'Logiciel hors périmètre commercial actuel'; end if;
      prod := prod || y;
    end loop;
  end if;
  update public.ai_prospects set
    crit_produit = greatest(0, least(coalesce((p_criteres->>'produit')::int, 0), 25)),
    crit_besoin = greatest(0, least(coalesce((p_criteres->>'besoin')::int, 0), 25)),
    crit_finance = greatest(0, least(coalesce((p_criteres->>'taille')::int, 0), 15)),
    crit_decideur = greatest(0, least(coalesce((p_criteres->>'decideur')::int, 0), 15)),
    crit_court_terme = greatest(0, least(coalesce((p_criteres->>'maturite')::int, 0), 10)),
    crit_disponibilite = greatest(0, least(coalesce((p_criteres->>'fiabilite')::int, 0), 10)),
    score_justification = left(j, 2000),
    besoins = case when jsonb_typeof(coalesce(p_besoins, 'null'::jsonb)) = 'array' then (select coalesce(array_agg(left(v, 200)), '{}') from (select jsonb_array_elements_text(p_besoins) v limit 10) q) else besoins end,
    produits_recommandes = case when cardinality(prod) > 0 then (select array_agg(distinct v) from unnest(prod) v) else produits_recommandes end,
    resume_ia = coalesce(left(nullif(btrim(coalesce(p_resume, '')), ''), 2000), resume_ia)
   where id = p.id;
  insert into public.ai_actions(agent, action, agent_id, task_id, prospect_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_qualification', a.id, p_task, p.id, jsonb_build_object('criteres', p_criteres), true, 0);
  select score, priorite into r from public.ai_prospects where id = p.id;
  return jsonb_build_object('ok', true, 'score', r.score, 'priorite', r.priorite);
end $$;

-- Étape du pipeline : étapes engageantes réservées à la direction (ai_guard_stage les refuse au service). Un prospect désinscrit ne peut qu'être « perdu » ou « en_veille ».
create or replace function public.ai_abonnement_etape(p_task uuid, p_prospect uuid, p_stage text, p_motif text)
returns jsonb language plpgsql set search_path = public as $$
declare a public.ai_agents; p public.ai_prospects;
begin
  a := public.ai_abo_agent(p_task, 'set_stage');
  perform public.ai_abo_plafond(p_task, 'abonnement_etape', 40);
  if p_stage <> all (array['identifie','enregistre','qualifie','premier_contact','conversation','besoin_identifie','interesse','rdv_propose','rdv_confirme','demo_realisee','offre_transmise','negociation','offre_acceptee','contrat_transmis','perdu','en_veille']) then
    raise exception 'Étape non autorisée à l''agent (les étapes contrat, paiement et déploiement sont réservées à la direction)';
  end if;
  if length(btrim(coalesce(p_motif, ''))) < 10 then raise exception 'Motif de 10 caractères au moins requis (fait observable)'; end if;
  select * into p from public.ai_prospects where id = p_prospect for update;
  if p.id is null then raise exception 'Prospect introuvable'; end if;
  if p.opt_out and p_stage not in ('perdu', 'en_veille') then raise exception 'Prospect désinscrit : seules les étapes perdu ou en_veille sont possibles'; end if;
  if p.stage is not distinct from p_stage then return jsonb_build_object('info', 'Déjà à cette étape'); end if;
  update public.ai_prospects set stage = p_stage where id = p.id;
  insert into public.ai_actions(agent, action, agent_id, task_id, prospect_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_etape', a.id, p_task, p.id, jsonb_build_object('de', p.stage, 'vers', p_stage, 'motif', left(btrim(p_motif), 300)), true, 0);
  return jsonb_build_object('ok', true, 'de', p.stage, 'vers', p_stage);
end $$;

create or replace function public.ai_abo_commercial(p_prospect uuid) returns uuid
language sql stable set search_path = public as $$
  select coalesce((select owner_id from public.ai_prospects where id = p_prospect),
                  (select user_id from public.ai_operators where role = 'commercial' and actif limit 1));
$$;

-- Créneaux libres (heure d'Abidjan) du commercial responsable du prospect, sur 7 jours.
create or replace function public.ai_abonnement_creneaux(p_task uuid, p_prospect uuid)
returns jsonb language plpgsql set search_path = public as $$
declare op uuid; r jsonb;
begin
  perform public.ai_abo_agent(p_task, 'list_free_slots');
  op := public.ai_abo_commercial(p_prospect);
  if op is null then return jsonb_build_object('info', 'Aucun commercial disponible : escalade avec ai_abonnement_escalade.'); end if;
  select coalesce(jsonb_agg(to_char(debut at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), '[]'::jsonb) into r from public.ai_free_slots(op, 7, 45);
  return jsonb_build_object('operator_id', op, 'creneaux_utc', r, 'note', 'Heures en UTC = heure d''Abidjan.');
end $$;

-- Rendez-vous confirmé PAR LE PROSPECT sur un créneau issu de ai_abonnement_creneaux (le prospect doit avoir accepté : conversation lue dans ai_messages).
create or replace function public.ai_abonnement_rdv(p_task uuid, p_prospect uuid, p_debut timestamptz, p_mode text, p_lieu text default null, p_produit text default null)
returns jsonb language plpgsql set search_path = public as $$
declare a public.ai_agents; p public.ai_prospects; op uuid; v_prod text; ap record;
begin
  a := public.ai_abo_agent(p_task, 'book_appointment');
  perform public.ai_abo_plafond(p_task, 'abonnement_rdv', 10);
  if p_mode not in ('visio', 'physique', 'telephone') then raise exception 'Mode : visio, physique ou telephone'; end if;
  if p_debut is null or p_debut < now() + interval '1 hour' then raise exception 'Créneau invalide ou trop proche'; end if;
  select * into p from public.ai_prospects where id = p_prospect for update;
  if p.id is null then raise exception 'Prospect introuvable'; end if;
  if p.opt_out then raise exception 'Prospect désinscrit'; end if;
  if nullif(btrim(coalesce(p_produit, '')), '') is not null then
    select id into v_prod from public.ai_products where id = lower(btrim(p_produit)) and actif;
    if v_prod is null then raise exception 'Logiciel hors périmètre commercial actuel'; end if;
  end if;
  op := public.ai_abo_commercial(p.id);
  if op is null then raise exception 'Aucun commercial disponible : escalade avec ai_abonnement_escalade'; end if;
  if not exists (select 1 from public.ai_free_slots(op, 14, 45) s where abs(extract(epoch from s.debut - p_debut)) < 60) then
    raise exception 'Créneau hors disponibilités : appelle ai_abonnement_creneaux et choisis un des créneaux proposés';
  end if;
  begin
    insert into public.ai_appointments(prospect_id, operator_id, product_id, debut, fin, mode, lieu, statut, rappel_at, fiche_prep)
    values (p.id, op, v_prod, p_debut, p_debut + interval '45 minutes', p_mode, left(p_lieu, 300), 'confirme', p_debut - interval '2 hours',
            format(E'%s — %s — score %s/100\nBesoins : %s\n%s', p.entreprise, coalesce(p.secteur, '?'), p.score, array_to_string(p.besoins, ', '), coalesce(p.resume_ia, '')))
    returning id, debut into ap;
  exception when exclusion_violation then raise exception 'Créneau déjà pris : propose-en un autre';
  end;
  update public.ai_prospects set stage = 'rdv_confirme', owner_id = op where id = p.id;
  insert into public.ai_approvals(type, prospect_id, objet_id, agent_id, motif, payload)
    values ('transfert_humain', p.id, ap.id, a.id, 'RDV confirmé le ' || to_char(p_debut at time zone 'Africa/Abidjan', 'DD/MM/YYYY à HH24"h"MI') || ' — préparer la démo', jsonb_build_object('id', ap.id, 'debut', ap.debut));
  insert into public.ai_actions(agent, action, agent_id, task_id, prospect_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_rdv', a.id, p_task, p.id, jsonb_build_object('rdv', ap.id, 'debut', ap.debut), true, 0);
  return jsonb_build_object('ok', true, 'rdv', ap.id, 'debut', ap.debut);
end $$;

-- Compte rendu d'un rendez-vous commencé ; l'entonnoir avance à « demo_realisee » si le RDV est réalisé.
create or replace function public.ai_abonnement_compte_rendu(p_task uuid, p_prospect uuid, p_rdv uuid, p_statut text, p_compte_rendu text, p_prochaine_etape text default null)
returns jsonb language plpgsql set search_path = public as $$
declare a public.ai_agents; ap public.ai_appointments; p public.ai_prospects; corps text := btrim(coalesce(p_compte_rendu, ''));
begin
  a := public.ai_abo_agent(p_task, 'record_appointment_report');
  perform public.ai_abo_plafond(p_task, 'abonnement_compte_rendu', 10);
  if p_statut not in ('realise', 'absent', 'annule') then raise exception 'Statut : realise, absent ou annule'; end if;
  select * into ap from public.ai_appointments where id = p_rdv and prospect_id = p_prospect for update;
  if ap.id is null then raise exception 'Rendez-vous introuvable pour ce prospect (select sur public.ai_appointments)'; end if;
  if ap.debut > now() then raise exception 'Ce rendez-vous n''a pas encore commencé : compte rendu impossible'; end if;
  if length(corps) < 20 then raise exception 'Compte rendu trop court : déroulé, besoins exprimés, décisions, prochaine étape'; end if;
  if ap.compte_rendu is not null then raise exception 'Un compte rendu existe déjà : ne l''écrase pas'; end if;
  update public.ai_appointments set statut = p_statut,
    compte_rendu = left(corps || case when nullif(btrim(coalesce(p_prochaine_etape, '')), '') is not null then E'\nProchaine étape : ' || btrim(p_prochaine_etape) else '' end, 4000)
   where id = ap.id;
  if p_statut = 'realise' then
    select * into p from public.ai_prospects where id = p_prospect;
    if p.stage in ('rdv_propose', 'rdv_confirme') then update public.ai_prospects set stage = 'demo_realisee' where id = p.id; end if;
  end if;
  insert into public.ai_actions(agent, action, agent_id, task_id, prospect_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_compte_rendu', a.id, p_task, p_prospect, jsonb_build_object('rdv', ap.id, 'statut', p_statut), true, 0);
  return jsonb_build_object('ok', true, 'rdv', ap.id, 'statut', p_statut);
end $$;

-- Offre calculée depuis la grille officielle (ai_pricing). Remise au-delà de la délégation de l'agent : validation direction ; au-delà du plafond direction : refusée.
create or replace function public.ai_abonnement_offre(p_task uuid, p_prospect uuid, p_produit text, p_lignes jsonb, p_remise numeric default 0)
returns jsonb language plpgsql set search_path = public as $$
declare a public.ai_agents; p public.ai_prospects; v_prod text; l jsonb; g public.ai_pricing; v_qte int; lignes jsonb := '[]'::jsonb; brut numeric := 0; d_agent numeric := 100; d_dir numeric := 100;
  remise numeric := greatest(0, least(coalesce(p_remise, 0), 100)); ht numeric; offer public.ai_offers; v_ap uuid; besoin boolean;
begin
  a := public.ai_abo_agent(p_task, 'create_offer');
  perform public.ai_abo_plafond(p_task, 'abonnement_offre', 10);
  select * into p from public.ai_prospects where id = p_prospect for update;
  if p.id is null then raise exception 'Prospect introuvable'; end if;
  if p.opt_out then raise exception 'Prospect désinscrit'; end if;
  select id into v_prod from public.ai_products where id = lower(btrim(coalesce(p_produit, ''))) and actif;
  if v_prod is null then raise exception 'Logiciel hors périmètre commercial actuel'; end if;
  if jsonb_typeof(coalesce(p_lignes, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_lignes) = 0 or jsonb_array_length(p_lignes) > 20 then raise exception 'lignes : tableau de 1 à 20 éléments {poste, qte}'; end if;
  for l in select * from jsonb_array_elements(p_lignes) loop
    select * into g from public.ai_pricing where product_id = v_prod and actif and poste = l->>'poste';
    if g.poste is null then raise exception 'Poste « % » absent de la grille officielle', left(coalesce(l->>'poste', ''), 60); end if;
    v_qte := greatest(1, least(coalesce((l->>'qte')::int, 1), 1000));
    lignes := lignes || jsonb_build_array(jsonb_build_object('poste', g.poste, 'libelle', g.libelle, 'unite', g.unite, 'qte', v_qte, 'pu_ht', g.prix_ht, 'montant_ht', v_qte * g.prix_ht));
    brut := brut + v_qte * g.prix_ht;
    d_agent := least(d_agent, g.remise_agent_max_pct); d_dir := least(d_dir, g.remise_direction_max_pct);
  end loop;
  if remise > d_dir then raise exception '%', format('Remise %s%% supérieure au plafond direction (%s%%) : refusée', remise, d_dir); end if;
  ht := round(brut * (1 - remise / 100));
  besoin := remise > d_agent;
  insert into public.ai_offers(prospect_id, product_id, lignes, total_brut_ht, remise_pct, total_ht, tva_pct, total_ttc, statut)
    values (p.id, v_prod, lignes, brut, remise, ht, 18, round(ht * 1.18), case when besoin then 'a_valider' else 'validee' end) returning * into offer;
  if besoin then
    insert into public.ai_approvals(type, prospect_id, objet_id, agent_id, motif, payload)
      values ('remise', p.id, offer.id, a.id, format('Remise %s%% > délégation agent %s%% sur %s', remise, d_agent, offer.reference), jsonb_build_object('reference', offer.reference, 'total_ht', offer.total_ht)) returning id into v_ap;
    update public.ai_offers set approval_id = v_ap where id = offer.id;
  end if;
  insert into public.ai_actions(agent, action, agent_id, task_id, prospect_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_offre', a.id, p_task, p.id, jsonb_build_object('offre', offer.id, 'reference', offer.reference, 'remise', remise), true, 0);
  return jsonb_build_object('offre', offer.id, 'reference', offer.reference, 'total_ht', offer.total_ht, 'total_ttc', offer.total_ttc, 'statut', offer.statut,
    'consigne', case when besoin then 'Offre soumise à validation direction : ne communique pas le montant remisé avant accord.' else 'Offre validée : présente référence + totaux HT/TTC (par message en file de validation).' end);
end $$;

create or replace function public.ai_abonnement_escalade(p_task uuid, p_prospect uuid, p_motif text)
returns jsonb language plpgsql set search_path = public as $$
declare a public.ai_agents; v_id uuid;
begin
  a := public.ai_abo_agent(p_task, 'escalate_to_human');
  perform public.ai_abo_plafond(p_task, 'abonnement_escalade', 20);
  if length(btrim(coalesce(p_motif, ''))) < 10 then raise exception 'Motif de 10 caractères au moins requis'; end if;
  if not exists (select 1 from public.ai_prospects where id = p_prospect) then raise exception 'Prospect introuvable'; end if;
  if exists (select 1 from public.ai_approvals where type = 'transfert_humain' and prospect_id = p_prospect and statut = 'en_attente' and agent_id = a.id) then
    return jsonb_build_object('info', 'Un transfert est déjà en attente pour ce prospect');
  end if;
  insert into public.ai_approvals(type, prospect_id, agent_id, task_id, motif) values ('transfert_humain', p_prospect, a.id, p_task, left(btrim(p_motif), 500)) returning id into v_id;
  insert into public.ai_actions(agent, action, agent_id, task_id, prospect_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_escalade', a.id, p_task, p_prospect, jsonb_build_object('approval', v_id), true, 0);
  return jsonb_build_object('ok', true, 'approval_id', v_id);
end $$;

create or replace function public.ai_abonnement_action_commerciale(p_task uuid, p_titre text, p_justification text default null, p_responsable text default null,
  p_echeance date default null, p_objectif_ca numeric default 0, p_segment text default null)
returns jsonb language plpgsql set search_path = public as $$
declare a public.ai_agents;
begin
  a := public.ai_abo_agent(p_task, 'propose_commercial_action');
  perform public.ai_abo_plafond(p_task, 'abonnement_action_commerciale', 5);
  insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok, cout_usd)
    values ('abonnement', 'abonnement_action_commerciale', a.id, p_task, jsonb_build_object('titre', left(coalesce(p_titre, ''), 120)), true, 0);
  return public.ai_propose_commercial_action(a.id, p_titre, p_justification, p_responsable, p_echeance, p_objectif_ca, p_segment);
end $$;

revoke all on function public.ai_abo_agent(uuid, text), public.ai_abo_plafond(uuid, text, int), public.ai_abo_commercial(uuid),
  public.ai_abonnement_qualifier(uuid, uuid, jsonb, text, jsonb, text[], text), public.ai_abonnement_etape(uuid, uuid, text, text),
  public.ai_abonnement_creneaux(uuid, uuid), public.ai_abonnement_rdv(uuid, uuid, timestamptz, text, text, text),
  public.ai_abonnement_compte_rendu(uuid, uuid, uuid, text, text, text), public.ai_abonnement_offre(uuid, uuid, text, jsonb, numeric),
  public.ai_abonnement_escalade(uuid, uuid, text), public.ai_abonnement_action_commerciale(uuid, text, text, text, date, numeric, text) from public, anon, authenticated;
grant execute on function public.ai_abo_agent(uuid, text), public.ai_abo_plafond(uuid, text, int), public.ai_abo_commercial(uuid),
  public.ai_abonnement_qualifier(uuid, uuid, jsonb, text, jsonb, text[], text), public.ai_abonnement_etape(uuid, uuid, text, text),
  public.ai_abonnement_creneaux(uuid, uuid), public.ai_abonnement_rdv(uuid, uuid, timestamptz, text, text, text),
  public.ai_abonnement_compte_rendu(uuid, uuid, uuid, text, text, text), public.ai_abonnement_offre(uuid, uuid, text, jsonb, numeric),
  public.ai_abonnement_escalade(uuid, uuid, text), public.ai_abonnement_action_commerciale(uuid, text, text, text, date, numeric, text) to service_role;

-- ===== Compétences par métier =====
create table if not exists public.ai_skills (
  code text primary key check (code ~ '^[a-z0-9_]{3,50}$'),
  nom text not null,
  description text not null,
  contenu text not null check (char_length(contenu) between 50 and 6000),
  actif boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.ai_agent_skills (
  agent_id uuid not null references public.ai_agents(id) on delete cascade,
  skill_code text not null references public.ai_skills(code) on delete cascade on update cascade,
  ordre int not null default 1,
  primary key (agent_id, skill_code)
);
alter table public.ai_skills enable row level security;
alter table public.ai_agent_skills enable row level security;
drop policy if exists dir_read on public.ai_skills;
create policy dir_read on public.ai_skills for select using (public.ai_is_direction());
drop policy if exists dir_read on public.ai_agent_skills;
create policy dir_read on public.ai_agent_skills for select using (public.ai_is_direction());
revoke all on public.ai_skills, public.ai_agent_skills from anon, authenticated;
grant select on public.ai_skills, public.ai_agent_skills to authenticated;

-- Réclamation : ajoute les compétences de l'agent à chaque mission
create or replace function public.ai_abonnement_reclamer(p_n int default 1) returns jsonb
language plpgsql set search_path = public as $$
declare g public.ai_governance; r record; got public.ai_agent_tasks; out jsonb := '[]'::jsonb; n int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('ai_claim_tasks'));
  select * into g from public.ai_governance where id = 1;
  if not coalesce(g.actif, true) then return out; end if;
  update public.ai_agent_tasks t set statut = 'a_faire',
         progression = left(coalesce(t.progression,'') || E'\n[Système] Exécution par abonnement interrompue, reprise.', 8000)
   where t.statut = 'en_cours' and t.started_at < now() - interval '6 hours'
     and exists (select 1 from public.ai_agents a where a.id = t.agent_id and a.mode_execution = 'abonnement');
  -- trop de tentatives ⇒ blocage + incident (comme ai_claim_tasks pour le mode API)
  for r in select t.id, t.agent_id, t.titre from public.ai_agent_tasks t join public.ai_agents a on a.id = t.agent_id
            where a.mode_execution = 'abonnement' and t.statut = 'a_faire' and t.executions - t.reprises >= g.max_executions_tache loop
    update public.ai_agent_tasks set statut = 'bloquee' where id = r.id;
    perform public.ai_register_incident(r.agent_id, r.id, 'tentatives_epuisees', 'attention',
      'Mission « ' || r.titre || ' » bloquée après ' || g.max_executions_tache || ' exécutions (mode abonnement)', true);
  end loop;
  for r in select t.id from public.ai_agent_tasks t join public.ai_agents a on a.id = t.agent_id
            where t.statut = 'a_faire' and a.etat = 'actif' and a.mode_execution = 'abonnement' and a.activite <> 'en_reunion'
              and not exists (select 1 from public.ai_task_dependencies d join public.ai_agent_tasks x on x.id = d.depend_de
                               where d.task_id = t.id and x.statut <> 'terminee')
            order by t.priorite, t.created_at loop
    exit when n >= greatest(1, least(p_n, 5));
    got := null;
    update public.ai_agent_tasks t set statut = 'en_cours', started_at = now(), executions = t.executions + 1
     where t.id = r.id and t.statut = 'a_faire'
       and not exists (select 1 from public.ai_agent_tasks y where y.agent_id = t.agent_id and y.statut = 'en_cours')
    returning t.* into got;
    if got.id is null then continue; end if;
    n := n + 1;
    out := out || jsonb_build_array(jsonb_build_object(
      'tache', jsonb_build_object('id', got.id, 'titre', got.titre, 'type', got.type, 'description', got.description, 'objectifs', got.objectifs,
                                 'entrees', got.entrees, 'priorite', got.priorite, 'echeance', got.echeance, 'progression', got.progression, 'executions', got.executions),
      'agent', (select jsonb_build_object('code', a.code, 'nom', a.nom, 'fonction', a.fonction, 'niveau', a.niveau, 'outils', a.outils, 'specialite', a.specialite, 'personnalite', a.personnalite)
                  from public.ai_agents a where a.id = got.agent_id),
      'charte', (select c.contenu from public.ai_agent_charters c where c.agent_id = got.agent_id order by c.version desc limit 1),
      -- mémoire : les souvenirs les plus importants et récents de l'agent + la mémoire partagée, plus ceux qui correspondent aux mots de la mission
      'memoire', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'contenu', q.contenu, 'tags', q.tags, 'partage', q.agent_id is null, 'date', q.created_at) order by q.rang)
                             from (select m.*, row_number() over (order by (m.fts @@ websearch_to_tsquery('french'::regconfig, left(got.titre, 300))) desc, m.importance desc, m.created_at desc) rang
                                     from public.ai_agent_memory m where m.agent_id = got.agent_id or m.agent_id is null) q where q.rang <= 8), '[]'::jsonb),
      -- compétences : méthodes de métier rattachées à l'agent (ai_skills)
      'competences', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'nom', s.nom, 'methode', s.contenu) order by k.ordre, s.code)
                                 from public.ai_agent_skills k join public.ai_skills s on s.code = k.skill_code and s.actif where k.agent_id = got.agent_id), '[]'::jsonb)));
    insert into public.ai_actions(agent, action, agent_id, task_id, payload, ok, cout_usd)
      values ('abonnement', 'abonnement_reclamee', got.agent_id, got.id, jsonb_build_object('titre', got.titre), true, 0);
  end loop;
  return out;
end $$;

-- ===== Contenu des compétences (méthodes générales ; aucun chiffre ni fait propre à SANIX n'y est inventé : les faits viennent de la base et des sources lues) =====
insert into public.ai_skills(code, nom, description, contenu) values
('pilotage_direction', 'Pilotage et délégation', 'Déléguer, évaluer, synthétiser pour le président',
$sk$MÉTHODE
1. Lis d'abord la mémoire et les rapports des sous-missions précédentes : ne délègue pas ce qui est déjà fait.
2. Une mission déléguée = un résultat vérifiable : titre précis, périmètre, livrable attendu (champ resultat_attendu), échéance réaliste, priorité 1 à 5. Pas de mission vague (« améliorer… »).
3. Une mission par agent et par sujet ; découpe en sous-missions indépendantes plutôt qu'en une grande ; utilise les dépendances seulement si l'ordre est réellement imposé.
4. Évalue chaque sous-mission terminée : note /100 avec un commentaire factuel (ce qui est prouvé, ce qui manque), jamais de note sans preuve lue.
5. Ta synthèse au président : 1) ce qui est fait (chiffres lus en base), 2) ce qui bloque et pourquoi, 3) la décision précise qu'on attend de lui, avec une recommandation.
6. Ne contourne jamais une règle de gouvernance : un plafond atteint est un signal à rapporter.$sk$),
('prospection_web', 'Prospection web', 'Trouver des entreprises réelles et leurs coordonnées publiques',
$sk$MÉTHODE
1. Cible = secteur + ville/commune du logiciel actif. Recherche par annuaires professionnels, sites d'entreprises, ordres/chambres, pages « contact » ; ouvre chaque page avant d'enregistrer.
2. Une fiche = entreprise réelle, source_url https de la page où tu l'as lue, données PUBLIQUES seulement (téléphone, e-mail, site, décideur et fonction s'ils sont publiés). Champ non publié = null ; jamais de coordonnée devinée (pas de prénom.nom@).
3. Avant de créer : vérifie le doublon (select sur ai_prospects par nom, téléphone, domaine). Réponse « doublon » : passe à la suivante.
4. Priorité aux fiches joignables (téléphone/WhatsApp ou e-mail publié) et au décideur identifié.
5. Rapport : nombre créé, sources utilisées, requêtes qui ont marché, secteurs/zones restant à couvrir. Cherche les entreprises que les autres chasseurs n'ont pas couvertes (lis tes souvenirs).$sk$),
('qualification_score', 'Qualification et score', 'Noter un prospect sur 100 avec preuves',
$sk$GRILLE (total 100) : produit /25 (adéquation avec le logiciel), besoin /25 (besoin exprimé ou observable), taille /15 (taille et potentiel), decideur /15 (décideur identifié et joignable), maturite /10 (maturité numérique : site, outils actuels), fiabilite /10 (fiabilité des informations).
RÈGLES
- Chaque point doit s'appuyer sur un fait observable (page lue, message du prospect, donnée de la fiche). Sans fait : note basse sur ce critère et dis-le.
- justification : sources et faits en 30 caractères minimum ; pas d'adjectifs sans preuve.
- Ne surévalue pas : un score élevé déclenche des actions humaines coûteuses. En cas de doute, note bas et propose la vérification à faire.
- Étape : n'avance le pipeline que sur un fait (réponse du prospect, besoin confirmé), jamais sur une intuition ; les étapes de contrat et de paiement appartiennent à la direction.$sk$),
('redaction_message', 'Rédaction de messages commerciaux', 'Messages WhatsApp et e-mails courts, personnalisés, sûrs',
$sk$MÉTHODE
1. Lis la fiche (secteur, besoins, produits recommandés) et le fil des messages avant d'écrire. Ne répète jamais un message déjà envoyé.
2. WhatsApp : 3 à 5 lignes, ton cordial et direct, une seule question ou un seul appel à l'action. E-mail : objet concret (≤ 60 caractères, sans majuscules agressives), 80 à 150 mots, une seule proposition.
3. Personnalise avec un fait réel sur l'entreprise (son secteur, sa ville, son besoin constaté). Aucun prix, délai, remise ou garantie non validés ; aucune statistique inventée.
4. Structure : accroche personnalisée → valeur concrète pour CE prospect → appel à l'action simple (échange de 15 minutes, démonstration, réponse oui/non).
5. Écris en français simple ; adapte le vouvoiement. Jamais de pression ni de fausse urgence.
6. Le message part toujours en file de validation du président ; ne le renvoie pas une fois en attente.$sk$),
('relance_sequence', 'Séquence de relance', 'Relancer au bon moment sans harceler',
$sk$MÉTHODE
- Rythme : J+3 (rappel utile avec un élément nouveau), J+7 (valeur différente : cas d'usage, démonstration), J+14 (dernier message, porte ouverte). Pas plus de 3 relances sans réponse, puis étape en_veille.
- Change d'angle et de canal à chaque relance ; préfère WhatsApp quand un numéro existe et que l'e-mail est douteux (email_statut invalide ou à confirmer).
- Chaque relance apporte quelque chose de nouveau ; jamais « je me permets de relancer » seul.
- Arrête tout dès qu'un prospect répond négativement ou demande à ne plus être contacté (opt_out) ; ne planifie pas de relance sur une fiche désinscrite.
- Planifie avec un scénario précis (quoi dire) pour que la relance soit rédigée sans ambiguïté.$sk$),
('decouverte_besoins', 'Découverte des besoins', 'Poser les bonnes questions avant de proposer',
$sk$MÉTHODE
1. Pars des questions de découverte du logiciel (get_product → questions_decouverte) et adapte-les au secteur.
2. Ordre : situation actuelle (comment font-ils aujourd'hui, avec quels outils) → problème (ce qui leur coûte du temps ou de l'argent) → impact (conséquence chiffrée si possible, d'après le prospect) → décision (qui décide, quel calendrier, quel budget).
3. Une ou deux questions à la fois ; reformule la réponse du prospect avant de continuer.
4. Note les besoins avec les mots du prospect ; ne déduis rien qu'il n'a pas dit.
5. Recommande le logiciel seulement après avoir confirmé un besoin ; si aucun ne convient, dis-le (en_veille) plutôt que de forcer.$sk$),
('traitement_objections', 'Traitement des objections', 'Répondre aux objections avec la bibliothèque officielle',
$sk$MÉTHODE
1. Consulte la bibliothèque (select sur public.ai_objections : objection, diagnostic, réponse, prochaine étape) avant de répondre ; adapte sans trahir le fond.
2. Écoute → reformule → diagnostique la vraie raison (prix, timing, confiance, concurrent, pas de besoin) → réponds par un fait ou une question → propose une prochaine étape concrète.
3. Ne discute pas le prix hors grille ; ne promets rien. Si le prospect exige un humain, a un litige ou un grand compte : escalade (ai_abonnement_escalade).
4. Un « non » ferme est respecté : étape perdue ou en_veille avec le motif, pas d'insistance.$sk$),
('prise_rdv', 'Prise de rendez-vous', 'Planifier une démonstration sans erreur',
$sk$MÉTHODE
1. Un rendez-vous n'est réservé qu'avec l'accord explicite du prospect (lis le fil des messages) sur un créneau issu de ai_abonnement_creneaux.
2. Propose 2 créneaux (heure d'Abidjan, jour et date en toutes lettres) et le mode (visio, téléphone, physique) ; confirme par message (en file de validation).
3. Après réservation : l'étape passe à rdv_confirme et la direction est alertée pour préparer la démonstration. Planifie un rappel.
4. Si aucun commercial n'est disponible ou si le prospect refuse tous les créneaux : escalade avec le motif.
5. Ne réserve jamais pour un prospect désinscrit ; ne double-réserve pas.$sk$),
('compte_rendu_rdv', 'Compte rendu de rendez-vous', 'Rendre compte fidèlement',
$sk$STRUCTURE (20 caractères minimum, viser 8 à 15 lignes) : 1) participants et durée, 2) déroulé, 3) besoins exprimés (mots du prospect), 4) objections et réponses, 5) décisions prises, 6) prochaine étape datée et son responsable.
RÈGLES : factuel, sans interprétation flatteuse ; statut realise / absent / annule selon les faits ; un compte rendu existant n'est jamais écrasé. Après un rendez-vous réalisé, propose la suite (offre, relance) au responsable.$sk$),
('offre_commerciale', 'Offre commerciale', 'Construire une offre conforme à la grille officielle',
$sk$MÉTHODE
1. Ne chiffre qu'à partir de la grille officielle (get_product / select sur ai_pricing) : postes et prix publiés uniquement. Pas de grille = pas de prix, escalade.
2. Compose les lignes (poste, quantité) selon le besoin confirmé du prospect, pas selon le plus gros panier.
3. Remise : jamais proposée spontanément ; si le prospect la demande, reste dans la délégation de l'agent ; au-delà, l'offre part en validation direction et le montant remisé n'est pas communiqué avant accord ; au-delà du plafond direction, c'est refusé.
4. Présente référence + totaux HT/TTC ; la transmission au prospect passe par un message en file de validation.$sk$),
('recherche_financeurs', 'Recherche de financeurs', 'Identifier et documenter des financeurs réels',
$sk$MÉTHODE
1. Cible : fonds, programmes d'accélération, banques, subventions et investisseurs actifs en Afrique de l'Ouest/Côte d'Ivoire pour une startup logicielle. Lis les pages officielles (https) ; une information sans source lue = « non vérifié ».
2. Pour chaque financeur : type, ticket min/max (si publié), critères d'éligibilité, dates et statut des appels (ouvert/fermé, avec la date de lecture), pays couverts, contact public (e-mail ou formulaire publié), lien de candidature.
3. Compare à la situation de SANIX lue dans levee_etat : indique l'éligibilité probable, ce qui manque (documents, RCCM, chiffres) et un score de priorité motivé.
4. Complète les cases vides des tables levee_*, sans écraser ce que le président a saisi ; ajoute une ligne datée dans notes. Jamais de contact personnel deviné.
5. Rapport : nouveaux financeurs, appels ouverts avec date limite, prochaines actions pour le président. Rien n'est envoyé à un financeur sans sa validation.$sk$),
('veille_concurrentielle', 'Veille concurrentielle', 'Surveiller les concurrents avec sources datées',
$sk$MÉTHODE
1. Liste les concurrents directs (même logiciel/secteur/marché) et indirects (tableurs, outils internationaux). Pour chacun : offre, prix publics, positionnement, clients cités, nouveautés ; source https et date de lecture à chaque fait.
2. Compare sur des critères mesurables (fonctions, prix, langue, support local, paiement mobile) ; marque « non vérifié » ce qui n'est pas publié.
3. Conclus par des implications actionnables pour SANIX (argument à mettre en avant, objection à anticiper), pas par un simple inventaire.
4. Compare avec ta veille précédente (mémoire) : ne rapporte que ce qui a changé.$sk$),
('etude_marche', 'Étude de marché', 'Estimer et segmenter un marché avec méthode',
$sk$MÉTHODE
1. Définis le segment (secteur, taille, zone) et la question à trancher avant de chercher.
2. Sources : statistiques officielles, chambres de commerce, rapports sectoriels, annuaires — en https, avec date. Distingue donnée lue et estimation ; une estimation donne son calcul (population cible × taux d'équipement × prix) et sa marge d'incertitude.
3. Sors : taille du segment, dynamique, concurrents, freins, canaux d'accès, recommandation de priorisation.
4. Termine par ce qui reste inconnu et comment le lever (enquête, appels, test). Pas de chiffre sans source ni calcul.$sk$),
('contenu_marketing', 'Contenu marketing', 'Contenus utiles, vrais et orientés action',
$sk$MÉTHODE
1. Pars d'un problème réel du lecteur (secteur, ville) et d'une preuve (fonction du logiciel, cas réel validé) — jamais de témoignage ou de chiffre inventé.
2. Structure : accroche problème → solution concrète → preuve → appel à l'action unique (démo, message WhatsApp). Ton clair, phrases courtes, français simple, adapté à l'Afrique de l'Ouest.
3. Adapte au support : LinkedIn/Facebook (600 caractères, 1 idée), e-mail (objet concret), page web (titres explicites). Propose 2 variantes quand c'est utile.
4. Rien n'est publié sans validation ; livre le contenu prêt à valider avec ses sources.$sk$),
('qualite_donnees', 'Qualité des données', 'Nettoyer et fiabiliser les fiches',
$sk$MÉTHODE
1. Normalise sans inventer : e-mail en minuscules sans espaces ; téléphones au format international (+225 pour la Côte d'Ivoire) ; noms d'entreprise sans doublon.
2. Détecte les doublons (même téléphone, domaine ou nom approchant) et signale-les, sans fusionner toi-même.
3. Une adresse n'est corrigée sans source que pour une faute évidente (domaine webmail) ; sinon exige une page publique (source_url https). Jamais d'adresse devinée.
4. Mesure avant/après (nombre de fiches corrigées, invalides, à confirmer) et rapporte les cas douteux au lieu de les forcer.$sk$),
('succes_client', 'Succès client', 'Fidéliser et développer les comptes',
$sk$MÉTHODE
1. Pour chaque client : usage réel, satisfaction exprimée, risques (impayés, inactivité), opportunités (modules ou licences supplémentaires correspondant à un besoin dit).
2. Contacte à des moments utiles (J+7 après démarrage, avant renouvellement), avec une valeur concrète — pas de message générique.
3. Une plainte ou un litige est escaladé à un humain immédiatement, avec les faits.
4. Rapporte : clients à risque, opportunités, retours produit à transmettre.$sk$),
('admin_documents', 'Administration et documents', 'Classer et tenir les pièces conformes',
$sk$MÉTHODE
1. Nomme et classe selon une nomenclature stable (date AAAA-MM-JJ, type, tiers, version) ; une pièce, un emplacement.
2. Vérifie la complétude avant de transmettre (signatures, dates, mentions légales) ; liste ce qui manque et qui doit le fournir.
3. Suis les échéances (renouvellements, déclarations, dépôts) avec une date et un responsable ; alerte à J-14 et J-3.
4. Ne rédige aucun engagement juridique ou financier ; prépare, puis fais valider par le président.$sk$)
on conflict (code) do update set nom = excluded.nom, description = excluded.description, contenu = excluded.contenu, updated_at = now();

insert into public.ai_agent_skills(agent_id, skill_code, ordre)
select a.id, v.s, v.o from (values
 ('sanix_ai_general_director','pilotage_direction',1),
 ('ia_dir_admin','pilotage_direction',1),('ia_dir_admin','admin_documents',2),
 ('ia_dir_client','pilotage_direction',1),('ia_dir_client','succes_client',2),
 ('ia_dir_intel','pilotage_direction',1),('ia_dir_intel','etude_marche',2),('ia_dir_intel','veille_concurrentielle',3),
 ('ia_dir_marketing','pilotage_direction',1),('ia_dir_marketing','contenu_marketing',2),
 ('sanix_ai_sales_director','pilotage_direction',1),('sanix_ai_sales_director','qualification_score',2),('sanix_ai_sales_director','relance_sequence',3),
 ('ia_content','contenu_marketing',1),
 ('ia_docs','admin_documents',1),('ia_docs','qualite_donnees',2),
 ('ia_market','etude_marche',1),('ia_market','veille_concurrentielle',2),
 ('ia_resp_prospection','pilotage_direction',1),('ia_resp_prospection','prospection_web',2),('ia_resp_prospection','qualification_score',3),('ia_resp_prospection','relance_sequence',4),
 ('ia_social','contenu_marketing',1),
 ('ia_success','succes_client',1),('ia_success','redaction_message',2),('ia_success','relance_sequence',3),
 ('ia_veille','veille_concurrentielle',1),
 ('sanix_ai_fundraising_director','recherche_financeurs',1),('sanix_ai_fundraising_director','etude_marche',2),
 ('ia_sup_distribution','pilotage_direction',1),('ia_sup_distribution','prospection_web',2),('ia_sup_distribution','qualification_score',3),
 ('ia_sup_immo','pilotage_direction',1),('ia_sup_immo','prospection_web',2),('ia_sup_immo','qualification_score',3),
 ('ia_sup_sante','pilotage_direction',1),('ia_sup_sante','prospection_web',2),('ia_sup_sante','qualification_score',3),
 ('ia_enrich_1','qualite_donnees',1),('ia_enrich_1','qualification_score',2),
 ('ia_hunter_1','prospection_web',1),('ia_hunter_1','qualite_donnees',2),
 ('ia_hunter_2','prospection_web',1),('ia_hunter_2','qualite_donnees',2),
 ('ia_hunter_3','prospection_web',1),('ia_hunter_3','qualite_donnees',2),
 ('ia_mail_1','redaction_message',1),('ia_mail_1','relance_sequence',2),('ia_mail_1','traitement_objections',3),
 ('ia_nego_1','traitement_objections',1),('ia_nego_1','offre_commerciale',2),('ia_nego_1','decouverte_besoins',3),('ia_nego_1','compte_rendu_rdv',4),
 ('ia_qualif_1','qualification_score',1),('ia_qualif_1','decouverte_besoins',2),('ia_qualif_1','qualite_donnees',3),
 ('ia_rdv_1','prise_rdv',1),('ia_rdv_1','compte_rendu_rdv',2),('ia_rdv_1','relance_sequence',3),
 ('ia_wa_1','redaction_message',1),('ia_wa_1','relance_sequence',2),('ia_wa_1','traitement_objections',3)
) v(c, s, o) join public.ai_agents a on a.code = v.c
on conflict (agent_id, skill_code) do update set ordre = excluded.ordre;
