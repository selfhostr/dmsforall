---
title: Référence de l'API
description: Comment appeler l'API de dmsforall, se connecter, paginer les listes, lire les erreurs et trouver la description OpenAPI.
---

L'interface web est un client de l'API publique. Tout ce que vous pouvez faire dans l'interface, vous pouvez le faire avec l'API.

## Adresse de base et versions

Tous les points d'accès se trouvent sous `/api/v1/`, par exemple `https://garage.example.org/api/v1/sante`. La version fait partie du chemin.

## Description OpenAPI

L'API publie une description OpenAPI, générée à partir du code. Elle n'est servie que si `OPENAPI_EXPOSER_DOCS=true` :

- `/api/docs` : documentation interactive ;
- `/api/docs.json` : le document OpenAPI, pour la génération de code.

Gardez-la désactivée sur un serveur de production accessible depuis Internet, sauf si vous en avez besoin. Pour produire le document depuis une copie des sources, lancez `pnpm api:openapi`.

## Se connecter

La connexion crée un cookie de session. Envoyez le cookie avec chaque requête. Le nom du cookie est `dfa_session` par défaut.

| Point d'accès                                | Méthode | Usage                                                              |
| -------------------------------------------- | ------- | ------------------------------------------------------------------ |
| `/api/v1/auth/connexion`                     | `POST`  | Se connecter avec une adresse e-mail et un mot de passe.           |
| `/api/v1/auth/deconnexion`                   | `POST`  | Se déconnecter et fermer la session.                               |
| `/api/v1/auth/moi`                           | `GET`   | Renvoyer l'utilisateur connecté et ses droits.                     |
| `/api/v1/auth/mot-de-passe/oubli`            | `POST`  | Demander un e-mail de réinitialisation du mot de passe.            |
| `/api/v1/auth/mot-de-passe/reinitialisation` | `POST`  | Définir un nouveau mot de passe avec le jeton de réinitialisation. |

Exemple avec `curl`. L'en-tête `Origin` est obligatoire pour la protection CSRF.

```sh
curl -c cookies.txt \
  -H "Origin: https://garage.example.org" \
  -H "Content-Type: application/json" \
  -d '{"email":"direction@garage.example.org","motDePasse":"replace-me"}' \
  https://garage.example.org/api/v1/auth/connexion
```

Vérifiez le corps exact de la requête de connexion dans la description OpenAPI, qui fait référence.

## Listes et pagination

Les listes utilisent une pagination par curseur :

- `limite` : nombre d'éléments à renvoyer.
- `curseur` : le curseur pour obtenir la page suivante. Prenez-le dans le champ `curseurSuivant` de la réponse précédente. Ne construisez jamais un curseur vous-même.

Une réponse de liste contient trois champs : `donnees` (les éléments), `curseurSuivant` (le curseur suivant, ou `null` sur la dernière page) et `limite`.

## Erreurs

Les erreurs utilisent le format `application/problem+json`. Lisez d'abord les champs `status` et `type`. Une requête que le rôle n'autorise pas renvoie `403` avec le code `DROIT_INSUFFISANT`.

## Autres conventions

- Les montants sont des entiers en centimes. `1'234.50 CHF` est envoyé sous la forme `123450`.
- Les créations sensibles acceptent une clé d'idempotence, afin qu'une nouvelle tentative ne crée pas de doublon.
- Les dates et heures suivent la norme ISO 8601.

:::caution
L'API ne remplace pas les droits de l'interface web. Une requête que le rôle n'autorise pas renvoie `403`, quel que soit le client. Voir [rôles et droits](roles-and-rights.md).
:::
