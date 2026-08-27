# ADR 0002 — Secrets TOTP : chiffrement par pgcrypto

Date : 27.08.2026 · Statut : accepté · Tranché par : @laupernoe

## Contexte

Deux fonctionnalités attendent la même décision : le **second facteur des garagistes** et la
**connexion à la console d'exploitation**. Cette dernière est construite — migration 0048, pool
`dfa_console`, cinq fonctions `SECURITY DEFINER`, écran dédié — mais reste **inatteignable** :
`exploitation/service-session-exploitant.ts:23` indique qu'aucun endpoint de connexion n'existe,
faute d'avoir tranché comment protéger `exploitation.exploitant.totp_secret_chiffre`.

Tant que la décision manque, on ne peut ni administrer le parc de garages autrement que par SQL,
ni proposer un second facteur.

## Décision

**Chiffrement dans PostgreSQL par `pgcrypto`.**

## Condition qui fait tenir cette décision

**La clé ne doit jamais être stockée en base ni dans la configuration du serveur PostgreSQL.**
Elle est fournie à la requête au moment du chiffrement et du déchiffrement, depuis la
configuration de l'application.

Sans cette condition, la décision perd l'essentiel de sa valeur : une clé rangée à côté des
données qu'elle protège ne protège rien. Avec elle, un accès en lecture à la base — sauvegarde,
réplique, dump — ne suffit pas à retrouver les secrets.

## Pourquoi

Moins de pièces mobiles qu'un gestionnaire de secrets externe, qui ajouterait une dépendance
d'exploitation que rien d'autre dans le produit ne justifie aujourd'hui.

Le risque classique de cette approche — « une sauvegarde volée emporte tout » — est déjà atténué
indépendamment : **les sauvegardes sont chiffrées avec `age`** (`docker/postgres/sauvegarde/`),
donc une sauvegarde dérobée n'est pas exploitable en clair. Le chiffrement pgcrypto est une
seconde couche, pas la seule.

## Ce que ça coûte

La rotation de clé est manuelle et demande de rechiffrer les secrets existants. À l'échelle
actuelle — quelques exploitants, puis quelques centaines de garagistes — c'est acceptable. À
réévaluer si le nombre de secrets rend une rotation impraticable.

## Écarté

- **Variable d'environnement dédiée**, comme la clé `age` — cohérent avec l'existant, mais laisse
  le déchiffrement entièrement côté application.
- **Gestionnaire de secrets** (SOPS, Vault, service de l'hébergeur) — le plus solide, écarté pour
  ne pas ajouter une brique d'exploitation aujourd'hui injustifiée.
- **Reporter le TOTP** — écarté : la console restait alors inatteignable sans échéance.
