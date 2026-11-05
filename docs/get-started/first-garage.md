---
title: Set up your first garage
description: Create the first garage account, then the sites, users and invoicing settings a garage needs before its first invoice.
---

At the end of this page, the garage has its first account, its sites, its staff accounts and the invoicing settings needed to issue a first invoice.

Create the garage, its site `PRINCIPAL`, its first `direction` account and an audit line with one command:

```sh
docker compose exec api node dist/cli/creer-garage.js --garage "Garage Exemple" --email direction@example.ch
```

Optional: `--first-name X` and `--last-name Y`.

The password is read from the variable `DFA_PREMIER_MOT_DE_PASSE`. If it is not set, the command asks for it without echo. The interactive prompt has not been tested yet.

The command exits with status 1 and one of these codes:

- `MOT_DE_PASSE_FAIBLE`: the password is too weak;
- `GARAGE_EXISTANT`: a garage with this name already exists;
- `COURRIEL_EXISTANT`: the e-mail address is already used.

Result: the account can sign in on the web interface at `DFA_PUBLIC_URL` (default `http://localhost:8080`). Signing in from another address returns `AUTH_ORIGINE_REFUSEE`.

The demo seed (`pnpm db:seed`) does not run with `NODE_ENV=production`. Do not use it on a server that holds real data.

## 2. Create the sites

Open the settings for sites and create one entry per workshop, counter or showroom. Each piece of data (clients, vehicles, orders, stock) belongs to one site.

## 3. Invite the staff

Open the settings for users and create one account per person. Choose the role that matches the work of the person. See [roles and rights](../reference/roles-and-rights.md).

For a shared workshop terminal, create an account with the role `poste_atelier` and attach it to one site.

## 4. Complete the invoicing settings

Fill in the company name and address, the VAT number and regime, the bank details, and the creditor block. The creditor block is copied onto each invoice when it is issued.

Invoices with a QR-bill cannot be issued without a complete creditor block.

## 5. Issue a test document

Create a test client and a quote, issue it, and check the PDF.

:::caution
An issued document is locked. Correct it with a credit note only. Use a test client for this step.
:::
