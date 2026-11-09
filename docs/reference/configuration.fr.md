---
title: Configuration
description: Chaque variable d'environnement lue par dmsforall, avec sa valeur par défaut et son effet.
---

dmsforall lit sa configuration dans des variables d'environnement. L'API les valide au démarrage avec zod, et refuse de démarrer si l'une d'elles est invalide. Le message d'erreur liste chaque variable fautive.

Vous avez rarement besoin de cette page. La pile par défaut démarre sans aucun réglage, et `.env.example` liste les quelques réglages que vous voudrez peut-être modifier (nom de domaine, e-mail, version). Tout le reste se trouve ici, pour un usage avancé.

Dans la pile par défaut, `docker-compose.yml` règle les variables de l'API à partir des valeurs `DFA_*` du fichier `.env` situé à côté. Les services de l'API lisent aussi ce fichier `.env` eux-mêmes : vous pouvez donc y ajouter n'importe quelle variable de cette page sous son propre nom, par exemple `LIMITE_CONNEXION_IP=30`. Le fichier Compose a le dernier mot pour les variables qu'il règle lui-même : utilisez pour celles-là les noms `DFA_*` de la section Déploiement de cette page.

En développement, les variables sont lues dans le fichier `.env` à la racine du dépôt, créé à partir de `docker/dev.env.example`.

Les booléens prennent les valeurs `true` ou `false`. Les durées sont exprimées en minutes, en secondes ou en millisecondes, selon ce que précise le nom de chaque variable.

## Noyau

| Variable               | Défaut        | Effet                                                                                                                         |
| ---------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | `development` | `development`, `test` ou `production`. En production, les contrôles sont plus stricts et l'envoi réel des e-mails est activé. |
| `MODE_PROCESSUS`       | `combine`     | `api` ne sert que le HTTP. `worker` n'exécute que les tâches de fond. `combine` fait les deux.                                |
| `PORT`                 | `3000`        | Port d'écoute de l'API, de 1 à 65535.                                                                                         |
| `API_URL_PUBLIQUE`     | obligatoire   | URL publique de l'API, par exemple `https://api.garage.example.org`.                                                          |
| `WEB_URL_PUBLIQUE`     | obligatoire   | URL publique de l'interface web.                                                                                              |
| `LOG_NIVEAU`           | `info`        | Niveau de journalisation : `fatal`, `error`, `warn`, `info`, `debug` ou `trace`.                                              |
| `OPENAPI_EXPOSER_DOCS` | `false`       | Publie la documentation de l'API sur `/api/docs`. Laissez `false` en production.                                              |

## Base de données

Dans la pile par défaut, vous ne réglez aucune de ces variables. Le point d'entrée de l'image de l'API construit `DATABASE_URL` et `DATABASE_URL_MIGRATION` à partir des mots de passe générés par `init-secrets`, et PostgreSQL crée les deux rôles au premier démarrage. Elles comptent si vous utilisez votre propre PostgreSQL : définissez alors `DATABASE_URL` et `DATABASE_URL_MIGRATION` dans `.env`, et créez les rôles avec les droits de `docker/postgres/init/01-roles.sql`.

| Variable                        | Défaut                      | Effet                                                                                                                                                             |
| ------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | obligatoire                 | URL PostgreSQL du rôle `dfa_app`. C'est le rôle utilisé par l'API, soumis à la sécurité au niveau des lignes (row-level security). Doit commencer par `postgres`. |
| `DATABASE_URL_MIGRATION`        | obligatoire                 | URL PostgreSQL du rôle `dfa_migrator`, utilisé uniquement pour appliquer les migrations. Doit être différente de `DATABASE_URL`.                                  |
| `DATABASE_POOL_MAX`             | `10`                        | Nombre maximal de connexions du pool, de 1 à 50.                                                                                                                  |
| `DATABASE_POOL_MIN`             | `min(2, DATABASE_POOL_MAX)` | Connexions gardées ouvertes même au repos. Ne peut pas dépasser `DATABASE_POOL_MAX`.                                                                              |
| `DATABASE_TIMEOUT_REQUETE_MS`   | `10000`                     | Durée maximale d'une requête, en millisecondes.                                                                                                                   |
| `DATABASE_TIMEOUT_CONNEXION_MS` | `5000`                      | Durée maximale d'ouverture d'une connexion, en millisecondes.                                                                                                     |
| `DATABASE_TIMEOUT_IDLE_MS`      | `30000`                     | Délai avant la fermeture d'une connexion inactive au-dessus du minimum, en millisecondes.                                                                         |

## Valkey

| Variable    | Défaut      | Effet                                                                                                                                         |
| ----------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `REDIS_URL` | obligatoire | URL Valkey (protocole Redis, donc elle commence par `redis`). Sert aux files d'attente, aux événements en temps réel et aux limites de débit. |

## Sessions et connexion

| Variable                            | Défaut        | Effet                                                                                                              |
| ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `SESSION_COOKIE_NOM`                | `dfa_session` | Nom du cookie de session. Lettres, chiffres, `_` et `-` uniquement.                                                |
| `SESSION_DUREE_MINUTES`             | `480`         | Durée maximale d'une session, de 5 à 43200 minutes.                                                                |
| `SESSION_INACTIVITE_MINUTES`        | `120`         | La session se ferme après ce temps d'inactivité, de 5 à 1440 minutes.                                              |
| `COOKIE_DOMAINE`                    | aucun         | Domaine du cookie de session. Laissez vide pour utiliser l'hôte de l'API.                                          |
| `COOKIE_SECURE`                     | `true`        | Marque le cookie `Secure`. Doit être `true` en production.                                                         |
| `TRUST_PROXY_HOPS`                  | `0`           | Nombre de reverse proxies devant l'API, de 0 à 10. Indiquez le nombre exact.                                       |
| `ARGON2_MEMOIRE_KIB`                | `19456`       | Coût mémoire du hachage des mots de passe, en KiB. Minimum 19456.                                                  |
| `ARGON2_ITERATIONS`                 | `2`           | Coût en temps du hachage des mots de passe. Minimum 2.                                                             |
| `ARGON2_PARALLELISME`               | `1`           | Parallélisme du hachage des mots de passe.                                                                         |
| `LIMITE_CONNEXION_IP`               | `20`          | Tentatives de connexion autorisées par adresse IP dans la fenêtre.                                                 |
| `LIMITE_CONNEXION_COMPTE`           | `15`          | Tentatives de connexion autorisées par compte dans la fenêtre. Doit être supérieure à `SEUIL_VERROUILLAGE_COMPTE`. |
| `LIMITE_FENETRE_SECONDES`           | `900`         | Durée de la fenêtre de connexion, en secondes. Minimum 30.                                                         |
| `SEUIL_VERROUILLAGE_COMPTE`         | `5`           | Mots de passe erronés consécutifs avant le verrouillage temporaire du compte.                                      |
| `LIMITE_RECHERCHE_UTILISATEUR`      | `40`          | Requêtes de recherche autorisées par utilisateur dans la fenêtre.                                                  |
| `LIMITE_RECHERCHE_FENETRE_SECONDES` | `30`          | Durée de la fenêtre de recherche, en secondes.                                                                     |

## E-mails sortants

Les e-mails ne partent réellement que si `NODE_ENV=production` **et** `COURRIEL_ENVOI_REEL=true`. Dans tous les autres cas, les messages sont mis de côté et ne sont pas remis. Dans la pile par défaut, `NODE_ENV` vaut `production`, et le point d'entrée fixe `COURRIEL_ENVOI_REEL=true` dès que `DFA_SMTP_HOST` est renseigné.

| Variable              | Défaut  | Effet                                                                     |
| --------------------- | ------- | ------------------------------------------------------------------------- |
| `COURRIEL_ENVOI_REEL` | `false` | Autorise l'envoi réel, avec `NODE_ENV=production`.                        |
| `SMTP_HOTE`           | aucun   | Nom d'hôte du serveur SMTP.                                               |
| `SMTP_PORT`           | `587`   | Port SMTP, de 1 à 65535.                                                  |
| `SMTP_SECURISE`       | `false` | `true` pour TLS implicite. Laissez `false` pour STARTTLS sur le port 587. |
| `SMTP_UTILISATEUR`    | aucun   | Nom d'utilisateur SMTP.                                                   |
| `SMTP_MOT_DE_PASSE`   | aucun   | Mot de passe SMTP.                                                        |
| `SMTP_EXPEDITEUR`     | aucun   | Adresse d'expédition. Doit être une adresse e-mail valide.                |

Chaque garage peut régler son propre serveur d'envoi dans l'application (**Réglages > Envoi des e-mails**). Ordre d'utilisation : le réglage du garage, puis les variables `SMTP_*` ci-dessus, puis rien. Sans l'un ni l'autre, l'e-mail n'est pas envoyé, et l'écran affiche « Non configuré ». Hors production, les e-mails ordinaires restent mis de côté quel que soit le réglage du garage ; seul l'e-mail d'essai de cet écran part réellement.

| Variable                         | Défaut  | Effet                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLE_CHIFFREMENT_SECRETS`        | aucun   | Clé de 32 octets (base64 ou 64 caractères hexadécimaux) qui chiffre les mots de passe SMTP des garages. Sans elle, l'enregistrement d'un mot de passe est refusé. Dans la pile par défaut, elle est générée au premier démarrage et stockée dans le volume `dfa_secrets`. Ailleurs, générez-la avec `openssl rand -base64 32`. La changer oblige à ressaisir les mots de passe. |
| `COURRIEL_RESEAU_PRIVE_AUTORISE` | `false` | Autorise, en production, le serveur d'envoi d'un garage situé sur un réseau privé (192.168.x, 10.x, localhost). Désactivé par défaut, pour que le bouton de test ne serve pas à sonder le réseau interne. Toujours autorisé hors production.                                                                                                                                    |

## Supervision

| Variable                             | Défaut     | Effet                                                                                               |
| ------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN`                         | aucun      | DSN d'un serveur compatible Sentry. Vide, le signalement d'erreurs est désactivé.                   |
| `SENTRY_ENVIRONMENT`                 | `NODE_ENV` | Nom de l'environnement affiché dans les signalements d'erreurs.                                     |
| `SENTRY_TAUX_ECHANTILLONNAGE_TRACES` | `0`        | Part des requêtes tracées pour la performance, de 0 à 1.                                            |
| `VERSION_APP`                        | calculée   | Version affichée dans le point de santé et dans les journaux. Calculée à partir du tag Git si vide. |
| `VERSION_APP_BRANCHE`                | calculée   | Branche ou tag ayant produit le build. Calculée si vide.                                            |

## Console d'exploitation

La console est désactivée tant que `DATABASE_URL_CONSOLE` n'est pas défini.

| Variable                             | Défaut                | Effet                                                               |
| ------------------------------------ | --------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL_CONSOLE`               | aucun                 | URL PostgreSQL du rôle `dfa_console`. La définir active la console. |
| `CONSOLE_COOKIE_NOM`                 | `dfa_console_session` | Nom du cookie de session de la console.                             |
| `CONSOLE_SESSION_DUREE_MINUTES`      | `60`                  | Durée maximale d'une session de console, de 5 à 240 minutes.        |
| `CONSOLE_SESSION_INACTIVITE_MINUTES` | `15`                  | Délai d'inactivité de la console, de 1 à 120 minutes.               |
| `CONSOLE_POOL_MAX`                   | `2`                   | Connexions du pool de la console, de 1 à 10.                        |

## Tâches de fond

Chaque tâche planifiée dispose d'un interrupteur marche/arrêt et d'une expression cron. Les expressions cron sont en UTC.

L'interrupteur accepte trois états. Lorsque la variable est vide, la tâche est active en production et inactive dans les autres environnements. `true` la force à l'état actif, `false` la force à l'arrêt.

| Variable                                  | Défaut       | Tâche                                                                    |
| ----------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| `REFERENTIEL_VEHICULES_CH_JOB_ACTIF`      | vide         | Mise à jour quotidienne des données de référence des véhicules suisses.  |
| `REFERENTIEL_VEHICULES_CH_JOB_CRON`       | `17 4 * * *` | Planification de la mise à jour des données de référence des véhicules.  |
| `POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF`  | vide         | Clôture automatique de la journée de pointage.                           |
| `POINTAGE_CLOTURE_AUTOMATIQUE_JOB_CRON`   | `30 0 * * *` | Planification de la clôture.                                             |
| `RELANCES_FACTURE_JOB_ACTIF`              | vide         | Planification et envoi des rappels de paiement des factures.             |
| `RELANCES_FACTURE_JOB_CRON`               | `12 * * * *` | Planification de la tâche de rappels.                                    |
| `RESILIATION_PURGE_AUTOMATIQUE_JOB_ACTIF` | vide         | Purge automatique des données d'un locataire après sa sortie du service. |
| `RESILIATION_PURGE_AUTOMATIQUE_JOB_CRON`  | `17 3 * * *` | Planification de la purge.                                               |

## Services de documents

| Variable                               | Défaut                   | Effet                                                                                               |
| -------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| `OCR_SERVICE_URL`                      | `http://ocr-permis:8092` | URL du service OCR qui lit les permis de circulation.                                               |
| `OCR_SERVICE_TIMEOUT_MS`               | `20000`                  | Délai d'attente du service OCR des véhicules, en millisecondes. Minimum 1000.                       |
| `LIMITE_OCR_PERMIS_UTILISATEUR`        | `15`                     | Analyses OCR de véhicules autorisées par utilisateur dans la fenêtre.                               |
| `LIMITE_OCR_PERMIS_FENETRE_SECONDES`   | `300`                    | Durée de la fenêtre OCR des véhicules, en secondes.                                                 |
| `FACTURES_FOURNISSEUR_OCR_SERVICE_URL` | aucun                    | URL du service OCR qui lit les factures fournisseurs. Non défini, la fonction n'est pas disponible. |
| `FACTURES_FOURNISSEUR_OCR_TIMEOUT_MS`  | `20000`                  | Délai d'attente du service OCR des factures fournisseurs, en millisecondes. Minimum 1000.           |

## Interface web

| Variable                | Défaut | Effet                                                                                                                              |
| ----------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_DFA_VERSION_INFO` | aucun  | Texte fixé au moment de la compilation, affiché dans le pied de page de version de l'interface. Réglé au build, pas à l'exécution. |

## Déploiement

Ces variables sont lues par le fichier Compose, pas par l'API. Renseignez-les dans `.env`. Aucune n'est obligatoire.

| Variable                                                                                                   | Défaut                  | Effet                                                                              |
| ---------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `DFA_VERSION`                                                                                              | `latest`                | Tag de l'image à exécuter : `X.Y.Z`, `X.Y`, `latest` ou `edge`.                    |
| `DFA_SITE_ADDRESS`                                                                                         | `http://localhost`      | Adresse du site. Un nom de domaine active HTTPS via Caddy.                         |
| `DFA_PUBLIC_URL`                                                                                           | `http://localhost:8080` | Adresse publique du site, utilisée comme `API_URL_PUBLIQUE` et `WEB_URL_PUBLIQUE`. |
| `DFA_HTTP_PORT`                                                                                            | `8080`                  | Port HTTP sur l'hôte.                                                              |
| `DFA_HTTPS_PORT`                                                                                           | `8443`                  | Port HTTPS sur l'hôte.                                                             |
| `DFA_TRUST_PROXY_HOPS`                                                                                     | `1`                     | Transmis comme `TRUST_PROXY_HOPS`.                                                 |
| `DFA_LOG_LEVEL`                                                                                            | `info`                  | Transmis comme `LOG_NIVEAU`.                                                       |
| `DFA_EXPOSE_API_DOCS`                                                                                      | `false`                 | Transmis comme `OPENAPI_EXPOSER_DOCS`.                                             |
| `DFA_SENTRY_DSN`                                                                                           | vide                    | Transmis comme `SENTRY_DSN`.                                                       |
| `DFA_SMTP_HOST`, `DFA_SMTP_PORT`, `DFA_SMTP_SECURE`, `DFA_SMTP_USER`, `DFA_SMTP_PASSWORD`, `DFA_SMTP_FROM` | vide, `587`, `false`    | Transmis comme `SMTP_HOTE`, `SMTP_PORT`, `SMTP_SECURISE`, `SMTP_UTILISATEUR`, `SMTP_MOT_DE_PASSE` et `SMTP_EXPEDITEUR`, dans le même ordre. Renseigner l'hôte active l'envoi réel.      |
| `DFA_SMTP_ALLOW_PRIVATE_NETWORK`                                                                           | `false`                 | Transmis comme `COURRIEL_RESEAU_PRIVE_AUTORISE`.                                   |
| `DFA_TIMEZONE`                                                                                             | `UTC`                   | Fuseau horaire du service de sauvegarde.                                           |
| `AGE_CLE_PUBLIQUE`                                                                                         | vide                    | Clé publique `age` du profil de sauvegarde.                                        |
| `HEURE_SAUVEGARDE`                                                                                         | `03:15`                 | Heure de la sauvegarde nocturne.                                                   |
| `SEUIL_TAILLE_MIN_POURCENT`                                                                                | `50`                    | Taille minimale d'une sauvegarde, en pourcentage de la précédente.                 |

:::caution
Vérifiez les variables sur cette page pour la version que vous exécutez. Les variables peuvent changer d'une version à l'autre. Lisez le [journal des modifications](https://github.com/selfhostr/dmsforall/blob/main/CHANGELOG.md) avant de mettre à jour.
:::
