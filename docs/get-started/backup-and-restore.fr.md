---
title: Sauvegarder et restaurer
description: Activer la sauvegarde nocturne chiffrée de la base et des fichiers téléversés, faire un dump manuel, et ce qui a et n'a pas été prouvé concernant la restauration.
---

À la fin de cette page, vous savez activer la sauvegarde nocturne, faire un dump à la main, et connaître l'état de la restauration.

:::caution
La copie hors site n'a pas été testée. Conservez une seconde copie hors du serveur, et vérifiez-la vous-même.
:::

## Activer la sauvegarde nocturne

La sauvegarde tourne dans le profil `backup`. Chaque nuit, elle écrit des fichiers chiffrés dans le volume `dmsforall_dfa_postgres_backups`. Chaque nuit produit trois fichiers portant le même horodatage :

| Fichier                              | Contenu                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `dfa_<timestamp>.dump.age`           | La base : schéma et données.                                                                    |
| `dfa_<timestamp>.roles.sql.age`      | Les rôles de la base, avec leurs mots de passe actuels.                                         |
| `dfa_<timestamp>.uploads.tar.gz.age` | Les fichiers téléversés et générés : PDF de factures, photos des ordres de réparation, exports. |

Les trois fichiers sont chiffrés avec la même clé `age`, tournent ensemble (7 quotidiennes, 4 hebdomadaires, 12 mensuelles) et sont copiés hors site ensemble lorsque `RCLONE_REMOTE` est renseigné. L'archive des fichiers est complète chaque nuit, et non incrémentale : elle a à peu près la taille des fichiers une fois compressés (les photos se compressent à peine), et le volume conserve jusqu'à 23 copies. Dimensionnez le volume en conséquence.

1. Ajoutez une clé publique `age` dans `.env` :

   ```sh
   AGE_CLE_PUBLIQUE=age1...
   ```

2. Démarrez le profil :

   ```sh
   docker compose --profile backup up -d
   ```

Gardez la clé privée `age` hors de ce serveur. Sans elle, les sauvegardes ne peuvent pas être lues. La sauvegarde tourne à partir de l'image publiée `ghcr.io/selfhostr/dmsforall-backup` : le serveur n'a donc pas besoin d'un clone du dépôt. Le script de restauration `restaurer.sh` fait exception : récupérez-le dans le dépôt, ou depuis un clone sur la machine où vous restaurez.

L'heure de sauvegarde se règle avec `HEURE_SAUVEGARDE` (par défaut `03:15`), et le fuseau horaire avec `DFA_TIMEZONE` (par défaut `UTC`).

## Faire un dump à la main

Pour une copie ponctuelle de la base, utilisez `pg_dump` dans le conteneur PostgreSQL :

```sh
docker compose exec postgres pg_dump -U dfa -Fc dfa > dfa-$(date +%Y%m%d).dump
```

Stockez le fichier chiffré et hors du serveur.

## Ce qui est sauvegardé

Le conteneur de sauvegarde monte les volumes de téléversement en lecture seule sous `/uploads` et archive tout ce qu'il y trouve :

- `dmsforall_dfa_api_uploads` : factures et autres documents PDF.
- `dmsforall_dfa_photos_or` : photos des ordres de réparation et leurs miniatures.
- `dmsforall_dfa_exports_resiliation` : les exports remis à un garage qui quitte le service. Ils peuvent contenir toutes les données d'un garage et ne peuvent pas toujours être régénérés une fois le garage parti.
- `dmsforall_dfa_reprise` : les archives téléversées pour reprendre les données du logiciel précédent. Elles sont la source de la reprise et ne peuvent pas être régénérées.

Un nouveau volume de téléversement ajouté au service `api` dans `docker-compose.yml` n'est pas sauvegardé tant que vous ne le montez pas aussi, en lecture seule, sous `/uploads/` dans le service `backup`.

L'archive est écrite en flux (`tar` vers `age`) : aucun fichier en clair n'est écrit sur le disque. La sauvegarde échoue, et `dernier-statut.txt` indique `ECHEC`, si l'archive ne peut pas être écrite ou si `/uploads` manque.

## Ce qui n'est pas sauvegardé

- Les données de Valkey. Les files d'attente et l'état de courte durée sont recréés.
- Les mots de passe de base générés et la clé de chiffrement (volume `dmsforall_dfa_secrets`), ainsi que les certificats TLS (volume `dmsforall_dfa_caddy_data`). Le fichier de rôles de la sauvegarde contient les mots de passe de la base. La clé de chiffrement protège les mots de passe d'envoi que les garages ont enregistrés dans l'application : sans elle, ils doivent être saisis de nouveau. Gardez une copie de la clé en lieu sûr :

  ```sh
  docker compose run --rm --no-deps --entrypoint cat api /secrets/secrets_key
  ```

- Les fichiers d'un répertoire de téléversement qui n'est pas un volume monté. Ils vivent dans le conteneur et sont perdus lorsqu'il est recréé.

## Restaurer

Une restauration ramène la base à l'heure de la sauvegarde. Tout ce qui a été écrit depuis cette sauvegarde est perdu.

1. Arrêtez les services `api` et `worker`, pour que rien n'écrive plus dans la base.
2. Restaurez le dump dans une base vide, sur une machine séparée, et vérifiez le résultat.
3. Ensuite seulement, restaurez sur le serveur de production. Une restauration complète sur une installation neuve a été prouvée.

`restaurer.sh` restaure ensemble la base et les fichiers, à condition que le fichier `.uploads.tar.gz.age` soit à côté du fichier `.dump.age` :

```sh
AGE_CLE_PRIVEE_FICHIER=/path/to/age.key \
  docker/postgres/sauvegarde/restaurer.sh /path/to/dfa_20260101-031500.dump.age dfa --confirmer
```

- `--base-seule` restaure la base seule.
- `--fichiers-seuls` restaure les fichiers seuls. Passez `-` comme nom de base.

Les fichiers sont extraits dans les volumes du service `api`. Un fichier de même nom est écrasé, et un fichier absent de l'archive est laissé en place. Les fichiers ne sont restaurés que si la base cible est `dfa` : un essai de restauration dans une autre base laisse les fichiers en service intacts.

Le test de restauration mensuel (`restaurer-test.sh`) déchiffre et lit l'archive complète des fichiers. Il n'a pas encore été exécuté sur une vraie archive dans les tests automatisés : lancez-le à la main une fois après avoir activé la sauvegarde.

:::caution
`restaurer.sh` exige `age` sur l'hôte, avec la clé privée. La pile doit déjà tourner avant la restauration.
:::
