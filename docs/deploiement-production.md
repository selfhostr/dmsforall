# Déploiement en production

Ce document décrit la mise en production de DFA avec `docker-compose.yml` (racine du
dépôt) : première installation pas à pas, déploiements suivants, migrations, sauvegardes,
rotation des secrets, monitoring, et retour arrière. Public visé : @laupernoe, seul au support — chaque
procédure est écrite pour être suivie sans avoir à relire le code à 2h du matin.

Philosophie : la simplicité qui marche. Un seul serveur, Docker Compose, une base et un Redis
managés. On complexifie (haute disponibilité, orchestrateur, réplication) seulement quand un
besoin réel l'impose — pas avant.

## 1. Vue d'ensemble

```
Internet
   │  443/80 (TLS automatique, Let's Encrypt)
   ▼
┌─────────────────────┐
│  reverse-proxy       │  Caddy — seul service exposé sur l'hôte
│  (conteneur)         │
└──────────┬───────────┘
           │ réseau Docker interne (aucun accès depuis l'hôte)
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐  ┌─────────┐
│  api     │  │  web     │  NestJS / nginx+SPA — conteneurs, images taguées par la CI
│ :3000    │  │ :8080    │
└────┬─────┘  └─────────┘
     │
     ▼ (TLS, réseau de l'hébergeur)
┌─────────────────┐   ┌──────────────────┐
│ PostgreSQL managé │   │ Redis managé      │   ← hors de ce dépôt, hors de Compose
└─────────────────┘   └──────────────────┘
```

Points structurants, tous déjà actés dans le code livré et repris tels quels ici :

- **Un seul domaine public** (ex. `https://app.dmsforall.example`) : `apps/web/nginx.conf` (CSP
  `connect-src 'self'`) et `apps/web/Dockerfile` (`VITE_API_URL=/api/v1`, chemin relatif)
  supposent tous les deux que le front et l'API sont servis derrière le **même** reverse proxy,
  sur la **même** origine. `API_URL_PUBLIQUE` et `WEB_URL_PUBLIQUE` doivent donc pointer vers la
  même URL en production — voir §4.
- **Aucun Postgres/Redis conteneurisé en production.** `docker-compose.yml` (Postgres+Redis en
  conteneurs) est réservé au dev hybride. En production, ce sont des services managés
  (Infomaniak ou Exoscale, Suisse) — voir §2 et §3.
- **Déploiement = image taguée.** `docker-compose.yml` ne contient aucun `build:` :
  `API_IMAGE`/`WEB_IMAGE` référencent une image déjà construite par la CI. Le rollback consiste
  à redéployer le tag précédent (§9), jamais à recompiler sur le serveur.
- **L'API refuse de démarrer si la configuration ou la posture RLS sont invalides** (validation
  zod + `verifierPostureRls()`, voir `apps/api/src/main.ts` et
  `apps/api/src/db/acces-base.service.ts`). C'est voulu : mieux vaut un déploiement qui échoue
  bruyamment qu'une API qui tourne sans isolation tenant effective.

## 2. Hébergement (nLPD)

DFA traite des données de garages et de leurs clients (personnes physiques) : le nLPD impose des
données hébergées en Suisse, chiffrées au repos et en transit. Deux hébergeurs suisses
conviennent, au choix selon disponibilité/tarif au moment de la mise en place :

- **Infomaniak** (Public Cloud / Jelastic) — base de données managée, object storage (Swiss
  Backup) pour les sauvegardes chiffrées.
- **Exoscale** — Compute (VM), DBaaS PostgreSQL, DBaaS Redis/Valkey, SOS (object storage
  compatible S3) pour les sauvegardes.

Dans les deux cas, vérifier explicitement au provisionnement :

- la **zone/datacenter est en Suisse** (les deux proposent plusieurs zones, ne pas prendre le
  défaut sans vérifier) ;
- le **chiffrement au repos** est activé sur l'instance de base de données et sur le stockage des
  sauvegardes (pas toujours activé par défaut) ;
- le **chiffrement en transit** : connexions Postgres/Redis en TLS (`sslmode=require` au minimum,
  `verify-full` si l'hébergeur fournit un certificat vérifiable ; `rediss://` pour Redis si
  disponible) — sinon restreindre l'accès réseau à l'IP du serveur applicatif (groupe de
  sécurité / firewall de l'hébergeur), jamais 0.0.0.0/0.

## 3. Prérequis avant la toute première mise en production

### 3.1 Publier des images taguées (prérequis bloquant, pas encore automatisé)

`docker-compose.yml` exige `API_IMAGE`/`WEB_IMAGE` pointant vers des images déjà
construites. **À la date d'écriture, `.github/workflows/ci.yml` ne construit ni ne publie
d'image** — le job `verifier` lance `pnpm build` (compilation TypeScript) mais aucune étape
`docker build`/`docker push` n'existe encore. C'est un prérequis à ajouter avant toute mise en
production, indépendamment de ce document (changement CI, hors périmètre de ces deux fichiers) :
un job qui, sur push de tag (`v*`) ou sur `main`, construit `apps/api/Dockerfile` et
`apps/web/Dockerfile` depuis la racine du dépôt (voir les deux Dockerfiles pour la raison du
contexte racine) et pousse vers un registre — GitHub Container Registry (`ghcr.io`) est le choix
le plus simple, aucune infrastructure supplémentaire, intégré à l'authentification GitHub Actions
existante.

**En attendant cette automatisation**, la toute première image peut être construite et publiée à
la main depuis un poste avec Docker :

```bash
# Depuis la racine du dépôt (contexte de build obligatoire, voir les Dockerfiles)
docker build -f apps/api/Dockerfile -t ghcr.io/<org>/dfa-api:v0.1.0 .
docker build -f apps/web/Dockerfile -t ghcr.io/<org>/dfa-web:v0.1.0 .

docker login ghcr.io -u <utilisateur-github>
docker push ghcr.io/<org>/dfa-api:v0.1.0
docker push ghcr.io/<org>/dfa-web:v0.1.0
```

Convention de tag : aligner sur `VERSION_APP` (`.env.production`) et sur la version de
`package.json` — le tag apparaît dans `GET /api/v1/sante` et doit permettre de corréler une
erreur Sentry à un déploiement précis (voir §8).

### 3.2 Base de données PostgreSQL managée

1. Provisionner une instance PostgreSQL 16 en Suisse (§2), réseau restreint à l'IP du serveur
   applicatif (ou VPC privé si l'hébergeur le propose).
2. Créer la base applicative, par exemple `dfa_prod`, via la console de l'hébergeur ou
   `CREATE DATABASE dfa_prod;` avec le compte admin fourni par l'hébergeur.
3. Se connecter à `dfa_prod` avec ce compte admin (psql) et rejouer **tel quel**
   `docker/postgres/init/01-roles.sql` — ce script est explicitement conçu pour ça (voir son
   en-tête). Il crée `dfa_migrator` et `dfa_app` avec les mots de passe de dev
   (`dfa_migrator_dev`/`dfa_app_dev`) : **c'est attendu**, l'instance n'est pas encore exposée.
4. Immédiatement après, changer les deux mots de passe pour des valeurs fortes générées pour
   l'occasion — ne jamais éditer le fichier SQL versionné pour y mettre un secret réel :

   ```sql
   alter role dfa_migrator with password '<mot-de-passe-fort-genere>';
   alter role dfa_app      with password '<mot-de-passe-fort-different>';
   ```

   Générer par exemple avec `openssl rand -base64 32`. Reporter ces deux valeurs dans
   `DATABASE_URL` (rôle `dfa_app`) et `DATABASE_URL_MIGRATION` (rôle `dfa_migrator`) de
   `.env.production` — la validation zod refuse de démarrer si ces deux URLs sont identiques,
   c'est un garde-fou volontaire (voir `apps/api/src/config/charger-config.ts`).
5. Les tables, politiques RLS et fonctions `SECURITY DEFINER` du schéma `amorcage` sont posées
   par les migrations (§6), pas par ce script — `01-roles.sql` ne fait que le provisionnement des
   rôles.

### 3.3 Redis managé

Provisionner une instance Redis (ou Valkey, compatible) en Suisse, réseau restreint de la même
façon, avec mot de passe/ACL et TLS si l'offre le permet (`rediss://`). Redis sert de cache et de
backend BullMQ (files de jobs) — pas de données à caractère personnel censées y transiter
durablement, mais même politique de restriction réseau que Postgres par cohérence.

### 3.4 Serveur applicatif

Une VM (Infomaniak Public Cloud ou Exoscale Compute), même zone/région que la base pour limiter
la latence, avec Docker Engine + le plugin Compose installés. Firewall/groupe de sécurité :
seuls les ports **80**, **443** (Caddy) et **22** (SSH, idéalement restreint par IP et par clé,
jamais par mot de passe) sont ouverts publiquement. Aucun autre port n'a besoin d'être ouvert —
`api` et `web` ne publient volontairement aucun port sur l'hôte dans `docker-compose.yml`.

### 3.5 DNS

Pointer l'enregistrement A (et AAAA si IPv6) du domaine choisi (ex. `app.dmsforall.example`) vers l'IP
publique du serveur, **avant** de démarrer `reverse-proxy` : Caddy négocie un certificat Let's
Encrypt au démarrage via le challenge HTTP-01, qui échoue si le DNS ne résout pas encore vers le
serveur.

### 3.6 Fichier `.env.production`

Sur le serveur, à côté de `docker-compose.yml`, créer `.env.production` (jamais commité —
déjà couvert par `.env.*` dans `.gitignore`) avec :

- **Toutes** les variables de `.env.example` (le schéma zod de `apps/api/src/config` les valide
  au démarrage — une valeur manquante fait échouer le conteneur `api` immédiatement, `docker
  compose logs api` en donne le détail précis, variable par variable), avec ces valeurs
  spécifiques à la production :
  - `NODE_ENV=production` (redondant avec `docker-compose.yml`, qui le fixe aussi en
    défense en profondeur — voir le fichier)
  - `COOKIE_SECURE=true` (obligatoire : la validation zod refuse de démarrer si
    `NODE_ENV=production` et `COOKIE_SECURE=false`)
  - `OPENAPI_EXPOSER_DOCS=false` (défaut déjà `false` — ne pas l'activer en production sans
    raison précise et temporaire : Swagger est monté hors du graphe Nest, donc hors de l'`APP_
    GUARD` d'authentification, voir le commentaire de la variable dans `.env.example`)
  - `TRUST_PROXY_HOPS=1` — Caddy (`reverse-proxy`) est l'unique reverse proxy entre Internet et
    le conteneur `api`. Une valeur incorrecte casse soit la limitation de débit par IP (réglée
    trop bas, tous les tenants partagent une seule clé), soit la protection anti-usurpation
    (réglée trop haut, un `X-Forwarded-For` forgé la contourne) — voir le commentaire détaillé
    dans `.env.example`.
  - `API_URL_PUBLIQUE` et `WEB_URL_PUBLIQUE` : **la même URL**, celle du domaine unique (§1), ex.
    `https://app.dmsforall.example` pour les deux. `WEB_URL_PUBLIQUE` est aussi la valeur utilisée
    telle quelle comme adresse de site dans le Caddyfile (`docker-compose.yml`, bloc
    `configs`).
  - `DATABASE_URL`, `DATABASE_URL_MIGRATION` : voir §3.2.
  - `REDIS_URL` : voir §3.3.
  - `VERSION_APP` : alignée sur le tag d'image déployé (§3.1, §7).
- Deux variables supplémentaires, propres à `docker-compose.yml` (pas au schéma zod de
  l'API) :
  - `API_IMAGE`, `WEB_IMAGE` : références complètes avec tag (ex.
    `ghcr.io/<org>/dfa-api:v0.1.0`).
  - `ACME_EMAIL` : adresse reçue par Let's Encrypt pour les notifications d'expiration de
    certificat (ne devrait jamais servir si le renouvellement automatique fonctionne, mais c'est
    le seul filet en cas d'échec silencieux).

Permissions du fichier sur le serveur : `chmod 600 .env.production`, lisible uniquement par
l'utilisateur qui lance `docker compose`.

## 4. Première mise en production, pas à pas

Une fois §3 complété (images publiées, base et Redis provisionnés, serveur prêt, DNS résolu,
`.env.production` rempli) :

```bash
# 1. Récupérer docker-compose.yml sur le serveur (ex. via git clone du dépôt, ou en copiant
#    seulement ce fichier — il ne dépend d'aucun autre fichier du dépôt à l'exécution, les
#    Dockerfiles ne servent qu'à CONSTRUIRE les images, déjà faites à l'étape 3.1).

# 2. Appliquer les migrations AVANT de démarrer quoi que ce soit d'autre — la base est vide au
#    tout premier déploiement, l'API refuserait de démarrer (verifierPostureRls() exige des
#    tables déjà migrées).
docker compose -f docker-compose.yml --env-file .env.production \
  --profile migration run --rm migrate

# 3. Démarrer la stack applicative.
docker compose -f docker-compose.yml --env-file .env.production up -d

# 4. Vérifier.
docker compose -f docker-compose.yml --env-file .env.production ps
curl -s https://<domaine>/api/v1/sante        # {"statut":"ok","version":"..."}
curl -s https://<domaine>/api/v1/sante/pret   # {"base":"ok","redis":"ok"}
```

**Ne jamais lancer `pnpm db:seed` (`seed-dev.ts`) contre la base de production.** Son garde-fou
actuel ne teste que `NODE_ENV === 'production'`, une variable qu'une session ponctuelle sur le
serveur peut ne pas hériter (finding documenté dans `docs/rapport-qa-etape-0.md`, non corrigé à
ce jour) — il créerait un compte admin à mot de passe public (`admin@garage-martin.ch` /
`Demo1234!Garage`, visible dans le dépôt) sur la base réelle. Ce fichier `docker-compose.yml`
ne définit d'ailleurs volontairement aucun service/`profile` pour le seed, uniquement pour
`migrate` — pour qu'il n'y ait tout simplement pas de commande « prête à copier-coller » qui
ferait cette erreur en production.

Créer le premier compte réel (celui du premier garage) par un autre canal que le seed de démo —
hors périmètre de ce document, voir la spécification métier de l'étape concernée.

## 5. Déploiements suivants

Workflow normal une fois la première mise en production faite :

1. La CI construit et teste (`lint`, `typecheck`, `test`, `test:integration`, `build`) sur chaque
   push — déjà en place (`.github/workflows/ci.yml`). Une fois le job de publication d'image
   ajouté (§3.1), chaque tag `vX.Y.Z` produit `dfa-api:vX.Y.Z` et `dfa-web:vX.Y.Z` sur le
   registre.
2. Sur le serveur, mettre à jour `.env.production` : `API_IMAGE`/`WEB_IMAGE` sur le nouveau tag.
3. **Migrer avant de redéployer le code** — voir §6 pour le détail et la gestion des échecs :

   ```bash
   docker compose -f docker-compose.yml --env-file .env.production \
     --profile migration run --rm migrate
   ```

4. Puis mettre à jour les conteneurs applicatifs :

   ```bash
   docker compose -f docker-compose.yml --env-file .env.production \
     up -d api web reverse-proxy
   ```

   Compose ne recrée que les services dont l'image a changé. Il y a une brève coupure (quelques
   secondes) le temps que le nouveau conteneur `api`/`web` démarre et passe `healthy` — accepté
   sciemment pour une stack Compose à instance unique (philosophie §0 : pas de bascule
   bleu/vert tant qu'aucune contrainte réelle ne l'impose).
5. Vérifier `GET /api/v1/sante` et `/pret`, surveiller Sentry et les logs quelques minutes (§8).

## 6. Migrations : qui, quand, et un échec à mi-parcours

**Qui/quand** : toujours via le service `migrate` (§4, §5), jamais automatiquement au démarrage
de `api`. C'est une décision volontaire, pas juste un détail — voir le point suivant.

**Pourquoi une étape séparée, jamais intégrée au démarrage de `api`** : si les migrations
échouent, on veut que le déploiement s'arrête *avant* de toucher aux conteneurs `api` en
production — les anciens conteneurs continuent de tourner et de servir du trafic, intacts,
puisque l'étape 4 (`up -d api web reverse-proxy`) n'a simplement jamais lieu. Une migration
ratée bloque un déploiement, elle ne cause jamais de coupure de service par elle-même.

**Comportement du runner en cas d'échec** (`apps/api/src/db/migrer.ts`, voir le fichier pour le
détail complet) :

- chaque fichier de migration s'exécute dans **sa propre transaction** : un échec au milieu d'un
  fichier annule ce fichier intégralement (`rollback`), la base revient exactement à l'état
  d'avant cette migration précise ;
- les migrations précédentes, déjà validées (`commit`) lors d'exécutions antérieures, **ne sont
  pas affectées** — elles restent appliquées ;
- un verrou consultatif Postgres empêche deux exécutions concurrentes de `migrate` de se
  marcher dessus (utile si un déploiement est relancé par erreur pendant qu'un premier tourne
  encore) ;
- chaque migration déjà appliquée est immuable : son empreinte SHA-256 est vérifiée à chaque
  exécution. Si le fichier a été modifié depuis (erreur de manipulation, retour de branche…), le
  runner refuse de continuer avec un message explicite plutôt que de diverger silencieusement
  entre bases.

**Procédure si `migrate` échoue à mi-parcours** :

1. Lire le message d'erreur — le runner écrit sur `stderr` le nom du fichier fautif et l'erreur
   SQL brute renvoyée par Postgres.
2. Ne **rien** faire sur les migrations déjà marquées appliquées (table `__dfa_migrations`) :
   elles sont correctes et intactes, ce n'est pas là qu'est le problème.
3. Corriger le fichier de migration fautif **s'il n'a encore jamais été appliqué avec succès nulle
   part** (ni en local, ni en CI, ni sur un autre environnement) — sinon, ne jamais le modifier
   après coup (violerait l'immuabilité, cf. `ErreurMigrationAlteree`) : écrire une **nouvelle**
   migration numérotée après, qui corrige ou complète la précédente.
4. Relancer `migrate` — c'est idempotent, les fichiers déjà appliqués sont simplement ignorés
   (comparaison d'empreinte) et sautés.
5. Ne passer à l'étape 4 de déploiement (`up -d api web reverse-proxy`) qu'une fois `migrate`
   revenu au statut 0 (succès), jamais avant.

Causes fréquentes d'échec à surveiller en priorité : verrou pris par une requête longue en cours
sur la table concernée (`statement_timeout` n'est volontairement pas activé pour `migrate`, une
migration DDL légitime peut prendre du temps — mais un blocage qui ne se résout jamais indique
une transaction oubliée ouverte ailleurs, à chercher côté `api` avant de retenter), ou une
contrainte (`UNIQUE`/`CHECK`/FK) violée par des données déjà en base qui ne respectent pas
l'hypothèse de la migration.

## 7. Sauvegardes PostgreSQL — chiffrées et testées en restauration

**Une sauvegarde non testée n'existe pas.** Les données de 10+ garages ne se perdent pas : la
politique ci-dessous a deux volets obligatoires, pas un seul — produire la sauvegarde, ET prouver
régulièrement qu'elle se restaure.

### 7.1 Production de la sauvegarde

Sauvegarde logique quotidienne (`pg_dump` format custom, restaurable sélectivement et plus
compact qu'un dump SQL brut), chiffrée avant tout transfert, envoyée vers un stockage objet dans
une zone suisse **différente** de celle de la base (pas le même datacenter que l'instance
primaire — un incident zone unique ne doit pas emporter à la fois la base et ses sauvegardes).

Exemple de script (à adapter au nom réel de la base/des identifiants ; s'exécute depuis un hôte
qui a le paquet client `postgresql` et `age` ou `gpg`, typiquement une tâche planifiée — cron sur
le serveur applicatif, ou un job géré par l'hébergeur si disponible) :

```bash
#!/usr/bin/env bash
set -euo pipefail

DATE=$(date +%Y-%m-%dT%H%M%S)
FICHIER="dfa_prod_${DATE}.dump"

# Connexion en lecture avec un rôle dédié aux sauvegardes si l'hébergeur le permet (moindre
# privilège : SELECT seul suffit à pg_dump), sinon dfa_migrator convient (propriétaire du schéma).
pg_dump "$DATABASE_URL_MIGRATION" --format=custom --file="/tmp/${FICHIER}"

# Chiffrement asymétrique (age : plus simple à opérer sans trousseau GPG partagé — clé publique
# stockée sur le serveur, clé privée UNIQUEMENT hors ligne, ex. gestionnaire de mots de passe de
# @laupernoe). Le fichier chiffré seul, sans la clé privée séparée, ne révèle rien.
age -r "$AGE_CLE_PUBLIQUE" -o "/tmp/${FICHIER}.age" "/tmp/${FICHIER}"
rm -f "/tmp/${FICHIER}"          # jamais de dump en clair qui traîne sur disque

# Upload vers le stockage objet (Exoscale SOS / Infomaniak Swiss Backup, compatibles S3).
aws --endpoint-url "$S3_ENDPOINT" s3 cp "/tmp/${FICHIER}.age" "s3://${S3_BUCKET}/postgres/"
rm -f "/tmp/${FICHIER}.age"
```

Rétention recommandée : 7 quotidiennes + 4 hebdomadaires + 12 mensuelles (règle de rotation
simple côté bucket — la plupart des offres d'object storage suisses savent l'appliquer via une
politique de cycle de vie, sinon un second script de purge).

### 7.2 Test de restauration (obligatoire, périodique)

Une fois par mois au minimum, et systématiquement après tout changement de version majeure de
PostgreSQL ou de la procédure de sauvegarde :

1. Provisionner une instance Postgres jetable (même version majeure que la production).
2. Déchiffrer la dernière sauvegarde (`age -d`, clé privée sortie de son stockage hors ligne pour
   l'occasion, jamais laissée sur un serveur).
3. Restaurer : `pg_restore --dbname=<base-jetable> <fichier.dump>`.
4. Vérifier au minimum : le nombre de tenants correspond à l'attendu, une requête applicative
   simple (ex. compter les utilisateurs actifs d'un tenant connu) renvoie un résultat cohérent, et
   `verifierPostureRls()` — ou son équivalent en SQL manuel — confirme que le RLS est toujours
   dans la posture attendue après restauration (une restauration qui recrée les rôles dans le
   mauvais ordre peut casser silencieusement la propriété des tables).
5. Détruire l'instance jetable.
6. Consigner la date et le résultat du test quelque part de durable (changelog interne, ticket) —
   la preuve que la sauvegarde a été testée doit survivre plus longtemps que l'instance de test
   elle-même.

## 8. Rotation des secrets

Il n'y a pas de `SESSION_SECRET` à faire tourner : les jetons de session sont générés par CSPRNG
côté serveur et stockés en base sous forme d'empreinte SHA-256, rien n'est signé (voir
`.env.example`). Ce qui reste à faire tourner périodiquement (au minimum annuellement, et
immédiatement en cas de suspicion de compromission ou de départ de toute personne y ayant eu
accès) :

- **Mots de passe `dfa_app`/`dfa_migrator`** (base managée). Rotation sans coupure :
  1. `ALTER ROLE dfa_app WITH PASSWORD '<nouveau>';` (et de même pour `dfa_migrator`) sur
     l'instance managée — l'ancien mot de passe cesse immédiatement de fonctionner, Postgres
     n'accepte qu'un mot de passe par rôle à la fois (pas de fenêtre de double validité comme un
     rôle avec deux clés) ;
  2. mettre à jour `DATABASE_URL`/`DATABASE_URL_MIGRATION` dans `.env.production` ;
  3. `docker compose -f docker-compose.yml --env-file .env.production up -d api migrate`
     (recrée uniquement le conteneur `api`, `migrate` n'est de toute façon jamais un conteneur
     durable) — bref instant entre l'étape 1 et le redémarrage du conteneur `api` où les
     connexions du pool existant échoueraient ; à faire donc dans une fenêtre courte, l'une
     après l'autre sans délai.
- **Identifiants Redis**, même procédure si l'instance en a.
- **Clé de chiffrement des sauvegardes** (`age`/GPG) : en cas de rotation, re-chiffrer au moins la
  dernière sauvegarde valide avec la nouvelle clé avant de considérer l'ancienne révoquée — ne
  jamais se retrouver dans une situation où aucune sauvegarde lisible n'existe pendant la
  transition.
- **Identifiants d'accès au registre d'images** (`docker login`), si le registre n'est pas déjà
  couvert par l'authentification GitHub Actions (cas de GHCR avec `GITHUB_TOKEN`, qui tourne déjà
  automatiquement et n'a rien à roter manuellement).

Aucun secret ne doit jamais être écrit dans `docker-compose.yml` (versionné) : tous
transitent par `.env.production`, jamais commité.

## 9. Monitoring

@laupernoe est seul au support : la règle est de voir un problème avant qu'un client ne le signale.

- **Logs structurés JSON** : déjà en place côté API (`pino`/`pino-http`, niveau piloté par
  `LOG_NIVEAU`) et côté front (nginx, `access_log`/`error_log` vers stdout/stderr — voir
  `apps/web/nginx.conf`). `docker-compose.yml` route tout vers le driver `json-file` avec
  rotation (`max-size: 10m`, `max-file: 5`) : `docker compose -f docker-compose.yml logs -f
  api` (ou `web`, `reverse-proxy`) reste la première commande à taper en cas d'incident. Il n'y a
  pas encore d'agrégation centralisée (type Loki/ELK) — à envisager seulement si le volume ou le
  nombre de garages le justifie, pas avant (philosophie §0).
- **Sonde de disponibilité externe (uptime check)** : configurer un service de surveillance
  externe (ex. UptimeRobot, Better Uptime, ou l'équivalent proposé par Infomaniak/Exoscale) sur
  `GET https://<domaine>/api/v1/sante/pret` (vérifie Postgres **et** Redis, contrairement à
  `/sante` qui ne vérifie que le process — voir `apps/api/src/sante/sante.controller.ts`),
  intervalle court (1–5 min), alerte par e-mail/SMS vers @laupernoe en cas de `503` ou de timeout.
  Surveiller aussi `https://<domaine>/` (front) séparément : un 502 côté `web` ne remonte pas
  forcément sur `/api/v1/sante/pret`.
- **Sentry (erreurs applicatives)** : **pas encore intégré dans le code** à ce jour (aucune
  dépendance `@sentry/*` dans `apps/api/package.json`/`apps/web/package.json`, aucune variable
  `SENTRY_DSN` dans le schéma zod de configuration). C'est un écart à combler — hors périmètre de
  ce document (qui ne touche que `docker-compose.yml` et lui-même) — avant d'onboarder le
  premier premier garage, pas après : sans Sentry, une erreur silencieuse côté navigateur d'un
  client n'est visible que si le client la signale, exactement ce que la philosophie de support
  de ce projet veut éviter. Une fois ajouté, prévoir une variable `SENTRY_DSN` (secret, dans
  `.env.production`) côté `api`, et une variable `VITE_SENTRY_DSN` inlinée au build côté `web`
  (même mécanisme que `VITE_API_URL`, voir `apps/web/Dockerfile`) — pas au runtime, ce qui a une
  conséquence directe : changer le DSN Sentry du front exige de reconstruire et republier l'image
  `web`, pas seulement de changer une variable d'environnement du conteneur.
- **Version déployée** : `VERSION_APP` (visible dans `GET /api/v1/sante`) doit toujours
  correspondre au tag d'image réellement déployé (§3.1, §5) — c'est ce qui permet de corréler une
  erreur Sentry (une fois intégré) ou une ligne de log à un déploiement précis.

## 10. Retour arrière (rollback)

Rollback = redéployer le tag d'image précédent, jamais une opération plus complexe :

```bash
# 1. Remettre l'ancien tag dans .env.production
#    API_IMAGE=ghcr.io/<org>/dfa-api:<tag-precedent>
#    WEB_IMAGE=ghcr.io/<org>/dfa-web:<tag-precedent>

# 2. Redémarrer avec ces images (déjà présentes localement ou re-tirées du registre — d'où
#    l'importance de ne jamais purger agressivement les anciens tags d'un registre, voir §5).
docker compose -f docker-compose.yml --env-file .env.production \
  up -d api web reverse-proxy
```

**Et les migrations déjà appliquées ?** Elles ne sont **pas** annulées automatiquement, et c'est
volontaire : le projet impose que toute migration soit écrite en *expand/contract*, jamais
destructive (règle non négociable, voir `CONTRIBUTING.md`). Concrètement, cela veut dire qu'une
migration déjà passée en production est censée être **compatible avec l'ancienne version du
code** qu'on est en train de redéployer — une colonne ajoutée reste nullable ou avec une valeur
par défaut tant que le code qui l'utilise n'est pas généralisé ; une colonne n'est supprimée
(« contract ») que dans une migration séparée, déployée seulement après que plus aucune version
du code en circulation ne la lit. **Dans l'immense majorité des cas, le bon rollback est donc :
redéployer le tag précédent et laisser le schéma tel quel** — aucune action sur la base.

Le cas où il faut réellement revenir en arrière sur une migration (bug qui corrompt des données,
migration qui n'aurait jamais dû partir) est rare et ne s'automatise pas :

1. Localiser le script correspondant dans `apps/api/src/db/migrations/down/` (convention
   `<nom-de-la-migration>.down.sql`, ex. `0001_socle_rls.down.sql` pour
   `0001_socle_rls.sql`) — ou en écrire un si absent.
2. Le relire entièrement et l'exécuter à la main via `psql`, connecté avec le rôle
   `dfa_migrator` (`DATABASE_URL_MIGRATION`) — jamais via le runner `migrate` automatique, qui
   n'a aucune notion de « descendre » une migration.
3. Supprimer manuellement la ligne correspondante dans la table de suivi
   `public.__dfa_migrations` (`delete from public.__dfa_migrations where nom = '<fichier>';`) —
   sinon le runner la considère toujours appliquée (vérification par empreinte) alors que l'objet
   qu'elle créait n'existe plus, et une nouvelle tentative de la réappliquer plus tard échouera de
   façon confuse.
4. Redéployer ensuite le tag de code compatible avec ce schéma redescendu.

Cette procédure manuelle est délibérément plus lourde que le rollback applicatif : c'est un
signal, pas un oubli — un retour arrière de schéma est un événement rare qui mérite qu'on
s'arrête et qu'on réfléchisse, pas une commande qu'on tape par réflexe à 2h du matin.

## 11. Pièges connus

- **`env_file: .env.production` doit exister au moment du `docker compose ... config`/`up`**,
  même pour une simple validation de syntaxe — sans lui, Compose refuse de démarrer avec une
  erreur de fichier manquant, avant même de regarder si les variables qu'il contient sont
  correctes.
- **`WEB_URL_PUBLIQUE` sert deux fois** : c'est à la fois la variable validée par le schéma zod
  de l'API (allowlist CORS) et l'adresse de site utilisée telle quelle dans le Caddyfile généré
  par `docker-compose.yml` (bloc `configs`). Une valeur incohérente (ex. avec un `/` final,
  ou un port explicite superflu) casse les deux à la fois — la garder strictement au format
  `https://domaine` sans chemin ni slash final.
- **Ne jamais purger tous les anciens tags d'images** du registre : un rollback (§10) suppose que
  le tag précédent est encore récupérable. Garder au minimum les N derniers déploiements.
- **`docker/postgres/init/01-roles.sql` ne se rejoue jamais tout seul sur une base managée** — il
  n'y a pas de conteneur d'initialisation en production (contrairement au dev, voir
  `docs/deploiement-local.md`). Une seule exécution manuelle à la création de la base (§3.2),
  point.
- **Ne jamais exécuter `pnpm db:seed` contre la base de production** (§4) — garde-fou insuffisant
  côté code à ce jour, voir `docs/rapport-qa-etape-0.md`.
