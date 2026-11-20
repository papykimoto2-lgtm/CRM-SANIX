# WhatsApp du directeur général IA

Le président écrit à son directeur général IA depuis son WhatsApp ; l'instruction suit le même circuit que dans le bureau exécutif (mission du DG, budget contrôlé), et la réponse (`repondre_president`) revient sur WhatsApp.

## Fonctionnement
- **Entrée** : `whatsapp-webhook` (signature Meta vérifiée) reconnaît le numéro enregistré dans `ai_president_whatsapp` ; tout autre numéro reste traité comme un prospect. Le message est journalisé dans `ai_executive_messages` (`canal = whatsapp`, `wamid` unique : un doublon Meta est ignoré), le DG répond « Reçu », exécute la mission, puis envoie sa réponse. 30 messages par heure au plus.
- **Sortie** : un message du directeur est mis en file (`wa_statut = en_attente`) si le président a écrit il y a moins de 23 h, sinon `hors_fenetre` (fenêtre WhatsApp de 24 h) : il repart au prochain message du président. Envoi immédiat par `repondre_president`, filet par le planificateur (`tick`). Réponses longues : 3 parties de 3 500 caractères au plus.
- **Limites** : texte seulement (audio, image : le DG le dit) ; le DG répond en 12 lignes maximum quand l'instruction vient de WhatsApp.

## Mise en route
1. API WhatsApp Cloud (Meta) : secrets Supabase `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` ; webhook Meta → fonction `whatsapp-webhook` (voir `WHATSAPP.md`), abonnement au champ `messages`.
2. Redéployer `whatsapp-webhook` et `ai-company` (migration `20261213000000_president_whatsapp.sql`).
3. Bureau SANIX AI → Paramétrage → « 💬 WhatsApp DG » : saisir son numéro (format international) et activer.
4. Envoyer un premier message au numéro WhatsApp Business de SANIX depuis le numéro enregistré.
