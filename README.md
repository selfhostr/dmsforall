# dmsforall (DFA)

DMS pour garages et concessions suisses. 100% navigateur, multi-tenant, hébergé en Suisse (nLPD).

## Quick Start

```bash
cp .env.example .env
pnpm install
pnpm docker:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

API: http://localhost:3000 — Frontend: http://localhost:5173

### Demo

Tous les comptes utilisent le mot de passe `Demo1234!Garage`.

| Email                             | Rôle           | Accès                                                                      |
| --------------------------------- | -------------- | -------------------------------------------------------------------------- |
| `admin@garage-martin.ch`          | admin          | Gestion technique : comptes, sites, paramètres. **Aucun droit financier.** |
| `direction@garage-martin.ch`      | direction      | Tous les droits : atelier, facturation, stock, ventes.                     |
| `comptable@garage-martin.ch`      | comptable      | Encaissement, paiements, export fiduciaire.                                |
| `receptionniste@garage-martin.ch` | receptionnaire | Comptoir : devis, factures, encaissement.                                  |
| `chef.atelier@garage-martin.ch`   | chef_atelier   | Atelier : OR, constat, devis, validation.                                  |
| `technicien@garage-martin.ch`     | technicien     | Exécution atelier : pointage (lecture montants masquée).                   |
| `magasinier@garage-martin.ch`     | magasinier     | Stock pièces : mouvements, réservations, fournisseurs.                     |
| `vendeur@garage-martin.ch`        | vendeur        | Ventes VN/VO : dossiers, reprises, financement.                            |
| `borne.atelier@garage-martin.ch`  | poste_atelier  | Compte service (tablette murale) : pointage tactile par PIN.               |

**Note** : utiliser `direction@` pour tester la facturation. Le compte `admin@` refuse tous les gestes financiers (normal, pas un bug).

## Vérifier

```bash
docker compose ps          # Postgres et Redis doivent être "healthy"
curl http://localhost:3000/api/docs    # Documentation OpenAPI (Swagger)
```

Frontend : ouvrir http://localhost:5173 dans le navigateur (pas `curl`).

## Avant de conclure ou de pousser

Passe de vérification (dans cet ordre) :

```bash
pnpm --filter @dfa/shared build    # Compiler packages/shared EN PREMIER
pnpm typecheck && pnpm lint && pnpm format:check
pnpm --filter @dfa/web i18n:check && pnpm test
```

**Pourquoi ?** Modifier `packages/shared` sans le reconstruire fait typechecker l'API contre un `dist/` périmé — compile vert mais échoue à l'exécution.

## Repartir de zéro

```bash
pnpm docker:reset && pnpm db:migrate && pnpm db:seed
```

## Pièges connus

1. **`docker compose down -v` obligatoire** après modification de `docker/postgres/init/01-roles.sql` (réinitialise le volume Postgres).

2. **`pnpm api:openapi` conflit avec `pnpm dev`** — ne jamais lancer au même moment (conflit de dossier de compilation).

3. **Front : une seule `.env`** (celle de la racine). Vite y cherche les `VITE_*`, jamais dans `apps/web/.env`.

4. **`import type` interdit en API** : convertir un import de classe injectée en `import type` casse l'injection de dépendance à l'exécution.

## Commandes

| Commande                | Effet                          |
| ----------------------- | ------------------------------ |
| `pnpm dev`              | API + front en hot-reload      |
| `pnpm dev:api`          | API seule (:3000)              |
| `pnpm dev:web`          | Front seul (:5173)             |
| `pnpm build`            | Build production               |
| `pnpm typecheck`        | Vérifier TypeScript            |
| `pnpm lint`             | Linter                         |
| `pnpm test`             | Tests unitaires                |
| `pnpm test:integration` | Tests d'intégration (Postgres) |
| `pnpm db:migrate`       | Appliquer migrations           |
| `pnpm db:seed`          | Charger données de démo        |
| `pnpm api:openapi`      | Exporter schéma OpenAPI        |
| `pnpm web:types`        | Générer types frontend         |
| `pnpm docker:reset`     | Repartir de zéro               |

## Conventions essentielles

Lire [CONTRIBUTING.md](CONTRIBUTING.md) avant de coder :

- Montants en centimes (integer).
- Multi-tenant : `tenant_id` NOT NULL + RLS partout.
- Types frontend générés depuis OpenAPI, jamais à la main.
- i18n FR/DE/IT dès le départ.
- Français : code, commentaires, documentation.

## Travail à deux

Branche de feature : `git switch -c feat/<nom>` depuis `dev`. PR contre `dev`.

```bash
git push -u origin feat/<nom>
gh pr create --base dev
```

Règles : périmètre disjoint (un répertoire = un propriétaire), points de contact négociés avant le code.

## Structure du dépôt

- **`apps/`** — API (NestJS) et frontend (React).
- **`site/`** — Site public (vitrine, documentation, pages légales). Astro + React + Tailwind. Dev : `cd site && pnpm install && pnpm dev` (:4321).
- **`contenu/`** — Source unique : documentation utilisateur FR/DE/IT et pages légales, montée par le site.
- **`outils/captures/`** — Génération automatisée des captures d'écran, par Docker.
- **`kanban/`** — Tableau de suivi. Lancer : `docker compose -f kanban/docker-compose.yml up -d` (http://localhost:8088).
- **`ancien-site/`** — Ancien site (Hugo), en sursis lors de la transition.

## Ressources

- [ARCHITECTURE.md](ARCHITECTURE.md) — Source de vérité
- [CONTRIBUTING.md](CONTRIBUTING.md) — Conventions de code
- [docs/](docs/) — Guides détaillés
