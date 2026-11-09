# Composants partagés

## `pager.js` — pagination des tableaux et listes longues

Utilisé par SANIX CRM Pro (`index.html`) et SANIX AI VIRTUAL COMPANY (`company/`). Aucune dépendance : un `<script src="shared/pager.js" defer>` suffit.

- **Tout `<tbody>`** est paginé automatiquement dès qu'il dépasse la taille de page (25 par défaut, choix 10 / 25 / 50 / 100 mémorisé dans `localStorage`).
- **Toute autre liste** (cartes, lignes `div`) : attribut `data-paginate` sur le conteneur.

| Attribut | Effet |
|---|---|
| `data-paginate` / `="pages"` | pager numéroté « 1–25 sur 519 · 1 2 3 4 … 21 · Lignes 25 » |
| `data-paginate="more"` | bouton « Afficher 20 de plus · N restants » (colonnes de kanban) |
| `data-paginate="off"` | exclu (sur le conteneur, un `<table>` ou un ancêtre) |
| `data-pg-size="9"` | éléments par page au départ (pages) ou affichés au départ (more) |
| `data-pg-sizes="9,18,36"` | choix proposés, propres à ce conteneur (grilles : multiples du nombre de colonnes) |
| `data-pg-item=".deal-card"` | sélecteur des éléments paginés (défaut : tous les enfants directs) |
| `data-pg-skip` (sur un enfant) | jamais masqué, jamais compté |

**Comportement**
- Le rendu de l'application peut remplacer le contenu (`innerHTML`) : la page courante est conservée (bornée), y compris quand l'élément est recréé s'il porte un `id`.
- Les filtres existants qui masquent des lignes (`style.display = 'none'`, `hidden`) sont respectés : seules les lignes non filtrées sont comptées.
- Impression : toutes les lignes sont affichées (`beforeprint` / `afterprint`).
- La barre se place après le tableau et après son cadre défilant (`overflow: auto`).
- Accessibilité : `<nav aria-label="Pagination">`, `aria-current="page"`, boutons réels, focus visible.

**API** (`window.SanixPager`)
- `reveal(element)` : rend visible un élément d'une liste paginée (change de page / déplie). À appeler après un rendu qui doit montrer une ligne précise (ex. carte déposée dans une colonne).
- `refresh(conteneur?)` : redessine un conteneur (ou tous).
- `stats()` : état de chaque liste (`id, mode, total, page, pages, size, shown, bar`) — tests et diagnostic.

**Tests** (Playwright) : `node shared/tests/pager_test.js` (banc d'essai), `node tests/crm_pagination_test.js` (CRM complet : hauteur des pages, kanban, onglets de section).
