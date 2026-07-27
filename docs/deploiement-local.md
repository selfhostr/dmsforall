# Déploiement local (dev)

Dev hybride : Postgres et Redis tournent en conteneurs, l'API et le front tournent en Node
local (hot-reload). Voir `docker-compose.yml` (racine) pour le détail des services.

## Prérequis

- **Node.js 22+**
- **pnpm** (voir `packageManager` dans `package.json` — `corepack enable` suffit à l'obtenir)
- **Docker Desktop** avec le backend **WSL2** activé (Windows) — indispensable pour
  `docker compose`. Sur Linux/macOS, Docker Engine/Docker Desktop standard suffit.

## Démarrage en 5 commandes

```bash
cp .env.example .env          # PowerShell : Copy-Item .env.example .env
# → les valeurs par défaut de .env.example fonctionnent telles quelles en dev (rôles et mots
#   de passe créés par docker/postgres/init/01-roles.sql), rien à générer.
pnpm install
pnpm docker:up                 # démarre Postgres + Redis en arrière-plan (crée aussi les
                                # rôles dfa_migrator/dfa_app au premier démarrage du volume)
pnpm db:migrate                # applique les migrations Drizzle (rôle dfa_migrator)
pnpm dev                       # API + front en Node local, hot-reload (rôle dfa_app)
```

## Vérifier que Postgres et Redis répondent

```bash
docker compose ps                                   # les deux services doivent être "healthy"
docker compose exec postgres pg_isready -U dfa -d dfa_dev
docker compose exec redis redis-cli ping             # doit répondre PONG
```

Ou directement depuis l'hôte si les clients sont installés localement (avec le rôle
applicatif `dfa_app`, celui réellement utilisé par l'API) :

```bash
psql postgresql://dfa_app:dfa_app_dev@localhost:5432/dfa_dev -c "select 1;"
redis-cli -h localhost -p 6379 ping
```

### Rôles Postgres (RLS)

Le service `postgres` démarre avec un compte superuser (`dfa`), mais **ce compte ne sert
qu'à initialiser le conteneur** — l'API et les migrations ne l'utilisent jamais. Au premier
démarrage sur un volume vide, `docker/postgres/init/01-roles.sql` crée automatiquement les
deux rôles réellement utilisés :

- `dfa_migrator` (propriétaire des tables, utilisé par `DATABASE_URL_MIGRATION`) ;
- `dfa_app` (soumis au RLS, utilisé par `DATABASE_URL`, celui de l'API en exécution).

Un rôle superuser ou propriétaire des tables contournerait silencieusement le RLS
d'isolation tenant — d'où cette séparation stricte. Voir les commentaires du fichier SQL pour
le détail.

## Repartir de zéro

```bash
pnpm docker:reset    # équivaut à : docker compose down -v && docker compose up -d
```

`down -v` supprime aussi les volumes nommés (`dfa_postgres_data`, `dfa_redis_data`) : toutes
les données locales sont perdues, il faudra rejouer `pnpm db:migrate` (et `pnpm db:seed` si
utilisé) après.

**C'est aussi la seule façon de (re)créer les rôles `dfa_migrator`/`dfa_app`** : le script
`docker/postgres/init/01-roles.sql` ne s'exécute qu'à l'initialisation d'un volume Postgres
vide. Si vous obtenez une erreur d'authentification pour `dfa_app` ou `dfa_migrator` alors
que le conteneur est « healthy », c'est très probablement qu'un volume `dfa_postgres_data`
antérieur à ces rôles traîne encore — `pnpm docker:reset` résout ce cas dans la quasi-totalité
des cas.

## Pièges connus

- **(Piège n°1) Le script de création des rôles ne rejoue jamais tout seul** : si vous
  changez de branche ou mettez à jour le dépôt et que `docker/postgres/init/01-roles.sql`
  est nouveau ou modifié sur un volume Postgres déjà initialisé, il sera silencieusement
  ignoré — Docker n'exécute `/docker-entrypoint-initdb.d/` qu'à la création d'un volume vide.
  Symptôme : erreurs d'authentification pour `dfa_app`/`dfa_migrator` malgré un conteneur
  « healthy ». Solution : `pnpm docker:reset` (équivalent `docker compose down -v`).

### Pièges Windows

- **WSL2 requis** : Docker Desktop sans le backend WSL2 ne fonctionne pas correctement pour
  ce projet. À vérifier dans Docker Desktop → Settings → General → *Use the WSL 2 based engine*.
- **Ports 5432 / 6379 déjà occupés** : une installation locale de PostgreSQL ou Redis (hors
  Docker) qui tourne en service Windows entre en conflit avec les ports publiés par
  `docker-compose.yml`. Arrêter le service local (`services.msc`) ou changer temporairement
  le port publié dans `docker-compose.yml` le temps du diagnostic.
- **Fins de ligne LF** : le dépôt attend des fins de ligne LF (voir `.gitattributes`). Sur
  Windows, vérifier `git config core.autocrlf` (idéalement `input` ou `false`) pour éviter que
  Git ne réécrive les fichiers en CRLF au checkout, ce qui casse notamment les scripts shell
  et peut déclencher des diffs parasites.
- **Les tests d'intégration ne touchent jamais `dfa_dev`** : ils utilisent testcontainers,
  qui démarre ses propres conteneurs Postgres/Redis éphémères. Docker Desktop (avec WSL2)
  doit donc aussi tourner pour lancer `pnpm test:integration` en local.
