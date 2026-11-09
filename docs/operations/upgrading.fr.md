---
title: Mettre à jour dmsforall
description: Mettre à jour une installation de production en sécurité, avec une sauvegarde, les migrations, un contrôle de santé et un plan de retour arrière.
---

À la fin de cette page, votre installation tourne sur la nouvelle version, et vous savez revenir en arrière si quelque chose échoue.

## Avant la mise à jour

1. Lisez le [journal des modifications](https://github.com/selfhostr/dmsforall/blob/main/CHANGELOG.md) de chaque version située entre la vôtre et la nouvelle. Notez toute modification des variables de configuration.
2. Faites une sauvegarde, et vérifiez qu'elle est complète. Voir [Sauvegarder et restaurer](../get-started/backup-and-restore.md).
3. Vérifiez l'espace disque libre. Les migrations et les sauvegardes ont besoin de place.
4. Prévoyez une courte fenêtre, et prévenez votre personnel. Le personnel ne doit pas travailler pendant la mise à jour.

## Mise à jour

Les versions postérieures à la 0.3.0 utilisent Valkey à la place de Redis pour les files d'attente. Rien à changer : le nom de service `redis`, le réglage `REDIS_URL` et le volume `dfa_redis_data` restent identiques, et Valkey relit les fichiers append-only existants. `docker compose pull` récupère la nouvelle image.

1. Renseignez `DFA_VERSION` dans `.env` avec le nouveau tag (ajoutez la ligne si le fichier n'en a pas). Si les notes de version signalent une modification de `docker-compose.yml`, téléchargez d'abord le nouveau fichier depuis la version publiée. Voir [Vérifier les images](../security/verify-images.md).
2. Téléchargez les nouvelles images et redémarrez la pile :

   ```sh
   docker compose pull
   docker compose up -d
   ```

3. Le service `migrate` applique les migrations de la base avant le démarrage de l'API. Vérifiez qu'il s'est terminé sans erreur :

   ```sh
   docker compose ps -a migrate
   ```

4. Contrôlez le point de santé :

   ```sh
   curl -s https://garage.example.org/api/v1/sante
   ```

5. Connectez-vous, et vérifiez un document de chaque domaine que vous utilisez.

## En cas d'échec

- **La migration a échoué.** L'API ne démarre pas sur la nouvelle version, et la version précédente continue de tourner. Lisez les journaux du service `migrate`, corrigez la cause, puis relancez la pile.
- **L'API ne démarre pas.** Lisez les journaux. Une erreur de configuration liste chaque variable fautive. Corrigez la variable, puis redémarrez.
- **La nouvelle version se comporte mal.** Restaurez la sauvegarde faite avant la mise à jour. C'est la façon prise en charge de revenir à l'état précédent.

:::caution
N'exécutez pas les scripts inverses des migrations sur une base qui a reçu de vraies données depuis la mise à jour. Chaque script inverse est testé en développement, mais il peut supprimer des données écrites après la mise à jour. Restaurez la sauvegarde à la place.
:::

:::caution
Ne modifiez jamais un fichier de migration déjà appliqué. Le migrateur vérifie une somme de contrôle (checksum) de chaque fichier, et refuse de s'exécuter si l'un d'eux a changé.
:::
