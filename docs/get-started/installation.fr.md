---
title: Installer dmsforall sur un serveur
description: Installer dmsforall avec un seul fichier Compose, placer votre propre reverse proxy devant pour HTTPS sur un domaine, et contrôler l'installation.
---

Cette page décrit une installation sur un serveur. Le [Démarrage rapide](quick-start.md) donne la version courte.

À la fin de cette page, la pile tourne sur votre serveur, derrière votre reverse proxy HTTPS si vous en avez un, et vous avez vérifié qu'elle répond.

## Prérequis

- Docker Engine et Docker Compose 2.24 ou plus récent.
- De l'espace disque pour la base de données, les documents téléversés et les sauvegardes.
- Pour un nom de domaine avec un vrai certificat : un reverse proxy de votre choix (Caddy, nginx, Traefik, un tunnel Cloudflare).

## Installer

Créez un dossier vide, téléchargez-y le fichier Compose, puis démarrez la pile. Ce fichier est tout ce dont vous avez besoin. Vous ne créez aucun autre fichier ni sous-dossier.

```sh
mkdir dmsforall && cd dmsforall
curl -LO https://github.com/selfhostr/dmsforall/releases/latest/download/docker-compose.yml
docker compose up -d
```

Ouvrez `https://<adresse du serveur>:8443`. dmsforall publie un seul port, en HTTPS uniquement, avec un certificat auto-signé généré au premier démarrage. Votre navigateur vous demande de l'accepter une fois. Pour un vrai certificat, placez un reverse proxy devant (voir ci-dessous).

Le premier démarrage génère les mots de passe et les clés, crée la base de données, applique les migrations et démarre tous les services. Tout est stocké à côté du fichier Compose :

| Dossier           | Contenu                                                                              |
| ----------------- | ------------------------------------------------------------------------------------ |
| `./data/postgres` | La base de données.                                                                  |
| `./data/valkey`   | Les files d'attente des tâches de fond.                                              |
| `./data/fichiers` | Les documents et photos téléversés et générés.                                       |
| `./data/secrets`  | Les mots de passe générés et la clé de chiffrement. Gardez-en une copie en lieu sûr. |
| `./data/certs`    | Le certificat HTTPS (`cert.pem`, `key.pem`).                                         |
| `./backups`       | Les sauvegardes quotidiennes.                                                        |

Ce sont de simples dossiers (bind mounts), et non des volumes Docker : vous pouvez les voir, les copier et les sauvegarder avec vos outils habituels. Docker les crée avec le bon propriétaire au premier démarrage. Vous n'exécutez ni `mkdir` ni `chown`.

## Créer le premier garage

Une nouvelle installation n'a pas encore de compte. Créez le premier garage et son premier compte avec une seule commande : voir [Configurer votre premier garage](first-garage.md). Connectez-vous ensuite à l'adresse ci-dessus. L'assistant de mise en route, qui guide les réglages du garage, démarre après cette première connexion.

## HTTPS avec votre propre reverse proxy

dmsforall ne gère ni les noms de domaine ni Let's Encrypt. Pour le servir sur un domaine avec un certificat valide, placez votre propre reverse proxy devant. Il doit rediriger vers `https://127.0.0.1:8443` et accepter le certificat auto-signé en amont (ou bien vous placez vos propres `cert.pem` et `key.pem` dans `./data/certs` et vous redémarrez `web`).

Renseignez l'adresse publique dans `.env`, puis redémarrez :

```sh
DFA_PUBLIC_URL=https://dmsforall.example.ch
```

Caddy (il obtient le certificat tout seul) :

```text
dmsforall.example.ch {
  reverse_proxy https://127.0.0.1:8443 {
    transport http {
      tls_insecure_skip_verify
    }
  }
}
```

nginx :

```nginx
location / {
  proxy_pass https://127.0.0.1:8443;
  proxy_ssl_verify off;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 1g;
}
```

Tunnel Cloudflare (`cloudflared`), dans le fichier de configuration :

```yaml
ingress:
  - hostname: dmsforall.example.ch
    service: https://localhost:8443
    originRequest:
      noTLSVerify: true
  - service: http_status:404
```

Le cookie de session est toujours `Secure` : n'utilisez le site qu'en HTTPS. Avec un reverse proxy devant, l'API fait confiance à deux sauts de proxy (le vôtre et le conteneur `web`). Sans `DFA_PUBLIC_URL`, elle en fait confiance à un seul.

## Réglages facultatifs

Rien n'est obligatoire. Pour modifier un réglage, créez un fichier nommé `.env` à côté de `docker-compose.yml`, en partant de `.env.example` (joint à chaque [version publiée](https://github.com/selfhostr/dmsforall/releases/latest)), et supprimez le `#` devant les lignes dont vous avez besoin.

| Variable                                                                                | Défaut       | Effet                                                                               |
| --------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------- |
| `DFA_VERSION`                                                                           | `latest`     | Version de l'image à exécuter.                                                      |
| `DFA_PORT`                                                                              | `8443`       | Le port HTTPS publié.                                                               |
| `DFA_PUBLIC_URL`                                                                        | aucun        | Adresse publique derrière votre reverse proxy. Utilisée dans les liens des e-mails. |
| `DFA_SMTP_HOST`, `DFA_SMTP_PORT`, `DFA_SMTP_USER`, `DFA_SMTP_PASSWORD`, `DFA_SMTP_FROM` | aucun, `587` | Envoi sortant des e-mails. L'envoi s'active dès que l'hôte est renseigné.           |
| `DFA_BACKUP_TIME`                                                                       | `02:30`      | Heure de la sauvegarde quotidienne (heure du serveur).                              |
| `DFA_BACKUP_KEEP_DAYS`                                                                  | `14`         | Nombre de jours de sauvegardes conservés.                                           |

Les autres réglages se trouvent dans la [référence de configuration](../reference/configuration.md).

## Les services

| Service    | Rôle                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| `web`      | L'interface web en HTTPS. Le seul port publié. Relaie `/api` vers l'API.                             |
| `api`      | L'API. Applique les migrations de la base au démarrage. Non publiée.                                 |
| `worker`   | Tâches de fond, à partir de la même image que l'API. Démarre une fois l'API en bonne santé.          |
| `postgres` | PostgreSQL 16. Non publié.                                                                           |
| `valkey`   | Valkey (open source, compatible Redis). Non publié.                                                  |
| `backup`   | La sauvegarde quotidienne, dans `./backups`. Voir [Sauvegarder et restaurer](backup-and-restore.md). |

Le profil `ocr` démarre le lecteur de permis de circulation : `docker compose --profile ocr up -d`. L'application fonctionne sans lui, il manque seulement le raccourci « scanner le permis de circulation ».

## Compiler depuis les sources

Pour compiler les images à partir d'un clone du dépôt, au lieu de les télécharger :

```sh
docker compose -f docker-compose.yml -f docker/compose.build.yml up -d --build
```

## Vérifier l'installation

```sh
docker compose ps
curl -k https://localhost:8443/api/v1/sante
```

Résultat attendu : tous les services sont `healthy` (le `worker` et `backup` après quelques secondes), et le point de santé renvoie un document JSON. Remplacez `localhost:8443` par votre adresse.

:::caution
Les données de `./data/postgres` et les mots de passe de `./data/secrets` vont ensemble. Si vous supprimez ou remplacez l'un sans l'autre, l'API refuse de démarrer et indique quel dossier restaurer. Ne supprimez jamais `./data/secrets` seul.
:::

:::caution
Laissez `OPENAPI_EXPOSER_DOCS` non défini ou à `false` sur un serveur accessible depuis Internet.
:::
