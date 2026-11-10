-- ═════════════════════════════════════════════════════════════════════════════
--  SANIX AI — PARAMÉTRAGE : rôles, équipes (cellules par logiciel), agents et logiciels configurables (additif et relançable)
--  Rien de l'organisation ni du catalogue n'est figé dans le code : tout est donnée, modifiable par la direction.
--  1. ai_roles        : modèles de postes (niveau, département, outils, personnalité, charte type).
--  2. ai_agents.role_code : le poste que tient un agent.
--  3. ai_cells / ai_cell_members : une cellule par logiciel (n'importe lequel du catalogue) ; qui y tient quel rôle. Les agents peuvent être mutualisés.
--  4. ai_agent_for(logiciel, rôle) : résolution de l'agent (cellule du logiciel, puis tout agent actif portant le rôle).
--  5. Routage CRM ↔ IA par rôle : crm_ai_routing et crm_ai_stage_owner gardent le code d'agent en repli.
--  6. Fonctions d'administration (direction seule) : logiciels, équivalences de noms, rôles, cellules, création et modification d'agents.
--  Les contenus ci-dessous (rôles, cellules des trois logiciels) sont une configuration PAR DÉFAUT : la direction peut tout changer sans code.
-- ═════════════════════════════════════════════════════════════════════════════

do $$ begin
  if to_regclass('public.crm_ai_routing') is null or to_regprocedure('public.ai_product_of(text)') is null then
    raise exception 'Appliquer d''abord les migrations 20261111 (connecteur) et 20261113 (Phase 2)' using errcode = '55000';
  end if;
end $$;

-- ─── 1. Rôles (modèles de postes) ────────────────────────────────────────────
create table if not exists public.ai_roles (
  code          text primary key check (code ~ '^[a-z0-9_]{3,40}$'),
  libelle       text not null check (char_length(libelle) between 2 and 120),
  description   text not null default '' check (char_length(description) <= 1000),
  niveau        smallint not null check (niveau between 1 and 5),
  departement_id text references public.ai_departments(id),
  outils        text[] not null default '{}',
  effort        text not null default 'medium' check (effort in ('low', 'medium', 'high')),
  personnalite  text check (personnalite is null or char_length(personnalite) <= 500),
  specialite    text check (specialite is null or char_length(specialite) <= 500),
  actif         boolean not null default true,
  updated_at    timestamptz not null default now()
);
insert into public.ai_roles(code, libelle, description, niveau, departement_id, outils, effort) values
  ('directeur_general', 'Directeur général IA', 'Coordonne l''organisation, reçoit les objectifs du président, crée et contrôle les missions.', 1, 'direction',
     array['creer_agent','modifier_agent','changer_etat_agent','assigner_mission','attendre_sous_taches','evaluer_tache','consulter_performance','convoquer_reunion','consulter_indicateurs','demander_ressources','repondre_president'], 'high'),
  ('directeur_commercial', 'Directeur commercial IA', 'Responsable de la performance commerciale : objectifs par logiciel, répartition, suivi des opportunités.', 2, 'direction',
     array['creer_agent','modifier_agent','changer_etat_agent','assigner_mission','attendre_sous_taches','evaluer_tache','consulter_performance','convoquer_reunion','consulter_indicateurs','demander_ressources','transmettre','lister_prospects','get_prospect','recommend_products','get_product','propose_commercial_action'], 'high'),
  ('directeur_administratif', 'Directeur administratif IA', 'Responsable de l''administration : facturation, encaissements, documents.', 2, 'administratif',
     array['creer_agent','modifier_agent','changer_etat_agent','assigner_mission','attendre_sous_taches','evaluer_tache','consulter_performance','consulter_indicateurs','convoquer_reunion','demander_ressources','transmettre'], 'high'),
  ('responsable_prospection', 'Responsable de la prospection', 'Coordonne les cellules commerciales : recherche, enrichissement, qualification, prise de contact.', 3, 'commercial',
     array['assigner_mission','attendre_sous_taches','evaluer_tache','consulter_performance','consulter_indicateurs','convoquer_reunion','demander_ressources','transmettre','lister_prospects','get_prospect','recommend_products','get_product','schedule_followup','escalate_to_human','propose_commercial_action'], 'medium'),
  ('superviseur_cellule', 'Superviseur de cellule', 'Supervise une cellule commerciale (un logiciel) : répartition des prospects, contrôle des argumentaires.', 4, 'commercial',
     array['assigner_mission','attendre_sous_taches','evaluer_tache','consulter_performance','transmettre','lister_prospects','get_prospect','get_product'], 'medium'),
  ('market_intelligence', 'Market Intelligence', 'Étudie les marchés, identifie les segments prioritaires et les arguments différenciants.', 3, 'intelligence',
     array['recherche_web','lister_prospects','transmettre'], 'medium'),
  ('lead_hunter', 'Lead Hunter', 'Identifie les entreprises susceptibles d''acheter un logiciel, distingue le vérifié du supposé, enregistre la source.', 5, 'commercial',
     array['recherche_web','create_prospect','transmettre'], 'medium'),
  ('lead_enrichment', 'Lead Enrichment', 'Enrichit les prospects du CRM : existence, activité, localisation, décideurs publics, sources et date de vérification. Ne jamais inventer.', 5, 'commercial',
     array['recherche_web','get_prospect','update_prospect','transmettre'], 'medium'),
  ('qualification', 'Qualification', 'Note le potentiel commercial sur 100 avec justification et choisit l''étape du pipeline.', 5, 'commercial',
     array['lister_prospects','get_prospect','update_prospect','set_stage','get_product','recommend_products','transmettre'], 'medium'),
  ('commercial_produit', 'Commercial produit', 'Transforme les informations en opportunités : besoins, argumentaire et démonstration d''un logiciel.', 5, 'commercial',
     array['lister_prospects','get_prospect','get_product','recommend_products','get_objection','schedule_followup','escalate_to_human','transmettre'], 'medium'),
  ('communication', 'Communication', 'Prépare les messages commerciaux personnalisés (WhatsApp, e-mail) ; envois soumis à la gouvernance.', 5, 'commercial',
     array['send_message','get_prospect','get_product','get_objection','schedule_followup','transmettre'], 'medium'),
  ('appointment_manager', 'Appointment Manager', 'Transforme l''intérêt en rendez-vous : créneaux, invitations, compte rendu.', 5, 'commercial',
     array['get_prospect','list_free_slots','book_appointment','record_appointment_report','schedule_followup','transmettre'], 'medium'),
  ('followup_manager', 'Follow-up Manager', 'Suit les opportunités : prospects sans réponse, relances, objections, cas sensibles.', 5, 'commercial',
     array['lister_prospects','get_prospect','schedule_followup','escalate_to_human','transmettre'], 'medium'),
  ('proposal_generator', 'Proposal Generator', 'Prépare les propositions commerciales depuis le catalogue et la grille tarifaire validée.', 5, 'commercial',
     array['get_prospect','get_product','recommend_products','create_offer','transmettre'], 'medium'),
  ('negotiation_manager', 'Negotiation Manager', 'Assiste la négociation : objections, offres, stratégie. Tout prix ou engagement reste soumis à validation.', 5, 'commercial',
     array['get_prospect','get_product','recommend_products','get_objection','create_offer','record_appointment_report','escalate_to_human','transmettre'], 'medium'),
  ('customer_success', 'Customer Success', 'Accompagne les clients après la vente : satisfaction, déploiement, extension, renouvellement.', 3, 'relation_client',
     array['lister_prospects','get_prospect','get_product','recommend_products','schedule_followup','transmettre'], 'medium'),
  ('sales_analyst', 'Sales Analyst', 'Mesure les performances commerciales : entonnoir, coûts, rentabilité.', 5, 'commercial',
     array['lister_prospects','get_prospect','transmettre'], 'low'),
  ('gestion_documents', 'Gestionnaire de documents', 'Prépare et contrôle les contrats et documents de commande.', 3, 'administratif',
     array['get_prospect','get_product','transmettre'], 'low')
on conflict (code) do nothing;

-- ─── 2. Rôle tenu par chaque agent ───────────────────────────────────────────
alter table public.ai_agents add column if not exists role_code text references public.ai_roles(code);
create index if not exists ai_agents_role on public.ai_agents(role_code) where role_code is not null;

-- ─── 3. Cellules (une par logiciel du catalogue) et leurs membres ────────────
create table if not exists public.ai_cells (
  id                   text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  nom                  text not null check (char_length(nom) between 2 and 120),
  product_id           text not null references public.ai_products(id),
  responsable_agent_id uuid references public.ai_agents(id) on delete set null,
  description          text check (description is null or char_length(description) <= 1000),
  actif                boolean not null default true,
  updated_at           timestamptz not null default now()
);
create unique index if not exists ai_cells_produit_actif on public.ai_cells(product_id) where actif;
create table if not exists public.ai_cell_members (
  cell_id   text not null references public.ai_cells(id) on delete cascade,
  role_code text not null references public.ai_roles(code),
  agent_id  uuid not null references public.ai_agents(id) on delete cascade,
  ordre     smallint not null default 0,
  primary key (cell_id, role_code, agent_id)
);
create index if not exists ai_cell_members_agent on public.ai_cell_members(agent_id);

-- Organisation PAR DÉFAUT (rôles des agents connus, trois cellules, membres) : relançable sans effet de bord, à relancer après seed_agents.sql.
-- La direction la modifie ensuite sans code (écran Paramétrage ou fonctions ai_cfg_*) ; relancer cette fonction ne retire jamais un choix déjà fait.
create or replace function public.ai_defaut_organisation() returns void
language plpgsql security definer set search_path = public, pg_temp as $f$
begin
update public.ai_agents a set role_code = m.role
  from (values
    ('sanix_ai_general_director', 'directeur_general'), ('sanix_ai_sales_director', 'directeur_commercial'), ('ia_dir_admin', 'directeur_administratif'),
    ('ia_resp_prospection', 'responsable_prospection'), ('ia_sup_immo', 'superviseur_cellule'), ('ia_sup_sante', 'superviseur_cellule'), ('ia_sup_distribution', 'superviseur_cellule'),
    ('ia_market', 'market_intelligence'), ('ia_hunter_1', 'lead_hunter'), ('ia_hunter_2', 'lead_hunter'), ('ia_hunter_3', 'lead_hunter'),
    ('ia_enrich_1', 'lead_enrichment'), ('ia_qualif_1', 'qualification'), ('ia_wa_1', 'communication'), ('ia_mail_1', 'communication'),
    ('ia_rdv_1', 'appointment_manager'), ('ia_nego_1', 'negotiation_manager'), ('ia_success', 'customer_success'), ('ia_docs', 'gestion_documents')
  ) m(code, role)
 where a.code = m.code and a.role_code is null;


-- Configuration par défaut des trois cellules (modifiable : aucun code ne s'y réfère). Les agents existants sont mutualisés.
insert into public.ai_cells(id, nom, product_id, responsable_agent_id, description)
select c.id, c.nom, c.product_id, (select a.id from public.ai_agents a where a.code = c.resp), c.descr
  from (values
    ('immosuite', 'Cellule ImmoSuite ERP', 'immosuite', 'ia_sup_immo', 'Professionnels de l''immobilier et du foncier'),
    ('aluexpert', 'Cellule menuiserie aluminium — AluExpert', 'aluexpert', 'ia_resp_prospection', 'Menuiseries aluminium, façades, vitrage, ateliers de transformation'),
    ('avicosuite', 'Cellule avicole — AvicoSuite', 'avicosuite', 'ia_resp_prospection', 'Exploitations avicoles : poulets de chair et pondeuses')
  ) c(id, nom, product_id, resp, descr)
 where exists (select 1 from public.ai_products p where p.id = c.product_id)
on conflict (id) do nothing;
insert into public.ai_cell_members(cell_id, role_code, agent_id, ordre)
select c.cell, c.role, a.id, c.ordre
  from (values
    ('immosuite', 'market_intelligence', 'ia_market', 0), ('immosuite', 'lead_hunter', 'ia_hunter_1', 0), ('immosuite', 'lead_enrichment', 'ia_enrich_1', 0),
    ('immosuite', 'qualification', 'ia_qualif_1', 0), ('immosuite', 'communication', 'ia_wa_1', 0), ('immosuite', 'communication', 'ia_mail_1', 1),
    ('immosuite', 'appointment_manager', 'ia_rdv_1', 0), ('immosuite', 'negotiation_manager', 'ia_nego_1', 0), ('immosuite', 'proposal_generator', 'ia_nego_1', 0),
    ('aluexpert', 'market_intelligence', 'ia_market', 0), ('aluexpert', 'lead_enrichment', 'ia_enrich_1', 0), ('aluexpert', 'qualification', 'ia_qualif_1', 0),
    ('aluexpert', 'communication', 'ia_wa_1', 0), ('aluexpert', 'communication', 'ia_mail_1', 1), ('aluexpert', 'appointment_manager', 'ia_rdv_1', 0),
    ('aluexpert', 'negotiation_manager', 'ia_nego_1', 0), ('aluexpert', 'proposal_generator', 'ia_nego_1', 0),
    ('avicosuite', 'market_intelligence', 'ia_market', 0), ('avicosuite', 'lead_enrichment', 'ia_enrich_1', 0), ('avicosuite', 'qualification', 'ia_qualif_1', 0),
    ('avicosuite', 'communication', 'ia_wa_1', 0), ('avicosuite', 'communication', 'ia_mail_1', 1), ('avicosuite', 'appointment_manager', 'ia_rdv_1', 0),
    ('avicosuite', 'negotiation_manager', 'ia_nego_1', 0), ('avicosuite', 'proposal_generator', 'ia_nego_1', 0)
  ) c(cell, role, agent, ordre)
  join public.ai_agents a on a.code = c.agent
 where exists (select 1 from public.ai_cells x where x.id = c.cell)
on conflict do nothing;

end $f$;
revoke all on function public.ai_defaut_organisation() from public, anon, authenticated;
select public.ai_defaut_organisation();

-- ─── 4. Résolution : qui tient ce rôle pour ce logiciel ? ────────────────────
create or replace function public.ai_agent_for(p_product text, p_role text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select x.agent_id from (
    select m.agent_id, 0 as rang, m.ordre
      from public.ai_cells c join public.ai_cell_members m on m.cell_id = c.id
     where c.actif and c.product_id = p_product and m.role_code = p_role
    union all
    select a.id, 1, 0 from public.ai_agents a where a.role_code = p_role          -- repli : tout agent portant ce rôle
  ) x join public.ai_agents a on a.id = x.agent_id
 where a.etat = 'actif' and a.archived_at is null and p_role is not null
 order by x.rang, x.ordre, a.created_at
 limit 1
$$;

-- ─── 5. Routage CRM ↔ IA par rôle (le code d'agent historique reste en repli) ─
alter table public.crm_ai_routing add column if not exists role_code text references public.ai_roles(code);
alter table public.crm_ai_routing alter column agent_code drop not null;
alter table public.crm_ai_stage_owner add column if not exists role_code text references public.ai_roles(code);
alter table public.crm_ai_stage_owner alter column agent_code drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.crm_ai_routing'::regclass and conname = 'crm_ai_routing_cible') then
    alter table public.crm_ai_routing add constraint crm_ai_routing_cible check (agent_code is not null or role_code is not null);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.crm_ai_stage_owner'::regclass and conname = 'crm_ai_stage_owner_cible') then
    alter table public.crm_ai_stage_owner add constraint crm_ai_stage_owner_cible check (agent_code is not null or role_code is not null);
  end if;
end $$;
update public.crm_ai_routing r set role_code = m.role
  from (values ('ia_qualif_1', 'qualification'), ('ia_success', 'customer_success'), ('ia_docs', 'gestion_documents'), ('ia_rdv_1', 'appointment_manager'), ('ia_dir_admin', 'directeur_administratif')) m(code, role)
 where r.agent_code = m.code and r.role_code is null;
update public.crm_ai_stage_owner r set role_code = m.role
  from (values ('ia_qualif_1', 'qualification'), ('ia_success', 'customer_success'), ('ia_docs', 'gestion_documents'), ('ia_rdv_1', 'appointment_manager'),
               ('ia_dir_admin', 'directeur_administratif'), ('ia_mail_1', 'communication'), ('ia_nego_1', 'negotiation_manager')) m(code, role)
 where r.agent_code = m.code and r.role_code is null;

-- Propriétaire de l'étape : l'agent qui tient le rôle dans la cellule du logiciel du prospect.
create or replace function public.crm_prospect_owner() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    select coalesce(public.ai_agent_for(new.produits_recommandes[1], o.role_code),
                    (select a.id from public.ai_agents a where a.code = o.agent_code and a.archived_at is null and a.etat <> 'archive'))
      into v_id from public.crm_ai_stage_owner o where o.stage = new.stage;
    if v_id is not null then new.agent_id := v_id; end if;
  end if;
  return new;
end $$;

-- Routage d'un événement du CRM : même résolution par rôle et par logiciel.
create or replace function public.crm_h_crm_event(ev public.crm_ai_events) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  rt public.crm_ai_routing; rec public.crm_records; p public.ai_prospects; v_client text; v_vars jsonb; v_task uuid; a public.ai_agents; v_data jsonb; v_inter jsonb; v_code text;
begin
  select * into rt from public.crm_ai_routing where event_type = ev.type and actif;
  if rt.event_type is null then return jsonb_build_object('skipped', 'aucune règle de routage active'); end if;
  v_client := case when ev.entity = 'clients' then ev.rid else coalesce(ev.payload->>'_client_rid', public.crm_client_rid_of(ev.payload)) end;
  if v_client is not null then select * into rec from public.crm_records where entity = 'clients' and rid = v_client and deleted_at is null; end if;
  if ev.entity = 'clients' and rec.rid is null then return jsonb_build_object('skipped', 'dossier client supprimé'); end if;
  if rec.rid is not null then p := public.crm_ensure_prospect(rec); end if;
  v_data := coalesce(rec.data, '{}'::jsonb);
  v_vars := jsonb_build_object('nom', coalesce(v_data->>'nom', ev.payload->>'client', ev.payload->>'nom', 'client'), 'secteur', coalesce(nullif(v_data->>'secteur', ''), 'secteur non renseigné'),
            'contexte', left(coalesce(ev.payload->>'contexte', nullif(v_data->>'notes', ''), 'aucune note'), 400), 'ref', coalesce(ev.payload->>'ref', ''),
            'montant', to_char(coalesce(nullif(ev.payload->>'montant', '')::numeric, public.crm_num(ev.payload->>'ttc')), 'FM999G999G999G999'),
            'solde', to_char(public.crm_num(ev.payload->>'solde'), 'FM999G999G999G999'), 'type', coalesce(ev.payload->>'type', 'rendez-vous'),
            'quand', coalesce(ev.payload->>'date', '') || ' ' || coalesce(ev.payload->>'heure', ''));
  -- l'identifiant du prospect figure dans la consigne : le moteur l'ajoute au périmètre de l'agent (sans lui, l'agent ne pourrait pas agir sur le dossier)
  -- paramétrage : l'agent est celui qui porte le rôle dans la cellule du logiciel du dossier (repli : agent de tout rôle équivalent, puis code historique)
  v_code := coalesce((select ag.code from public.ai_agents ag where ag.id = public.ai_agent_for(coalesce(public.ai_product_of(v_data->>'logiciel'), p.produits_recommandes[1]), rt.role_code)), rt.agent_code);
  v_task := public.crm_make_task(v_code, rt.task_type, public.crm_tpl(rt.titre_tpl, v_vars),
              public.crm_tpl(rt.desc_tpl, v_vars) || case when p.id is not null then E'\n\nDossier SANIX AI : prospect_id = ' || p.id else '' end, rt.priorite, rt.echeance_h, p.id, ev.id);
  select * into a from public.ai_agents where id = (select agent_id from public.ai_agent_tasks where id = v_task);
  if p.id is not null then
    update public.ai_prospects set agent_id = a.id where id = p.id and (agent_id is distinct from a.id) and ev.type in ('crm.prospect.created', 'crm.client.created');
    v_inter := public.crm_interaction('Pris en charge par l''IA', public.crm_tpl(rt.note_tpl, v_vars || jsonb_build_object('agent', a.nom)), null, ev.created_at, ev.id);
    perform public.crm_put('clients', rec.rid,
      jsonb_build_object('interactions', jsonb_build_array(v_inter),
                         'ia', coalesce(rec.data->'ia', '{}'::jsonb) || jsonb_build_object('prospect_id', p.id, 'agent_code', a.code, 'agent_nom', a.nom, 'stage', p.stage, 'linked_at', ev.created_at)),
      'ia', 'ia:' || ev.type, false, null, null, false);
  end if;
  return jsonb_build_object('task_id', v_task, 'agent', a.code, 'prospect_id', p.id, 'client_rid', rec.rid);
end $$;


-- ─── 6. Lecture par les opérateurs ; écriture uniquement par les fonctions d'administration ci-dessous ───
do $$ declare t text; begin
  foreach t in array array['ai_roles', 'ai_cells', 'ai_cell_members'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists cfg_read on public.%I', t);
    execute format('create policy cfg_read on public.%I for select to authenticated using (public.ai_is_operator())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ─── 7. Fonctions d'administration (direction seule, journalisées) ───────────
create or replace function public.ai_cfg_check() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.ai_is_direction() then raise exception 'Réservé à la direction' using errcode = '42501'; end if;
end $$;
create or replace function public.ai_cfg_audit(p_action text, p_payload jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.ai_actions(agent, action, payload) values ('operateur', p_action, coalesce(p_payload, '{}'::jsonb))
$$;
create or replace function public.ai_cfg_arr(j jsonb, p_max int default 40, p_len int default 200) returns text[]
language sql immutable as $$
  select coalesce(array(select left(btrim(x), p_len) from jsonb_array_elements_text(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end) x
                         where btrim(x) <> '' limit p_max), '{}'::text[])
$$;

-- Logiciel du catalogue : création (inactive par défaut : jamais proposée avant activation) ou modification.
create or replace function public.ai_cfg_save_product(p_id text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id text := lower(btrim(coalesce(p_id, ''))); cur public.ai_products;
begin
  perform public.ai_cfg_check();
  if v_id !~ '^[a-z0-9_]{2,40}$' then raise exception 'Identifiant de logiciel invalide (a-z, 0-9 et _ ; 2 à 40 caractères)' using errcode = '22023'; end if;
  select * into cur from public.ai_products where id = v_id;
  if cur.id is null then
    if btrim(coalesce(p->>'nom', '')) = '' or btrim(coalesce(p->>'marche_cible', '')) = '' then
      raise exception 'Nom et marché cible obligatoires pour un nouveau logiciel' using errcode = '22023';
    end if;
    insert into public.ai_products(id, nom, marche_cible, secteurs, mots_cles, fonctionnalites, questions_decouverte, argumentaire, demo_url, video_url, brochure_url, actif)
    values (v_id, left(btrim(p->>'nom'), 120), left(btrim(p->>'marche_cible'), 300), public.ai_cfg_arr(p->'secteurs', 30, 80), public.ai_cfg_arr(p->'mots_cles', 40, 80),
            public.ai_cfg_arr(p->'fonctionnalites', 60, 300), public.ai_cfg_arr(p->'questions_decouverte', 20, 300), left(p->>'argumentaire', 4000),
            nullif(btrim(p->>'demo_url'), ''), nullif(btrim(p->>'video_url'), ''), nullif(btrim(p->>'brochure_url'), ''), coalesce((p->>'actif')::boolean, false));
  else
    update public.ai_products set
      nom = case when p ? 'nom' and btrim(p->>'nom') <> '' then left(btrim(p->>'nom'), 120) else nom end,
      marche_cible = case when p ? 'marche_cible' and btrim(p->>'marche_cible') <> '' then left(btrim(p->>'marche_cible'), 300) else marche_cible end,
      secteurs = case when p ? 'secteurs' then public.ai_cfg_arr(p->'secteurs', 30, 80) else secteurs end,
      mots_cles = case when p ? 'mots_cles' then public.ai_cfg_arr(p->'mots_cles', 40, 80) else mots_cles end,
      fonctionnalites = case when p ? 'fonctionnalites' then public.ai_cfg_arr(p->'fonctionnalites', 60, 300) else fonctionnalites end,
      questions_decouverte = case when p ? 'questions_decouverte' then public.ai_cfg_arr(p->'questions_decouverte', 20, 300) else questions_decouverte end,
      argumentaire = case when p ? 'argumentaire' then left(p->>'argumentaire', 4000) else argumentaire end,
      demo_url = case when p ? 'demo_url' then nullif(btrim(p->>'demo_url'), '') else demo_url end,
      video_url = case when p ? 'video_url' then nullif(btrim(p->>'video_url'), '') else video_url end,
      brochure_url = case when p ? 'brochure_url' then nullif(btrim(p->>'brochure_url'), '') else brochure_url end,
      actif = case when p ? 'actif' then (p->>'actif')::boolean else actif end,
      updated_at = now()
     where id = v_id;
  end if;
  perform public.ai_cfg_audit('cfg_logiciel', jsonb_build_object('id', v_id, 'champs', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p) k)));
  return (select jsonb_build_object('ok', true, 'id', x.id, 'actif', x.actif, 'tarif_officiel', exists (select 1 from public.ai_pricing t where t.product_id = x.id and t.actif))
            from public.ai_products x where x.id = v_id);
end $$;

-- Équivalences de noms (nom du logiciel dans le CRM → logiciel du catalogue).
create or replace function public.ai_cfg_set_alias(p_alias text, p_product text, p_on boolean default true) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_alias text := lower(btrim(coalesce(p_alias, '')));
begin
  perform public.ai_cfg_check();
  if v_alias = '' then raise exception 'Nom à faire correspondre obligatoire' using errcode = '22023'; end if;
  if p_on then
    insert into public.ai_product_aliases(alias, product_id) values (v_alias, p_product) on conflict (alias) do update set product_id = excluded.product_id;
  else
    delete from public.ai_product_aliases where alias = v_alias;
  end if;
  perform public.ai_cfg_audit('cfg_alias', jsonb_build_object('alias', v_alias, 'produit', p_product, 'actif', p_on));
  return jsonb_build_object('ok', true);
end $$;

-- Rôle (modèle de poste).
create or replace function public.ai_cfg_save_role(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text := lower(btrim(coalesce(p->>'code', ''))); cur public.ai_roles;
begin
  perform public.ai_cfg_check();
  if v_code !~ '^[a-z0-9_]{3,40}$' then raise exception 'Code de rôle invalide (a-z, 0-9 et _ ; 3 à 40 caractères)' using errcode = '22023'; end if;
  select * into cur from public.ai_roles where code = v_code;
  if cur.code is null then
    if btrim(coalesce(p->>'libelle', '')) = '' or (p->>'niveau') is null then raise exception 'Libellé et niveau obligatoires pour un nouveau rôle' using errcode = '22023'; end if;
    insert into public.ai_roles(code, libelle, description, niveau, departement_id, outils, effort, personnalite, specialite, actif)
    values (v_code, left(btrim(p->>'libelle'), 120), left(coalesce(p->>'description', ''), 1000), (p->>'niveau')::smallint, nullif(p->>'departement_id', ''),
            public.ai_cfg_arr(p->'outils', 40, 60), coalesce(nullif(p->>'effort', ''), 'medium'), nullif(left(p->>'personnalite', 500), ''), nullif(left(p->>'specialite', 500), ''),
            coalesce((p->>'actif')::boolean, true));
  else
    update public.ai_roles set
      libelle = case when p ? 'libelle' and btrim(p->>'libelle') <> '' then left(btrim(p->>'libelle'), 120) else libelle end,
      description = case when p ? 'description' then left(coalesce(p->>'description', ''), 1000) else description end,
      niveau = case when p ? 'niveau' then (p->>'niveau')::smallint else niveau end,
      departement_id = case when p ? 'departement_id' then nullif(p->>'departement_id', '') else departement_id end,
      outils = case when p ? 'outils' then public.ai_cfg_arr(p->'outils', 40, 60) else outils end,
      effort = case when p ? 'effort' then p->>'effort' else effort end,
      personnalite = case when p ? 'personnalite' then nullif(left(p->>'personnalite', 500), '') else personnalite end,
      specialite = case when p ? 'specialite' then nullif(left(p->>'specialite', 500), '') else specialite end,
      actif = case when p ? 'actif' then (p->>'actif')::boolean else actif end,
      updated_at = now()
     where code = v_code;
  end if;
  perform public.ai_cfg_audit('cfg_role', jsonb_build_object('code', v_code));
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

-- Cellule (un logiciel du catalogue).
create or replace function public.ai_cfg_save_cell(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id text := lower(btrim(coalesce(p->>'id', ''))); cur public.ai_cells;
begin
  perform public.ai_cfg_check();
  if v_id !~ '^[a-z0-9_]{2,40}$' then raise exception 'Identifiant de cellule invalide (a-z, 0-9 et _ ; 2 à 40 caractères)' using errcode = '22023'; end if;
  select * into cur from public.ai_cells where id = v_id;
  if cur.id is null then
    if btrim(coalesce(p->>'nom', '')) = '' or coalesce(p->>'product_id', '') = '' then raise exception 'Nom et logiciel obligatoires pour une nouvelle cellule' using errcode = '22023'; end if;
    insert into public.ai_cells(id, nom, product_id, responsable_agent_id, description, actif)
    values (v_id, left(btrim(p->>'nom'), 120), p->>'product_id', nullif(p->>'responsable_agent_id', '')::uuid, nullif(left(p->>'description', 1000), ''), coalesce((p->>'actif')::boolean, true));
  else
    update public.ai_cells set
      nom = case when p ? 'nom' and btrim(p->>'nom') <> '' then left(btrim(p->>'nom'), 120) else nom end,
      product_id = case when p ? 'product_id' and coalesce(p->>'product_id', '') <> '' then p->>'product_id' else product_id end,
      responsable_agent_id = case when p ? 'responsable_agent_id' then nullif(p->>'responsable_agent_id', '')::uuid else responsable_agent_id end,
      description = case when p ? 'description' then nullif(left(p->>'description', 1000), '') else description end,
      actif = case when p ? 'actif' then (p->>'actif')::boolean else actif end,
      updated_at = now()
     where id = v_id;
  end if;
  perform public.ai_cfg_audit('cfg_cellule', jsonb_build_object('id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Membre d'une cellule : qui tient quel rôle.
create or replace function public.ai_cfg_set_member(p_cell text, p_role text, p_agent uuid, p_on boolean default true, p_ordre smallint default 0) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.ai_cfg_check();
  if p_on then
    insert into public.ai_cell_members(cell_id, role_code, agent_id, ordre) values (p_cell, p_role, p_agent, coalesce(p_ordre, 0))
    on conflict (cell_id, role_code, agent_id) do update set ordre = excluded.ordre;
  else
    delete from public.ai_cell_members where cell_id = p_cell and role_code = p_role and agent_id = p_agent;
  end if;
  perform public.ai_cfg_audit('cfg_membre', jsonb_build_object('cellule', p_cell, 'role', p_role, 'agent', p_agent, 'actif', p_on));
  return jsonb_build_object('ok', true);
end $$;

-- Création d'un agent depuis un rôle (modèle de poste) ; tout champ du modèle est modifiable à la création.
create or replace function public.ai_cfg_create_agent(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  r public.ai_roles; m public.ai_agents; v_nom text := btrim(coalesce(p->>'nom', '')); v_fonction text; v_dept text; v_niveau smallint; v_outils text[]; v_c jsonb := coalesce(p->'charte', '{}'::jsonb);
  v_code text; v_base text; v_i int := 1; v_id uuid;
begin
  perform public.ai_cfg_check();
  select * into r from public.ai_roles where code = p->>'role_code' and actif;
  if r.code is null then raise exception 'Rôle inconnu ou inactif' using errcode = '22023'; end if;
  if char_length(v_nom) < 2 then raise exception 'Nom obligatoire' using errcode = '22023'; end if;
  v_fonction := coalesce(nullif(btrim(p->>'fonction'), ''), r.libelle);
  v_dept := coalesce(nullif(p->>'departement_id', ''), r.departement_id);
  v_niveau := coalesce((p->>'niveau')::smallint, r.niveau);
  v_outils := case when p ? 'outils' then public.ai_cfg_arr(p->'outils', 40, 60) else r.outils end;
  if v_niveau > 1 then
    select * into m from public.ai_agents where id = nullif(p->>'manager_id', '')::uuid and archived_at is null;
    if m.id is null then raise exception 'Responsable (manager_id) obligatoire et existant' using errcode = '22023'; end if;
  end if;
  v_base := left('ia_' || trim(both '_' from regexp_replace(lower(unaccent(v_nom)), '[^a-z0-9]+', '_', 'g')), 50);
  v_code := v_base;
  while exists (select 1 from public.ai_agents where code = v_code) loop v_i := v_i + 1; v_code := v_base || '_' || v_i; end loop;
  insert into public.ai_agents(code, nom, fonction, departement_id, manager_id, niveau, personnalite, specialite, outils, effort, etat, budget_jour_usd, role_code, cree_par_user, avatar)
  values (v_code, left(v_nom, 80), left(v_fonction, 120), v_dept, m.id, v_niveau, coalesce(nullif(left(p->>'personnalite', 500), ''), r.personnalite), coalesce(nullif(left(p->>'specialite', 500), ''), r.specialite),
          v_outils, coalesce(nullif(p->>'effort', ''), r.effort), 'actif', nullif(p->>'budget_jour_usd', '')::numeric, r.code, auth.uid(), '{}'::jsonb)
  returning id into v_id;
  insert into public.ai_agent_charters(agent_id, version, contenu, motif, redige_par_user)
  values (v_id, 1, jsonb_build_object(
    'identite', left(v_nom, 80) || ' — ' || v_fonction || ', collaborateur IA de SANIX AI VIRTUAL COMPANY',
    'fonction', v_fonction, 'departement', (select d.nom from public.ai_departments d where d.id = v_dept),
    'mission_principale', coalesce(nullif(btrim(v_c->>'mission_principale'), ''), nullif(r.description, ''), v_fonction),
    'missions_secondaires', coalesce(v_c->'missions_secondaires', '[]'::jsonb), 'competences', coalesce(v_c->'competences', '[]'::jsonb),
    'outils', to_jsonb(v_outils), 'donnees', coalesce(v_c->'donnees', '["Prospects et données du CRM"]'::jsonb),
    'objectifs', coalesce(v_c->'objectifs', '["Atteindre les objectifs fixés dans chaque mission"]'::jsonb),
    'delais', coalesce(nullif(btrim(v_c->>'delais'), ''), 'Selon l''échéance de chaque mission'),
    'indicateurs', coalesce(v_c->'indicateurs', '["Missions terminées avec résultat", "Coût IA par mission"]'::jsonb),
    'procedures', coalesce(v_c->'procedures', '[]'::jsonb),
    'limites', coalesce(v_c->'limites', '["Aucun engagement financier, juridique ou contractuel", "Aucun envoi externe sans validation", "Aucune information inventée"]'::jsonb),
    'responsable', coalesce(m.nom || ' — ' || m.fonction, 'Direction'),
    'reporting', coalesce(nullif(btrim(v_c->>'reporting'), ''), 'Rapport de fin de mission : réalisé, chiffres, difficultés, suites')),
    'Création par la direction', auth.uid());
  if nullif(p->>'cell_id', '') is not null then
    insert into public.ai_cell_members(cell_id, role_code, agent_id) values (p->>'cell_id', r.code, v_id) on conflict do nothing;
  end if;
  perform public.ai_cfg_audit('cfg_agent_cree', jsonb_build_object('code', v_code, 'role', r.code));
  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code);
end $$;

-- Modification d'un agent : poste, rattachement, outils, effort, budget. Les outils modifiés produisent une nouvelle version de la charte.
create or replace function public.ai_cfg_update_agent(p_agent uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.ai_agents; v_outils_avant text[];
begin
  perform public.ai_cfg_check();
  select * into a from public.ai_agents where id = p_agent for update;
  if a.id is null then raise exception 'Agent introuvable' using errcode = 'P0002'; end if;
  if a.niveau = 1 and (p ? 'manager_id' or p ? 'niveau') then raise exception 'Le directeur général ne peut pas être rattaché à un responsable' using errcode = '22023'; end if;
  v_outils_avant := a.outils;
  update public.ai_agents set
    nom = case when p ? 'nom' and char_length(btrim(p->>'nom')) >= 2 then left(btrim(p->>'nom'), 80) else nom end,
    fonction = case when p ? 'fonction' and char_length(btrim(p->>'fonction')) >= 2 then left(btrim(p->>'fonction'), 120) else fonction end,
    manager_id = case when p ? 'manager_id' then nullif(p->>'manager_id', '')::uuid else manager_id end,
    niveau = case when p ? 'niveau' then (p->>'niveau')::smallint else niveau end,
    departement_id = case when p ? 'departement_id' then p->>'departement_id' else departement_id end,
    outils = case when p ? 'outils' then public.ai_cfg_arr(p->'outils', 40, 60) else outils end,
    effort = case when p ? 'effort' then p->>'effort' else effort end,
    budget_jour_usd = case when p ? 'budget_jour_usd' then nullif(p->>'budget_jour_usd', '')::numeric else budget_jour_usd end,
    role_code = case when p ? 'role_code' then nullif(p->>'role_code', '') else role_code end,
    personnalite = case when p ? 'personnalite' then nullif(left(p->>'personnalite', 500), '') else personnalite end,
    specialite = case when p ? 'specialite' then nullif(left(p->>'specialite', 500), '') else specialite end
   where id = p_agent returning * into a;
  if a.outils is distinct from v_outils_avant then
    insert into public.ai_agent_charters(agent_id, version, contenu, motif, redige_par_user)
    select c.agent_id, c.version + 1, c.contenu || jsonb_build_object('outils', to_jsonb(a.outils)), 'Outils modifiés par la direction', auth.uid()
      from public.ai_agent_charters c where c.agent_id = p_agent order by c.version desc limit 1;
  end if;
  perform public.ai_cfg_audit('cfg_agent_modifie', jsonb_build_object('code', a.code, 'champs', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(p) k)));
  return jsonb_build_object('ok', true, 'id', a.id, 'code', a.code);
end $$;

-- ─── 8. Droits ───────────────────────────────────────────────────────────────
revoke all on function public.ai_cfg_check(), public.ai_cfg_audit(text, jsonb), public.ai_cfg_arr(jsonb, int, int) from public, anon, authenticated;
revoke all on function public.ai_cfg_save_product(text, jsonb), public.ai_cfg_set_alias(text, text, boolean), public.ai_cfg_save_role(jsonb), public.ai_cfg_save_cell(jsonb),
  public.ai_cfg_set_member(text, text, uuid, boolean, smallint), public.ai_cfg_create_agent(jsonb), public.ai_cfg_update_agent(uuid, jsonb), public.ai_agent_for(text, text) from public, anon;
grant execute on function public.ai_cfg_save_product(text, jsonb), public.ai_cfg_set_alias(text, text, boolean), public.ai_cfg_save_role(jsonb), public.ai_cfg_save_cell(jsonb),
  public.ai_cfg_set_member(text, text, uuid, boolean, smallint), public.ai_cfg_create_agent(jsonb), public.ai_cfg_update_agent(uuid, jsonb) to authenticated;
grant execute on function public.ai_agent_for(text, text) to authenticated, service_role;

