---
title: Ports et chemins
description: Ports réseau et chemins de stockage utilisés par dmsforall dans la pile par défaut et en développement.
---

## Ports réseau

### Pile par défaut (`docker-compose.yml`)

| Service                        | Port de l'hôte      | Remarques                                                                         |
| ------------------------------ | ------------------- | --------------------------------------------------------------------------------- |
| `web`                          | `8443` (`DFA_PORT`) | HTTPS uniquement, correspond au port 8443 du conteneur. Relaie `/api` vers `api`. |
| `api`, `worker`                | aucun               | Accessibles uniquement via `web`.                                                 |
| `postgres`, `valkey`, `backup` | aucun               | Jamais publiés.                                                                   |
| `ocr-permis`                   | aucun               | Profil `ocr`, joignable depuis l'API dans le réseau Docker.                       |

Seul `web` publie un port, et il n'y a pas de port HTTP. Gardez fermés les autres ports sur le pare-feu.

### Développement (`docker/compose.dev.yml`)

| Service       | Port | Remarques                                              |
| ------------- | ---- | ------------------------------------------------------ |
| API           | 3000 | `PORT` dans `.env`. Tourne sur l'hôte avec `pnpm dev`. |
| Interface web | 5173 | Serveur de développement Vite.                         |
| PostgreSQL    | 5432 | Publié pour que les outils puissent se connecter.      |
| Valkey        | 6379 | Publié pour que les outils puissent se connecter.      |

## Chemins de stockage

La pile par défaut utilise de simples dossiers à côté de `docker-compose.yml` (bind mounts), sans volume Docker.

| Dossier           | Contenu                                                             | Couvert par la sauvegarde quotidienne |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------- |
| `./data/postgres` | Données PostgreSQL.                                                 | Oui, par le dump.                     |
| `./data/fichiers` | Documents téléversés et générés, photos, exports.                   | Oui, dans l'archive des fichiers.     |
| `./data/secrets`  | Mots de passe de base générés et clé de chiffrement.                | Non. Gardez une copie en lieu sûr.    |
| `./data/valkey`   | Données Valkey (files d'attente des tâches).                        | Non.                                  |
| `./data/certs`    | Certificat HTTPS : `cert.pem` et `key.pem`.                         | Non. Régénéré s'il manque.            |
| `./backups`       | Les sauvegardes quotidiennes (`dfa-*.sql.gz`, `fichiers-*.tar.gz`). | Copie locale uniquement.              |

L'archive des fichiers couvre tout ce qui se trouve sous `./data/fichiers`. Voir [Sauvegarder et restaurer](../get-started/backup-and-restore.md).

En développement, les fichiers PDF sont écrits dans `apps/api/uploads/documents-pdf/<tenant>/<document>.pdf`.

:::caution
Les dossiers ne sont pas chiffrés par Docker. Pour les données au repos, utilisez un disque ou une partition chiffrés, sous le dossier qui contient `docker-compose.yml`. Voir [Ce qui est protégé](../security/what-is-protected.md).
:::
