# dmsforall (DFA)

DMS pour garages et concessions suisses. Cent pour cent navigateur, multi-tenant avec isolation RLS, hébergé en Suisse (nLPD). Pensé dès le départ pour garage indépendant et concession multi-sites multi-marques.

## Statut

Étape 0 (socle technique) en cours : authentification, tenants, sites, rôles, i18n (FR/DE/IT), API OpenAPI, squelette UI. Aucun module métier encore. Voir [ARCHITECTURE.md](ARCHITECTURE.md) § 6 pour la feuille de route complète.

## Stack

| Couche | Technologie | Notes |
|---|---|---|
| Backend | TypeScript + NestJS | OpenAPI généré automatiquement |
| Base de données | PostgreSQL 16 + Drizzle ORM | RLS pour isolation multi-tenant |
| Frontend | React + Vite (SPA) + shadcn/ui | Types générés depuis l'OpenAPI |
| Jobs/asynchrone | Redis + BullMQ | Catalogues, PDF, e-mails, synchros |
| PDF | Typst ou Playwright | QR-facture suisse intégrée |
| Auth | Sessions + rôles par tenant | TOTP optionnel, 7 rôles métier |

## Démarrage rapide

Prérequis : **Node.js 22+**, **pnpm**, **Docker Desktop** (avec WSL2 activé sur Windows).

```bash
# 1. Copier la configuration
cp .env.example .env              # PowerShell : Copy-Item .env.example .env

# 2. Installer les dépendances
pnpm install

# 3. Démarrer Postgres + Redis en arrière-plan
pnpm docker:up

# 4. Appliquer les migrations
pnpm db:migrate

# 5. Démarrer l'API et le front en hot-reload
pnpm dev
```

L'API est accessible sur `http://localhost:3000`, le front sur `http://localhost:5173`.

Pour vérifier que les services répondent :
```bash
docker compose ps                          # Postgres et Redis doivent être "healthy"
psql postgresql://dfa_app:dfa_app_dev@localhost:5432/dfa_dev -c "select 1;"
redis-cli -h localhost -p 6379 ping
```

Repartir de zéro (réinitialiser volumes et rôles Postgres) :
```bash
pnpm docker:reset
```

Voir [docs/deploiement-local.md](docs/deploiement-local.md) pour le détail et les pièges connus (Windows WSL2, fin de lignes LF, rôles Postgres).

## Structure du dépôt

```
dms/
├── apps/                          # Monorepo : chaque app a son package.json (@dfa/api, @dfa/web)
│   ├── api/                       # Backend NestJS + OpenAPI
│   └── web/                       # Frontend React + Vite
├── packages/
│   └── shared/                    # Types et utilitaires partagés entre backend et frontend
├── docker/
│   └── postgres/init/01-roles.sql # Création des rôles Postgres (RLS)
├── docs/
│   └── deploiement-local.md       # Guide détaillé démarrage dev
├── .assistant/agents/                # Équipe d'agents spécialisés (voir CONTRIBUTING.md)
├── .env.example                   # Modèle de configuration (à copier en .env)
├── docker-compose.yml             # Postgres + Redis dev
├── ARCHITECTURE.md                # Vision, stack, modèle de données, feuille de route
├── CONTRIBUTING.md                      # Conventions non négociables et équipe d'agents
└── package.json                   # Scripts root (dev, build, lint, test, db:*, docker:*)
```

## Conventions essentielles

Avant de coder dans ce dépôt, lire [CONTRIBUTING.md](CONTRIBUTING.md) entièrement — il documente les règles qui surprennent les nouveaux venus. Les points clés :

- **Montants en centimes** : toujours integer, jamais float. TVA calculée par ligne puis agrégée.
- **Multi-tenant** : `tenant_id` NOT NULL + RLS sur toute table métier. Le tenant est résolu depuis la session/token, **jamais** depuis un paramètre de requête.
- **Types frontend** : générés depuis l'OpenAPI, **jamais** écrits à la main.
- **Aucune chaîne en dur** : i18n FR/DE/IT dès le jour 1, clés structurées par domaine.
- **API-first** : chaque fonctionnalité existe d'abord comme endpoint OpenAPI, puis comme écran.
- **Langue de travail** : français dans le code, les commentaires et les docs.

Voir [CONTRIBUTING.md](CONTRIBUTING.md) pour le détail complet, y compris les conventions base de données, audit trail, tests d'isolation tenant et arithmétique financière.

## Ressources

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Source de vérité : vision, positionnement, stack, modèle de données, couche connecteurs, feuille de route détaillée.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — Conventions de code non négociables, équipe d'agents, rôles et périmètres.
- **[docs/deploiement-local.md](docs/deploiement-local.md)** — Guide complet pour démarrer en dev, pièges Windows, rôles Postgres, tests d'intégration.

## Scripts utiles

Depuis la racine (voir `package.json` pour la liste complète) :

```bash
pnpm dev                # API + front en hot-reload
pnpm dev:api           # API seule
pnpm dev:web           # Front seul
pnpm build             # Build production tous les apps
pnpm lint              # ESLint sur tout le monorepo
pnpm lint:fix          # ESLint + fix
pnpm typecheck         # TypeScript strict sur tout
pnpm test              # Tous les tests (unitaires + intégration)
pnpm test:integration  # Intégration uniquement (@dfa/api)
pnpm db:generate       # Générer types Drizzle depuis le schéma
pnpm db:migrate        # Appliquer migrations Drizzle
pnpm db:seed           # Injecter données de test (si implémenté)
pnpm api:openapi       # Exporter le schéma OpenAPI
pnpm web:types         # Générer types frontend depuis OpenAPI
pnpm docker:up         # Postgres + Redis background
pnpm docker:down       # Arrêter les services (garder les volumes)
pnpm docker:reset      # Arrêter + supprimer volumes + redémarrer
```
