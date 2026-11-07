---
title: Roles and rights
description: How rights work in dmsforall - a per-person grid, roles as presets, and where the rights are defined.
---

Each person has a **grid** of rights, not a single exclusive role. The grid sets, for six areas, whether the person sees nothing, can look, or can act. A role (`direction`, `vendeur`...) is only a **preset**: the starting grid given to a new person, which the owner can then adjust. The rights are checked by the API on every request, from the person's grid read from the database. The web interface hides the actions a person cannot perform, but the API is the authority.

## The grid

| Area          | Rien (nothing) | Voir (look)                   | Faire (act)                     |
| ------------- | -------------- | ----------------------------- | ------------------------------- |
| `atelier`     | no access      | repair orders, journal        | start, check, clock time, lines |
| `accueil`     | no access      | clients, vehicles, bookings   | reception, quotes, bookings     |
| `facturation` | no access      | documents, payments           | draft, issue, take payments     |
| `pieces`      | no access      | articles, stock, reservations | stock moves, orders, receiving  |
| `ventes`      | no access      | stock vehicles, deals         | new and used car deals          |
| `finances`    | no access      | dashboard, accounting export  | refunds, corrections, export    |

`faire` includes `voir`. Three more switches sit outside the grid:

- `encadrer` - correct other people's hours, reopen a repair order, lift a block, workshop settings.
- `gererEmployes` ("Employes & reglages") - accounts and workshop terminals. Follows the preset; not editable one switch at a time.
- `patron` - irreversible acts: the creditor IBAN, launching a data takeover, the garage exit. Follows the preset (`direction` only).

Three options per person:

- `voitMontants` - sees prices, totals and amounts. Without it a person cannot use Facturation: Faire, Ventes: Faire or any Finances level, and the invoice PDF (which carries the amount) is refused.
- `voitPrixAchat` - sees purchase prices and margins on parts.
- `avoirsPlafonnes` - credit notes are capped at the ceiling set in the workshop settings. This is a constraint, not a power.

The amounts are removed **by the server** from responses; the switch is read from the person's grid on every request.

## Presets

| Preset           | Role stored      | Summary                                                                                                 |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------- |
| `direction`      | `direction`      | Everything, including `encadrer`, `gererEmployes`, `patron`.                                            |
| `admin`          | `admin`          | Technical administrator: workshop, reception, accounts. No money, stock or sales.                       |
| `comptable`      | `comptable`      | Invoicing and finances; looks at the rest. Reads the creditor block but cannot change the IBAN.         |
| `fiduciaire`     | `comptable`      | External accountant: Facturation and Finances in Voir only, nothing else. Sees amounts, writes nothing. |
| `receptionnaire` | `receptionnaire` | Counter: reception, quotes, invoices, payments. Credit notes capped.                                    |
| `vendeur`        | `vendeur`        | Sales plus invoicing. Credit notes capped.                                                              |
| `chef_atelier`   | `chef_atelier`   | Workshop manager: `encadrer`, parts, invoicing. Credit notes capped.                                    |
| `technicien`     | `technicien`     | Workshop only, no amounts.                                                                              |
| `magasinier`     | `magasinier`     | Parts and counter invoicing, and clocks time. Credit notes capped.                                      |

`fiduciaire` has no value of its own in the `role_utilisateur` enum: it is stored with `role = comptable` and recognised by its grid.

`poste_atelier` is not a preset: it is a **fixed device profile** for a workshop terminal (read repair orders, clock time, identify by PIN). Its grid is ignored.

No person loses a right in the move from roles to presets. A test (`apps/api/src/auth/matrice-droits.spec.ts`) checks, for every action and every role, that the preset holds at least the old rights, and pins every right added.

## How an action maps to the grid

Each of the ~170 actions (`apps/api/src/auth/matrice-droits.ts`, the labels on the routes) is attached to one or two internal capacities in `apps/api/src/auth/capacites-actions.ts`. A person holds the action when their grid grants one of them. The table is typed `Record<Action, ...>`: an action that is not classified does not compile. `MATRICE_DROITS[role]` is now only the list of actions of that role's preset.

## Separation of duties

A "Faire" level alone does not give every action of its area. A person who runs the parts stock (Pieces: Faire) without any commercial authority (no Ventes: Faire, no Finances: Faire) cannot check their own work on a repair order, issue quotes, invoices or credit notes, and cannot validate supplier invoices; a workshop manager (`encadrer`) in that position can issue quotes and check orders, but does not take payments, issue invoices or credit notes, hold the stock movements or validate supplier invoices. These rules live in `capacitesDeLaGrille` (`packages/shared/src/contrats/capacites.ts`).

## Who can change a grid

`PATCH /api/v1/utilisateurs/{id}/capacites` and the role change need the right `socle.utilisateur.modifier` (Employes & reglages). On top of that:

- you cannot change your own grid or role, nor reset or reactivate your own account through the employee routes;
- deactivating, reactivating and resetting the access of someone follow the same rules as changing their grid (a weaker person cannot take over, or suspend, a stronger one);
- you cannot grant what you do not hold yourself (the API names the offending field);
- you cannot change someone who holds more than you; only an `admin` can change an `admin`;
- `admin` (the integrator) can assign any business preset, so it can create the first owner of a garage;
- the last active `patron` cannot be demoted or deactivated (checked under a per-garage lock, so two simultaneous demotions cannot remove both);
- changes are audited (before and after); the sessions of a person whose rights go down are revoked.

## Credit note ceiling

A person with the `avoirsPlafonnes` option can issue credit notes only up to the ceiling set in the workshop settings.

## Workshop terminals

People with `gererEmployes` create, deactivate and reset workshop terminals (`socle.borne.*`, `POST /api/v1/bornes`). The server generates the terminal's login and password and shows the password once. PINs are per technician and are managed separately.

## What the web interface receives

`GET /api/v1/auth/moi` returns the sorted list of actions the person holds (`actions`) and their grid (`capacites`, with `prereglage` and `personnalisee`). `GET /api/v1/capacites/modele` returns the areas, levels, options and presets with i18n keys, to draw the "who can do what" screen.

## Sites

A user can have access to all sites of the garage, or to one site. The workshop terminal always has one site.

## Changing a role

Changing the role of a person applies the preset of the new role and replaces their grid (the audit keeps the old one). To reset a customised grid, apply the preset again. When a person leaves the garage, deactivate their account rather than deleting it. The audit trail refers to the account, so it must stay in place.
