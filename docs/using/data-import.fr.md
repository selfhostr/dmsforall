---
title: Importer les données d'un système existant
description: Transférer les clients, les véhicules, les documents et les travaux en cours d'un garage, depuis une archive de base de données existante, vers dmsforall, avec un plan à relire d'abord.
---

L'import transfère les données d'un garage depuis son logiciel actuel vers dmsforall. Il se déroule en étapes, et rien n'est écrit avant que vous ayez relu le plan.

À la fin de cette page, vous connaissez les étapes d'un import et ce qu'il faut vérifier avant de le confirmer.

## Ce que l'import lit

L'import lit des archives de bases de données. Le type de fichier est détecté d'après le contenu du fichier, et non d'après son nom :

- des bases Microsoft Access (`.mdb`, `.accdb`), ou une archive qui les contient ;
- des tables dBase et FoxPro (`.dbf`).

L'import a été testé avec des archives exportées depuis Auto-i. Projet non affilié à Auto-i.

:::caution
Les archives Access sont lues avec les programmes `mdbtools`. Le conteneur de l'API les inclut. Si vous lancez l'API hors du conteneur, installez d'abord `mdbtools`, sinon l'import s'arrête avec une erreur indiquant que l'outil est manquant.
:::

## Les étapes

1. **Envoi.** Envoyez l'archive. Le système vérifie qu'il s'agit d'un type pris en charge.
2. **Analyse.** Le système lit les tables et compte les enregistrements.
3. **Plan.** Le système propose ce qu'il va importer, ce qu'il va laisser de côté, avec le motif de chaque choix.
4. **Import.** Une fois le plan confirmé, les enregistrements sont écrits dans la base du garage.
5. **Rapport.** Le rapport indique ce qui a été importé, ce qui a été ignoré et ce qui nécessite une décision humaine.

Résultat après le rapport : les clients et véhicules importés apparaissent dans la recherche, et les documents ouverts apparaissent dans leurs listes.

## Relire le plan

Avant de confirmer, vérifiez :

- le nombre de clients et de véhicules par rapport à ce que vous attendez ;
- les factures ouvertes et leurs montants ;
- les ordres de réparation ouverts et leur statut ;
- les éléments que le plan laisse de côté, et le motif.

Un import peut être annulé depuis l'écran d'import. Vérifiez le rapport de l'import annulé avant d'en lancer un autre.

:::caution
Conservez l'archive d'origine jusqu'à ce que le rapport soit relu et que le garage ait utilisé le nouveau système pendant au moins un cycle complet de facturation.
:::

:::caution
L'import écrit dans la base de données du garage. Faites une sauvegarde avant de commencer. Voir [Sauvegarder et restaurer](../get-started/backup-and-restore.md).
:::
