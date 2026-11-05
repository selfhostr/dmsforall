# ADR 0002: TOTP secrets encrypted with pgcrypto

This decision was accepted on 2026-08-27 by @laupernoe. It fixes how TOTP secrets are protected at rest.

## Context

Two features need the same decision: the second factor for garage staff, and the sign-in to the operator console. The console is built (migration 0048, the `dfa_console` pool, five `SECURITY DEFINER` functions, a dedicated screen), but sign-in cannot be reached until one question is settled: how to protect the TOTP secret stored in `exploitation.exploitant.totp_secret_chiffre`.

Until the question is settled, the fleet of garages can be administered only through SQL, and no second factor can be offered.

## Decision

Encryption inside PostgreSQL, with `pgcrypto`.

## Condition that makes this decision hold

The key must never be stored in the database, nor in the configuration of the PostgreSQL server. It is supplied to the query at encryption and decryption time, from the configuration of the application.

Without this condition, the decision loses most of its value: a key stored next to the data it protects protects nothing. With it, read access to the database (backup, replica, dump) is not enough to recover the secrets.

## Why

Fewer moving parts than an external secrets manager, which would add an operational dependency that nothing else in the product justifies yet.

The usual risk of this approach, "a stolen backup carries everything", is already reduced: backups are encrypted with `age`, so a stolen backup is not readable in clear text. The `pgcrypto` encryption is a second layer, not the only one.

## Costs

Key rotation is manual, and it requires re-encrypting the existing secrets. At the current scale, a few operators and then a few hundred garages, this is acceptable. Re-evaluate it if the number of secrets makes rotation impractical.

## Rejected

- **A dedicated environment variable**, like the `age` key. It is consistent with the existing setup, but it leaves all decryption to the application.
- **A secrets manager** (SOPS, Vault, a hosting provider's service). The most robust option, rejected to avoid adding an operational component that is not justified today.
- **Postponing TOTP.** Rejected, because the console would stay unreachable with no date set.
