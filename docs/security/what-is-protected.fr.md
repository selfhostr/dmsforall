---
title: Ce qui est protégé et ce qui ne l'est pas
description: Les mesures de sécurité que dmsforall fournit, celles qu'il ne fournit pas, et ce que l'exploitant doit faire.
---

Cette page énumère les protections que dmsforall fournit dans le code, les lacunes qui subsistent dans cette version, et ce que vous devez mettre en place vous-même. Lisez-la avant de mettre de vraies données sur un serveur.

## Ce que dmsforall protège

**Séparation entre garages.** Chaque garage est un locataire. Chaque table locataire possède une colonne `tenant_id` et la sécurité au niveau des lignes (row-level security) de PostgreSQL. L'API restreint en plus chaque requête au locataire de l'utilisateur connecté. Le locataire vient de la session, jamais d'un paramètre de requête. L'API se connecte avec un rôle soumis à la sécurité au niveau des lignes, et les migrations utilisent un rôle différent.

**Mots de passe et connexion.** Les mots de passe sont hachés avec Argon2id. Les tentatives de connexion sont limitées par adresse IP et par compte. Après plusieurs mots de passe erronés, le compte est bloqué pendant un certain temps. La réinitialisation du mot de passe se fait avec un jeton envoyé par e-mail.

**Sessions.** Le cookie de session est inaccessible au JavaScript (HTTP-only). Il est marqué `Secure` par défaut, et la configuration de production refuse de démarrer si cette option est désactivée. L'API vérifie l'en-tête `Origin` des requêtes qui modifient des données.

**Droits.** Chaque route vérifie les droits du rôle dans une seule matrice de droits. Voir [rôles et droits](../reference/roles-and-rights.fr.md).

**Argent.** Les montants sont des entiers en centimes. Une facture émise est verrouillée, et une correction passe par un avoir. La trace d'audit enregistre qui a modifié une entité sensible, quand, et les valeurs avant et après.

**Configuration.** L'API valide chaque variable au démarrage et refuse de démarrer avec une valeur invalide. En production, elle refuse les mots de passe de la base de développement.

**Documentation de l'API.** La documentation OpenAPI est désactivée par défaut. Elle n'est publiée que si `OPENAPI_EXPOSER_DOCS=true`.

**Lieu des données.** Tout fonctionne sur votre serveur. dmsforall n'envoie aucune donnée à un service tiers. Le suivi d'erreurs facultatif ne va que vers le serveur compatible Sentry que vous indiquez dans `SENTRY_DSN`.

## Ce que dmsforall ne protège pas

- **Second facteur pour les comptes des garages.** L'authentification à deux facteurs (TOTP) n'est pas disponible pour les comptes du personnel des garages dans cette version. La console d'exploitation, que les garages n'utilisent pas, exige un second facteur. Utilisez des mots de passe longs et uniques pour tous les comptes.
- **Chiffrement au repos.** Les volumes nommés Docker ne sont pas chiffrés par Docker. Chiffrez le disque ou la partition qui contient le répertoire de données Docker.
- **Sauvegardes hors site.** La sauvegarde nocturne est chiffrée, mais elle reste sur le même serveur tant que vous n'avez pas configuré une copie hors site. Une sauvegarde sur le même disque ne protège pas contre la perte du serveur. Voir [Sauvegarder et restaurer](../get-started/backup-and-restore.md).
- **Le cache des PDF.** Il n'est pas sauvegardé. Il est régénéré à partir de la base de données.
- **Le serveur lui-même.** Le système d'exploitation, l'hôte Docker, ses utilisateurs et ses mises à jour relèvent de votre responsabilité.
- **Accès à la base de données.** Toute personne qui connaît le mot de passe du superutilisateur PostgreSQL peut lire toutes les données. Conservez ce mot de passe séparément des mots de passe des applications.
- **Sécurité côté client.** Un navigateur laissé déverrouillé donne accès au compte connecté. Définissez des durées de session adaptées à votre personnel. Voir les variables `SESSION_*` dans la [référence de configuration](../reference/configuration.md).
- **Limites de débit derrière un proxy.** Les limites utilisent l'adresse IP du client. Si `TRUST_PROXY_HOPS` est mal réglé, tous les utilisateurs peuvent partager une même limite, ou un client peut falsifier son adresse.

## Ce que vous devez faire

1. Servez dmsforall uniquement en HTTPS, avec un certificat valide.
2. Remplacez tous les mots de passe de développement avant le premier démarrage. Utilisez un gestionnaire de mots de passe.
3. Réglez `TRUST_PROXY_HOPS` sur le nombre de proxies inverses placés devant l'API.
4. Gardez `OPENAPI_EXPOSER_DOCS=false` et `COOKIE_SECURE=true` en production.
5. Fermez tous les ports sauf 80 et 443 au niveau du pare-feu.
6. Gardez le serveur, Docker et les images à jour. Voir [Mettre à jour](../operations/upgrading.md).
7. Testez régulièrement la restauration de vos sauvegardes.
8. Vérifiez les rôles de votre personnel au moins une fois par an, et désactivez les comptes des personnes qui quittent l'entreprise.

Pour signaler une vulnérabilité, suivez [SECURITY.md](https://github.com/selfhostr/dmsforall/blob/main/SECURITY.md). N'ouvrez pas de ticket public.
