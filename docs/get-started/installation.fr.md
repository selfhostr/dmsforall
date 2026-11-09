---
title: Installer dmsforall sur un serveur
description: Réglages, HTTPS, services de la pile, profils facultatifs et contrôles d'une installation de dmsforall.
---

Cette page décrit une installation sur un serveur. Le [Démarrage rapide](quick-start.md) donne la version courte pour `localhost`.

À la fin de cette page, la pile tourne sur votre serveur, et vous avez vérifié qu'elle répond.

## Prérequis

- Docker Engine et Docker Compose v2.
- Pour HTTPS sur un domaine : un nom DNS qui pointe vers le serveur, et les ports 80 et 443 ouverts vers Internet.
- De l'espace disque pour les données PostgreSQL, les sauvegardes et les documents téléversés.

## Réglages

À côté de `docker-compose.yml`, créez un fichier nommé `.env`. Partez de `.env.example`, joint à chaque [version publiée](https://github.com/selfhostr/dmsforall/releases/latest), et supprimez le `#` devant les lignes dont vous avez besoin. Aucun réglage n'est obligatoire : chacun a une valeur par défaut. Les plus courants sont :

| Variable               | Défaut                  | Effet                                                                                                       |
| ---------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DFA_SITE_ADDRESS`     | `http://localhost`      | Adresse du site. Indiquez un nom de domaine pour obtenir HTTPS.                                             |
| `DFA_PUBLIC_URL`       | `http://localhost:8080` | Adresse publique que les utilisateurs saisissent dans le navigateur. Doit correspondre à l'adresse du site. |
| `DFA_HTTP_PORT`        | `8080`                  | Port HTTP sur l'hôte.                                                                                       |
| `DFA_HTTPS_PORT`       | `8443`                  | Port HTTPS sur l'hôte.                                                                                      |
| `DFA_VERSION`          | `latest`                | Version de l'image à exécuter.                                                                              |
| `DFA_TRUST_PROXY_HOPS` | `1`                     | Nombre de reverse proxies devant l'API.                                                                     |

L'envoi sortant des e-mails se règle avec `DFA_SMTP_HOST`, `DFA_SMTP_PORT`, `DFA_SMTP_USER`, `DFA_SMTP_PASSWORD` et `DFA_SMTP_FROM`. L'envoi s'active tout seul dès que l'hôte est renseigné. Les autres réglages se trouvent dans la [référence de configuration](../reference/configuration.md).

Vous ne saisissez jamais de secret. Le service `init-secrets` génère, au premier démarrage, les mots de passe de la base de données et la clé qui chiffre les mots de passe enregistrés. Il les conserve dans le volume `dfa_secrets`. Les rôles et les chaînes de connexion de la base en sont dérivés. Conservez une copie du contenu de ce volume : voir [Sauvegarder et restaurer](backup-and-restore.md).

## HTTPS

Lorsque `DFA_SITE_ADDRESS` est un nom de domaine, Caddy obtient et renouvelle de lui-même un certificat Let's Encrypt. Les ports 80 et 443 doivent atteindre le serveur.

:::caution
HTTPS avec un vrai domaine n'a pas encore été testé de bout en bout. Vérifiez le certificat après le premier démarrage, et lisez les journaux de Caddy s'il manque.
:::

## Les services

| Service        | Rôle                                                                         |
| -------------- | ---------------------------------------------------------------------------- |
| `proxy`        | Caddy. Publie les ports HTTP et HTTPS et achemine les requêtes.              |
| `web`          | L'interface web.                                                             |
| `api`          | L'API. Non publiée.                                                          |
| `worker`       | Tâches de fond, à partir de la même image que l'API.                         |
| `migrate`      | Applique les migrations de la base avant le démarrage de l'API.              |
| `postgres`     | PostgreSQL 16. Non publié.                                                   |
| `redis`        | Valkey. Non publié.                                                          |
| `init-secrets` | Génère une seule fois les mots de passe de la base et la clé de chiffrement. |

PostgreSQL et Valkey ne sont jamais publiés sur un port de l'hôte.

## Profils facultatifs

- `--profile ocr` : démarre l'image `ghcr.io/selfhostr/dmsforall-ocr`, qui lit les permis de circulation. Ce profil n'a pas encore été démarré.
- `--profile backup` : démarre les sauvegardes nocturnes chiffrées, à partir de l'image `ghcr.io/selfhostr/dmsforall-backup`. Il a besoin de `AGE_CLE_PUBLIQUE` dans `.env`. Voir [Sauvegarder et restaurer](backup-and-restore.md).

```sh
docker compose --profile backup up -d
```

## Compiler depuis les sources

Pour compiler les images à partir d'un clone du dépôt, au lieu de les télécharger :

```sh
docker compose -f docker-compose.yml -f docker/compose.build.yml up -d --build
```

## Créer le premier garage

Une fois la pile démarrée, créez le premier compte du garage. Voir [Configurer votre premier garage](first-garage.md) pour la commande et ses options.

## Vérifier l'installation

```sh
docker compose ps
curl -s http://localhost:8080/api/v1/sante
```

Remplacez `localhost:8080` par votre domaine pour un serveur. Résultat attendu : `postgres` et `redis` affichent `healthy`, le service `migrate` s'est arrêté sans erreur, `api` et `worker` tournent, et le point de santé renvoie un document JSON.

:::caution
Laissez `OPENAPI_EXPOSER_DOCS` non défini ou à `false` sur un serveur accessible depuis Internet.
:::
