---
title: Ports et chemins
description: Ports réseau, chemins de stockage et volumes Docker utilisés par dmsforall dans la pile par défaut et en développement.
---

## Ports réseau

### Pile par défaut (`docker-compose.yml`)

| Service                | Port de l'hôte            | Remarques                                                                                                  |
| ---------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `proxy` (Caddy) HTTP   | `8080` (`DFA_HTTP_PORT`)  | Correspond au port 80 du conteneur.                                                                        |
| `proxy` (Caddy) HTTPS  | `8443` (`DFA_HTTPS_PORT`) | Correspond au port 443 du conteneur. Utilisez les ports 80 et 443 avec un domaine dans `DFA_SITE_ADDRESS`. |
| `web`, `api`, `worker` | aucun                     | Accessibles uniquement via le proxy.                                                                       |
| `postgres`, `redis`    | aucun                     | Jamais publiés.                                                                                            |
| `ocr-permis`           | aucun                     | Profil `ocr`, joignable depuis l'API dans le réseau Docker.                                                |

Seul le proxy publie un port. Gardez fermés les autres ports sur le pare-feu.

### Développement (`docker/compose.dev.yml`)

| Service       | Port | Remarques                                              |
| ------------- | ---- | ------------------------------------------------------ |
| API           | 3000 | `PORT` dans `.env`. Tourne sur l'hôte avec `pnpm dev`. |
| Interface web | 5173 | Serveur de développement Vite.                         |
| PostgreSQL    | 5432 | Publié pour que les outils puissent se connecter.      |
| Valkey        | 6379 | Publié pour que les outils puissent se connecter.      |

## Chemins de stockage

| Chemin ou volume                    | Contenu                                              | Sauvegardé par la sauvegarde nocturne |
| ----------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| `dmsforall_dfa_postgres_data`       | Données PostgreSQL.                                  | Oui, par le dump.                     |
| `dmsforall_dfa_postgres_backups`    | Sauvegardes nocturnes chiffrées (profil `backup`).   | Copie locale uniquement.              |
| `dmsforall_dfa_api_uploads`         | Documents PDF téléversés et générés.                 | Oui, dans l'archive des fichiers.     |
| `dmsforall_dfa_exports_resiliation` | Exports réalisés lorsqu'un garage quitte le service. | Oui, dans l'archive des fichiers.     |
| `dmsforall_dfa_photos_or`           | Photos des ordres de réparation et miniatures.       | Oui, dans l'archive des fichiers.     |
| `dmsforall_dfa_reprise`             | Archives téléversées pour une reprise de données.    | Oui, dans l'archive des fichiers.     |
| `dmsforall_dfa_secrets`             | Mots de passe de base générés et clé de chiffrement. | Non. Gardez une copie en lieu sûr.    |
| `dmsforall_dfa_redis_data`          | Données Valkey.                                      | Non.                                  |
| `dmsforall_dfa_caddy_data`          | Certificats TLS obtenus par Caddy.                   | Non.                                  |

L'archive des fichiers (`dfa_<timestamp>.uploads.tar.gz.age`) couvre tout ce qui est monté sous `/uploads` dans le service `backup`. Voir [Sauvegarder et restaurer](../get-started/backup-and-restore.md).

En développement, les fichiers PDF sont écrits dans `apps/api/uploads/documents-pdf/<tenant>/<document>.pdf`.

:::caution
Les volumes nommés Docker ne sont pas chiffrés par Docker. Pour les données au repos, utilisez un disque ou une partition chiffrés, situés sous le répertoire de données de Docker. Voir [Ce qui est protégé](../security/what-is-protected.md).
:::
