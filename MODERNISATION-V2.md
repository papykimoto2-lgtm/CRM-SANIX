# SANIX CRM — couche visuelle V2

Cette branche ajoute une feuille CSS additive : `modernisation-v2.css`.

## Intégration
Ajouter dans le `<head>` de `index.html`, après les styles existants :

```html
<link rel="stylesheet" href="modernisation-v2.css">
```

La feuille ne remplace aucun module JavaScript et ne modifie pas les traitements métier. Elle modernise la navigation, les cartes, les formulaires, les tableaux et les états de focus, avec des adaptations mobiles.

## Contrôle
Le fichier source HTML de production n'a pas été modifié dans cette première PR. L'intégration doit être testée sur l'instance de préproduction avec les données CRM réelles avant fusion et déploiement.
