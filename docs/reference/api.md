---
title: API reference
description: How to call the dmsforall API, sign in, paginate lists, read errors, and where to find the OpenAPI description.
---

The web interface is a client of the public API. Anything you can do in the interface, you can do with the API.

## Base address and versions

All endpoints are under `/api/v1/`, for example `https://garage.example.org/api/v1/sante`. The version is part of the path.

## OpenAPI description

The API publishes an OpenAPI description, generated from the code. It is served only when `OPENAPI_EXPOSER_DOCS=true`:

- `/api/docs`: interactive documentation;
- `/api/docs.json`: the OpenAPI document, for code generation.

Keep it disabled on a production server that is reachable from the Internet, unless you need it. To produce the document from a source checkout, run `pnpm api:openapi`.

## Sign in

Signing in creates a session cookie. Send the cookie with each request. The cookie name is `dfa_session` by default.

| Endpoint                                     | Method | Use                                            |
| -------------------------------------------- | ------ | ---------------------------------------------- |
| `/api/v1/auth/connexion`                     | `POST` | Sign in with an e-mail address and a password. |
| `/api/v1/auth/deconnexion`                   | `POST` | Sign out and close the session.                |
| `/api/v1/auth/moi`                           | `GET`  | Return the signed-in user and their rights.    |
| `/api/v1/auth/mot-de-passe/oubli`            | `POST` | Ask for a password reset e-mail.               |
| `/api/v1/auth/mot-de-passe/reinitialisation` | `POST` | Set a new password with the reset token.       |

Example with `curl`. The `Origin` header is required by the CSRF protection.

```sh
curl -c cookies.txt \
  -H "Origin: https://garage.example.org" \
  -H "Content-Type: application/json" \
  -d '{"email":"direction@garage.example.org","motDePasse":"replace-me"}' \
  https://garage.example.org/api/v1/auth/connexion
```

Check the exact body of the sign-in request in the OpenAPI description, which is the reference.

## Lists and pagination

Lists use cursor pagination:

- `limite`: number of items to return.
- `curseur`: the cursor to get the next page. Take it from the field `curseurSuivant` of the previous response. Do not build cursors yourself.

A list response has three fields: `donnees` (the items), `curseurSuivant` (the next cursor, or `null` on the last page) and `limite`.

## Errors

Errors use the `application/problem+json` format. Read the `status` and the `type` fields first. A request that the role does not allow returns `403` with the code `DROIT_INSUFFISANT`.

## Other conventions

- Amounts are integers in centimes. `1'234.50 CHF` is sent as `123450`.
- Sensitive creations accept an idempotency key, so that a retry does not create a duplicate.
- Dates and times use ISO 8601.

:::caution
The API does not replace the rights of the web interface. A request that the role does not allow returns `403`, whatever the client. See [roles and rights](roles-and-rights.md).
:::
