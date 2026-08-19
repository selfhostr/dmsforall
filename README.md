dmsforall (DFA)
===============

DMS pour garages et concessions suisses. 100% navigateur, multi-tenant,
hébergé en Suisse (nLPD).

Démarrage rapide
----------------

```bash
cp .env.example .env
pnpm install
pnpm docker:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

API : http://localhost:3000 — Interface web : http://localhost:5173

Comptes de démonstration
------------------------

Tous les comptes utilisent le mot de passe : Demo1234!Garage

- admin@garage-martin.ch — gestion technique (comptes, sites, paramètres).
  Aucun droit financier.
- direction@garage-martin.ch — tous les droits (atelier, facturation, stock,
  ventes).
- comptable@garage-martin.ch — encaissement, paiements, export fiduciaire.
- receptionniste@garage-martin.ch — comptoir (devis, factures, encaissement).
- chef.atelier@garage-martin.ch — OR, constat, devis, validation.
- technicien@garage-martin.ch — pointage (lecture montants masquée).
- magasinier@garage-martin.ch — stock pièces (mouvements, réservations).
- vendeur@garage-martin.ch — ventes VN/VO (dossiers, reprises, financement).
- borne.atelier@garage-martin.ch — poste atelier, pointage tactile par PIN.

Utiliser direction@ pour tester la facturation. admin@ n'a aucun droit
financier.

Vérifier
--------

```bash
docker compose ps          # Postgres et Redis doivent être "healthy"
curl http://localhost:3000/api/docs    # Documentation OpenAPI (Swagger)
```

Interface web : ouvrir http://localhost:5173 dans le navigateur.

Avant de conclure ou pousser
-----------------------------

Exécuter cette passe de vérification (dans cet ordre) :

```bash
pnpm --filter @dfa/shared build
pnpm typecheck && pnpm lint && pnpm format:check
pnpm --filter @dfa/web i18n:check && pnpm test
```

Pourquoi ? Modifier packages/shared sans reconstruire fait typechecker l'API
contre un dist/ périmé — compilation réussit mais échoue à l'exécution.

Repartir de zéro
----------------

```bash
pnpm docker:reset && pnpm db:migrate && pnpm db:seed
```

Pièges connus
-------------

- docker compose down -v est obligatoire après modification de
  docker/postgres/init/01-roles.sql (réinitialise le volume Postgres).

- pnpm api:openapi entre en conflit avec pnpm dev — ne jamais lancer
  les deux en même temps (conflit de dossier de compilation).

- Interface web : un seul .env à la racine. Vite y cherche VITE_* là,
  jamais dans apps/web/.env.

- import type est interdit en API : convertir un import de classe injectée
  en import type casse l'injection de dépendance à l'exécution.

Commandes
---------

- pnpm dev — API + interface web avec hot-reload
- pnpm dev:api — API seule (:3000)
- pnpm dev:web — Interface web seule (:5173)
- pnpm build — build production
- pnpm typecheck — vérifier TypeScript
- pnpm lint — linter
- pnpm test — tests unitaires
- pnpm test:integration — tests d'intégration (Postgres)
- pnpm db:migrate — appliquer migrations
- pnpm db:seed — charger données de démo
- pnpm api:openapi — exporter schéma OpenAPI
- pnpm web:types — générer types frontend
- pnpm docker:reset — repartir de zéro

Conventions essentielles
------------------------

Avant de coder, lire CONTRIBUTING.md :

- Tous les montants en centimes (entiers).
- Multi-tenant : tenant_id NOT NULL + RLS partout.
- Types frontend générés depuis OpenAPI, jamais à la main.
- i18n FR/DE/IT dès le départ.
- Français : code, commentaires, documentation.

Travail à deux
--------------

Branche de fonctionnalité : git switch -c feat/<nom> depuis dev. PR contre dev.

```bash
git push -u origin feat/<nom>
```

Puis ouvrir une pull request depuis http://forge.example.org/owner/dmsforall
(créer une PR vers la branche dev). Avec la CLI forge (tea), la commande
équivalente est : tea pr create --base dev

Règles : périmètre disjoint (un répertoire = un propriétaire), points de
contact négociés avant le code.

Structure du dépôt
------------------

- apps/ — API (NestJS), interface web (React).
- packages/ — Modules partagés (contrats TypeScript, types métier).
- notes de travail — Idées et chantiers restants, par domaine.

Documentation, guides de démarrage et spécifications techniques :
http://forge.example.org/owner/dmsforall/wiki

Ressources
----------

- ARCHITECTURE.md — Source de vérité
- CONTRIBUTING.md — Conventions de code
- Wiki : http://forge.example.org/owner/dmsforall/wiki — Spécifications,
  guides utilisateur, documentation légale.
