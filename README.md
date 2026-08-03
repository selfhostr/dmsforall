# dmsforall (DFA)

**DMS pour garages et concessions suisses**. 100 % navigateur — zéro installation client. Multi-tenant avec isolation par ligne (RLS Postgres). Hébergé en Suisse (nLPD). Conçu pour garage indépendant ET concession multi-sites multi-marques.

## État du projet

**Étape 0 (socle technique) livrée et vérifiée** : authentification par session Argon2id, multi-tenant avec isolation RLS, gestion des sites et rôles, i18n FR/DE/IT, API OpenAPI, squelette UI, tests d'intégration sur base Postgres réelle.

**Étapes 1 et 2 livrées** : atelier complet (OR, planning, pointage), clients et véhicules, facturation (devis/facture/avoir, QR-facture suisse native, export fiduciaire, encaissement). Écrans et API fonctionnels.

**Étape 3 (Pièces) — API livrée, écrans livrés** : articles, stock, mouvements, réservations. Commandes fournisseur et consignes en cours.

**Étapes 4-5 en cours** : schémas ventes VN/VO et connecteurs posés ; implémentation API et écrans en parallèle.

Voir [ARCHITECTURE.md](ARCHITECTURE.md) pour la vision complète et la feuille de route détaillée.

## Stack

| Couche          | Technologie                    | Notes                              |
| --------------- | ------------------------------ | ---------------------------------- |
| Backend         | TypeScript + NestJS            | OpenAPI généré automatiquement     |
| Base de données | PostgreSQL 16 + Drizzle ORM    | RLS pour isolation multi-tenant    |
| Frontend        | React + Vite (SPA) + shadcn/ui | Types générés depuis l'OpenAPI     |
| Jobs/asynchrone | Redis + BullMQ                 | Catalogues, PDF, e-mails, synchros |
| PDF             | Typst ou Playwright            | QR-facture suisse intégrée         |
| Auth            | Sessions + rôles par tenant    | TOTP optionnel, 7 rôles métier     |

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

Après `pnpm db:seed`, se connecter sur `http://localhost:5173` avec **l'un des 7 comptes** ci-dessous (Garage Martin SA). Tous utilisent le mot de passe `Demo1234!Garage`.

**⚠️ Important** : le compte `admin@` est un **rôle technique** sans aucun droit financier (RF-115). Tout refus d'action financière avec ce compte est **correct, pas un bug**. Utiliser `direction@` pour parcourir la facturation.

| Compte                            | Rôle           | Périmètre                                                                                                     |
| --------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| `admin@garage-martin.ch`          | admin          | Gestion des comptes utilisateurs. **Aucun droit émission de devis/facture ni encaissement.**                  |
| `direction@garage-martin.ch`      | direction      | Tous les droits : facturation, encaissement, remboursement, paramétrage (coordonnées bancaires).              |
| `comptable@garage-martin.ch`      | comptable      | Encaissement, remboursement, export fiduciaire. Même droits que `direction` sur l'argent.                     |
| `receptionniste@garage-martin.ch` | réceptionnaire | Comptoir : émet devis et factures, encaisse les paiements. Pas de remboursement d'avance.                     |
| `chef.atelier@garage-martin.ch`   | chef d'atelier | Émet des devis/bons de commande. **Ni facture ni avoir, ni encaissement.** (Démontre l'asymétrie des droits.) |
| `technicien@garage-martin.ch`     | technicien     | Lecture seule côté montants — le serveur retire les montants de toute réponse pour ce rôle.                   |
| `magasinier@garage-martin.ch`     | magasinier     | Gestion pièces : articles, stock, mouvements, réservations, commandes fournisseur.                            |

**Ce que le jeu de démo contient** (pour savoir quoi parcourir une fois connecté) :

- **4 ordres de réparation** à des états variés (neuf, en cours, en contrôle, terminé) sur des véhicules différents.
- **1 devis émis** (Golf, client Meier) reprenant les deux travaux reportés constatés en atelier.
- **1 facture brouillon** (Octavia, client Dupont) non finalisée.
- **1 facture émise et numérotée** (Master, client Transports Rhône) avec son bulletin de versement QR suisse.
- **1 virement de 150.00 CHF** imputé partiellement sur la facture Master → solde ouvert, facture non soldée.

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

### 2. `pnpm api:openapi` est un point de synchronisation global

La commande **compile l'intégralité de l'API** avant d'exporter le schéma OpenAPI. Elle ne peut être lancée que si le build complet `nest build` réussit :

```bash
pnpm api:openapi     # Correct : compile tout + exporte
# Ne pas faire : pnpm --filter @dfa/api exec tsx dist/src/openapi/export.ts
```

Conséquence : tant qu'**un seul module API** est en chantier (erreur de compilation, import manquant, décorateur cassé), `pnpm api:openapi` échoue. Ce n'est pas une erreur de l'outil de génération, c'est qu'il attendait un build complet. Ne pas relancer tant qu'une correction n'a pas levé l'erreur de compilation à la base. Cela bloque aussi la génération des types côté frontend (`pnpm web:types` dépend de l'OpenAPI), et potentiellement CI/CD selon votre configuration.

**Cause technique** : esbuild ne décorte pas les métadonnées TypeScript avec `tsx`, et NestJS ne peut plus résoudre ses dépendances d'injection à l'exécution.

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

## Dev sans Node ni pnpm sur l'hôte (tout conteneurisé)

Section distincte du flux ci-dessus. **Le flux normal reste `pnpm install` + `pnpm dev` sur
l'hôte** (Node 22+ requis) — cette section est pour un poste qui n'a **ni Node ni pnpm** et où
tout doit passer par Docker, y compris l'installation des dépendances et l'exécution du code.
Seuls Postgres et Redis (`docker-compose.yml`) sont communs aux deux flux.

Ajoute `docker-compose.dev.yml`, qui **complète** `docker-compose.yml` (jamais ne le remplace) :
deux services `api`/`web` construits sur l'image officielle `node:22-alpine` (pas de Dockerfile
dédié), avec le dépôt entier bind-monté et le code source rechargé à chaud. Toutes les commandes
ci-dessous utilisent donc **systématiquement les deux fichiers** :

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml <commande>
```

### Séquence de démarrage

```bash
# 1. Copier le fichier de configuration (identique au flux Node local, à la racine)
cp .env.example .env

# 2. Démarrer Postgres et Redis
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis

# 3. Installer les dépendances DANS un conteneur (peuple des volumes nommés, réutilisés
#    ensuite par les services api/web — voir docker-compose.dev.yml). Construit aussi
#    packages/shared (`tsc -b`) : apps/api en a besoin au démarrage (résolution de module vers
#    packages/shared/dist, jamais vers les sources côté API — contrairement à Vite côté web).
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm api \
  sh -c "corepack enable && pnpm install && pnpm --filter @dfa/shared build"

# 4. Appliquer les migrations, puis charger les données de démo
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm api \
  sh -c "corepack enable && pnpm db:migrate"
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm api \
  sh -c "corepack enable && pnpm db:seed"

# 5. Démarrer l'API (:3000) et le front (:5173) en hot-reload
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d api web
```

`corepack enable` est répété en tête de **chaque** commande one-off (`run --rm`, jamais dans les
services `api`/`web` déjà démarrés, où c'est fait une fois au lancement) : chaque `run` part d'un
conteneur éphémère neuf, et l'activation du shim `pnpm` par corepack ne survit pas d'un conteneur
à l'autre (elle modifie `/usr/local/bin`, une couche de l'image, jamais un volume). Les deux
volumes `dfa_dev_pnpm_store`/`dfa_dev_corepack_cache` évitent seulement de retélécharger à
chaque fois — aucune conséquence fonctionnelle s'ils sont supprimés.

Les 6 comptes de démo (section « Identifiants de démonstration » ci-dessus) sont disponibles sur
`http://localhost:5173` avec le mot de passe `Demo1234!Garage`. Le mot de passe est identique au flux Node local.

### Commandes courantes en conteneur

| Besoin                                                       | Commande                                                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Logs en direct                                               | `docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f api web`                                              |
| Typecheck (tout le monorepo)                                 | `… run --rm api sh -c "corepack enable && pnpm typecheck"`                                                                    |
| Lint                                                         | `… run --rm api sh -c "corepack enable && pnpm lint"`                                                                         |
| Tests (API + web)                                            | `… run --rm api sh -c "corepack enable && pnpm test"`                                                                         |
| Un seul fichier de test (API)                                | `… run --rm api sh -c "corepack enable && pnpm --filter @dfa/api exec vitest run --project unitaire src/auth/cookie.spec.ts"` |
| Un seul fichier de test (web)                                | `… run --rm api sh -c "corepack enable && pnpm --filter @dfa/web exec vitest run src/api/client.spec.ts"`                     |
| Réinstaller après changement de `pnpm-lock.yaml`             | `… run --rm api sh -c "corepack enable && pnpm install"`                                                                      |
| Arrêter                                                      | `docker compose -f docker-compose.yml -f docker-compose.dev.yml down`                                                         |
| Repartir de zéro (efface aussi node_modules/cache conteneur) | `docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v`                                                      |

`pnpm api:openapi` (compile puis exporte, voir piège n°2 ci-dessus) fonctionne à l'identique via
`… run --rm api sh -c "corepack enable && pnpm api:openapi"` — jamais `tsx` directement dessus,
même piège qu'en Node local.

### Pourquoi un override plutôt qu'un fichier autonome

`docker-compose.dev.yml` est fait pour être utilisé **avec** `docker-compose.yml`
(`-f docker-compose.yml -f docker-compose.dev.yml`), jamais seul. Ce choix (documenté en tête du
fichier) laisse les nouveaux services `api`/`web` rejoindre automatiquement le réseau par défaut
du projet Compose (nom de dossier du dépôt) sans une seule ligne de configuration réseau — c'est
la « simplicité qui marche » plutôt qu'un fichier autonome qui aurait dû référencer en dur le nom
généré de ce réseau.

### `node_modules` : piège spécifique au bind-mount

Le dépôt entier est monté dans le conteneur pour le hot-reload. Sans précaution, un
`node_modules` installé pour une architecture (ex. macOS/arm64 côté hôte, s'il existait) écrase
silencieusement celui installé pour arm64/musl **dans** le conteneur — cassant à l'exécution,
pas à la compilation (voir `@node-rs/argon2`, binaire natif). `docker-compose.dev.yml` règle ça
avec des volumes nommés montés sur chaque chemin `node_modules` du monorepo (racine,
`apps/api`, `apps/web`, `packages/shared`), qui masquent ces sous-dossiers du bind-mount et ne
vivent que dans le conteneur. Un `pnpm install` sur l'hôte (si Node y est installé un jour) reste
sans effet sur ces volumes — aucun risque de collision.

### Compromis honnêtes

- **Hot-reload perceptiblement rapide, mais pas instantané comme en Node natif** : mesuré en
  pratique sur ce dépôt, un changement de fichier source (API comme front) est détecté et
  recompilé/rechargé en **1 à 2 secondes** via le bind-mount macOS (VirtioFS, Docker Desktop
  moderne) — un peu plus lent qu'en Node local, sans être gênant à l'usage.
- **`pnpm install` répété est explicite, pas automatique** : les services `api`/`web` ne lancent
  jamais `pnpm install` eux-mêmes au démarrage (`docker compose … up`) — seule l'étape 3
  ci-dessus le fait. Après un changement de dépendance (`pnpm-lock.yaml` modifié), il faut
  relancer cette commande manuellement avant de redémarrer `api`/`web`.
- **`packages/shared` n'est pas surveillé en continu** : `pnpm --filter @dfa/shared build`
  (étape 3) compile une fois ; un changement dans `packages/shared/src` exige de relancer ce
  build (identique au flux Node local — `pnpm dev` à la racine ne surveille que `apps/*`).
- **`pnpm test:integration` (testcontainers) n'est pas couvert par ce flux** : testcontainers
  démarre ses propres conteneurs Postgres/Redis en parlant au démon Docker directement — hors
  périmètre de cette section (exigerait de monter le socket Docker dans le conteneur `api`, une
  complexité supplémentaire non nécessaire pour le dev quotidien).

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

| Commande                                                                                                      | Effet                                                       |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **`pnpm dev`**                                                                                                | API + front en hot-reload simultanés                        |
| `pnpm dev:api`                                                                                                | API seule (http://localhost:3000)                           |
| `pnpm dev:web`                                                                                                | Front seul (http://localhost:5173)                          |
| `pnpm build`                                                                                                  | Build production (tous les apps)                            |
| **`pnpm typecheck`**                                                                                          | Validation TypeScript strict sur tout le monorepo           |
| **`pnpm lint`**                                                                                               | ESLint sur tout le monorepo                                 |
| `pnpm lint:fix`                                                                                               | ESLint + corrections automatiques                           |
| **`pnpm test`**                                                                                               | Tests unitaires (API + web)                                 |
| `pnpm test:integration`                                                                                       | Tests d'intégration sur Postgres (API uniquement)           |
| **`pnpm --filter @dfa/api exec vitest run --project unitaire src/auth/cookie.spec.ts`**                       | Lancer un seul fichier de test                              |
| **`pnpm --filter @dfa/api exec vitest run --project unitaire src/auth/cookie.spec.ts -t "connexion valide"`** | Lancer un seul test par son nom                             |
| `pnpm db:generate`                                                                                            | Générer types Drizzle depuis le schéma Postgres             |
| **`pnpm db:migrate`**                                                                                         | Appliquer les migrations Drizzle (idempotent)               |
| **`pnpm db:seed`**                                                                                            | Charger données de démo (garage + 6 comptes utilisateurs)   |
| `pnpm api:openapi`                                                                                            | Exporter le schéma OpenAPI en JSON                          |
| `pnpm web:types`                                                                                              | Générer types TypeScript frontend depuis OpenAPI            |
| **`pnpm --filter @dfa/web i18n:check`**                                                                       | Vérifier la couverture i18n (FR→DE/IT)                      |
| `pnpm docker:up`                                                                                              | Démarrer Postgres + Redis (arrière-plan)                    |
| `pnpm docker:down`                                                                                            | Arrêter services (garder volumes)                           |
| **`pnpm docker:reset`**                                                                                       | Arrêter + supprimer volumes + redémarrer (repartir de zéro) |

Les commandes en **gras** sont celles utilisées au quotidien.
