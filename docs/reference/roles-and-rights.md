---
title: Roles and rights
description: The nine roles of dmsforall, what each one can do, and where the rights are defined.
---

Every user has one role. The role decides what the user can read, create and change. The rights are defined in one file, `apps/api/src/auth/matrice-droits.ts`, and checked by the API on every request. The web interface hides the actions a role cannot perform, but the API is the authority.

## Roles

| Role             | For                     | Summary                                                                                                                                       |
| ---------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `direction`      | Management              | All rights on the garage: workshop, invoicing, stock (including receiving supplier orders and validating supplier invoices), sales, settings. |
| `admin`          | Technical administrator | Accounts, sites and settings. No rights on money, stock or sales.                                                                             |
| `comptable`      | Accounting              | Payments, accounting exports, reading of invoices and supplier invoices.                                                                      |
| `receptionnaire` | Counter                 | Quotes, invoices and payments. Credit notes up to a ceiling.                                                                                  |
| `vendeur`        | Sales                   | New and used car sales, quotes, invoices and payments.                                                                                        |
| `chef_atelier`   | Workshop manager        | Repair orders and quotes. Drafts documents, but does not issue invoices or credit notes.                                                      |
| `technicien`     | Technician              | Clocks time on repair orders. Reads the documents of the orders. Issues nothing.                                                              |
| `magasinier`     | Parts                   | Stock, reservations, supplier orders, payments at the counter.                                                                                |
| `poste_atelier`  | Workshop terminal       | A shared terminal account for one site. Clocks time with a PIN. No money.                                                                     |

In a small garage without a parts clerk, the owner (`direction`) does the parts clerk's work: stock movements, receiving supplier orders, supplier invoices, returning deposits. `chef_atelier` does not.

The rights of `admin` do not include money, stock or sales, on purpose. Use `direction` to test the business flows.

## Rights by area

The matrix defines the rights for each action, such as creating an invoice, recording a payment, moving stock, or opening the dashboard's financial figures. Some rights depend on the status of the document, for example an issued invoice cannot be changed by anyone.

Check the file for the exact list. It is the source of truth for each release.

## Credit note ceiling

A role that holds `facturation.avoir.plafonne` (today `receptionnaire`) can issue credit notes only up to the ceiling set in the workshop settings. The ceiling is a constraint of the matrix, not a role check in the code.

## Workshop terminals

`direction` and `admin` create, deactivate and reset workshop terminals (`socle.borne.*`, `POST /api/v1/bornes`). The server generates the terminal's login and password and shows the password once. PINs are per technician and are managed separately.

## What the web interface receives

`GET /api/v1/auth/moi` returns the sorted list of actions the role holds (`actions`). A test (`apps/web/src/droits.parite.spec.ts`) checks that the web's own rights files give the same answers as the matrix.

## Sites

A user can have access to all sites of the garage, or to one site. The workshop terminal always has one site.

## Changing a role

When a person leaves the garage, deactivate their account rather than deleting it. The audit trail refers to the account, so it must stay in place.
