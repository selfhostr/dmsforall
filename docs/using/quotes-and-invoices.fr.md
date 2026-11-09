---
title: Émettre devis et factures avec une QR-facture
description: Créer des devis, des commandes, des factures et des avoirs, et émettre des factures avec une QR-facture suisse.
---

dmsforall gère quatre types de documents de vente : les devis (_devis_), les bons de commande (_bons de commande_), les factures (_factures_) et les avoirs (_avoirs_). Les factures d'acompte (_factures d'acompte_) sont des factures d'un genre particulier.

À la fin de cette page, vous pouvez émettre une facture avec une QR-facture suisse et la corriger par un avoir.

## Avant la première facture

Complétez le bloc créancier dans les réglages de facturation. Il contient les coordonnées bancaires qui figurent sur la QR-facture. Une facture qui nécessite une QR-facture ne peut pas être émise sans bloc créancier complet. Voir [Configurer votre premier garage](../get-started/first-garage.fr.md).

## Créer un document

1. Depuis l'ordre de réparation ou le dossier de vente, choisissez **Nouveau devis** ou **Nouvelle facture**.
2. Vérifiez le client, les lignes, le taux de TVA de chaque ligne et les totaux.
3. Enregistrez-le en brouillon. Un brouillon peut encore être modifié.

La TVA est calculée ligne par ligne, puis additionnée pour le document. Les totaux sont affichés en CHF, avec des centimes.

## Émettre un document

1. Choisissez **Émettre**.
2. Vérifiez une dernière fois le document : après cette étape, il est verrouillé.
3. Téléchargez ou imprimez le PDF.

Les documents émis reçoivent un numéro d'une série continue pour chaque année. Un numéro n'est jamais réutilisé.

## La référence de la QR-facture

Les factures portent l'une de trois références :

- une référence QR (QRR), pour un compte QR-IBAN ;
- une référence créancier (SCOR), pour un compte IBAN classique ;
- aucune référence.

Le choix dépend du compte bancaire du bloc créancier.

## Factures d'acompte

Une facture d'acompte est une facture de nature _acompte_. Elle partage la même série de numérotation que les autres factures.

## Avoirs

Un avoir corrige une facture émise. Vous ne modifiez jamais une facture émise. Choisissez le motif et la portée :

- totale : l'avoir annule la facture entière ;
- partielle : il annule une partie de la facture.

:::caution
Les avoirs peuvent être limités par rôle. Un réceptionnaire ne peut émettre un avoir que jusqu'à un plafond fixé par la direction. Au-delà du plafond, le système refuse l'avoir et le conserve en brouillon, sans numéro. La direction et la comptabilité n'ont pas de plafond. Voir [rôles et droits](../reference/roles-and-rights.fr.md).
:::

:::caution
dmsforall n'est pas un conseiller fiscal. Faites vérifier vos factures et vos chiffres de TVA par une fiduciaire avant de vous y fier pour votre comptabilité.
:::
