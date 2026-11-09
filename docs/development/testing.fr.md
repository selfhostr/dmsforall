---
title: Tester dmsforall
description: Lancer les tests unitaires, les tests d'intégration, un seul fichier de test et le contrôle de réversibilité des migrations.
---

À la fin de cette page, vous pouvez lancer toute la suite de tests, un seul fichier de test, et les tests d'intégration sur une base jetable.

## Tests unitaires

```sh
pnpm test
```

Cette commande lance les tests unitaires de chaque paquet. Vitest ne vérifie pas les types : lancez aussi `pnpm typecheck`.

## Un seul fichier de test

```sh
pnpm --filter @dfa/api exec vitest run --project unitaire apps/api/src/facturation/documents/numerotation.spec.ts
```

Pour lancer un seul test par son nom, ajoutez `-t` avec un fragment du nom :

```sh
pnpm --filter @dfa/api exec vitest run --project unitaire -t "fragment du nom" apps/api/src/facturation/documents/numerotation.spec.ts
```

Le paquet web n'a pas d'option `--project` :

```sh
pnpm --filter @dfa/web exec vitest run apps/web/src/test/accessibilite/contraste-jetons.spec.ts
```

## Tests d'intégration

```sh
pnpm test:integration
```

Les tests d'intégration démarrent une base PostgreSQL jetable avec testcontainers. Docker doit être lancé. Ils n'utilisent jamais votre base de développement.

Les tests d'intégration ont besoin des programmes `mdbtools` pour les tests sur les archives Access. La CI les installe. Installez-les localement pour lancer l'ensemble des tests.

## Réversibilité des migrations

```sh
scripts/verifier-reversibilite-migrations.sh
```

Le script applique chaque migration, l'annule avec son script inverse, puis la réapplique. La CI l'exécute à chaque modification. Une migration qui ne peut pas être annulée fait échouer le contrôle.

## Règles de test

- L'isolation des locataires, le calcul des montants, les machines à états et la matrice rôle par action doivent être testés.
- Les tests de montants vérifient des valeurs exactes, jamais des approximations.
- Un test d'intégration vérifie la vraie requête, pas une simulation de la couche base de données.
- N'affaiblissez jamais un test pour le faire passer. Corrigez le code, ou modifiez le test pour une raison que la revue accepte.
