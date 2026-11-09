---
title: Gérer les pièces et le stock
description: Tenir le catalogue des pièces, suivre le stock de chaque site, réserver des pièces sur les ordres de réparation et commander auprès des fournisseurs.
---

Le module pièces tient le catalogue des pièces, le stock de chaque site et les mouvements qui le modifient. Les pièces peuvent être réservées sur un ordre de réparation, commandées auprès des fournisseurs, et facturées via les factures fournisseurs.

À la fin de cette page, vous pouvez ajouter un article, enregistrer un mouvement de stock et réserver une pièce sur un ordre.

## Articles

Un article a une référence, une description, un prix d'achat fournisseur, un prix de vente, un taux de TVA et un emplacement de stockage. Donnez à chaque article une référence claire, car c'est la référence que le comptoir recherche.

## Mouvements de stock

Chaque modification du stock est enregistrée sous forme de mouvement. Les types sont :

- entrée de marchandise à la réception d'une livraison fournisseur ;
- sortie pour un ordre de réparation ;
- vente au comptoir ;
- retour à un fournisseur, ou retour d'un client ;
- transfert entre sites ;
- correction d'inventaire ;
- casse ou perte ;
- retour d'une consigne (_consigne_).

Chaque mouvement conserve qui l'a effectué et quand.

## Réservations

Lorsqu'une pièce est ajoutée à un ordre de réparation, elle est réservée. Le stock affiché comme disponible correspond au stock diminué des réservations. Une réservation est libérée lorsque la pièce est montée, ou lorsque la ligne est annulée.

## Commandes fournisseurs

Créez une commande fournisseur depuis la liste des fournisseurs. Lorsque la livraison arrive, enregistrez la réception. Le stock augmente au moment où la réception est enregistrée, et non à l'envoi de la commande.

## Factures fournisseurs

Une facture fournisseur peut être saisie à la main, ou lue depuis un PDF si le service OCR facultatif est configuré. Vérifiez les montants avant d'approuver la facture.

:::caution
La valorisation du stock selon la méthode FIFO (premier entré, premier sorti) est décidée, mais pas encore implémentée. Les marges par pièce ou par ordre ne peuvent pas être considérées comme fiables dans cette version.
:::
