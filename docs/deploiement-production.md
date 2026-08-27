# Déploiement en production

Ce document explique comment installer, mettre à jour, migrer et, si besoin, revenir en arrière
sur le déploiement de production de dmsforall. Pour les sauvegardes et restaurations
PostgreSQL, voir [docs/exploitation-sauvegardes.md](exploitation-sauvegardes.md) — ce document-ci
ne les répète pas.

Écrit pour quelqu'un qui déploie sans avoir le contexte, à n'importe quelle heure. Chaque section
donne les commandes exactes et comment vérifier qu'elles ont marché.

## 1. Vue d'ensemble

Trois pièces :

- **`docker-compose.yml`** (racine du dépôt) : tout tourne en conteneurs sur un seul serveur —
  Postgres, Redis, l'API, le worker, le front, Caddy, les sauvegardes.
- **`.github/workflows/publier-images.yml`** : construit et publie les images `dfa-api`/`dfa-web`
  sur le registre de conteneurs forge, taguées, à chaque push sur `main` ou chaque tag `vX.Y.Z`.
- **`.github/workflows/deployer.yml`** et **`migrer.yml`** : pointent le serveur sur une image déjà
  publiée. Déclenchement manuel uniquement (`workflow_dispatch`) — voir §3.3 pour pourquoi.

Les tests e2e Playwright (`e2e/`) ne font partie d'AUCUN de ces workflows — décision, pas un oubli.
Le harnais (`e2e/scripts/executer.sh`) suppose une API déjà démarrée sur l'hôte et une astuce de
détection d'IP réglée pour Docker rootless local (voir `e2e/README.md`) : les faire tourner en CI
demanderait de monter d'abord une pile éphémère complète (Postgres, Redis, migrations, seed,
API), un chantier séparé, non fait ici plutôt qu'annoncé et non vérifié.

## 2. Hébergement

Décidé : Postgres, Redis et le reste tournent en conteneurs sur le(s) serveur(s) de @laupernoe — aucun
service managé par un hébergeur (voir l'en-tête de `docker-compose.yml`). Le chiffrement au
repos exigé par le nLPD vient d'une couche EN DESSOUS de Docker (LUKS sur la partition qui héberge
`/var/lib/docker/volumes`) : ce compose ne le fournit pas lui-même.

Pas encore décidé : le fournisseur exact (Infomaniak, Exoscale ou autre — les deux premiers ne
proposent que du `linux/amd64` en Compute/VM, voir `publier-images.yml`) et la topologie réseau
devant Caddy (répartiteur de charge d'un hébergeur, tunnel Cloudflare). `TRUST_PROXY_HOPS`
(`.env.production.example`) dépend de cette décision — la règle de calcul et la procédure de
vérification post-déploiement y sont documentées, pas ici.

## 3. Pipeline de build et déploiement

### 3.1 Vue d'ensemble

```
push sur main / tag vX.Y.Z  →  publier-images.yml  →  images taguées sur le registre
                                                          │
                                    (manuel) migrer.yml ──┤── (manuel) deployer.yml
                                                          ▼
                                                   serveur de production
```

`docker-compose.yml` déploie par image taguée (`API_IMAGE`/`WEB_IMAGE`), jamais par build
local — publier une image ne la déploie jamais automatiquement. Les deux workflows de déploiement
prennent un `tag` en entrée (menu **Actions → Jouer les migrations en production / Déployer en
production → Run workflow** sur forge, ou l'API forge).

### 3.2 Premier déploiement

1. Cloner le dépôt sur le serveur, sur le tag à déployer (voir §4 pour pourquoi un checkout Git
   complet, pas seulement `docker-compose.yml` copié) :
   ```bash
   git clone --branch <tag> --depth 1 <url-du-depot> /opt/dfa
   cd /opt/dfa
   ```
2. Créer les deux fichiers requis même vides, avant tout `docker compose up` — sinon Docker
   matérialise le chemin manquant comme un répertoire (détail dans
   [exploitation-sauvegardes.md](exploitation-sauvegardes.md), section Premier déploiement) :
   ```bash
   mkdir -p secrets
   touch secrets/rclone.conf secrets/age-cle-privee-test.txt
   chmod 600 secrets/rclone.conf secrets/age-cle-privee-test.txt
   ```
3. `cp .env.production.example .env.production` puis remplir CHAQUE variable — le fichier explique
   pour chacune à quoi elle sert, comment obtenir sa valeur, si elle est secrète (voir aussi §7).
4. DNS du domaine choisi déjà pointé vers l'IP publique du serveur AVANT l'étape suivante (Caddy
   demande un certificat Let's Encrypt au premier démarrage, voir §5).
5. Premier démarrage :
   ```bash
   docker compose -f docker-compose.yml --env-file .env.production up -d
   ```
   Vérifier : `docker compose -f docker-compose.yml --env-file .env.production ps` — tous les
   services `Up`/`healthy` (`reverse-proxy` peut rester `starting` une minute, le temps du
   certificat).
6. **Rotation immédiate des mots de passe de développement — MAINTENANT, avant d'ouvrir quoi que
   ce soit au public.** `docker/postgres/init/01-roles.sql` vient de créer les rôles Postgres avec
   des mots de passe publiés dans ce dépôt Git (`dfa_app_dev`, `dfa_migrator_dev`,
   `dfa_console_dev`) — un filet les expire de lui-même sous 7 jours sur `dfa_prod`, mais ne pas
   compter dessus. Procédure complète : §8.
7. Premier jeu de migrations :
   ```bash
   docker compose -f docker-compose.yml --env-file .env.production --profile migration run --rm migrate
   ```
8. Vérifier : `curl https://<domaine>/api/v1/sante` répond `{"statut":"ok",...}`.

### 3.3 Pourquoi les migrations sont un workflow séparé

Une migration jouée automatiquement à la suite d'un push retire à @laupernoe la possibilité de la refuser
à un mauvais moment (heure de pointe d'un garage, doute sur une migration précise). C'est pour ça
que `docker-compose.yml` exige déjà `--profile migration run migrate` — jamais démarré par un
`docker compose up` normal. `migrer.yml` ne change rien à ça : c'est une façade auditée (forge
garde une trace de qui a lancé quoi, sur quel tag) autour du même geste manuel — jamais un
raccourci qui l'automatiserait, et c'est aussi pourquoi `deployer.yml` lui-même reste manuel plutôt
que déclenché sur chaque tag publié : le même point de contrôle humain protège les deux.

L'ordre **migrer puis déployer** (jamais l'inverse) tient à une seule propriété : les migrations de
ce dépôt sont construites en expand/contract, donc une migration EXPAND (ajout de colonne/table
nullable, nouvel index) ne casse rien pendant que l'ancien code tourne encore dessus. Le nouveau
code, lui, suppose la migration déjà appliquée — le déployer avant la migration le ferait planter
au démarrage. Le commentaire de tête de chaque fichier `apps/api/src/db/migrations/000N_*.sql` dit
si elle est expand ou contract.

### 3.4 Mise à jour normale (sans migration)

1. Vérifier que le tag existe sur le registre (Actions → Publier les images → le run du tag est
   vert).
2. Lancer **Déployer en production** avec ce tag.
3. Vérifier : le run se termine en vert, et l'étape « Basculer les images » affiche
   `OK — <tag> déployé`.

Le workflow bascule uniquement `api`/`web`/`worker` — `postgres`, `redis`, `backup`,
`restauration-test`, `reverse-proxy`, `ocr-permis` restent en place, aucune interruption pour eux.

### 3.5 Séquence d'un déploiement avec migration

1. Lire le diff des migrations de ce tag : `git diff <tag-precedent>..<tag> -- apps/api/src/db/migrations/`.
2. Lancer **Jouer les migrations en production** avec ce tag. `api`/`web`/`worker` tournent encore
   sur l'ancien code pendant cette étape — c'est voulu (§3.3).
3. Une fois ce run vert : lancer **Déployer en production** avec le MÊME tag (§3.4).

Une migration qui échoue fait échouer ce run — le détail de l'erreur est dans les logs de l'étape
« Jouer les migrations sur le serveur ». `api`/`web`/`worker` n'ont pas bougé : la production
continue de tourner sur l'ancien code, sans dégradation, le temps de comprendre l'échec.

### 3.6 Domaine et CORS

`API_URL_PUBLIQUE` et `WEB_URL_PUBLIQUE` (`.env.production`) doivent pointer vers la MÊME origine
publique — le Caddyfile inline de `docker-compose.yml` sert `/api/*` et le reste sur un seul
domaine, jamais deux.

### 3.7 Montée de version majeure de PostgreSQL

Une montée de version majeure recrée un volume Postgres vide, qui rejoue automatiquement
`docker/postgres/init/01-roles.sql` — les rôles reviennent avec les mots de passe de
développement. Reprendre la procédure de rotation du §8 dans la foulée, avant de rouvrir le
reverse proxy au public. Recalculer aussi les réglages mémoire de `command:` du service `postgres`
(`shared_buffers`, `effective_cache_size`…) si le gabarit du serveur a changé entre-temps —
méthode : [PGTune](https://pgtune.leopard.in.ua/), profil « Web application ».

### 3.8 Mise en place des workflows (une fois)

Secrets du dépôt (**Réglages → Actions → Secrets**) :

| Secret                  | Contenu                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REGISTRE_IMAGES_TOKEN` | Jeton personnel forge, portée « package » lecture/écriture (déjà requis par `publier-images.yml`)                                                           |
| `DEPLOY_HOTE`           | Adresse du serveur de production                                                                                                                              |
| `DEPLOY_PORT`           | Port SSH (optionnel, défaut 22)                                                                                                                               |
| `DEPLOY_UTILISATEUR`    | Utilisateur SSH dédié au déploiement (jamais `root`, membre du groupe `docker`)                                                                               |
| `DEPLOY_CLE_SSH`        | Clé privée SSH dédiée (`ssh-keygen -t ed25519 -f deploiement`), la clé publique correspondante dans `~DEPLOY_UTILISATEUR/.ssh/authorized_keys` sur le serveur |
| `DEPLOY_HOTE_EMPREINTE` | Sortie de `ssh-keyscan -H <hote>`, collée telle quelle (recommandé : épingle le serveur plutôt que de faire confiance à la première connexion CI)             |
| `DEPLOY_CHEMIN`         | Chemin absolu du checkout Git sur le serveur (ex. `/opt/dfa`, voir §4)                                                                                        |

Sur le serveur, l'utilisateur `DEPLOY_UTILISATEUR` doit pouvoir exécuter `docker`/`docker compose`
sans `sudo` (membre du groupe `docker`) et avoir un accès en écriture au checkout de `DEPLOY_CHEMIN`.

## 4. Checkout Git sur le serveur

`docker-compose.yml` ne suffit pas seul sur le serveur : `postgres` monte
`docker/postgres/init/01-roles.sql` en lecture seule à un chemin relatif à ce fichier, et
`deployer.yml`/`migrer.yml` (§3) s'attendent tous les deux à un checkout Git complet sur
`DEPLOY_CHEMIN` — ils y font `git fetch --tags && git checkout <tag>` avant chaque action, pour
que le compose et le script de rôles déployés correspondent TOUJOURS exactement à la version dont
l'image tourne, jamais un fichier resté en retard ou en avance sur une modification manuelle.

Une copie de fichiers sans `.git` casserait ce mécanisme à la première mise à jour : toujours
`git clone` (§3.2), jamais une simple copie.

## 5. TLS

Prérequis silencieux, à vérifier AVANT le premier démarrage : IP publique fixe, pas de CGNAT,
ports 80/443 joignables depuis Internet (pas seulement depuis le réseau local), DNS déjà résolu
vers cette IP. Caddy gère le renouvellement Let's Encrypt seul, sans intervention — un
renouvellement qui échoue (port bloqué, DNS qui a changé) se voit dans
`docker compose logs reverse-proxy`, pas ailleurs : aucune alerte automatique aujourd'hui (§9).

## 6. Sauvegardes

Voir [docs/exploitation-sauvegardes.md](exploitation-sauvegardes.md) — dispositif, copie hors
site, test de restauration mensuel, restauration réelle. Rien de spécifique au déploiement
d'application n'est répété ici.

## 7. Variables d'environnement

Voir `.env.production.example` (racine du dépôt) — liste exhaustive, croisée avec le schéma zod de
configuration, chaque variable documentée (usage, obtention, secrète ou non). Ne pas dupliquer
cette liste ici : elle dérive.

## 8. Rotation des secrets

Mots de passe Postgres (`dfa`, `dfa_app`, `dfa_migrator`, `dfa_console`) :

1. Générer une valeur forte pour chaque rôle à faire tourner : `openssl rand -base64 32`.
2. Session psql manuelle (§11) :
   ```sql
   alter role dfa_app password '<nouveau-mot-de-passe>' valid until 'infinity';
   alter role dfa_migrator password '<nouveau-mot-de-passe>' valid until 'infinity';
   alter role dfa_console password '<nouveau-mot-de-passe>' valid until 'infinity';
   ```
   `valid until 'infinity'` est obligatoire : `01-roles.sql` pose une expiration à 7 jours sur
   `dfa_prod` (filet de production, voir ce fichier) — l'omettre laisse le compte expirer tout
   seul une semaine plus tard.
3. Reporter les mêmes valeurs dans `DATABASE_URL`, `DATABASE_URL_MIGRATION`,
   `POSTGRES_MIGRATOR_PASSWORD` (`.env.production` — ce dernier sert au service `backup`, voir
   exploitation-sauvegardes.md) et redémarrer `api`/`worker`/`backup` :
   ```bash
   docker compose -f docker-compose.yml --env-file .env.production up -d api worker backup
   ```
4. Le mot de passe du rôle `dfa` (superuser) se change directement :
   `alter role dfa password '<nouveau-mot-de-passe>' valid until 'infinity';`, puis
   `POSTGRES_SUPERUSER_PASSWORD` dans `.env.production`.

Redis (`REDIS_PASSWORD`) : changer la valeur dans `.env.production`, puis

```bash
docker compose -f docker-compose.yml --env-file .env.production up -d redis api worker
```

(redémarre Redis ET les deux clients — une rotation à moitié faite casse la connexion).

Vérifier après coup :

```bash
docker compose -f docker-compose.yml --env-file .env.production logs api --tail 50
```

ne doit montrer aucune erreur d'authentification.

## 9. Monitoring

Sentry (`SENTRY_DSN`, instance auto-hébergée en Suisse) capture les erreurs applicatives — à
renseigner dès le premier déploiement, voir §7. Logs structurés JSON sur stdout de chaque
conteneur (`docker compose logs <service>`), capturés par le driver `json-file` (rotation 10 Mo ×
5 fichiers, voir `x-logging` dans `docker-compose.yml`).

Aucune supervision externe n'existe aujourd'hui pour `GET /api/v1/sante/pret` (Postgres + Redis) ni
pour le renouvellement TLS (§5) : recommandé, jamais implémenté ici — voir le commentaire du
service `api` dans `docker-compose.yml` pour le raisonnement complet (pourquoi un
vérificateur doit vivre EN DEHORS de ce serveur). Même limite pour un test de restauration mensuel
en échec : voir exploitation-sauvegardes.md.

## 10. Retour arrière

**Sans migration entre les deux tags** : redéployer le tag précédent avec `deployer.yml` (§3.4).
Les images sont immuables, l'opération est symétrique à une mise à jour normale.

**Avec une migration entre les deux tags : on ne revient pas en arrière sur le code, on corrige en
avant.** Décidé maintenant plutôt que pendant l'incident :

- Un rollback de CODE sans rollback de SCHÉMA fait tourner l'ancien code contre un schéma qu'il ne
  connaît pas (colonne manquante qu'il attendait, ou l'inverse pour une migration CONTRACT).
- Rejouer le `down/` d'une migration contre une base qui a déjà reçu des écritures réelles depuis
  risque de perdre ces écritures — un rollback de schéma n'est jamais automatiquement sûr après le
  premier trafic réel.
- Le filet qui reste toujours disponible, dans les deux cas, est la restauration depuis sauvegarde
  ([exploitation-sauvegardes.md](exploitation-sauvegardes.md)) — dernier recours, pas la première
  option : elle perd tout ce qui s'est passé depuis la dernière sauvegarde réussie.

Avant tout rollback, vérifier qu'aucune migration n'a tourné entre les deux tags :

```bash
git log <tag-cible>..<tag-actuel> --oneline -- apps/api/src/db/migrations/
```

Une liste vide : rollback normal (§3.4). Une liste non vide : corriger en avant.

## 11. Diagnostic et dépannage

Session psql manuelle sur le Postgres de production :

```bash
docker compose -f docker-compose.yml --env-file .env.production exec postgres psql -U dfa -d dfa_prod
```

Logs d'un service :

```bash
docker compose -f docker-compose.yml --env-file .env.production logs <service> --tail 100 -f
```

État de tous les services :

```bash
docker compose -f docker-compose.yml --env-file .env.production ps
```

**L'API ne répond pas après un déploiement** : `logs api` — une erreur de configuration zod
s'affiche au démarrage avec la liste complète des variables fautives (l'app refuse de démarrer
plutôt que tourner en config incertaine). Une erreur de connexion Postgres/Redis pointe vers une
rotation de secret pas reportée partout (§8).

**`docker compose` échoue avec une erreur de socket/permission** : vérifier `DOCKER_HOST` — un
démon Docker rootless peut coexister avec le démon rootful attendu par ce compose et répondre à sa
place silencieusement. `echo $DOCKER_HOST` ; le socket attendu par ce dépôt est
`unix:///var/run/docker.sock`.

**Le renouvellement TLS a échoué** : `logs reverse-proxy` — Caddy journalise la raison exacte
(port bloqué, DNS qui a changé, taux limite Let's Encrypt atteint). Voir §5 pour les prérequis à
revérifier en premier.

**Une migration a échoué à mi-chemin** : `api`/`web`/`worker` n'ont pas bougé (§3.5) — la
production continue de tourner normalement. Lire l'erreur dans les logs du run `migrer.yml`,
corriger la migration, republier un nouveau tag, recommencer.
