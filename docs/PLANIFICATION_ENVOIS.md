# Planification des envois (WhatsApp, e-mail)

Les messages **validés par le président** ne partent que dans une fenêtre horaire réglable, avec un plafond WhatsApp quotidien. Hors fenêtre, ou plafond atteint, un message validé reste « à envoyer » (file) et part automatiquement au créneau suivant, sans intervention.

## Réglages (Gouvernance → « Planification des envois »)
| Réglage | Valeur par défaut |
|---|---|
| Planification active | oui (décochée : envoi dès la validation, à toute heure) |
| Jours d'envoi | lundi à samedi |
| Heures | 08:00 – 18:00, heure d'Abidjan (UTC+0, sans heure d'été) |
| Plafond WhatsApp par jour | 20 |

L'écran affiche l'état en direct : fenêtre ouverte ou fermée, prochain créneau, WhatsApp envoyés aujourd'hui / plafond, messages en file, à valider, relances planifiées. Jarvis reçoit le même état.

## Fonctionnement (migration `20261215000000_planification_envoi.sql`)
- `ai_claim_outbox` (appelée à chaque tick par `flushOutbox`) ne réserve **rien** hors fenêtre ; elle limite WhatsApp au reste du plafond du jour ; l'e-mail respecte la fenêtre. **Aucune fonction Edge à redéployer.**
- `ai_messages.envoye_at` : heure réelle du départ (renseignée par déclencheur), base du compteur quotidien.
- `ai_claim_due_followups` : en mode « autonome » (envoi direct), les relances ne sont déclenchées que dans la fenêtre ; en mode « validation », la préparation n'est pas bloquée (le message attend de toute façon la validation puis le créneau).
- `ai_envoi_etat()` : état pour l'écran et pour Jarvis (opérateurs seulement).

## Limites
- Le mode « autonome » (envoi direct sans validation) ne passe pas par la file : seules les relances y sont limitées à la fenêtre. Le mode actuel est « validation ».
- Un premier message WhatsApp à un prospect qui n'a jamais écrit exige un **modèle approuvé par Meta** ; tant que le compte Meta est verrouillé ou qu'aucun modèle n'est approuvé, les messages restent en file / envoi manuel.
- Le plafond ne concerne que WhatsApp ; Gmail garde son propre plafond.
