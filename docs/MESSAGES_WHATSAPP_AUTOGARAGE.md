# AutoGarage Pro — modèles de premier message WhatsApp (à VALIDER avant tout envoi)

Statut : **brouillons**. Rien n'est envoyé automatiquement. Chaque message est relu par le président, personnalisé avec le nom du garage, et envoyé par une personne (ou placé dans la file de validation des agents commerciaux).

Faits utilisés, tous issus de la fiche produit : ERP garage (fiches véhicules, ordres de réparation, diagnostics et entretiens, stock de pièces, rendez-vous, caisse, facturation), version de démonstration de 15 jours. **Aucun prix, aucune promesse de résultat, aucune référence client** dans le premier message.

## Variante A — garage généraliste / mécanique
> Bonjour {Nom du garage}, ici {Prénom} de SANIX.
> Nous avons développé AutoGarage Pro, un logiciel pour garages : ordres de réparation, stock de pièces, rendez-vous, caisse et facturation au même endroit.
> Aimeriez-vous essayer une version de démonstration de 15 jours dans votre garage ?
> Si ce message ne vous concerne pas, répondez STOP : nous ne vous écrirons plus.

## Variante B — carrosserie / peinture
> Bonjour {Nom du garage}, ici {Prénom} de SANIX.
> AutoGarage Pro aide les ateliers à suivre chaque véhicule de l'entrée à la facture : ordres de réparation, pièces, planning des mécaniciens, devis et facturation.
> Voulez-vous voir comment cela fonctionnerait pour votre atelier, avec une démonstration de 15 jours ?
> Répondez STOP pour ne plus recevoir de message de notre part.

## Variante C — garage qui semble déjà équipé (ex. AUTO EXPERT)
> Bonjour {Nom du garage}, ici {Prénom} de SANIX.
> Votre site mentionne un espace de gestion interne. Nous proposons AutoGarage Pro (ordres de réparation, stock de pièces, rendez-vous, caisse, facturation) : seriez-vous ouverts à comparer, sans engagement, avec une démonstration de 15 jours ?
> Répondez STOP pour ne plus recevoir de message de notre part.

## Règles d'envoi
- 20 messages par jour au plus, du lundi au samedi, entre 8 h et 18 h (heure d'Abidjan) : ce sont les horaires affichés par les garages.
- Un seul message par garage. Pas de relance avant 3 jours ; deux relances au plus, courtes. Toute réponse STOP / « non » : fiche marquée désinscrite, plus aucun message.
- Personnaliser : nom exact du garage et, si connu, un point précis (carrosserie, climatisation…). Ne rien affirmer qui ne soit pas lu sur leur page.
- Canal : WhatsApp par le numéro lu sur leur page. **Envoi via l'API WhatsApp du CRM** : un premier message à quelqu'un qui n'a jamais écrit exige un modèle de message approuvé par Meta (le compte est encore verrouillé, erreur 131031). En attendant : envoi manuel depuis le téléphone, ou appel.
- Chaque envoi et chaque réponse sont notés dans la fiche CRM (interactions).
