# Pipeline commercial SANIX — V2

## Principe
Le dossier commercial canonique est `ai_prospects`. Le CRM historique conserve ses objets `clients` et `deals` dans `crm_records`; le connecteur CRM ↔ IA synchronise les changements d'étape vers le CRM. Ne pas créer une deuxième table d'opportunités.

## Parcours commercial
| Phase | Étapes |
|---|---|
| Prospection | Identifié → Enregistré → Qualifié |
| Contact & découverte | Premier contact → Conversation → Besoin identifié → Intéressé |
| Rendez-vous & démonstration | RDV proposé → RDV confirmé → Démo réalisée |
| Offre & négociation | Offre transmise → Négociation → Offre acceptée → Contrat transmis |
| Closing & encaissement | Contrat signé → Paiement attendu → Paiement confirmé → Marché gagné |
| Déploiement & fidélisation | Déploiement → Client fidélisé |
| Sortie | Perdu / En veille |

Les étapes de signature, d'encaissement, de gain et de fidélisation restent soumises aux garde-fous de la base et au rôle direction.

## Utilisation
1. Créer ou importer un prospect. Une fiche IA déjà reliée au CRM doit garder son `crm_rid`.
2. Vérifier les coordonnées et le produit recommandé, puis qualifier le besoin et le potentiel.
3. Affecter le dossier à un commercial. La réaffectation depuis l'interface est réservée à la direction.
4. Déplacer le dossier au fil des interactions. Chaque transition est inscrite dans `ai_stage_history`.
5. Programmer une prochaine action datée sur la fiche. Les actions échues sont signalées dans le pipeline.
6. Consulter rendez-vous, offres, conversations et relances depuis les vues dédiées.
7. À chaque étape engageante, conserver les validations requises. Le statut « gagné » ne doit pas remplacer la confirmation contractuelle ou financière.

## Pilotage
- Opportunités actives : dossiers qui ne sont ni perdus, ni en veille, ni gagnés.
- Potentiel brut actif : somme du potentiel déclaré sur les opportunités actives ; ce n'est pas du chiffre d'affaires.
- Ventes gagnées : dossiers au stade marché gagné, déploiement ou client fidélisé.
- Actions en retard : prochaine action échue sur un dossier non clos.
- Répartition par commercial : filtre par responsable et affectation réservée à la direction.

## Sécurité et limites
- Le navigateur ne contourne pas les règles SQL : les étapes engageantes sont protégées en base.
- Les désinscriptions (`opt_out`) restent prioritaires ; aucun bouton de pipeline ne réactive un contact désinscrit.
- La présence d'un potentiel estimé ne vaut ni devis accepté, ni contrat signé, ni encaissement.
- La V2 affiche les historiques par dossier à l'ouverture, afin d'éviter de charger tout l'historique au démarrage.
- Aucun message externe n'est envoyé par le simple déplacement d'une carte ou la planification d'une action.
