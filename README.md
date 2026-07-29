# dmsforall (DFA)

**DMS pour garages et concessions suisses**. 100 % navigateur — zéro installation client. Multi-tenant avec isolation par ligne (RLS Postgres). Hébergé en Suisse (nLPD). Conçu pour garage indépendant ET concession multi-sites multi-marques.

## État du projet

**Étape 0 (socle technique) livrée et vérifiée** : authentification par session Argon2id, multi-tenant avec isolation RLS, gestion des sites et rôles, i18n FR/DE/IT, API OpenAPI, squelette UI, tests d'intégration sur base Postgres réelle. Aucun module métier (atelier, clients, facturation) — ceux-ci sont en cours d'assemblage pour l'étape 1.

Voir [ARCHITECTURE.md](ARCHITECTURE.md) pour la vision complète et la feuille de route (étapes 1-5).

## Stack

| Couche | Technologie | Notes |
|---|---|---|
| Backend | TypeScript + NestJS | OpenAPI généré automatiquement |
| Base de données | PostgreSQL 16 + Drizzle ORM | RLS pour isolation multi-tenant |
| Frontend | React + Vite (SPA) + shadcn/ui | Types générés depuis l'OpenAPI |
| Jobs/asynchrone | Redis + BullMQ | Catalogues, PDF, e-mails, synchros |
| PDF | Typst ou Playwright | QR-facture suisse intégrée |
| Auth | Sessions + rôles par tenant | TOTP optionnel, 7 rôles métier |

## Prérequis

- **Node.js 22+** — aucune version antérieure testée.
- **pnpm** — gestionnaire de paquets du monorepo.
- **Docker Desktop** — contient Postgres 16 et Redis localement.

### ⚠️ Windows + Docker = WSL2 obligatoire

Si vous êtes sous **Windows 11/10** : WSL2 doit être **activé** pour que Docker Desktop fonctionne. C'est un piège qui bloque immédiatement.

Vérifier l'activation :
```powershell
wsl --list --verbose
```

Si WSL2 n'apparaît pas ou n'est pas en mode 2, l'activer :
```powershell
Panneau de config → Programmes → Activer/désactiver les fonctionnalités Windows → [✓] Sous-système Windows pour Linux
```

Puis redémarrer. Docker Desktop refusera de démarrer sans cela.

## Démarrage en 5 commandes

```bash
# 1. Copier le fichier de configuration
cp .env.example .env    # (PowerShell : Copy-Item .env.example .env)

# 2. Installer les dépendances
pnpm install

# 3. Démarrer Postgres et Redis (conteneurs en arrière-plan)
pnpm docker:up

# 4. Appliquer les migrations de schéma
pnpm db:migrate

# 5. Charger les données de démo et démarrer l'app
pnpm db:seed           # crée un garage de démo
pnpm dev               # API :3000 + front :5173
```

**Important** : L'étape 1 (`cp .env.example .env`) est obligatoire. Node ne lit **aucun** fichier `.env` tout seul — sans cette copie, `pnpm install` échouera sur des variables manquantes (erreur « variable X not found »).

### Identifiants de démonstration

Après `pnpm db:seed`, se connecter sur `http://localhost:5173` avec :
- **Email** : `admin@garage-martin.ch`
- **Mot de passe** : `Demo1234!Garage`

Cela crée un garage de démo (Garage Martin SA) avec un administrateur locataire.

### Vérifier que tout tourne

```bash
docker compose ps                 # Postgres et Redis doivent être "healthy"
curl http://localhost:3000/docs   # Documentation OpenAPI interactive
```

**`curl http://localhost:5173` ne suffit PAS** pour vérifier le front : la commande renvoie un code 200 même quand la configuration `VITE_*` est absente ou invalide — elle ne fait que récupérer la coquille HTML, avant que React ne s'exécute et ne valide la config dans le navigateur. Ouvrir `http://localhost:5173` dans un navigateur et confirmer que l'écran de connexion s'affiche (pas « Configuration frontend invalide »). Si le doute persiste, `pnpm --filter @dfa/web build` échoue bruyamment (code de sortie non nul) si `VITE_API_URL` n'est pas résolue — voir piège n°4 ci-dessous.

Pour tout réinitialiser (volumes Postgres + Redis) :
```bash
pnpm docker:reset    # équivalent à : docker compose down -v && docker compose up -d
```

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

## Pièges connus du dépôt

Quatre points vérifiés — ils bloqueront un nouveau venu, d'où leur documentation explicite ici :

### 1. `docker compose down -v` obligatoire après modification de rôles Postgres

Si vous éditez `docker/postgres/init/01-roles.sql`, la nouvelle configuration ne sera appliquée que si le volume Postgres est vide :

```bash
docker compose down -v    # supprimer le volume
pnpm docker:up            # redémarrer (réexécute les scripts d'init)
pnpm db:migrate           # réappliquer les migrations
```

Sans `down -v`, les scripts d'initialisation ne rejouent jamais — la nouvelle config reste inaccessible.

### 2. `pnpm api:openapi` compile la partie build, échoue via `tsx`

Ne pas lancer `tsx dist/main.js` directement pour exporter l'OpenAPI. La commande doit compiler d'abord :

```bash
pnpm api:openapi     # Correct : compile + exporte
# Ne pas faire : pnpm --filter @dfa/api exec tsx dist/src/openapi/export.ts
```

esbuild ne décorte pas les métadonnées TypeScript avec `tsx`, et NestJS ne peut plus résoudre ses dépendances d'injection.

### 3. Ne jamais convertir un import de classe injectée en `import type` dans `apps/api`

Exemple **incorrect** :

```typescript
// ❌ Casse l'injection de dépendance
import type { AuthService } from './auth.service';

export class MyController {
  constructor(private readonly auth: AuthService) {} // erreur à l'exécution
}
```

Correct :

```typescript
// ✅ Conserve l'import de classe
import { AuthService } from './auth.service';

export class MyController {
  constructor(private readonly auth: AuthService) {}
}
```

La règle ESLint qui interdit cette conversion est désactivée exprès pour l'API.

### 4. Le front ne lit qu'un seul `.env`, celui de la racine

`apps/web/vite.config.ts` fixe `envDir` sur la racine du monorepo : Vite y cherche son `.env`,
jamais dans `apps/web/`. Il n'existe volontairement aucun `apps/web/.env.example` — le
`.env.example` racine est l'unique référence des variables `VITE_*`, deux copies de la même
documentation divergeant tôt ou tard. La séquence de démarrage en 5 commandes ci-dessus
(`cp .env.example .env` **à la racine**) suffit et reste la seule à suivre.

Si `VITE_API_URL` n'est pas résolue, `pnpm dev`/`pnpm --filter @dfa/web build` échouent
immédiatement avec un message explicite (garde-fou dans `vite.config.ts`) plutôt que de
démarrer avec une configuration invalide détectée seulement dans le navigateur.

## Conventions essentielles

Lire [CONTRIBUTING.md](CONTRIBUTING.md) entièrement avant de coder. Les règles clés :

- **Montants en centimes** : integer toujours, jamais float. TVA par ligne, arrondi au 5 ct pour totaux espèces.
- **Multi-tenant** : `tenant_id` NOT NULL + politique RLS sur toute table métier. Le tenant se résout depuis la session/token, **jamais** depuis un paramètre URL.
- **Types frontend** : générés depuis OpenAPI, jamais écrits à la main.
- **Aucune chaîne en dur** : i18n FR/DE/IT dès le départ. Clés structurées par domaine (`atelier.or.statut.enCours`).
- **API-first** : chaque fonctionnalité = endpoint OpenAPI documenté d'abord, écran ensuite.
- **Langue de travail** : français (code, commentaires, documentation).

Voir [CONTRIBUTING.md](CONTRIBUTING.md) pour audit trail, isolation tenant en tests, arithmétique financière exacte.

## Ressources

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Source de vérité : vision, positionnement, stack, modèle de données, couche connecteurs, feuille de route détaillée.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — Conventions de code non négociables, équipe d'agents, rôles et périmètres.
- **[docs/deploiement-local.md](docs/deploiement-local.md)** — Guide complet pour démarrer en dev, pièges Windows, rôles Postgres, tests d'intégration.

## Commandes utiles

Depuis la racine du dépôt :

| Commande | Effet |
|----------|--------|
| **`pnpm dev`** | API + front en hot-reload simultanés |
| `pnpm dev:api` | API seule (http://localhost:3000) |
| `pnpm dev:web` | Front seul (http://localhost:5173) |
| `pnpm build` | Build production (tous les apps) |
| **`pnpm typecheck`** | Validation TypeScript strict sur tout le monorepo |
| **`pnpm lint`** | ESLint sur tout le monorepo |
| `pnpm lint:fix` | ESLint + corrections automatiques |
| **`pnpm test`** | Tests unitaires (API + web) |
| `pnpm test:integration` | Tests d'intégration sur Postgres (API uniquement) |
| **`pnpm --filter @dfa/api exec vitest run --project unitaire src/auth/cookie.spec.ts`** | Lancer un seul fichier de test |
| **`pnpm --filter @dfa/api exec vitest run --project unitaire src/auth/cookie.spec.ts -t "connexion valide"`** | Lancer un seul test par son nom |
| `pnpm db:generate` | Générer types Drizzle depuis le schéma Postgres |
| **`pnpm db:migrate`** | Appliquer les migrations Drizzle (idempotent) |
| **`pnpm db:seed`** | Charger données de démo (garage + admin) |
| `pnpm api:openapi` | Exporter le schéma OpenAPI en JSON |
| `pnpm web:types` | Générer types TypeScript frontend depuis OpenAPI |
| **`pnpm --filter @dfa/web i18n:check`** | Vérifier la couverture i18n (FR→DE/IT) |
| `pnpm docker:up` | Démarrer Postgres + Redis (arrière-plan) |
| `pnpm docker:down` | Arrêter services (garder volumes) |
| **`pnpm docker:reset`** | Arrêter + supprimer volumes + redémarrer (repartir de zéro) |

Les commandes en **gras** sont celles utilisées au quotidien.
