# Pipeline commercial SANIX — V2

## Parcours commercial

Le module Commercial utilise `ai_prospects` comme dossier d'opportunité canonique. Le CRM historique conserve ses objets `clients` et `deals` dans `crm_records`; le connecteur CRM ↔ IA reste le mécanisme de synchronisation. Aucune table d'opportunités parallèle n'est créée.

Le Kanban regroupe le parcours en quatre phases :

| Phase | Étapes |
|---|---|
| Exploration | Identifié, enregistré, qualifié, premier contact, conversation, besoin identifié, intéressé, RDV proposé, RDV confirmé |
| Proposition | Démo réalisée, offre transmise |
| Négociation | Négociation, offre acceptée |
| Closing | Contrat transmis, contrat signé, paiement attendu, paiement confirmé, marché gagné, déploiement, client fidélisé |

Les dossiers `perdu` et `en_veille` sont affichés dans la section « Résultats clôturés » sous le Kanban. Ils ne sont pas comptés comme opportunités actives.

## Pilotage et prévisions

- **Pipeline total actif** : somme du potentiel estimé des dossiers non gagnés, non perdus et non en veille.
- **Prévision pondérée** : potentiel positif multiplié par la probabilité indicative de l'étape, avec les mêmes coefficients que `company/live.js` : identifié 3 %, enregistré 5 %, qualifié 10 %, premier contact 12 %, conversation 18 %, besoin identifié 25 %, intéressé 30 %, RDV proposé 35 %, RDV confirmé 40 %, démo réalisée 45 %, offre transmise 55 %, négociation 65 %, offre acceptée 80 %, contrat transmis 90 %, paiement attendu 95 %. Les étapes non couvertes par ce barème ne contribuent pas à la prévision.
- **Gagnées / perdues** : nombre de dossiers et potentiel estimé associé. Ce n'est pas le chiffre d'affaires comptable ni le total encaissé.
- **Taux de conversion** : dossiers gagnés / (dossiers gagnés + dossiers perdus). Les dossiers en veille ne sont pas considérés comme perdus.
- **Actions en retard** : prochaine action échue sur un dossier qui n'est pas dans un statut de clôture.
- **Non attribuées** : opportunités actives sans responsable.

Les pondérations sont des hypothèses de pilotage, pas des statistiques de conversion constatées. Elles devront être recalibrées à partir des résultats réels SANIX. Attention : la fonction SQL historique `ai_report_data` utilise encore un barème différent et ne retient qu'une partie des étapes. La prévision du Kanban n'est donc pas encore harmonisée avec les rapports serveur ; cette harmonisation doit précéder toute utilisation financière officielle.

## Centre de pilotage commercial

La vue « Pilotage » lit les commandes `crm_records` (`entity = commandes`) et leurs tableaux `paiements`. Elle sépare explicitement :

- **Encaissements enregistrés** : somme des lignes de paiement présentes ; les anciens acomptes sans détail sont inclus au cumul historique mais ne sont pas ventilés par mois.
- **Encaissements mensuels** : uniquement les paiements avec une date exploitable.
- **Solde restant** : TTC de la commande moins les paiements/acompte enregistrés, sans solde négatif.
- **Performance par logiciel et commercial** : ventilation selon les champs réellement renseignés sur les commandes ; les commerciaux absents restent « Non attribué ».

Les objectifs mensuels et commissions ne sont pas calculés tant qu’ils ne disposent pas de paramètres et de liens fiables avec les commandes. Les données affichées restent des indicateurs de gestion à rapprocher des factures, écritures comptables et relevés bancaires. Le potentiel des prospects et les offres ne sont jamais comptés comme chiffre d’affaires encaissé.

## Exécution commerciale

1. Créer ou importer un prospect. Une fiche IA reliée au CRM conserve son `crm_rid`.
2. Vérifier les coordonnées et la source, qualifier le besoin, le produit, le budget et le potentiel.
3. Affecter le dossier à un commercial. La réaffectation depuis l'interface est réservée à la direction.
4. Déplacer le dossier au fil des interactions ; les transitions sont inscrites dans `ai_stage_history`.
5. Programmer une prochaine action datée sur la fiche. Les échéances dépassées sont signalées.
6. Consulter rendez-vous, offres, conversations et relances depuis les vues dédiées.
7. Respecter les validations humaines et les garde-fous SQL pour les étapes engageantes.

## Sécurité et limites

- Les règles SQL/RLS restent l'autorité ; masquer un contrôle dans l'interface n'est pas une mesure de sécurité suffisante.
- Les désinscriptions (`opt_out`) restent prioritaires ; les changements d'étape ne réactivent pas un contact.
- Le potentiel estimé ne vaut ni offre acceptée, ni contrat signé, ni encaissement.
- Aucun message externe n'est envoyé par le simple déplacement d'une carte ou la planification d'une action.
- Les preuves contractuelles et financières doivent être rapprochées des pièces et écritures du CRM avant de présenter une vente comme définitivement sécurisée.
