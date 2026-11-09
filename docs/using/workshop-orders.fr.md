---
title: Gérer les ordres de réparation
description: Ouvrir un ordre de réparation, ajouter la main-d'œuvre et les pièces, suivre ses statuts et le clôturer.
---

Un ordre de réparation (OR, _ordre de réparation_) est le document central de l'atelier. Il enregistre les travaux effectués sur un véhicule pour un client.

À la fin de cette page, vous savez ouvrir un ordre, y ajouter des lignes, le suivre dans l'atelier et le clôturer.

## Statuts d'un ordre

| Statut     | Signification                                     |
| ---------- | ------------------------------------------------- |
| `planifie` | Planifié, pas encore commencé.                    |
| `ouvert`   | Ouvert. Les travaux peuvent commencer.            |
| `en_cours` | Travaux en cours.                                 |
| `controle` | Travaux terminés, en attente du contrôle qualité. |
| `termine`  | Terminé, prêt à être facturé.                     |
| `facture`  | Facturé.                                          |
| `restitue` | Véhicule rendu au client.                         |
| `cloture`  | Clôturé.                                          |
| `annule`   | Annulé.                                           |

Les indicateurs d'attente, comme l'attente de pièces, sont conservés séparément du statut.

## Ouvrir un ordre

1. Ouvrez le client, puis le véhicule. Si le véhicule n'est pas dans le système, créez-le d'abord.
2. Choisissez **Créer un OR** et sélectionnez le site.
3. Décrivez la réclamation du client et saisissez le kilométrage.

Résultat : l'ordre apparaît dans la liste des ordres de réparation, avec le statut `ouvert`.

## Ajouter des lignes

Chaque ligne est de l'un de ces types :

- main-d'œuvre, soit en temps de barème (_barème_), soit en temps réel, soit sous forme de forfait (_forfait_) ;
- une pièce, issue du catalogue des pièces, qui réserve du stock sur l'ordre ;
- une fourniture, une prestation confiée à un sous-traitant, ou un produit d'atelier ;
- une ligne de taxe, une remise ou une ligne de texte.

Chaque ligne a son propre statut : proposée, à valider, validée, en cours, réalisée, facturée, refusée ou annulée.

### Joindre des photos à une ligne

Utilisez **Photo** sur une ligne, ou dans la fenêtre qui ajoute un travail, pour photographier le défaut sur une tablette ou un téléphone. Chaque ligne accepte jusqu'à 20 photos, au format JPEG ou PNG, et le navigateur réduit chaque photo avant l'envoi. Sélectionnez une vignette pour voir la photo en plein écran avec sa légende. La personne qui a pris une photo, ou un responsable, peut la supprimer jusqu'à la facturation de l'ordre. Toute personne qui peut lire l'ordre voit les vignettes.

## Devis pour travaux supplémentaires

Lorsque l'atelier découvre des travaux supplémentaires, il crée un devis complémentaire sur l'ordre. Le client décide pour l'ensemble du devis, ou ligne par ligne : accepter, refuser ou accepter partiellement. La décision est enregistrée sur l'ordre.

## Clôturer un ordre

1. Vérifiez que chaque ligne est réalisée, refusée ou annulée.
2. Émettez la facture depuis l'ordre. Voir [Devis et factures](quotes-and-invoices.fr.md).
3. Lorsque le véhicule est rendu, passez le statut à `restitue`. Passez-le à `cloture` une fois le dossier complet.

Le système n'accepte que les changements de statut que le workflow autorise pour le statut actuel.

:::caution
Chaque action sur un ordre dépend du rôle de la personne qui l'effectue. Un technicien peut pointer son temps et consulter l'ordre, mais ne peut pas émettre de facture. Voir [rôles et droits](../reference/roles-and-rights.fr.md).
:::
