---
title: Compiler dmsforall
description: Compiler les paquets, l'API et l'interface web, exporter le document OpenAPI, générer les types web et construire les images de conteneurs.
---

À la fin de cette page, vous pouvez compiler chaque paquet, exporter le contrat de l'API et construire les deux images de conteneurs.

## Prérequis

- Node.js 22 ou plus récent.
- pnpm 11, tel qu'épinglé dans `package.json`.
- Docker avec Compose v2, pour la base de données et les images.

## Installer les dépendances

```sh
pnpm install --frozen-lockfile
```

L'option `--frozen-lockfile` fait échouer l'installation si `pnpm-lock.yaml` ne correspond pas à `package.json`.

## Compiler les paquets

```sh
pnpm --filter @dfa/shared build
pnpm build
```

Compilez `@dfa/shared` en premier. L'API et l'interface web utilisent sa sortie compilée.

## Exporter le contrat de l'API et générer les types web

Après avoir modifié un contrôleur ou un DTO, régénérez le document OpenAPI et les types web :

```sh
pnpm api:openapi
pnpm web:types
```

N'exécutez pas `pnpm api:openapi` pendant que `pnpm dev` tourne. Les deux écrivent dans le même dossier de compilation.

## Construire les images de conteneurs

Pour construire les images de la pile à partir des sources, utilisez le fichier de surcharge :

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml build
```

Pour construire une seule image à la main, lancez la commande depuis la racine du dépôt, car les Dockerfiles copient les paquets du workspace :

```sh
docker build -f apps/api/Dockerfile -t dmsforall:local .
docker build -f apps/web/Dockerfile -t dmsforall-web:local .
```

L'image de l'API contient aussi les programmes `mdbtools`, dont l'import de données a besoin.

## Vérifier le résultat

```sh
pnpm typecheck
pnpm lint
pnpm format:check
```

Pour la liste complète des contrôles exécutés par la CI, lisez [Tester](testing.fr.md) et [Contribuer](contributing.fr.md).
