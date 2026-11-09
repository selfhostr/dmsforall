---
title: Dépannage
description: Diagnostiquer les problèmes les plus courants d'une installation de dmsforall, des erreurs de démarrage aux échecs d'envoi d'e-mails, d'OCR et d'import.
---

Commencez par les journaux du service en panne :

```sh
docker compose logs api --tail 100
docker compose ps
```

## L'API ne démarre pas

**Message : `Configuration invalide`.** Le journal liste chaque variable fautive, avec la raison. Corrigez-les une à une dans `.env`, puis relancez `docker compose up -d`. Avec le fichier Compose standard, vous rencontrez rarement cette erreur, car la connexion à la base et les clés sont réglées pour vous.

**Le message indique `COOKIE_SECURE doit être true en production`.** Supprimez la ligne `COOKIE_SECURE=false` de `.env`. Le cookie de session doit être envoyé via HTTPS.

**Le message indique qu'un mot de passe de développement est utilisé.** L'URL de la base contient `dfa_app_dev` ou `dfa_migrator_dev`. Vous avez défini `DATABASE_URL` vous-même avec les mots de passe de développement. Supprimez `DATABASE_URL` et `DATABASE_URL_MIGRATION` de `.env` : la pile les construit à partir de mots de passe générés.

**Le message cite `DATABASE_POOL_MIN`.** Une valeur supérieure à `DATABASE_POOL_MAX` est refusée. Abaissez le minimum, ou augmentez le maximum.

## La connexion échoue

**L'accès web est refusé avec `AUTH_ORIGINE_REFUSEE`.** L'adresse dans votre navigateur ne correspond pas à `DFA_PUBLIC_URL` (par défaut `http://localhost:8080`). Ouvrez le site à cette adresse, ou modifiez `DFA_PUBLIC_URL` et redémarrez la pile.

**Le mot de passe est refusé, et le compte est verrouillé.** Attendez la fin du verrouillage. Des échecs répétés verrouillent le compte pendant un certain temps. La limite se règle avec `SEUIL_VERROUILLAGE_COMPTE`.

**La connexion renvoie `429`.** Trop de tentatives depuis une même adresse, ou trop de tentatives sur un même compte. Attendez la fin de la fenêtre. Si tous les utilisateurs sont bloqués en même temps, `TRUST_PROXY_HOPS` est probablement faux, et tous les utilisateurs partagent une seule adresse.

**La page s'affiche, mais vous restez déconnecté.** Vérifiez que `WEB_URL_PUBLIQUE` et `API_URL_PUBLIQUE` utilisent HTTPS et correspondent aux adresses de votre navigateur. Vérifiez `COOKIE_DOMAINE`, si vous l'avez défini.

## La base est occupée

**Message : `timeout exceeded when trying to connect`.** Toutes les connexions du pool sont utilisées. Cherchez une requête lente dans les journaux, ou augmentez `DATABASE_POOL_MAX` si le serveur a de la marge. Vérifiez aussi la limite `max_connections` de PostgreSQL.

## Les e-mails n'arrivent pas

Chaque garage peut régler son propre serveur d'envoi dans **Réglages > Envoi des e-mails** ; il est utilisé en premier, et l'écran propose un bouton de test. Sans lui, les messages ne partent réellement que si `NODE_ENV=production`, `COURRIEL_ENVOI_REEL=true` et les variables `SMTP_*` sont renseignés. Sinon, les messages sont mis de côté et ne sont pas remis. Vérifiez d'abord ces variables, puis les journaux du service `api` pour l'erreur SMTP.

## L'OCR ne lit pas le permis de circulation

Le service OCR doit tourner et être joignable depuis l'API à l'adresse `OCR_SERVICE_URL`. Si le service est lent, augmentez `OCR_SERVICE_TIMEOUT_MS`. Une erreur qui indique que le service est indisponible signifie que la requête n'a pas été traitée : réessayez.

## L'import de données s'arrête

**L'import s'arrête avec une erreur indiquant que les outils Access sont indisponibles.** Une archive Access a besoin des programmes `mdbtools`. Le conteneur de l'API les contient. Si vous lancez l'API hors du conteneur, installez `mdbtools` sur le serveur.

**L'import signale des enregistrements ignorés.** Lisez la raison donnée pour chaque enregistrement ignoré, dans le plan d'import ou dans le rapport.

## La page est vide après une mise à jour

Vérifiez que le conteneur `web` tourne, et que sa version correspond à celle de l'API. Videz le cache du navigateur, puis rechargez la page. Consultez les journaux du service `web`.

## La migration a échoué

L'API ne démarre pas sur la nouvelle version, et la version précédente continue de tourner. Lisez les journaux du service `migrate`, corrigez la cause dans une nouvelle version, puis relancez la mise à jour. Ne modifiez pas un fichier de migration déjà appliqué.

## Où obtenir de l'aide

Ouvrez une issue sur le [dépôt GitHub](https://github.com/selfhostr/dmsforall/issues) avec la version, les lignes de journal pertinentes et les étapes pour reproduire le problème. Retirez les données personnelles et tout secret avant de coller un journal.
