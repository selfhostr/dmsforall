---
title: Riferimento API
description: Come chiamare l'API di dmsforall, accedere, paginare le liste, leggere gli errori e dove trovare la descrizione OpenAPI.
---

L'interfaccia web è un client dell'API pubblica. Tutto ciò che si può fare nell'interfaccia, si può farlo anche con l'API.

## Indirizzo di base e versioni

Tutti gli endpoint si trovano sotto `/api/v1/`, per esempio `https://garage.example.org/api/v1/sante`. La versione fa parte del percorso.

## Descrizione OpenAPI

L'API pubblica una descrizione OpenAPI, generata dal codice. È disponibile solo quando `OPENAPI_EXPOSER_DOCS=true`:

- `/api/docs`: documentazione interattiva;
- `/api/docs.json`: il documento OpenAPI, per la generazione di codice.

La lasci disattivata su un server di produzione raggiungibile da Internet, a meno che non ne abbia bisogno. Per produrre il documento da una copia del sorgente, esegua `pnpm api:openapi`.

## Accesso

L'accesso crea un cookie di sessione. Invii il cookie con ogni richiesta. Il nome del cookie è `dfa_session` per impostazione predefinita.

| Endpoint                                     | Metodo | Uso                                                 |
| -------------------------------------------- | ------ | --------------------------------------------------- |
| `/api/v1/auth/connexion`                     | `POST` | Accedere con un indirizzo e-mail e una password.    |
| `/api/v1/auth/deconnexion`                   | `POST` | Uscire e chiudere la sessione.                      |
| `/api/v1/auth/moi`                           | `GET`  | Restituire l'utente connesso e i suoi diritti.      |
| `/api/v1/auth/mot-de-passe/oubli`            | `POST` | Chiedere un'e-mail per il reset della password.     |
| `/api/v1/auth/mot-de-passe/reinitialisation` | `POST` | Impostare una nuova password con il token di reset. |

Esempio con `curl`. L'intestazione `Origin` è obbligatoria per la protezione CSRF.

```sh
curl -c cookies.txt \
  -H "Origin: https://garage.example.org" \
  -H "Content-Type: application/json" \
  -d '{"email":"direction@garage.example.org","motDePasse":"replace-me"}' \
  https://garage.example.org/api/v1/auth/connexion
```

Verifichi il corpo esatto della richiesta di accesso nella descrizione OpenAPI, che è il riferimento.

## Liste e paginazione

Le liste usano la paginazione a cursore:

- `limite`: numero di elementi da restituire.
- `curseur`: il cursore per ottenere la pagina successiva. Lo prenda dal campo `curseurSuivant` della risposta precedente. Non costruisca i cursori da solo.

La risposta di una lista ha tre campi: `donnees` (gli elementi), `curseurSuivant` (il cursore successivo, oppure `null` nell'ultima pagina) e `limite`.

## Errori

Gli errori usano il formato `application/problem+json`. Legga prima i campi `status` e `type`. Una richiesta che il ruolo non consente restituisce `403` con il codice `DROIT_INSUFFISANT`.

## Altre convenzioni

- Gli importi sono numeri interi in centesimi. `1'234.50 CHF` viene inviato come `123450`.
- Le creazioni sensibili accettano una chiave di idempotenza, così che un nuovo tentativo non crei un duplicato.
- Date e orari usano lo standard ISO 8601.

:::caution
L'API non sostituisce i diritti dell'interfaccia web. Una richiesta che il ruolo non consente restituisce `403`, qualunque sia il client. Vedere [ruoli e diritti](roles-and-rights.md).
:::
