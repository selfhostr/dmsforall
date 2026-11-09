# ADR 0002 : secrets TOTP chiffrés avec pgcrypto

Cette décision a été acceptée le 27.08.2026 par @laupernoe. Elle fixe la manière dont les secrets TOTP sont protégés au repos.

## Contexte

Deux fonctionnalités ont besoin de la même décision : le second facteur pour le personnel des garages, et la connexion à la console d'exploitation. La console est construite (migration 0048, le pool `dfa_console`, cinq fonctions `SECURITY DEFINER`, un écran dédié), mais la connexion ne peut pas être atteinte tant qu'une question n'est pas tranchée : comment protéger le secret TOTP stocké dans `exploitation.exploitant.totp_secret_chiffre`.

Tant que la question n'est pas tranchée, le parc de garages ne peut être administré que par SQL, et aucun second facteur ne peut être proposé.

## Décision

Chiffrement à l'intérieur de PostgreSQL, avec `pgcrypto`.

## Condition qui rend cette décision valable

La clé ne doit jamais être stockée dans la base de données, ni dans la configuration du serveur PostgreSQL. Elle est fournie à la requête au moment du chiffrement et du déchiffrement, depuis la configuration de l'application.

Sans cette condition, la décision perd l'essentiel de sa valeur : une clé stockée à côté des données qu'elle protège ne protège rien. Avec elle, l'accès en lecture à la base (sauvegarde, réplica, export) ne suffit pas à retrouver les secrets.

## Pourquoi

Moins de pièces mobiles qu'un gestionnaire de secrets externe, qui ajouterait une dépendance opérationnelle que rien d'autre dans le produit ne justifie encore.

Le risque habituel de cette approche, « une sauvegarde volée contient tout », est déjà réduit : les sauvegardes sont chiffrées avec `age`, donc une sauvegarde volée n'est pas lisible en clair. Le chiffrement `pgcrypto` est une seconde couche, pas la seule.

## Coûts

La rotation de la clé est manuelle et impose de rechiffrer les secrets existants. À l'échelle actuelle, quelques opérateurs puis quelques centaines de garages, c'est acceptable. À réévaluer si le nombre de secrets rend la rotation impraticable.

## Écartées

- **Une variable d'environnement dédiée**, comme la clé `age`. Elle est cohérente avec la configuration existante, mais elle laisse tout le déchiffrement à l'application.
- **Un gestionnaire de secrets** (SOPS, Vault, service d'un hébergeur). L'option la plus robuste, écartée pour ne pas ajouter un composant opérationnel injustifié aujourd'hui.
- **Reporter le TOTP.** Écarté, car la console resterait inaccessible sans date fixée.
