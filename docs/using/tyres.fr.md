---
title: Stocker et changer les jeux de pneus
description: Enregistrer les jeux de pneus en dépôt, suivre leur statut et les remettre au client lorsqu'il vient les chercher.
---

Le module pneus conserve les jeux de pneus saisonniers des clients qui laissent leurs pneus en dépôt au garage.

À la fin de cette page, vous pouvez enregistrer un jeu en dépôt, le déplacer et le remettre au client.

## Enregistrer un jeu en dépôt

1. Ouvrez le client et le véhicule.
2. Choisissez **Nouveau dépôt**, puis saisissez la saison, été ou hiver, et l'emplacement dans le hangar.

Résultat : le jeu apparaît avec le statut `en_depot`.

Un véhicule ne peut avoir qu'un seul jeu actif en dépôt pour chaque saison.

## Statuts

| Statut       | Signification                                                          |
| ------------ | ---------------------------------------------------------------------- |
| `en_depot`   | En dépôt, en attente.                                                  |
| `monte`      | Monté sur le véhicule, par exemple lors d'un changement de saison.     |
| `a_relancer` | Aucun mouvement depuis un certain temps. Le client doit être contacté. |
| `sorti`      | Sorti. Le motif est obligatoire.                                       |

Lorsqu'un jeu reste trop longtemps sans mouvement, son statut passe automatiquement à `a_relancer`.

## Sortir un jeu

Choisissez **Sortir**, puis indiquez le motif : rendu au client, véhicule vendu, mis au rebut, ou autre. Le statut devient `sorti`. Un jeu sorti ne peut pas être rouvert. Créez plutôt un nouvel enregistrement de dépôt.

:::caution
Ne supprimez pas un enregistrement de dépôt pour le sortir. Utilisez l'action de sortie, afin que l'historique reste complet.
:::
