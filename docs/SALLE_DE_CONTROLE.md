# Salle de contrôle (SANIX AI)

Fenêtre d'affichage en direct de l'activité des agents, pour un second écran, une télévision ou un téléphone. Bureau SANIX AI → bouton **🖥 Salle de contrôle** (ou `company/live.html`). Lecture seule, réservée aux opérateurs connectés.

## Ce qu'elle montre (données réelles, rafraîchies toutes les 6 s)
- **Réseau des agents** : un point par agent, groupés par direction. Cyan pulsant = au travail ; violet = coordonne ses équipes ; orange = attend une validation ; rouge = mission bloquée (6 h) ; gris = en attente ou suspendu. Chaque action d'un agent envoie une impulsion vers la direction générale ; une fiche créée déclenche une onde verte. Survol = détail ; clic = ses missions.
- **Indicateurs** : agents au travail, missions en cours, fiches créées aujourd'hui, prospects en base, décisions à valider, coût IA du jour.
- **Missions en direct** : état, priorité, logiciel, durée écoulée et progression en fiches créées (objectif lu dans le titre ou les objectifs de la mission, ex. « 20 fiches »).
- **Flux d'actions** (journal `ai_actions`) et **bandeau des nouvelles fiches**.
- **Indice de santé 0-100** : réussite des missions sur 7 jours (40 %), absence de missions figées de plus de 90 min (25 %), blocages des 24 h (15 %), part des fiches du jour avec un contact et une source https (20 %). Il signale les problèmes ; il ne remplace pas la lecture des rapports.

## Technique
- Le statut d'un agent est déduit de ses missions (les agents en mode abonnement ne publient pas d'activité détaillée).
- La fenêtre hérite de la session du Bureau (`window.open`) ; c'est le Bureau qui renouvelle le jeton et le lui transmet (`postMessage`, même origine). Si le Bureau est fermé, la salle fonctionne jusqu'à l'expiration du jeton, puis demande de la rouvrir depuis le Bureau.
- `?kiosk=1` masque les boutons (affichage mural). Test : `node company/tests/live_test.js`.

## Vue 3D et assistant vocal « Jarvis »

**Vue 3D** (Three.js, locale, aucune dépendance externe) : le directeur général au centre, les agents en anneaux par niveau et par département. Un agent au travail s'allume et un anneau tourne autour de lui ; les liens hiérarchiques actifs s'illuminent ; chaque nouvelle fiche déclenche une impulsion lumineuse de l'agent vers le centre.
- Glisser : tourner · molette / pincement : zoomer · clic droit, Maj+glisser ou deux doigts : déplacer · double-clic : vue d'ensemble · clic sur un agent : la caméra s'en approche et sa fiche s'ouvre.
- Boutons : zoom +/−, vue d'ensemble, rotation automatique, plein cadre (masque les panneaux).
- Repli automatique en vue 2D si WebGL est indisponible ; `?2d` force la vue 2D.

**Jarvis** (Web Speech API du navigateur, sans clé ni service tiers ; Chrome/Edge/Safari) :
- 🎤 (orbe) : parler une fois ; 🖐 mains libres : dire « Jarvis » pour l'appeler ; 🔊 voix on/off ; saisie au clavier toujours possible.
- Réponses calculées localement sur les données réelles : situation, fiches du jour / total, qui travaille, blocages, santé, validations, budget, avancement d'un logiciel (« où en est AutoGarage ? »), ce que fait un agent.
- Caméra à la voix : « zoom avant / arrière », « vue d'ensemble », « montre le directeur commercial », « arrête / lance la rotation », « plein cadre ».
- Toute autre demande : Jarvis propose de la transmettre au directeur général IA ; **rien n'est envoyé sans « oui »**. La réponse du directeur est ensuite lue à voix haute dès son arrivée.

**Mode dynamique (mouvement perpétuel)** — activé par défaut, bouton ✺ ou voix (« mode calme » / « active le mode dynamique ») : les agents orbitent en permanence autour du directeur général (anneaux en sens alternés, vitesses différentes), les liens suivent, la caméra « respire » doucement et suit l'agent sélectionné. Le mode calme fige les agents.

**Jarvis conversationnel** — la fonction Edge `ai-jarvis` (Haiku, budget IA appliqué, JWT direction) reçoit la demande, les 8 derniers échanges et un instantané en direct (agents, missions, indicateurs, activité) et répond en langage naturel, lu à voix haute. Elle peut commander l'interface (zoom, vue d'ensemble, focus sur un agent, mode calme/dynamique, panneaux) et **proposer** une consigne au directeur général ou une mission à un agent : rien n'est envoyé sans « oui ». Après une réponse vocale, le micro se rouvre seul pour la suite de la discussion. Sans serveur (budget, réseau, fonction non déployée), Jarvis retombe sur ses réponses locales.

**Propositions d'amélioration** — Jarvis analyse en continu les données réelles (missions bloquées ou figées, prospection sous-performante, qualité des fiches, taux de réussite, décisions en attente, capacité IA inutilisée, logiciels sans mission) et affiche une pastille 💡 avec leur nombre. Dites « propositions » (ou touchez 💡) : il en énonce trois au maximum, numérotées, avec le constat chiffré et la piste. Répondez « la deux », « toutes » ou « non » : la consigne ou la mission correspondante n'est envoyée qu'après ce choix. Le serveur (`ai-jarvis`) reçoit ces constats et peut en ajouter ; sans serveur, les propositions sont calculées localement.
