---
title: Sauvegarder et restaurer
description: La sauvegarde quotidienne qui tourne toute seule, comment en faire une à la main, comment la restaurer, et ce qui n'est pas couvert.
---

À la fin de cette page, vous savez où se trouvent les sauvegardes quotidiennes, comment en faire une à la main, comment en restaurer une, et ce que vous devez encore copier vous-même.

## La sauvegarde quotidienne

Le service `backup` tourne avec la pile. Chaque jour à 02:30 (heure du serveur, Europe/Zurich), il écrit deux fichiers dans le dossier `./backups`, à côté du fichier Compose :

| Fichier                         | Contenu                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `dfa-<date>_<time>.sql.gz`      | Toute la base de données : schéma et données.                                                   |
| `fichiers-<date>_<time>.tar.gz` | Les fichiers téléversés et générés : PDF de factures, photos des ordres de réparation, exports. |

Les sauvegardes de plus de 14 jours sont supprimées. Modifiez l'heure et le nombre de jours avec `DFA_BACKUP_TIME` et `DFA_BACKUP_KEEP_DAYS` dans `.env`. L'archive des fichiers est complète chaque nuit, et non incrémentale : dimensionnez donc le disque pour 14 copies de vos documents.

Pour faire une sauvegarde maintenant :

```sh
docker compose exec -u dfa backup /scripts/sauvegarder.sh
```

:::caution
`./backups` se trouve sur la même machine que les données. Une panne de disque ou un serveur volé perd les deux. Copiez ce dossier sur une autre machine chaque jour (`rsync`, `rclone`, un NAS), et gardez avec lui une copie de `./data/secrets`.
:::

Pour chiffrer les sauvegardes, renseignez `DFA_BACKUP_AGE_PUBLIC_KEY` dans `.env` avec une clé publique [age](https://age-encryption.org). Les fichiers se terminent alors par `.age`. Gardez la clé privée hors du serveur : sans elle, les sauvegardes ne peuvent pas être lues.

## Ce que contient une sauvegarde, et ce qu'elle ne contient pas

Le dump de la base et l'archive des fichiers couvrent tout ce que l'application stocke : documents, photos, exports remis à un garage qui quitte le service, et archives téléversées pour reprendre les données du logiciel précédent.

Non couverts :

- `./data/secrets`, les mots de passe générés et la clé de chiffrement. La clé protège les mots de passe d'envoi que les garages ont enregistrés dans l'application : sans elle, ils doivent être saisis de nouveau. Copiez une fois ce petit dossier en lieu sûr.
- `./data/valkey`. Les files d'attente et l'état de courte durée sont recréés.
- `./data/certs`, le certificat HTTPS. Il est régénéré s'il manque.

## Restaurer

Une restauration ramène la base à l'heure de la sauvegarde. Tout ce qui a été écrit après est perdu. Exécutez ces commandes dans le dossier du fichier Compose.

1. Arrêtez les services qui écrivent dans la base :

   ```sh
   docker compose stop api worker
   ```

2. Restaurez la base à partir d'un fichier de sauvegarde (le nom d'un fichier de `./backups`) :

   ```sh
   docker compose exec -u dfa backup /scripts/restaurer.sh dfa-2026-11-10_023000.sql.gz
   ```

   Le script charge d'abord la sauvegarde dans une nouvelle base, et ne remplace la base actuelle que si cela réussit. La base actuelle est conservée sous le nom `dfa_avant_restauration_<time>`, et le script affiche la commande qui la supprime une fois que vous êtes satisfait. Une sauvegarde endommagée ne détruit jamais vos données actuelles. Pour une sauvegarde chiffrée, déchiffrez-la d'abord (`age -d -i age.key -o backups/restore.sql.gz backups/dfa-....sql.gz.age`) et indiquez ce fichier.

3. Restaurez les fichiers (facultatif, si des documents sont perdus) :

   ```sh
   sudo tar -xzf backups/fichiers-2026-11-10_023000.tar.gz -C data/fichiers
   ```

4. Redémarrez les services :

   ```sh
   docker compose start api worker
   ```

Pour restaurer sur un nouveau serveur, copiez-y le fichier Compose, `./data/secrets` et les deux fichiers de sauvegarde, démarrez la pile une fois (`docker compose up -d`, puis `docker compose stop api worker`), et exécutez les étapes 2 à 4.

:::caution
Une sauvegarde que vous n'avez jamais restaurée n'est pas une sauvegarde. Restaurez-en une sur une machine séparée dès maintenant, connectez-vous et ouvrez un document, avant de saisir de vraies données.
:::
