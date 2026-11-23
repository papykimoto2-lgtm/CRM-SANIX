# Jarvis V2 — fiabilité des indicateurs de la salle de contrôle

## Objectif de cette première livraison

Clarifier les périodes utilisées par les compteurs existants sans modifier les règles métier, les données Supabase, les missions, les agents ou les communications externes.

## Périmètres actuels

- Le chargement principal de `ai_agent_tasks` porte sur les tâches actualisées pendant les 7 derniers jours, avec une limite de 600 lignes.
- Les compteurs du workflow (à traiter, exécution, coordination, validation, blocages et terminées) sont calculés sur cet ensemble de 7 jours.
- Le compteur de blocages dans le KPI des missions est également calculé sur cet ensemble de 7 jours.
- La liste « Missions en direct » masque les tâches bloquées dont la dernière mise à jour date de plus de 24 heures. Son résumé doit donc indiquer explicitement « bloquées (24 h) ».
- L'indice de santé utilise les tâches actualisées sur 7 jours pour le taux de réussite, les missions figées depuis plus de 90 minutes et les blocages actualisés sur 24 heures. La qualité des fiches est calculée sur les fiches créées le jour courant.

## Modifications V2

1. Le KPI des missions précise que son nombre de blocages porte sur 7 jours.
2. Le workflow indique explicitement que ses compteurs utilisent les tâches actualisées sur 7 jours.
3. Le résumé de la liste des missions précise que les blocages affichés sont limités aux dernières 24 heures.
4. L'infobulle de l'indice de santé documente les fenêtres et précise que les composantes insuffisamment renseignées sont exclues du calcul.

## Limites connues à traiter dans une prochaine itération

- Le chargement principal est limité à 600 tâches : si la fenêtre de 7 jours dépasse ce plafond, les compteurs représentent l'échantillon chargé et non nécessairement l'intégralité des tâches.
- Le compteur « À valider » du bandeau supérieur provient de la source des validations présidentielles et ne doit pas être assimilé automatiquement au nombre de tâches ayant le statut `attente_validation`.
- Les statuts d'agent restent une déduction à partir de l'activité déclarée et des tâches chargées ; ils ne constituent pas une preuve d'exécution effective du processus externe.
- Cette livraison est en lecture seule et ne relance ni ne réaffecte aucune mission.

## Vérifications

La revue de code doit confirmer les changements de libellés et le maintien des calculs existants. Les tests navigateur et la vérification du déploiement restent des étapes séparées ; une fusion ne prouve pas à elle seule que la version est en production.
