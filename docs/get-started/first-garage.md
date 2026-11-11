---
title: Set up your first garage
description: Create the first garage account, then the sites, users and invoicing settings a garage needs before its first invoice.
---

At the end of this page, the garage has its first account, its sites, its staff accounts and the invoicing settings needed to issue a first invoice.

## 1. Create the garage

A new installation has no account. The first start of the API draws a one-time installation code and prints it in its logs. The web interface asks for it on its first screen.

1. Read the installation code in the API logs:

   ```sh
   docker compose logs api
   ```

   Look for the block that says `Installation code`, followed by a code like `K7QM-3XRB-9TNA`.

2. Open `https://<server address>:8443` (the address of your installation, or `DFA_PUBLIC_URL` behind a reverse proxy). On a new installation the browser shows **Create your garage** instead of the sign-in page. Enter the garage name, your first and last name, your e-mail address, a password typed twice (at least 12 characters) and the installation code.

3. Select **Create my garage**. You are signed in as the `direction` account, and the setup assistant opens.

Result: the garage exists with its site (named after the garage), its `direction` account and an audit line. It also gets its workshop settings, an hourly rate `ATELIER` (CHF 140.00) and eight appointment reasons (service, tyres, MFK inspection, brakes, diagnosis, bodywork, air conditioning, other), so it can take appointments on day one. All of it can be changed in the settings. The setup assistant guides you through the address, bank details, VAT, hourly rate and staff of the garage, with default values.

The installation code protects a new installation that is reachable from the internet before its owner arrives: only someone who can read the server logs can create the first garage. The code works once. A new code is drawn each time the API starts while no garage exists, and it stops working as soon as a garage exists. Only a salted hash of it is stored in the database. If you lost it, run `docker compose restart api` and read the logs again. The screen refuses with these codes:

- `INSTALLATION_CODE_INVALIDE` (403): the code is wrong or out of date;
- `INSTALLATION_DEJA_FAITE` (409): a garage already exists on this installation. Sign in instead;
- `AUTH_TROP_DE_TENTATIVES` (429): too many attempts. Wait, then try again;
- `MOT_DE_PASSE_FAIBLE` (inside a 400 `VALIDATION_ECHOUEE`): the password is too weak, too common, too predictable, or it contains the e-mail address.

### Alternative: the command line

To create the garage without the browser, run one command. It does exactly the same as the screen (same site, hourly rate and appointment reasons) and does not need the installation code, because it runs on the server:

```sh
docker compose exec api node dist/cli/creer-garage.js --garage "Garage Exemple" --email direction@example.ch
```

Optional: `--first-name X` and `--last-name Y`. Run with `--help` for the full usage.

In development, run the same command from the repository root. It reads `DATABASE_URL_MIGRATION` from the root `.env`, like the API:

```sh
pnpm --filter @dfa/api exec tsx src/cli/creer-garage.ts --garage "Garage Exemple" --email direction@example.ch
```

The password is read from the variable `DFA_PREMIER_MOT_DE_PASSE`. If it is not set, the command asks for it without echo. The interactive prompt has not been tested yet.

The command exits with status 1 and one of these codes:

- `MOT_DE_PASSE_FAIBLE`: the password is too weak. The message says why: too common, too predictable, or it contains the e-mail address;
- `GARAGE_EXISTANT`: a garage with this name already exists;
- `COURRIEL_EXISTANT`: the e-mail address is already used.

Result: the account can sign in on the web interface at the address of your installation (`https://<server address>:8443`, or `DFA_PUBLIC_URL` behind a reverse proxy). Signing in from another address than `DFA_PUBLIC_URL` returns `AUTH_ORIGINE_REFUSEE`. After the first sign-in, the setup assistant guides you through the address, bank details, VAT, hourly rate and staff of the garage, with default values.

The demo seed (`pnpm db:seed`) does not run with `NODE_ENV=production`. Do not use it on a server that holds real data.

## 2. Create the sites

Open the settings for sites and create one entry per workshop, counter or showroom. Each piece of data (clients, vehicles, orders, stock) belongs to one site.

## 3. Invite the staff

Open the settings for users and create one account per person. Choose the role that matches the work of the person. See [roles and rights](../reference/roles-and-rights.md).

For a shared workshop terminal, create an account with the role `poste_atelier` and attach it to one site.

## 4. Complete the invoicing settings

Fill in the company name and address, the VAT number and regime, the bank details, and the creditor block. The creditor block is copied onto each invoice when it is issued.

An invoice can be issued without a complete creditor block, for example when it is paid in cash. It then has no QR-bill, and the application warns you. Fill in the creditor block before you send invoices that must be paid by transfer.

## 5. Issue a test document

Create a test client and a quote, issue it, and check the PDF.

:::caution
An issued document is locked. Correct it with a credit note only. Use a test client for this step.
:::
