Déploiement en production
=========================

Ce document décrit la mise en production de DFA avec `docker-compose.yml` (racine du
dépôt) : première installation pas à pas, déploiements suivants, migrations, sauvegardes,
rotation des secrets, monitoring, et retour arrière. Public visé : @laupernoe, seul au support — chaque
procédure est écrite pour être suivie sans avoir à relire le code à 2h du matin.

Philosophie : la simplicité qui marche. Un seul serveur, Docker Compose. **Décision actée par
@laupernoe : auto-hébergement complet sur ses propres serveurs — ni Infomaniak ni Exoscale ne portent
quoi que ce soit d'applicatif.** Postgres et Redis tournent en conteneurs, comme le reste. On
complexifie (haute disponibilité, orchestrateur, réplication, serveur dédié à la base) seulement
quand un besoin réel l'impose — pas avant. Le §2 est franc sur ce que ce choix coûte et sur le
moment où il faudra le reconsidérer : ce n'est pas gratuit, et le prétendre serait malhonnête.

0. Décisions ouvertes — à trancher par @laupernoe avant la mise en production

---

Liste consolidée de tout ce qui, dans ce document, dépend d'un choix pas encore fait (matériel
réel, nom de domaine, fournisseur) — pour ne pas avoir à le chasser dans les 800 lignes qui
suivent. À tenir à jour à chaque révision plutôt que laissé à dériver silencieusement.

- ⚠️ **Variante d'hébergement** (§2.1) : serveur loué en datacenter suisse (auto-administré) vs
  serveur physique chez @laupernoe/en local professionnel. Le reste du document suppose la première par
  défaut (recommandation §2.1) ; la seconde ajoute la checklist IP fixe/CGNAT/ports du §5 et
  l'onduleur/RAID du §3.4.
- ⚠️ **Fournisseur du serveur loué**, si cette variante est retenue (§2.1) — non nommé à ce jour.
- ⚠️ **Nom de domaine réel** — `app.dmsforall.example` est un exemple utilisé dans tout le document
  (§1, §3.5, §5, §9). À remplacer par le domaine effectivement possédé avant le premier
  déploiement (DNS, Caddyfile généré, `API_URL_PUBLIQUE`/`WEB_URL_PUBLIQUE`).
- ⚠️ **Propriétaire GitHub pour `ghcr.io`** (§3.1) — `<org>`/`<propriétaire>` dans les exemples
  d'image (`ghcr.io/<org>/dfa-api:...`) doit devenir le nom réel (organisation ou compte
  personnel) du dépôt, en minuscules — `.github/workflows/publier-images.yml` le calcule déjà
  automatiquement pour les images qu'il publie, seuls les exemples de commandes manuelles du
  document restent à personnaliser au cas par cas.
- ⚠️ **Gabarit réel du serveur applicatif** (RAM/vCPU) — les réglages Postgres (`command:` du
  service `postgres`, `docker-compose.yml`) et les `deploy.resources` de tous les services
  supposent un serveur de départ à 8 Go RAM / 4 vCPU (§3.4, §3.7). À recalculer avec
  [pgtune](https://pgtune.leopard.in.ua/) dès que le matériel réel est connu.
- ⚠️ **Sentry auto-hébergé (pile complète) vs GlitchTip** — recommandation du projet : GlitchTip
  (`docs/sentry-auto-heberge.md` §1), nettement plus léger (2-4 Go RAM contre 16 Go et plus) et
  sans le risque de mise à jour cassante de la pile complète. Décision finale à @laupernoe. Si la pile
  complète est malgré tout retenue, elle doit tourner sur un **second serveur**, jamais sur celui
  de DFA (`docs/sentry-auto-heberge.md` §2.1/§2.6) — un serveur supplémentaire à prévoir dans ce
  cas.
- ⚠️ **Fournisseur de stockage objet pour les sauvegardes hors site** (§7.1, `S3_ENDPOINT`/
  `S3_BUCKET`) — Infomaniak Swiss Backup, Exoscale SOS, ou un second serveur physique sous
  contrôle de @laupernoe (alternative sans tiers, même paragraphe). Non tranché à ce jour.
- ⚠️ **Chiffrement de disque (LUKS), onduleur, RAID1** (§3.4) — dépendent du matériel/OS réel
  retenu ; à vérifier explicitement avant le premier déploiement, jamais supposés actifs par
  défaut.

1. Vue d'ensemble

---

```
Internet
   │  443/80 (TLS automatique, Let's Encrypt — voir §5)
   ▼
┌─────────────────────┐
│  reverse-proxy       │  Caddy — seul service exposé sur l'hôte
│  (conteneur)         │
└──────────┬───────────┘
           │ réseau Docker interne (aucun accès depuis l'hôte ni Internet)
     ┌─────┴─────┐
     ▼           ▼
┌─────────┐  ┌─────────┐
│  api     │  │  web     │  NestJS / nginx+SPA — conteneurs, images taguées par la CI
│ :3000    │  │ :8080    │
└────┬─────┘  └─────────┘
     │
     ▼ réseau Docker interne (aucun accès depuis l'hôte ni Internet)
┌──────────────┐   ┌──────────────┐
│  postgres     │   │  redis        │  Conteneurs, SUR LE MÊME SERVEUR — plus de service
│  (conteneur)  │   │  (conteneur)  │  managé, voir §2 pour l'argumentaire et ses limites.
└──────────────┘   └──────────────┘
```

Points structurants, tous déjà actés dans le code livré et repris tels quels ici :

- **Un seul domaine public** (ex. `https://app.dmsforall.example`) : `apps/web/nginx.conf` (CSP
  `connect-src 'self'`) et `apps/web/Dockerfile` (`VITE_API_URL=/api/v1`, chemin relatif)
  supposent tous les deux que le front et l'API sont servis derrière le **même** reverse proxy,
  sur la **même** origine.

  **Domaine et CORS** : `API_URL_PUBLIQUE` et `WEB_URL_PUBLIQUE` (`.env.production`) doivent donc
  pointer vers **la même URL** en production. `WEB_URL_PUBLIQUE` sert deux fois : allowlist CORS
  côté schéma zod de l'API, et adresse de site utilisée telle quelle dans le Caddyfile généré par
  `docker-compose.yml` — une valeur incohérente (`/` final, port explicite superflu) casse
  les deux à la fois. Voir §3.6.

- **Postgres et Redis sont désormais des conteneurs de ce même fichier `docker-compose.yml`,
  sur le même hôte que l'API** — pas des services externes. C'est le changement structurant par
  rapport à une hypothèse d'hébergement managé : tout le cycle de vie (versions, tuning, volumes,
  sauvegardes, montée de version majeure) devient la responsabilité de @laupernoe. Voir §2 et §3.
- **Déploiement = image taguée.** `docker-compose.yml` ne contient aucun `build:` pour
  `api`/`web` : `API_IMAGE`/`WEB_IMAGE` référencent une image déjà construite par la CI. Le
  rollback consiste à redéployer le tag précédent (§10), jamais à recompiler sur le serveur.
  `postgres`/`redis` utilisent directement les images officielles.
- **L'API refuse de démarrer si la configuration ou la posture RLS sont invalides** (validation
  zod + `verifierPostureRls()`, voir `apps/api/src/main.ts` et
  `apps/api/src/db/acces-base.service.ts`). C'est voulu : mieux vaut un déploiement qui échoue
  bruyamment qu'une API qui tourne sans isolation tenant effective.
- **`docker-compose.yml` ne suffit plus seul sur le serveur.** Il monte
  `docker/postgres/init/01-roles.sql` en lecture seule au même chemin relatif que le
  `docker-compose.yml` de dev. Il faut donc un checkout du dépôt sur le serveur (ex.
  `git clone --branch <tag> --depth 1`), pas seulement une copie de ce fichier — voir §4.

2. Hébergement (nLPD) — auto-hébergement, ce que ça change vraiment

---

DFA traite des données de garages et de leurs clients (personnes physiques) : le nLPD impose des
données hébergées en Suisse, chiffrées au repos et en transit. **Décision de @laupernoe : le ou les
serveurs sont les siens**, pas une offre managée. Ce paragraphe est honnête sur ce que ça implique
— pas seulement techniquement, mais opérationnellement pour une personne seule.

**2.1 Où placer les serveurs**

« Ses propres serveurs » n'implique pas forcément « chez lui ». Deux variantes très différentes
en pratique :

- **Serveur loué en datacenter suisse, auto-administré** (VPS/bare-metal chez un hébergeur
  suisse, sans souscrire à une base de données ou un cache managés — uniquement la machine).
  C'est ce que suppose implicitement le reste de ce document : alimentation électrique redondante,
  connectivité réseau professionnelle, température/hygrométrie contrôlées, remplacement de disque
  pris en charge par l'hébergeur en cas de panne matérielle. Le nLPD (localisation, chiffrement)
  reste couvert de la même façon qu'une offre managée — seule la couche « base de données/cache
  en tant que service » disparaît, pas la couche « datacenter ».
- **Serveur physique chez @laupernoe ou en local professionnel** (garage, bureau). Moins cher à court
  terme, mais ajoute des risques que ce document doit nommer sans les minimiser : coupure
  électrique sans onduleur, connexion Internet résidentielle/professionnelle non conçue pour
  servir du trafic entrant (IP dynamique, CGNAT possible chez certains FAI suisses, bande passante
  montante limitée — voir §5), absence de remplacement de disque sous garantie en heures, et une
  franchise nLPD plus difficile à défendre si l'environnement physique (accès, incendie, vol) n'a
  pas de contrôle documenté.

**Recommandation** : la première variante (serveur loué, auto-administré, chez un hébergeur
suisse) pour tout ce qui sert de vrais clients payants, même un seul premier garage. La seconde
variante est défendable uniquement pour du développement/test, jamais pour des données de
production de clients réels — le nLPD et la confiance d'un garagiste qui confie ses données ne
se négocient pas contre une économie d'hébergement. Le reste de ce document (§3 à §11) s'applique
identiquement dans les deux cas ; §5 (TLS) documente spécifiquement le risque supplémentaire de la
seconde variante.

**2.2 Ce que @laupernoe gagne à ne plus dépendre d'un hébergeur**

- Coût prévisible et généralement plus bas qu'une base + un cache managés facturés séparément.
- Contrôle total : versions exactes, réglages fins, pas de fenêtre de maintenance imposée par un
  tiers, pas de migration forcée vers une nouvelle génération d'offre.
- Aucune dépendance à la disponibilité ou aux CGU d'un service tiers pour la donnée elle-même.

**2.3 Ce que @laupernoe perd — à dire sans détour**

- **Redondance et haute disponibilité.** Une base managée réplique en général vers un nœud de
  secours et bascule automatiquement en cas de panne matérielle. Ici, un seul conteneur
  `postgres` sur un seul disque d'un seul serveur : une panne matérielle (disque, RAM,
  alimentation) **arrête le service** jusqu'à intervention manuelle. Il n'y a pas de bascule
  automatique dans ce document, et il ne devrait pas y en avoir tant qu'un seul serveur est en jeu
  — une « haute disponibilité » à un seul nœud est un théâtre, pas une garantie.
- **Supervision matérielle.** Un hébergeur managé surveille la santé physique du disque
  (SMART), la RAM, l'alimentation, et remplace de façon proactive. Ici, c'est @laupernoe qui doit
  surveiller (voir §9) — ou accepter de le découvrir a posteriori.
- **Sauvegardes automatiques et testées par le fournisseur.** Elles n'existent plus par défaut :
  §7 en fait la responsabilité complète de @laupernoe, chiffrement et test de restauration inclus. C'est
  le point le plus important de ce document.
- **Montées de version transparentes.** Un hébergeur managé applique les correctifs mineurs de
  sécurité automatiquement et propose une procédure encadrée pour les montées de version majeures.
  Ici, c'est manuel — voir §3.7 et §8.
- **Chiffrement au repos « par défaut ».** Une offre managée l'active généralement d'un clic
  (parfois même par défaut). Ici, un volume Docker nommé (`dfa_postgres_data`) **n'apporte aucun
  chiffrement de son propre fait** — voir §2.4.
- **Bande passante et débit.** Un hébergeur dimensionne son réseau pour du trafic entrant/sortant
  de service. Une connexion résidentielle ou une petite offre pro a souvent un débit montant très
  inférieur au débit descendant (asymétrie ADSL/câble/certaines offres fibre) — un facteur direct
  pour la latence perçue par les garages clients ET pour la durée des transferts de sauvegarde
  hors site (§7).
- **Temps de @laupernoe lui-même.** Chaque point ci-dessus qui était « the hébergeur s'en occupe »
  devient une tâche récurrente à faire ou à automatiser puis vérifier — patching, surveillance
  d'espace disque, test de restauration mensuel, renouvellement TLS. Ce n'est pas gratuit en
  temps, même quand c'est automatisé, parce qu'un automatisme non supervisé qui échoue
  silencieusement équivaut à ne pas l'avoir fait.

**2.4 Chiffrement au repos — une responsabilité qui descend d'un cran**

Un volume Docker nommé (`dfa_postgres_data`, `dfa_redis_data`, `caddy_data`) est un répertoire
ordinaire sous `/var/lib/docker/volumes/` : **aucun chiffrement de son propre fait**. Le
chiffrement au repos exigé par le nLPD doit venir d'une couche **en dessous** de Docker :

- Chiffrer la partition qui héberge `/var/lib/docker` avec LUKS (Linux) dès l'installation du
  système d'exploitation du serveur — c'est le point le plus simple à traiter tôt et le plus
  pénible à rattraper après coup (rattraper = réinstaller le système et migrer les volumes).
- Documenter où est stockée la passphrase/clé de déverrouillage LUKS, séparément du serveur
  lui-même (gestionnaire de mots de passe de @laupernoe, jamais un fichier sur le même disque) — un
  disque chiffré dont la clé traîne à côté ne protège que contre le vol physique du disque seul,
  pas contre un accès au serveur en marche.
- Si l'hébergeur loué propose un chiffrement de disque intégré au niveau de l'infrastructure
  (courant chez les offres cloud sérieuses), le documenter explicitement plutôt que de supposer
  qu'il est actif — vérifier, ne jamais deviner.

3. Prérequis avant la toute première mise en production

---

**3.1 Publier des images taguées**

`docker-compose.yml` exige `API_IMAGE`/`WEB_IMAGE` pointant vers des images déjà
construites. **`.github/workflows/publier-images.yml` automatise cette publication** (une version
antérieure de ce document décrivait ceci comme un prérequis manquant — comblé depuis) : il rejoue
d'abord les mêmes portes de qualité que `ci.yml` (lint, typecheck, tests unitaires, tests
d'intégration), puis, seulement si elles passent :

- sur push d'un tag `vX.Y.Z`, publie `ghcr.io/<propriétaire>/dfa-api:vX.Y.Z` et
  `ghcr.io/<propriétaire>/dfa-web:vX.Y.Z` (`<propriétaire>` = organisation ou compte GitHub du
  dépôt, mis en minuscules automatiquement par le workflow — exigence ghcr.io) ;
- sur push sur `main`, publie la même paire sous le tag immuable `main-<sha-court>` (jamais
  `latest` ni `main` seul, pour que le rollback §10 puisse toujours retrouver précisément la
  version d'avant).

Chaque image est en outre signée (attestation de provenance SLSA via Sigstore/OIDC GitHub,
vérifiable avec `gh attestation verify oci://<image>@<digest> --owner <org>`).

Mettre en production le résultat d'un tag `vX.Y.Z` revient donc à reporter ces deux références
dans `.env.production` :

```bash
API_IMAGE=ghcr.io/<propriétaire>/dfa-api:vX.Y.Z
WEB_IMAGE=ghcr.io/<propriétaire>/dfa-web:vX.Y.Z
```

Convention de tag : aligner sur `VERSION_APP` (`.env.production`) et sur la version de
`package.json` — le tag apparaît dans `GET /api/v1/sante` et doit permettre de corréler une
erreur Sentry à un déploiement précis (voir §9).

**Secours manuel** (GitHub Actions indisponible, ou tout premier bootstrap avant d'avoir jamais
poussé de tag) : la même construction peut être reproduite à la main depuis un poste avec Docker,
identique à ce que fait le workflow :

```bash
Depuis la racine du dépôt (contexte de build obligatoire, voir les Dockerfiles)
===============================================================================
docker build -f apps/api/Dockerfile -t ghcr.io/<org>/dfa-api:v0.1.0 .
docker build -f apps/web/Dockerfile -t ghcr.io/<org>/dfa-web:v0.1.0 .

docker login ghcr.io -u <utilisateur-github>
docker push ghcr.io/<org>/dfa-api:v0.1.0
docker push ghcr.io/<org>/dfa-web:v0.1.0
```

**3.2 PostgreSQL — rôles et mots de passe (auto-hébergé)**

Contrairement à une base managée, **il n'y a plus de compte admin d'hébergeur à qui parler** :
Postgres tourne dans le conteneur `postgres` de `docker-compose.yml`, sur le même hôte.

1. Au tout premier démarrage du conteneur `postgres` (volume `dfa_postgres_data` vide),
   `docker-entrypoint-initdb.d` rejoue **automatiquement**
   `docker/postgres/init/01-roles.sql` — c'est le même mécanisme qu'en dev, voir
   `docker-compose.yml`. Il crée `dfa_migrator` et `dfa_app` avec les mots de passe de **dev**
   (`dfa_migrator_dev`/`dfa_app_dev`) : **c'est attendu**, le réseau `interne` n'est à ce stade
   accessible depuis nulle part en dehors des autres conteneurs.
2. **Immédiatement après ce premier démarrage, avant d'ouvrir `reverse-proxy` au public**,
   changer les trois mots de passe (`dfa_migrator`, `dfa_app`, et le superuser `dfa` lui-même)
   pour des valeurs fortes générées pour l'occasion — ne jamais éditer le fichier SQL versionné
   pour y mettre un secret réel, et **jamais `psql -c "alter role ... password '<...>'"`** : le
   mot de passe transiterait en clair par l'argument de la commande (historique shell, `ps aux`,
   `docker inspect`, journal d'audit Docker — même défaut corrigé pour Redis, voir
   `docker-compose.yml`). Ouvrir une session interactive et utiliser `\password`, qui
   chiffre le mot de passe côté client avant de l'envoyer — il n'apparaît jamais en clair dans la
   requête SQL, ni dans l'historique shell, ni dans la table des processus :

   ```bash
   docker compose -f docker-compose.yml --env-file .env.production \
     exec postgres psql -U dfa -d dfa_prod
   ```

   Puis, à l'intérieur de la session (chaque mot de passe est saisi deux fois, masqué à l'écran) :

   ```
   \password dfa_migrator
   \password dfa_app
   \password dfa
   ```

   Générer les valeurs par exemple avec `openssl rand -base64 32`, dans un terminal séparé. `\password`
   ne modifie **que** le mot de passe : il ne lève **pas** l'expiration `VALID UNTIL` posée par le
   filet de production de `01-roles.sql` (voir le fichier et §8). Lever cette expiration est une
   étape séparée et obligatoire de cette procédure — sans mot de passe à transmettre, ces deux
   instructions se tapent sans risque, dans la même session ou via `-c` :

   ```sql
   alter role dfa_migrator valid until 'infinity';
   alter role dfa_app valid until 'infinity';
   ```

   Quitter avec `\q`. Reporter les deux valeurs `dfa_migrator`/`dfa_app` dans `DATABASE_URL`/
   `DATABASE_URL_MIGRATION` de `.env.production` (hôte `postgres` — nom de service Compose, résolu
   par le DNS interne du réseau `interne`, jamais `localhost`) — la validation zod refuse de
   démarrer si les deux URLs sont identiques, garde-fou volontaire (voir
   `apps/api/src/config/charger-config.ts`). Le mot de passe superuser
   (`POSTGRES_SUPERUSER_PASSWORD` dans `.env.production`, lu par `docker-compose.yml`) doit
   lui aussi être fort et distinct dès le premier démarrage — c'est celui qui protège
   `POSTGRES_PASSWORD` du conteneur, jamais utilisé par l'API mais capable de tout (voir la note
   dans `docker-compose.yml`). `dfa` n'est jamais concerné par le filet `VALID UNTIL`
   (réservé à `dfa_migrator`/`dfa_app`, voir `01-roles.sql`), donc rien à lever pour ce rôle.

3. Les tables, politiques RLS et fonctions `SECURITY DEFINER` du schéma `amorcage` sont posées
   par les migrations (§6), pas par `01-roles.sql` — ce script se limite au provisionnement des
   rôles.
4. **Simplification par rapport à une base managée** : plus besoin de se connecter à la main via
   `psql` contre un hébergeur pour rejouer `01-roles.sql` — le conteneur le fait lui-même, comme
   en dev. Ce qui reste manuel, et ne peut pas être automatisé sans risque : la rotation des mots
   de passe de dev vers des valeurs fortes, décrite ci-dessus. Voir aussi §8 (rotation
   périodique) et §11 (rejeu de `01-roles.sql` sur un volume déjà initialisé).

**3.3 Redis (auto-hébergé)**

Même principe : le conteneur `redis` de `docker-compose.yml` tourne avec `--requirepass`,
mot de passe lu depuis `REDIS_PASSWORD` (`.env.production`) — à générer fort dès le premier
déploiement (`openssl rand -base64 32`), jamais la valeur vide utilisée en dev. Reporter la même
valeur dans `REDIS_URL` (`redis://:${REDIS_PASSWORD}@redis:6379`, hôte `redis` — nom de service
Compose). Une incohérence entre `REDIS_PASSWORD` et `REDIS_URL` fait échouer la connexion de
l'API au démarrage avec une erreur claire dans `docker compose logs api`, jamais un échec
silencieux.

**3.4 Serveur applicatif**

Un serveur (loué en datacenter suisse ou physique, voir §2.1) avec Docker Engine + le plugin
Compose installés. Firewall : seuls les ports **80**, **443** (Caddy) et **22** (SSH, idéalement
restreint par IP et par clé, jamais par mot de passe) sont ouverts publiquement. Aucun autre port
n'a besoin d'être ouvert — `postgres`, `redis`, `api` et `web` ne publient volontairement aucun
port sur l'hôte dans `docker-compose.yml`.

Prérequis supplémentaires propres à l'auto-hébergement, à traiter **avant** le premier
déploiement, pas après :

- **Chiffrement de disque (LUKS)** activé sur la partition qui héberge `/var/lib/docker` — voir
  §2.4. Rattraper après coup exige de réinstaller le système.
- **Onduleur (UPS)** si le serveur est en local physique (§2.1, seconde variante) : une coupure
  électrique brutale sur un conteneur Postgres n'est jamais destructrice grâce au WAL (voir
  `stop_grace_period` documenté dans `docker-compose.yml`), mais une coupure répétée use les
  disques et rallonge chaque redémarrage (relecture du WAL). Un serveur loué en datacenter a
  normalement déjà une alimentation redondante — vérifier plutôt que supposer.
- **RAID1 (miroir de disques)** si le matériel le permet : ce n'est **pas** une sauvegarde (une
  suppression accidentelle ou une corruption logique se réplique instantanément sur les deux
  disques), mais un filet contre la panne d'un seul disque qui évite une restauration complète
  depuis une sauvegarde hors site à chaque défaillance matérielle isolée. Complémentaire à §7,
  ne le remplace jamais.
- **Sizing initial** : les réglages `command:` du service `postgres`
  (`docker-compose.yml`) supposent un serveur de départ à 8 Go RAM / 4 vCPU, avec le
  conteneur `postgres` plafonné à 3 Go/2 vCPU (`deploy.resources.limits`) pour laisser de la
  marge à `api`/`web`/`redis`/`reverse-proxy` sur le même hôte. À recalculer dès que le gabarit
  réel est connu — voir §3.7.

**3.5 DNS**

Pointer l'enregistrement A (et AAAA si IPv6) du domaine choisi (ex. `app.dmsforall.example`) vers l'IP
publique du serveur, **avant** de démarrer `reverse-proxy` : Caddy négocie un certificat Let's
Encrypt au démarrage via le challenge HTTP-01, qui échoue si le DNS ne résout pas encore vers le
serveur. Voir §5 pour tout ce qui peut empêcher ce challenge de réussir en auto-hébergement.

**3.6 Fichier `.env.production`**

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
    `https://app.dmsforall.example` pour les deux.
  - `DATABASE_URL`, `DATABASE_URL_MIGRATION` : hôte `postgres` (nom de service Compose), rôles
    `dfa_app`/`dfa_migrator` avec les mots de passe forts générés en §3.2, jamais les valeurs de
    dev.
  - `REDIS_URL` : hôte `redis`, mot de passe généré en §3.3.
  - `VERSION_APP` : alignée sur le tag d'image déployé (§3.1, §6).
  - `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TAUX_ECHANTILLONNAGE_TRACES` : voir
    `docs/sentry-auto-heberge.md` pour la mise en place de l'instance elle-même. Ces trois
    variables sont optionnelles côté schéma zod (l'API démarre sans Sentry configuré), mais à
    renseigner avant d'onboarder le premier premier garage — voir §9.
- Variables supplémentaires, propres à `docker-compose.yml` (pas au schéma zod de l'API) :
  - `API_IMAGE`, `WEB_IMAGE` : références complètes avec tag (ex.
    `ghcr.io/<org>/dfa-api:v0.1.0`).
  - `ACME_EMAIL` : adresse reçue par Let's Encrypt pour les notifications d'expiration de
    certificat.
  - `POSTGRES_SUPERUSER_PASSWORD` : mot de passe du rôle `dfa` (superuser de bootstrap) — voir
    §3.2. Jamais utilisé par l'API.
  - `REDIS_PASSWORD` : voir §3.3. Doit être exactement le mot de passe encodé dans `REDIS_URL`
    ci-dessus.

Permissions du fichier sur le serveur : `chmod 600 .env.production`, lisible uniquement par
l'utilisateur qui lance `docker compose`.

**3.7 Dimensionnement et montée de version majeure de Postgres**

Les réglages `command:` du service `postgres` (`shared_buffers`, `effective_cache_size`,
`max_connections`, etc., voir `docker-compose.yml`) sont des valeurs de départ pour un
serveur hypothétique à 8 Go RAM / 4 vCPU. À **recalculer** dès que le gabarit réel du serveur est
connu — méthode : [pgtune](https://pgtune.leopard.in.ua/), profil « Web application », en
ajustant `max_connections` à la réalité de `DATABASE_POOL_MAX` (`.env.example`) plutôt qu'au
défaut de l'outil. Un changement de ces valeurs se fait dans `docker-compose.yml`
(versionné, revue Git) puis `docker compose ... up -d postgres` — un simple redémarrage du
conteneur suffit, pas de migration.

**Montée de version mineure** (ex. `16.3` → `16.4`, correctifs de sécurité) : changer le tag
d'image dans `docker-compose.yml`, `docker compose ... pull postgres && ... up -d postgres`.
Sans risque de compatibilité de format de données — les versions mineures de Postgres garantissent
la compatibilité binaire du répertoire de données au sein d'une même version majeure. C'est un
correctif de sécurité que @laupernoe doit désormais appliquer lui-même (perdu par rapport à une base
managée, voir §2.3) : surveiller les annonces de sécurité PostgreSQL, ne pas laisser une version
mineure vieillir des mois.

**Montée de version majeure** (ex. `16` → `17`) : **pas** de compatibilité binaire du répertoire
de données — nécessite `pg_dump`/`pg_restore` (ou `pg_upgrade` si le gain de temps le justifie,
plus délicat à opérer correctement en conteneur). Procédure minimale sûre pour un seul serveur :

1. Sauvegarder (§7), et **vérifier que cette sauvegarde précise se restaure** avant de continuer.
2. Démarrer un second conteneur Postgres temporaire avec la nouvelle version majeure et un
   volume vide.
3. **Rejouer immédiatement la rotation des mots de passe (§3.2, étape 2)** sur ce conteneur
   temporaire — son volume est vide, donc `01-roles.sql` vient d'y recréer `dfa_migrator`/
   `dfa_app` avec les mots de passe de **dev** (expiration automatique 7 jours, voir
   `01-roles.sql`), exactement comme au tout premier déploiement. Ce n'est pas optionnel :
   `pg_dump -d` (§7.1) ne sauvegarde pas les rôles, donc la restauration de l'étape suivante ne
   les recrée pas — sans cette étape, une bascule en production sur ce conteneur tournerait avec
   les identifiants publiés dans le dépôt. Réutiliser les mêmes valeurs fortes déjà présentes dans
   `.env.production` (pas besoin d'en générer de nouvelles, ni de modifier `.env.production`) : la
   procédure du §3.2 les reporte via `\password`, puis lève l'expiration (`valid until
'infinity'`).
4. `pg_restore` la sauvegarde dedans, faire tourner les vérifications applicatives de base (§7.2)
   — impossible avant l'étape précédente : sans rotation, les identifiants de `.env.production`
   ne correspondent à aucun rôle valide sur ce conteneur tout juste initialisé.
5. Basculer `docker-compose.yml` (image, volume) vers ce nouveau conteneur seulement une
   fois la restauration validée — jamais une bascule à l'aveugle.
6. Garder l'ancien volume intact jusqu'à confirmation que tout fonctionne en production sur la
   nouvelle version (au moins quelques jours), avant de le supprimer.

7. Première mise en production, pas à pas

---

Une fois §2 et §3 complétés (serveur choisi et préparé, images publiées, DNS résolu,
`.env.production` rempli avec des mots de passe _provisoires_ de dev pour Postgres/Redis à ce
stade — ils seront changés à l'étape 2 ci-dessous) :

```bash
1. Récupérer le dépôt sur le serveur — un `git clone` complet, pas seulement une copie de
=========================================================================================
   docker-compose.yml : ce fichier monte désormais docker/postgres/init/01-roles.sql.
==========================================================================================
git clone --branch <tag> --depth 1 <url-du-depot> /opt/dfa
cd /opt/dfa
   Créer .env.production ici (§3.6), chmod 600.
===============================================

2. Démarrer UNIQUEMENT postgres/redis d'abord (pas encore api/web/reverse-proxy), pour changer
==============================================================================================
   les mots de passe avant toute exposition — voir §3.2/§3.3 pour le détail des commandes.
==========================================================================================
docker compose -f docker-compose.yml --env-file .env.production up -d postgres redis
   ... rotation des mots de passe dfa/dfa_migrator/dfa_app/redis (§3.2, §3.3) ...
=================================================================================
   ... mettre à jour .env.production avec les valeurs fortes ...
================================================================

3. Appliquer les migrations AVANT de démarrer l'API — la base est vide au tout premier
======================================================================================
   déploiement, l'API refuserait de démarrer (verifierPostureRls() exige des tables déjà
========================================================================================
   migrées).
============
docker compose -f docker-compose.yml --env-file .env.production \
  --profile migration run --rm migrate

4. Démarrer le reste de la stack.
=================================
docker compose -f docker-compose.yml --env-file .env.production up -d

5. Vérifier.
============
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

5. TLS et joignabilité publique

---

Caddy (`reverse-proxy`) gère lui-même le certificat Let's Encrypt (HTTPS automatique, challenge
HTTP-01) — ça n'a jamais changé, avec ou sans base managée. **Ce qui change réellement en
auto-hébergement** : il n'y a plus de load balancer/CDN d'hébergeur en frontal pour absorber une
panne réseau ou masquer un souci de joignabilité, et la responsabilité de rester joignable sur les
ports 80/443 repose entièrement sur le serveur et sa connexion.

Checklist à valider **avant** le premier démarrage de `reverse-proxy`, dans les deux variantes de
§2.1 mais particulièrement critique pour un serveur en local physique :

- **IP publique fixe.** Une IP qui change fait perdre le certificat au prochain renouvellement
  (le DNS pointerait vers une IP obsolète) — si l'offre réseau ne fournit qu'une IP dynamique,
  mettre en place un DDNS et un enregistrement DNS à faible TTL, ou changer d'offre.
- **Pas de CGNAT.** Certains FAI suisses (surtout mobile/certaines offres résidentielles)
  placent le client derrière un CGNAT (IP publique partagée entre plusieurs clients, ports 80/443
  non redirigeables vers le serveur) — dans ce cas, l'auto-hébergement à domicile n'est
  techniquement pas possible sans une solution de contournement (tunnel sortant vers un petit VPS
  qui fait juste office de relais TLS). À vérifier auprès du FAI **avant** de s'engager sur cette
  variante.
- **Ports 80 et 443 non bloqués par le FAI** — certaines offres résidentielles bloquent le port 80
  entrant par défaut (anti-serveur-web historique) ; à vérifier explicitement, pas à supposer.
- **Redirection de port** configurée sur le routeur si le serveur est derrière une box (variante
  domicile) : 80/443 externes vers l'IP interne du serveur, tous protocoles.

**Comportement en cas d'échec de renouvellement ACME** (certificat qui approche de l'expiration
sans que le renouvellement ait pu se faire — DNS cassé, port bloqué, IP changée) : Caddy retente
automatiquement à intervalles croissants et journalise l'échec (`docker compose logs
reverse-proxy`) ; `ACME_EMAIL` (§3.6) reçoit une notification de Let's Encrypt avant expiration
réelle du certificat — c'est le filet de dernier recours, pas un mécanisme à surveiller
activement en premier lieu. Si le certificat expire réellement, tous les clients voient une alerte
de sécurité navigateur sur le domaine — traiter ça comme un incident P1 (voir §9) : diagnostiquer
la joignabilité (les points ci-dessus) avant de suspecter Caddy lui-même, qui échoue rarement à
tort quand les prérequis réseau sont réunis.

6. Déploiements suivants et migrations

---

Workflow normal une fois la première mise en production faite :

1. La CI construit et teste (`lint`, `typecheck`, `test`, `test:integration`, `build`) sur chaque
   push — déjà en place (`.github/workflows/ci.yml`). La publication d'image est un workflow
   séparé, lui aussi déjà en place (`.github/workflows/publier-images.yml`, voir §3.1) : chaque
   tag `vX.Y.Z` produit `dfa-api:vX.Y.Z` et `dfa-web:vX.Y.Z` sur le registre, chaque push sur
   `main` produit `dfa-api:main-<sha>` et `dfa-web:main-<sha>`.
2. Sur le serveur, mettre à jour `.env.production` : `API_IMAGE`/`WEB_IMAGE` sur le nouveau tag.
3. **Migrer avant de redéployer le code** :

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
   sciemment pour une stack Compose à instance unique (philosophie : pas de bascule bleu/vert
   tant qu'aucune contrainte réelle ne l'impose).

5. Vérifier `GET /api/v1/sante` et `/pret`, surveiller Sentry et les logs quelques minutes (§9).

**Migrations : qui, quand, et un échec à mi-parcours.**

Toujours via le service `migrate`, jamais automatiquement au démarrage de `api`. C'est
volontaire : si les migrations échouent, on veut que le déploiement s'arrête _avant_ de toucher
aux conteneurs `api` en production — les anciens conteneurs continuent de tourner et de servir du
trafic, intacts, puisque l'étape 4 n'a simplement jamais lieu. Une migration ratée bloque un
déploiement, elle ne cause jamais de coupure de service par elle-même.

Comportement du runner en cas d'échec (`apps/api/src/db/migrer.ts`, voir le fichier pour le
détail complet) :

- chaque fichier de migration s'exécute dans **sa propre transaction** : un échec au milieu d'un
  fichier annule ce fichier intégralement (`rollback`), la base revient exactement à l'état
  d'avant cette migration précise ;
- les migrations précédentes, déjà validées (`commit`) lors d'exécutions antérieures, **ne sont
  pas affectées** ;
- un verrou consultatif Postgres empêche deux exécutions concurrentes de `migrate` de se marcher
  dessus ;
- chaque migration déjà appliquée est immuable : son empreinte SHA-256 est vérifiée à chaque
  exécution. Si le fichier a été modifié depuis, le runner refuse de continuer avec un message
  explicite plutôt que de diverger silencieusement entre bases.

Procédure si `migrate` échoue à mi-parcours :

1. Lire le message d'erreur (`stderr` : fichier fautif, erreur SQL brute de Postgres).
2. Ne rien faire sur les migrations déjà marquées appliquées (table `__dfa_migrations`).
3. Corriger le fichier fautif **seulement s'il n'a encore jamais été appliqué avec succès nulle
   part** — sinon écrire une **nouvelle** migration numérotée après (immuabilité, cf.
   `ErreurMigrationAlteree`).
4. Relancer `migrate` — idempotent, les fichiers déjà appliqués sont ignorés.
5. Ne passer à l'étape 4 de déploiement qu'une fois `migrate` revenu au statut 0.

Causes fréquentes d'échec à surveiller en priorité : verrou pris par une requête longue en cours
sur la table concernée (`statement_timeout` n'est volontairement pas activé pour `migrate`), ou
une contrainte (`UNIQUE`/`CHECK`/FK) violée par des données déjà en base.

7. Sauvegardes PostgreSQL — chiffrées, hors site, testées en restauration

---

**Une sauvegarde non testée n'existe pas.** Les données de 10+ garages ne se perdent pas. En
auto-hébergement, ce paragraphe passe de « recommandé » à **seule ligne de défense** : il n'y a
plus de réplication managée derrière, plus de snapshot automatique d'un fournisseur — si ce
mécanisme échoue silencieusement, il n'y a rien d'autre.

Trois exigences non négociables, pas une seule :

1. **Chiffrée** avant tout transfert — un dump en clair qui transite ou qui traîne n'est jamais
   acceptable.
2. **Hors site, au sens physique.** Une sauvegarde sur le même disque, ou même sur un second
   disque du même serveur (RAID compris, voir §3.4), ne protège de rien en cas d'incendie, de vol,
   de dégât des eaux ou de panne totale du serveur — c'est le scénario même qu'une sauvegarde doit
   couvrir. « Hors site » ne veut **pas** dire « chez un fournisseur qui peut lire les données » :
   un stockage objet suisse (Infomaniak Swiss Backup, Exoscale SOS) utilisé **uniquement comme
   coffre de fichiers déjà chiffrés** reste cohérent avec la décision d'auto-hébergement — le
   fournisseur ne voit jamais que des octets chiffrés, il n'héberge aucune logique ni aucune
   donnée en clair de DFA. Alternative sans dépendance à un tiers : un second serveur physique
   dans un lieu réellement distinct, sous le contrôle de @laupernoe.
3. **Testée en restauration**, périodiquement et pas seulement une fois à la mise en place (§7.2).

**7.1 Production de la sauvegarde**

Sauvegarde logique quotidienne (`pg_dump` format custom, restaurable sélectivement et plus
compact qu'un dump SQL brut), exécutée directement contre le conteneur `postgres` local (plus
besoin de traverser Internet pour atteindre la base, contrairement à une base managée distante),
chiffrée **en flux, avant toute écriture sur disque**, puis envoyée hors site (voir point 2
ci-dessus).

**Le clair ne doit jamais toucher le disque, même brièvement** (correctif d'audit — l'ancienne
version de ce script écrivait le dump en clair dans `/tmp` en mode `0644` par défaut, lisible par
tout compte local le temps du chiffrement, avec un nom de fichier prévisible détournable par un
lien symbolique pré-créé, et un `rm -f` que `set -e` pouvait sauter en cas d'échec d'`age` — un
clair pouvait alors traîner indéfiniment sans que la surveillance du §7.1 ne le détecte, puisqu'elle
ne vérifie que l'absence de sauvegarde, jamais la présence d'un résidu). La version ci-dessous
chaîne `pg_dump | age | aws s3 cp -` en un seul pipeline : aucun fichier intermédiaire, donc rien à
laisser traîner. `pipefail` (déjà dans `set -euo pipefail`) fait échouer tout le pipeline si un
seul maillon échoue — y compris `pg_dump`, qui sinon laisserait passer un flux tronqué sans
erreur visible côté `age`/`aws`.

Exemple de script (à adapter ; s'exécute depuis le serveur applicatif lui-même, typiquement une
tâche planifiée — cron ou systemd timer). **`set -u` fait volontairement échouer le script si une
variable requise n'est pas exportée dans l'environnement du planificateur** (`AGE_CLE_PUBLIQUE`,
`S3_ENDPOINT`, `S3_BUCKET`, et les identifiants attendus par `aws` lui-même) : un cron n'hérite
d'aucun profil shell, donc ces variables doivent être fournies explicitement — `EnvironmentFile=
/opt/dfa/.env.production` pour un systemd timer, ou une ligne `set -a; . /opt/dfa/.env.production;
set +a` en tête de script pour un cron classique (jamais coder une valeur en dur dans le script
lui-même, versionné ou non) :

```bash
#!/usr/bin/env bash
set -euo pipefail

Échec immédiat et explicite si l'environnement du planificateur n'a pas exporté ces variables
=============================================================================================
(voir le paragraphe ci-dessus) — sans ce contrôle, `set -u` fait échouer le script au premier
=============================================================================================
usage de la variable manquante avec un message Bash générique ("unbound variable"), suffisant
=============================================================================================
pour arrêter le script mais pas pour orienter l'astreinte vers la cause en pleine nuit.
=======================================================================================
: "${AGE_CLE_PUBLIQUE:?AGE_CLE_PUBLIQUE manquant — clé publique age, voir .env.production}"
: "${S3_ENDPOINT:?S3_ENDPOINT manquant — voir .env.production}"
: "${S3_BUCKET:?S3_BUCKET manquant — voir .env.production}"

DATE=$(date +%Y-%m-%dT%H%M%S)
FICHIER="dfa_prod_${DATE}.dump.age"
COMPOSE="docker compose -f /opt/dfa/docker-compose.yml --env-file /opt/dfa/.env.production"

Chiffrement asymétrique (age : plus simple à opérer sans trousseau GPG partagé — clé publique
=============================================================================================
stockée sur le serveur, clé privée UNIQUEMENT hors ligne, ex. gestionnaire de mots de passe de
==============================================================================================
@laupernoe). Le fichier chiffré seul, sans la clé privée séparée, ne révèle rien.
==========================================================================
#
Tout en un seul pipeline, jamais de fichier intermédiaire en clair : pg_dump (DANS le conteneur
===============================================================================================
postgres, pas besoin d'exposer le port sur l'hôte — voir §11 ; rôle dfa_migrator, propriétaire
==============================================================================================
du schéma) → age (chiffrement, sortie sur stdout par défaut) → aws s3 cp - (lit l'entrée
========================================================================================
standard, upload en flux). Stockage objet suisse comme simple coffre chiffré (voir §7 point 2) ;
================================================================================================
alternative sans intermédiaire tiers : remplacer la dernière étape par un `ssh ... "cat >
=========================================================================================
fichier"` vers un second serveur physique distinct sous contrôle de @laupernoe, même principe de flux.
===============================================================================================
$COMPOSE exec -T postgres pg_dump -U dfa_migrator -d dfa_prod --format=custom \
  | age -r "$AGE_CLE_PUBLIQUE" \
  | aws --endpoint-url "$S3_ENDPOINT" s3 cp - "s3://${S3_BUCKET}/postgres/${FICHIER}"
```

Rétention recommandée : 7 quotidiennes + 4 hebdomadaires + 12 mensuelles (règle de rotation
simple côté bucket — la plupart des offres d'object storage suisses savent l'appliquer via une
politique de cycle de vie, sinon un second script de purge).

**Surveillance du bon déroulé** : un cron/systemd timer qui échoue silencieusement équivaut à ne
pas avoir de sauvegarde du tout. Faire écrire au script un statut vérifiable (fichier horodaté,
ou notification explicite en cas d'échec — même un simple envoi vers le canal de monitoring
existant, voir §9) plutôt que de supposer que « ça a tourné » parce que le cron est configuré.

**7.2 Test de restauration (obligatoire, périodique)**

Une fois par mois au minimum, et systématiquement après tout changement de version majeure de
PostgreSQL (§3.7) ou de la procédure de sauvegarde :

1. Démarrer une instance Postgres jetable — en auto-hébergement, le plus simple est un conteneur
   Docker temporaire sur un poste de travail ou le serveur lui-même, même version majeure que la
   production : `docker run --rm -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:16-alpine`.
2. Déchiffrer la dernière sauvegarde (`age -d`, clé privée sortie de son stockage hors ligne pour
   l'occasion, jamais laissée sur un serveur).
3. Restaurer : `pg_restore --host=localhost --port=5433 --dbname=<base-jetable> <fichier.dump>`.
4. Vérifier au minimum : le nombre de tenants correspond à l'attendu, une requête applicative
   simple (ex. compter les utilisateurs actifs d'un tenant connu) renvoie un résultat cohérent, et
   `verifierPostureRls()` — ou son équivalent en SQL manuel — confirme que le RLS est toujours
   dans la posture attendue après restauration.
5. Détruire l'instance jetable (`docker rm`/arrêt du conteneur — rien ne survit, c'était jetable
   par construction).
6. Consigner la date et le résultat du test quelque part de durable (changelog interne, ticket) —
   la preuve que la sauvegarde a été testée doit survivre plus longtemps que l'instance de test
   elle-même.

7. Rotation des secrets

---

Il n'y a pas de `SESSION_SECRET` à faire tourner : les jetons de session sont générés par CSPRNG
côté serveur et stockés en base sous forme d'empreinte SHA-256, rien n'est signé (voir
`.env.example`). Ce qui reste à faire tourner périodiquement (au minimum annuellement, et
immédiatement en cas de suspicion de compromission ou de départ de toute personne y ayant eu
accès) :

- **Mots de passe `dfa_app`/`dfa_migrator`/`dfa` (superuser)**, désormais sur le conteneur
  `postgres` local plutôt qu'une instance managée. Rotation sans coupure prolongée :
  1. Comme au §3.2 : **jamais** `psql -c "alter role ... password '<...>'"` (le secret
     transiterait en clair par l'argument de la commande — historique shell, `ps aux`, `docker
inspect`, journal d'audit Docker). Ouvrir une session interactive et utiliser `\password` :
     ```bash
     docker compose -f docker-compose.yml --env-file .env.production \
       exec postgres psql -U dfa -d dfa_prod
     ```
     puis, dans la session, `\password dfa_app` (et de même pour `dfa_migrator`, `dfa`), mot de
     passe saisi deux fois, masqué — l'ancien mot de passe cesse immédiatement de fonctionner.
     `dfa_app`/`dfa_migrator` sont déjà `valid until 'infinity'` depuis la rotation initiale
     (§3.2) : `\password` seul suffit ici, pas besoin de relever l'expiration ;
  2. mettre à jour `DATABASE_URL`/`DATABASE_URL_MIGRATION`/`POSTGRES_SUPERUSER_PASSWORD` dans
     `.env.production` ;
  3. `docker compose -f docker-compose.yml --env-file .env.production up -d api` — bref
     instant entre l'étape 1 et le redémarrage du conteneur `api` où les connexions du pool
     existant échoueraient ; à faire donc dans une fenêtre courte, l'une après l'autre sans délai.
     Changer `POSTGRES_PASSWORD` du conteneur `postgres` lui-même exige en plus de recréer ce
     conteneur (`up -d postgres`) avec la nouvelle valeur dans `.env.production` — brève
     interruption de Postgres, à planifier hors heures d'atelier.

  **Toute commande de cette section qui ne peut vraiment pas éviter un secret en argument**
  (aucune ne le fait plus après ce correctif, mais à respecter pour toute commande ajoutée plus
  tard ici) : la préfixer d'un espace avant de la taper. La plupart des shells (bash avec
  `HISTCONTROL=ignorespace` ou `ignoreboth`, actif par défaut sur de nombreuses distributions —
  vérifier avec `echo $HISTCONTROL`, sinon `export HISTCONTROL=ignorespace` en tête de session)
  n'enregistrent alors pas la ligne dans l'historique — dernier filet, pas un substitut à éviter
  le secret en argument en premier lieu.

- **`REDIS_PASSWORD`** : même procédure — `docker compose ... up -d redis api` avec la nouvelle
  valeur dans `.env.production` et dans `REDIS_URL`.
- **Clé de chiffrement des sauvegardes** (`age`/GPG) : en cas de rotation, re-chiffrer au moins la
  dernière sauvegarde valide avec la nouvelle clé avant de considérer l'ancienne révoquée — ne
  jamais se retrouver dans une situation où aucune sauvegarde lisible n'existe pendant la
  transition.
- **Identifiants d'accès au registre d'images** (`docker login`), si le registre n'est pas déjà
  couvert par l'authentification GitHub Actions (cas de GHCR avec `GITHUB_TOKEN`).
- **`SENTRY_DSN`** : voir `docs/sentry-auto-heberge.md` pour la rotation côté instance Sentry
  elle-même.

Aucun secret ne doit jamais être écrit dans `docker-compose.yml` (versionné) : tous
transitent par `.env.production`, jamais commité.

9. Monitoring

---

@laupernoe est seul au support : la règle est de voir un problème avant qu'un client ne le signale. En
auto-hébergement, cette règle s'étend à des couches qu'un hébergeur managé aurait surveillées à
sa place — espace disque, santé du disque, charge du serveur.

- **Logs structurés JSON** : déjà en place côté API (`pino`/`pino-http`, niveau piloté par
  `LOG_NIVEAU`) et côté front (nginx, `access_log`/`error_log` vers stdout/stderr — voir
  `apps/web/nginx.conf`). `docker-compose.yml` route tout vers le driver `json-file` avec
  rotation (`max-size: 10m`, `max-file: 5`) : `docker compose -f docker-compose.yml logs -f
api` (ou `web`, `postgres`, `redis`, `reverse-proxy`) reste la première commande à taper en cas
  d'incident. Postgres journalise en plus toute requête de plus d'1 seconde
  (`log_min_duration_statement=1000`, voir `docker-compose.yml`) — tout le monitoring de
  requêtes lentes dont ce projet a besoin au stade actuel, sans outil supplémentaire.
- **Espace disque** : à surveiller explicitement, ce qu'un hébergeur managé aurait fait pour la
  base — un disque plein arrête Postgres brutalement (transactions refusées, potentiellement pire
  qu'un arrêt propre). Une vérification quotidienne simple (`df -h`, ou une alerte via le service
  d'uptime check ci-dessous s'il propose des checks système) suffit à ce stade ; à durcir
  (alerting dédié) si le volume de données croît vite.
- **Sonde de disponibilité externe (uptime check)** : configurer un service de surveillance
  externe (ex. UptimeRobot, Better Uptime) sur `GET https://<domaine>/api/v1/sante/pret` (vérifie
  Postgres **et** Redis, contrairement à `/sante` qui ne vérifie que le process — voir
  `apps/api/src/sante/sante.controller.ts`), intervalle court (1–5 min), alerte par e-mail/SMS
  vers @laupernoe en cas de `503` ou de timeout. Surveiller aussi `https://<domaine>/` (front)
  séparément : un 502 côté `web` ne remonte pas forcément sur `/api/v1/sante/pret`.
- **Sentry (erreurs applicatives), auto-hébergé en Suisse** : intégration SDK en place côté API
  (`apps/api/src/observabilite/`) et front (`apps/web/src/observabilite/`), désactivée proprement
  tant que `SENTRY_DSN`/`VITE_SENTRY_DSN` sont vides (aucun appel réseau, aucun impact sur le
  démarrage). Mise en place de l'instance elle-même — la partie la plus lourde à opérer seul —
  documentée dans `docs/sentry-auto-heberge.md`, à traiter avant d'onboarder le premier garage
  pilote : sans Sentry actif, une erreur silencieuse côté navigateur d'un client n'est visible que
  si le client la signale, exactement ce que cette section veut éviter. `VITE_SENTRY_DSN` est
  inlinée au build (comme `VITE_API_URL`, voir `apps/web/Dockerfile`) — changer le DSN front exige
  de reconstruire et republier l'image `web`, pas seulement de changer une variable
  d'environnement du conteneur.
- **Version déployée** : `VERSION_APP` (visible dans `GET /api/v1/sante`) doit toujours
  correspondre au tag d'image réellement déployé (§3.1, §6) — c'est ce qui permet de corréler une
  erreur Sentry ou une ligne de log à un déploiement précis.

10. Retour arrière (rollback)

---

Rollback = redéployer le tag d'image précédent, jamais une opération plus complexe :

```bash
1. Remettre l'ancien tag dans .env.production
=============================================
   API_IMAGE=ghcr.io/<org>/dfa-api:<tag-precedent>
==================================================
   WEB_IMAGE=ghcr.io/<org>/dfa-web:<tag-precedent>
==================================================

2. Redémarrer avec ces images (déjà présentes localement ou re-tirées du registre — d'où
========================================================================================
   l'importance de ne jamais purger agressivement les anciens tags d'un registre, voir §6).
===========================================================================================
docker compose -f docker-compose.yml --env-file .env.production \
  up -d api web reverse-proxy
```

**Et les migrations déjà appliquées ?** Elles ne sont **pas** annulées automatiquement, et c'est
volontaire : le projet impose que toute migration soit écrite en _expand/contract_, jamais
destructive (règle non négociable, voir `CONTRIBUTING.md`). Concrètement, une migration déjà passée en
production est censée être **compatible avec l'ancienne version du code** qu'on est en train de
redéployer — une colonne ajoutée reste nullable ou avec une valeur par défaut tant que le code qui
l'utilise n'est pas généralisé ; une colonne n'est supprimée (« contract ») que dans une migration
séparée, déployée seulement après que plus aucune version du code en circulation ne la lit.
**Dans l'immense majorité des cas, le bon rollback est donc : redéployer le tag précédent et
laisser le schéma tel quel** — aucune action sur la base.

Le cas où il faut réellement revenir en arrière sur une migration (bug qui corrompt des données,
migration qui n'aurait jamais dû partir) est rare et ne s'automatise pas :

1. Localiser le script correspondant dans `apps/api/src/db/migrations/down/` (convention
   `<nom-de-la-migration>.down.sql`, ex. `0001_socle_rls.down.sql` pour
   `0001_socle_rls.sql`) — ou en écrire un si absent.
2. Le relire entièrement et l'exécuter à la main via `psql` **dans le conteneur `postgres`**
   (`docker compose ... exec postgres psql -U dfa_migrator -d dfa_prod`, rôle `dfa_migrator`) —
   jamais via le runner `migrate` automatique, qui n'a aucune notion de « descendre » une
   migration.
3. Supprimer manuellement la ligne correspondante dans la table de suivi
   `public.__dfa_migrations` (`delete from public.__dfa_migrations where nom = '<fichier>';`) —
   sinon le runner la considère toujours appliquée alors que l'objet qu'elle créait n'existe plus.
4. Redéployer ensuite le tag de code compatible avec ce schéma redescendu.

Cette procédure manuelle est délibérément plus lourde que le rollback applicatif : c'est un
signal, pas un oubli — un retour arrière de schéma est un événement rare qui mérite qu'on
s'arrête et qu'on réfléchisse, pas une commande qu'on tape par réflexe à 2h du matin.

11. Pièges connus

---

- **`env_file: .env.production` doit exister au moment du `docker compose ... config`/`up`**,
  même pour une simple validation de syntaxe — sans lui, Compose refuse de démarrer avec une
  erreur de fichier manquant, avant même de regarder si les variables qu'il contient sont
  correctes.
- **`WEB_URL_PUBLIQUE` sert deux fois** (voir §1, Domaine et CORS) : garder strictement le format
  `https://domaine` sans chemin ni slash final.
- **Ne jamais purger tous les anciens tags d'images** du registre : un rollback (§10) suppose que
  le tag précédent est encore récupérable. Garder au minimum les N derniers déploiements.
- **`docker/postgres/init/01-roles.sql` ne se rejoue jamais tout seul sur un volume déjà
  initialisé** — comportement standard de `docker-entrypoint-initdb.d/`, identique en dev
  (`docs/deploiement-local.md`) et en prod maintenant que Postgres est conteneurisé ici aussi. Sur
  un volume `dfa_postgres_data` déjà initialisé, il faut soit l'exécuter à la main (`docker
compose exec postgres psql -U dfa -d dfa_prod -f -` en lui passant le contenu du fichier), soit
  repartir d'un volume vide (`docker compose down -v` — **destructif**, jamais sur une base qui
  contient déjà des données réelles sans sauvegarde vérifiée au préalable, voir §7).
- **Tout volume Postgres neuf rejoue `01-roles.sql` et recrée `dfa_migrator`/`dfa_app` avec les
  mots de passe de dev publiés dans le dépôt** — pas seulement au tout premier déploiement : une
  montée de version majeure (§3.7) démarre elle aussi un conteneur sur un volume vide. Le filet
  d'expiration à 7 jours de `01-roles.sql` transforme un oubli en panne visible plutôt qu'en trou
  silencieux, mais ne dispense jamais de rejouer la rotation complète du §3.2 dès ce nouveau
  démarrage — c'est explicitement une étape de la procédure §3.7, pas une option qu'on redécouvre
  à 2h du matin quand l'API refuse de se connecter.
- **Ne jamais exécuter `pnpm db:seed` contre la base de production** (§4) — garde-fou insuffisant
  côté code à ce jour, voir `docs/rapport-qa-etape-0.md`.
- **Session psql manuelle depuis le serveur** : pas besoin d'exposer le port 5432 sur l'hôte pour
  ça (le fichier n'en publie volontairement aucun, voir §1) —
  `docker compose -f docker-compose.yml --env-file .env.production exec postgres psql -U
dfa -d dfa_prod`.
- **Un volume Docker nommé n'est pas chiffré par lui-même** (§2.4) — vérifier le chiffrement de
  la partition hôte avant le premier déploiement, pas après.
- **CGNAT / IP dynamique / port 80 bloqué** peuvent silencieusement empêcher tout renouvellement
  TLS si le serveur est en local physique (§5) — à vérifier avant de s'engager sur cette variante
  d'hébergement, pas après le premier incident de certificat expiré.
