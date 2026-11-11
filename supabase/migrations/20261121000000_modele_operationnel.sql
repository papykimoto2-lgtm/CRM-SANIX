-- ═════════════════════════════════════════════════════════════════════════════
--  SANIX AI — Modèle des agents d'exécution (maîtrise du coût)
--  Le premier pilote réel a coûté 1,89 $ en une heure sur le seul modèle principal : le budget de 3 $/jour s'épuise en une dizaine de missions.
--  `modele_operationnel` fait tourner les agents d'exécution (niveau 4 et au-dessous dans l'organigramme) sur un modèle moins cher ; la direction (niveaux 1 à 3) garde `modele`.
--  Sans valeur (NULL), rien ne change : tous les agents gardent `modele`. Réglable par la direction. Additif et relançable.
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.ai_governance add column if not exists modele_operationnel text;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ai_governance'::regclass and conname = 'ai_governance_modele_operationnel_check') then
    alter table public.ai_governance add constraint ai_governance_modele_operationnel_check
      check (modele_operationnel is null or modele_operationnel in ('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'));
  end if;
end $$;
