# Security policy

dmsforall holds client records, invoices, payment details and staff accounts for each garage that runs it. We take reports seriously and thank you for the time it takes to write one.

## Supported versions

dmsforall has no stable release line yet. Security fixes land on `dev` first, then on `main`, and ship in the next tagged release.

| Version                              | Supported                                        |
| ------------------------------------ | ------------------------------------------------ |
| `main` and the latest tagged release | Yes                                              |
| `dev`                                | Yes, for reports; fixes are not released from it |
| Older tags                           | No. Upgrade.                                     |

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through GitHub's private vulnerability reporting: open the **Security** tab of the repository, then **Report a vulnerability**, or go directly to https://github.com/selfhostr/dmsforall/security/advisories/new.

Include, as far as you can:

- the component concerned (see the scope below);
- steps to reproduce, or a proof of concept;
- the impact as you understand it, for example whether one garage can read another garage's data;
- the version, tag or commit you tested.

A private advisory lets us discuss and fix the problem before it becomes public. You will be credited in the advisory unless you ask not to be.

## What to expect

- An acknowledgement within **7 days**.
- A first assessment (confirmed, not a vulnerability, or more information needed) within **14 days**.
- For a confirmed issue, a fix as soon as it is ready, then a tagged release and a published advisory. We aim for a fix within 90 days, and usually sooner.

dmsforall is maintained by volunteers. There is no bug bounty.

## How a report is handled

1. **Receipt.** The report arrives as a private advisory. A maintainer acknowledges it within 7 days.
2. **Triage.** We reproduce the problem, decide whether it is a vulnerability, and tell you the result within 14 days.
3. **Fix.** The fix is prepared privately and gets a regression test. We may ask you to confirm that it solves the problem.
4. **Release.** The fix is merged, a release is tagged, and the advisory is published with the affected and fixed versions and the credit.
5. **Afterwards.** If the cause belongs to a class of problems, we look for the same pattern elsewhere and add a test or a check so that it does not come back.

If a report is not a vulnerability, we explain why. If it is still a useful hardening idea, we may ask you to file it as a public issue.

## Credit

We credit each reporter of a resolved vulnerability in the advisory and in the release notes, with the name or handle you give us, unless you ask to stay anonymous. No vulnerability has been resolved yet, so there is no one to list.

## Verifying releases

Release images are published to `ghcr.io/selfhostr/dmsforall` and `ghcr.io/selfhostr/dmsforall-web`. The release workflow signs them and attaches attestations, but this has not run yet, because no release has been published. Until a release is verified, pin the images by digest and record the digest you tested. The page [Verify the images](https://dmsforall.selfhostr.io/docs/security/verify-images/) lists each check and its status.

## Scope

In scope, roughly in order of importance:

- **Tenant isolation.** Any way for a user of one garage to read or change another garage's data, through the API, the search, the exports, the PDF files or the jobs. Row-level security and the application-level scoping are both in scope.
- **Authentication and sessions.** Login, the session cookie, password reset, account lockout and the rate limits.
- **Authorisation.** A role that can perform an action listed as forbidden for it in the rights matrix (`apps/api/src/auth/matrice-droits.ts`), or an endpoint that has no rights check.
- **Money.** A way to change an issued invoice, to bypass the credit-note rule, or to make an amount wrong through rounding or VAT.
- **Injection.** SQL, command, template and header injection, and unsafe file handling in the data import (Access and dBase archives) and in the OCR of vehicle documents.
- **Secrets.** Any path by which a secret (password, token, key) is returned by the API, written to a log, or stored in clear text.
- **Container and compose files** that expose more than they should.

Out of scope: vulnerabilities in third-party software that we only depend on (report those upstream), problems that need an attacker who already controls the server or its database, and reports from automated scanners without a demonstrated impact.

## Hardening notes for operators

- Serve dmsforall only over HTTPS. The session cookie is marked `Secure` by default (`COOKIE_SECURE=true`).
- Set `TRUST_PROXY_HOPS` to the exact number of reverse proxies in front of the API. A wrong value lets clients forge their address, or lets all users share one rate-limit bucket.
- Replace every development password before the first production start. The API refuses to start in production when the database URL still uses the development role passwords.
- Keep `OPENAPI_EXPOSER_DOCS=false` in production, unless you need the API documentation.
- Back up the database and test a restore regularly. See [Back up and restore](https://dmsforall.selfhostr.io/docs/get-started/backup-and-restore/).
