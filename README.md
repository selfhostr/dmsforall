<div align="center">

<img src="docs/assets/logo.svg" width="96" alt="dmsforall logo">

# dmsforall

**Self-hosted management software for Swiss garages and dealerships: repair orders, invoices with QR-bill, parts, time clocking and used car sales.**

[![CI](https://github.com/selfhostr/dmsforall/actions/workflows/ci.yml/badge.svg)](https://github.com/selfhostr/dmsforall/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-dmsforall.selfhostr.io-F07E17)](https://dmsforall.selfhostr.io/docs/)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/selfhostr/dmsforall/badge)](https://scorecard.dev/viewer/?uri=github.com/selfhostr/dmsforall)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

> [!WARNING]
> Development is paused for now. The code, images and docs stay available, but do not expect new features or quick fixes.

## Overview

- **One app for the workshop and the counter.** Clients, vehicles, repair orders (OR), appointments, time clocking, parts stock, quotes, invoices and payments run in one browser application.
- **Built for Swiss garages.** Invoices carry a Swiss QR-bill reference, VAT is calculated per line, amounts are stored as whole centimes, and the interface is available in French, German and Italian.
- **Runs on your server.** Each installation is a Docker stack. PostgreSQL row-level security keeps each garage's data apart, and the API describes its endpoints in OpenAPI.

Free, for good. MIT licence, no paid edition.

Try the [public demo](https://dmsforall.selfhostr.io/demo/) in your browser. It runs on made-up data and nothing leaves your browser.

## Quick start

You need Docker with Compose v2.

```sh
git clone https://github.com/selfhostr/dmsforall.git && cd dmsforall
cp .env.example .env   # optional for a first try on localhost
docker compose up -d
```

Open http://localhost:8080 in your browser. The first start generates the database passwords, applies the migrations, then starts the API. Create the first garage account with `docker compose exec api node dist/cli/creer-garage.js --garage "Garage Exemple" --email direction@example.ch`, then sign in. In development, run `pnpm --filter @dfa/api exec tsx src/cli/creer-garage.ts --garage "Garage Exemple" --email direction@example.ch` instead.

For a server with a domain name and HTTPS, set `DFA_SITE_ADDRESS` and `DFA_PUBLIC_URL` in `.env`, then read [Install on a server](https://dmsforall.selfhostr.io/docs/get-started/installation/). Set up backups before you enter real data: [Back up and restore](https://dmsforall.selfhostr.io/docs/get-started/backup-and-restore/).

## What it does

- **Clients and vehicles**: client records, contacts, vehicles with their owner history, and a global search.
- **Workshop**: repair orders with labour, parts and fee lines, statuses from planned to closed, appointments, and a courtesy car list.
- **Time clocking**: technicians clock their time on repair orders, from a shared workshop terminal protected by a PIN.
- **Invoicing**: quotes, purchase orders, invoices, down-payment invoices and credit notes, with a Swiss QR-bill and PDF output.
- **Payments**: cash, card, bank transfer, QR-bill, TWINT, compensation and leasing, recorded per document.
- **Parts and stock**: articles, stock per site, stock movements, reservations on repair orders, supplier orders and supplier invoices.
- **Used and new car sales**: vehicle stock, sales files, trade-ins, and financing or leasing confirmation.
- **Tyre storage**: seasonal tyre sets kept in storage, flagged for recall when they have not moved for a while.
- **Reminders**: automatic reminders for overdue invoices, sent by e-mail.
- **Data import**: import of a garage's existing database from a Microsoft Access or dBase/FoxPro archive, with a plan to review before anything is written.
- **Dashboard**: workshop activity and, for management and accounting roles, financial figures.
- **Accounting export**: WinBIZ export of invoices and payments.

## Architecture

The web interface is a React single-page application built with Vite. It calls a NestJS API, which publishes an OpenAPI description. The API stores data in PostgreSQL 16 through Drizzle ORM, with row-level security on tenant tables. Redis and BullMQ run background jobs. In the production stack, Caddy receives the public requests and forwards them to the web and API containers.

## Limits

- The interface exists in French, German and Italian only.
- dmsforall is designed for Swiss law and VAT: QR-bill invoices, amounts in CHF centimes. It is not designed for other countries.
- The light and dark themes belong to the application design. No other theme is provided.
- The project is in alpha. The data model, the configuration variables and the screens can still change between releases.
- dmsforall gives no tax or legal guarantee. Have invoices, VAT figures and accounting exports checked by a fiduciary before you rely on them.
- Connectors to third-party services, such as a vehicle reference data source or a parts catalogue, need their own licences or accounts.
- The operator is responsible for security: TLS certificates, server access, secrets, backups and updates.

## Status

Alpha. Development is paused for now. The code, images and docs stay available, but do not expect new features or quick fixes. Version `0.1.0` is the first release, and no stable release line exists. Until version 1.0, an upgrade can require manual steps. Read the [changelog](CHANGELOG.md) before each upgrade.

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains the development setup, the checks that CI runs and the project conventions. Report security problems privately, as described in [SECURITY.md](SECURITY.md). The [Code of Conduct](CODE_OF_CONDUCT.md) applies to all project spaces.

## License

MIT, see [LICENSE](LICENSE). The software is provided as is, without warranty of any kind. Third-party notices are in [NOTICE](NOTICE).

## Support dmsforall

dmsforall is free and has no company behind it. If it saves you time, you can support its development:

- **Patreon** (recurring): [patreon.com/selfhostr](https://www.patreon.com/selfhostr)
- **Bitcoin**: `bc1phcqfc46ev9ztpuxyh3fmz6aaktshnz8z4ve9jk7pxdcyu9ks37wqq2kjgd`
- **Ethereum**: `0x67Cd93028943308B8c12782C9ad078D253278f40`
- **Solana**: `63u8bhkf63HBcNYbRRyaHPtfRtSUmbugtwaauzAxHtb3`
