# Phase 2 — test de mission réelle (procédure)

Objectif du cahier des charges : un agent reçoit une mission réelle, consulte les données autorisées, utilise un modèle IA, produit un résultat structuré, l'enregistre et transmet son travail. Ce test **ne peut pas être exécuté sans crédits Anthropic** ; il est préparé ici et se vérifie en une requête.

## 1. Pré-requis
1. Migrations appliquées dans l'ordre : `20261111…` (connecteur), `20261112…` (pilotage), `20261113…` (Phase 2).
2. Fonctions `ai-company`, `ai-sales-director`, `whatsapp-webhook` redéployées avec les paquets de `supabase/deploy/` (traduction du navigateur désactivée).
3. `ANTHROPIC_API_KEY` posée et **crédits ajoutés** sur le compte de la clé.
4. Gouvernance : `communication_externe = validation` (déjà fait). **Plafonner le budget du test** : *Gouvernance* → budget du jour à 3 $ et par agent à 1 $ (rétablir ensuite).
5. Réactiver uniquement les agents du périmètre commercial (SQL Editor) :
```sql
update ai_agents set etat = 'actif', incidents_consecutifs = 0
 where code in ('ia_market', 'ia_hunter_1', 'ia_enrich_1', 'ia_qualif_1') and etat = 'suspendu';
```
6. **Recommandé avant le test** : suspendre les agents hors périmètre et annuler leurs missions ouvertes, sinon les 25 missions de départ (dont Santé et Logistique) consommeront le budget :
```sql
update ai_agents set etat = 'suspendu'
 where code in ('ia_sup_sante', 'ia_sup_distribution', 'ia_hunter_2', 'ia_hunter_3', 'ia_content', 'ia_social', 'ia_veille',
                'ia_dir_marketing', 'ia_dir_intel', 'ia_dir_admin', 'ia_docs', 'ia_dir_client', 'ia_success') and etat <> 'suspendu';
update ai_agent_tasks set statut = 'annulee'
 where agent_id in (select id from ai_agents where etat = 'suspendu') and statut in ('a_faire', 'bloquee', 'attente_sous_taches');
```

## 2. Le test
Dans SANIX AI, cliquer sur le directeur général IA et lui donner une instruction **limitée** :

> « Qualifie 5 prospects immobiliers de notre base pour ImmoSuite ERP : vérifie leurs informations, note chacun sur 100 avec justification, et présente-moi le résultat. Aucun message ne doit être envoyé. »

## 3. Vérification
Exécuter `supabase/verifier_mission_reelle.sql` (lecture seule). Le test est **réussi** si :
- au moins un appel IA est enregistré, avec son coût ;
- au moins une mission est terminée, **avec rapport et résultat** (la ligne « sans preuve » doit rester à 0) ;
- les prospects scorés ont une **justification** (la ligne « sans justification » reste à 0) ;
- **aucun message n'est envoyé** (les envois éventuels sont « en attente de validation ») ;
- les incidents éventuels sont expliqués (budget, refus de justification…).

Sinon : noter la ligne en échec, ne pas relancer en boucle ; le coût est plafonné par le budget du test.

## 4. Ce qui est vérifié automatiquement sans crédits
`supabase/functions/tests/phase2_test.ts` (clôture avec preuve, relances d'un agent qui répond par texte, mission bloquée plutôt que terminée, mission par logiciel, score justifié) et `phase2_sql_test.sh` (migration, garde-fous en base, ventes HT par logiciel) : modèle de langage scripté, PostgreSQL réel.
