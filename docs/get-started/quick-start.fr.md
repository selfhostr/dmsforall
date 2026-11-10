---
title: Démarrage rapide
description: Démarrer la pile dmsforall avec un seul fichier Docker Compose et ouvrir l'interface web.
---

À la fin de cette page, la pile dmsforall tourne sur votre machine ou sur votre serveur, et vous pouvez ouvrir l'interface web dans un navigateur.

Il faut Docker Engine et Docker Compose 2.24 ou plus récent. La [page d'installation](installation.md) liste les autres prérequis.

## Étapes

1. Créez un dossier vide et téléchargez-y le fichier Compose. C'est le seul fichier dont vous avez besoin.

   ```sh
   mkdir dmsforall && cd dmsforall
   curl -LO https://github.com/selfhostr/dmsforall/releases/latest/download/docker-compose.yml
   ```

2. Démarrez la pile. Les images sont téléchargées depuis `ghcr.io/selfhostr`. Il n'y a rien à régler et aucun dossier à créer.

   ```sh
   docker compose up -d
   ```

3. Lisez le code d'installation à usage unique que l'API affiche à son premier démarrage :

   ```sh
   docker compose logs api
   ```

   Il ressemble à `K7QM-3XRB-9TNA`.

4. Ouvrez `https://<adresse du serveur>:8443` dans un navigateur. Le certificat est auto-signé : acceptez-le une fois. La page **Créer votre garage** s'ouvre : saisissez le nom du garage, votre nom, votre adresse e-mail, un mot de passe et le code d'installation. Vous êtes connecté et l'assistant de mise en route s'ouvre. Voir [Configurer votre premier garage](first-garage.md).

Résultat : la page qui crée votre garage s'affiche. Le premier démarrage génère les mots de passe et la clé de chiffrement, crée la base de données et applique les migrations. Vos données sont dans le dossier `./data` et vos sauvegardes dans `./backups`, à côté du fichier Compose.

## Suite

- Pour un nom de domaine avec un vrai certificat, placez votre propre reverse proxy devant : voir [Installer dmsforall sur un serveur](installation.md).
- Créez le premier garage en ligne de commande plutôt que dans le navigateur : voir [Configurer votre premier garage](first-garage.md).
- La sauvegarde quotidienne est déjà active. Copiez `./backups` sur une autre machine, et testez une restauration : voir [Sauvegarder et restaurer](backup-and-restore.md).
