---
title: Démarrage rapide
description: Démarrer la pile dmsforall avec Docker Compose et ouvrir l'interface web.
---

À la fin de cette page, la pile dmsforall tourne sur votre machine ou sur votre serveur, et vous pouvez ouvrir l'interface web dans un navigateur.

Il faut Docker Engine et Docker Compose 2.24 ou plus récent. La [page d'installation](installation.md) liste les autres prérequis.

## Étapes

1. Téléchargez le fichier Compose. C'est le seul fichier dont vous avez besoin.

   ```sh
   curl -LO https://github.com/selfhostr/dmsforall/releases/latest/download/docker-compose.yml
   ```

2. Démarrez la pile. Les images sont téléchargées depuis `ghcr.io/selfhostr`. Aucun réglage n'est nécessaire pour un premier essai sur `localhost`.

   ```sh
   docker compose up -d
   ```

3. Créez le premier compte du garage (voir [Configurer votre premier garage](first-garage.md)), puis ouvrez http://localhost:8080 dans un navigateur.

Résultat : la page de connexion s'affiche. Au premier démarrage, la pile génère une seule fois les mots de passe de la base de données et la clé de chiffrement, applique les migrations, puis démarre l'API et le worker.

## Suite

- Pour un serveur accessible depuis Internet, définissez un domaine et HTTPS (un fichier `.env` de quelques lignes) : voir [Installer dmsforall sur un serveur](installation.md).
- Créez le premier compte du garage avec `creer-garage.js` : voir [Configurer votre premier garage](first-garage.md).
- Mettez en place les sauvegardes avant de saisir de vraies données : voir [Sauvegarder et restaurer](backup-and-restore.md).

:::caution
La pile a été définie et ses fichiers ont été relus, mais l'installation complète n'a pas encore été exécutée de bout en bout sur une machine vierge, avec un vrai domaine. Signalez toute différence que vous constatez.
:::
