---
title: Contribuer à dmsforall
description: Comment préparer un environnement de développement, lancer les contrôles et soumettre une modification à la revue.
---

Le guide complet est [CONTRIBUTING.md](https://github.com/selfhostr/dmsforall/blob/main/CONTRIBUTING.md) dans le dépôt. Cette page en donne la version courte, ainsi que les liens utiles pour la documentation.

## Préparer un environnement de développement

```sh
cp .env.example .env
pnpm install
pnpm docker:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm docker:*` pilote `docker-compose.dev.yml`, qui utilise le nom de projet Compose `dmsforall-dev`. Il ne démarre que PostgreSQL et Valkey. Ajoutez `--profile containers` pour faire tourner toute la pile de développement dans des conteneurs.

L'API tourne sur le port 3000 et l'interface web sur le port 5173. Les comptes de démonstration sont listés dans le guide de contribution.

## Avant d'ouvrir une demande de fusion

Lancez ces contrôles dans cet ordre :

```sh
pnpm --filter @dfa/shared build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm --filter @dfa/web i18n:check
pnpm test
```

## Soumettre une modification

1. Créez une branche depuis `dev`, avec un nom tel que `feat/nom`, `fix/nom` ou `docs/nom`.
2. Rédigez les messages de commit selon Conventional Commits, et signez chaque commit avec `git commit -s`.
3. Ouvrez une demande de fusion vers `dev`. Un seul sujet par demande.

## Garder la documentation juste

La documentation fait partie de la modification. Lorsque vous changez un comportement, mettez à jour la page qui le décrit, et relisez la page entière, pas seulement le paragraphe modifié.

Les pages de documentation sont rédigées en anglais, puis traduites. Les chaînes de l'interface sont d'abord en français, puis en allemand et en italien.

## Architecture et décisions

- [Architecture](https://github.com/selfhostr/dmsforall/blob/main/ARCHITECTURE.md) : composants, domaines et conventions.
- [Design](https://github.com/selfhostr/dmsforall/blob/main/DESIGN.md) : couleurs, typographie, densité et règles d'accessibilité. En français.
- [Registres de décisions](adr/) : les décisions qui façonnent le code.
