---
title: Enregistrer les paiements
description: Enregistrer les paiements en espèces, par carte, par virement, par QR-facture, par TWINT, par compensation et par leasing sur les documents.
---

Un paiement s'enregistre sur une facture. La facture indique ce qui a été payé et ce qui reste dû.

À la fin de cette page, vous pouvez enregistrer un paiement et vérifier le solde d'une facture.

## Moyens de paiement

| Moyen          | Usage                                      |
| -------------- | ------------------------------------------ |
| `especes`      | Espèces.                                   |
| `carte`        | Paiement par carte.                        |
| `virement`     | Virement bancaire.                         |
| `qr`           | Paiement par QR-facture.                   |
| `twint`        | TWINT.                                     |
| `compensation` | Un montant compensé avec un autre montant. |
| `leasing`      | Paiement par une société de leasing.       |

## Encaisser un paiement

1. Ouvrez la facture.
2. Choisissez **Encaisser**.
3. Choisissez le moyen et saisissez le montant. Un paiement partiel est accepté.

Résultat : le solde de la facture diminue. Lorsque le solde atteint zéro, la facture est payée.

## Vérifier les paiements

La facture conserve la liste de ses paiements, ce qui vous permet de voir chaque montant et son moyen de paiement.

:::caution
La réconciliation des relevés bancaires (camt.054) n'est pas disponible dans cette version. Les paiements sont enregistrés à la main, et rapprochés des factures par la personne qui les enregistre.
:::

:::caution
Seuls les rôles `direction`, `comptable`, `receptionnaire`, `vendeur` et `magasinier` peuvent enregistrer des paiements. Voir [rôles et droits](../reference/roles-and-rights.md).
:::
