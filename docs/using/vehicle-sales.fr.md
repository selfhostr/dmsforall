---
title: Vendre des véhicules neufs et d'occasion
description: Gérer le stock de véhicules neufs et d'occasion, les dossiers de vente, les reprises et les confirmations de financement ou de leasing.
---

Le module ventes couvre les véhicules neufs (VN, _véhicules neufs_) et les véhicules d'occasion (VO, _véhicules d'occasion_). Il suit le véhicule de la commande à la livraison, le dossier de vente qui l'accompagne, la reprise du véhicule du client, et le financement.

À la fin de cette page, vous pouvez mettre un véhicule en stock, ouvrir un dossier de vente et le suivre jusqu'à la livraison.

## Statuts des véhicules

| Statut        | Signification                      |
| ------------- | ---------------------------------- |
| `en_commande` | Commandé, pas encore en stock.     |
| `disponible`  | En stock et disponible à la vente. |
| `reserve`     | Réservé pour un client.            |
| `vendu`       | Vendu.                             |
| `livre`       | Livré au client.                   |

## Statuts des dossiers de vente

Un dossier de vente passe de `prospection` (premier contact) à `engage` (le client s'est engagé), puis à `en_preparation`, `pret_a_livrer`, `livre` et `clos`. Il peut aussi être `annule` ou `abandonne`.

## Reprise

Le véhicule du client peut être repris en paiement partiel. La reprise passe de `estimee` à `negociee`, puis à `confirmee` ou `refusee`.

## Financement

Une vente peut être payée comptant (`comptant`), avec un crédit bancaire (`credit`) ou avec un leasing (`leasing`).

- Pour un paiement comptant, le financement est confirmé immédiatement.
- Pour un crédit ou un leasing, la confirmation commence en `en_attente`. La société de financement accepte ou refuse ensuite. Enregistrez sa réponse sur le dossier de vente.

:::caution
En cas de leasing, le véhicule est vendu à la société de leasing, et non au client. La facture doit suivre cette structure. Faites-la vérifier par votre fiduciaire.
:::
