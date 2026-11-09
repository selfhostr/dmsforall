---
title: Cosa è protetto e cosa non lo è
description: I controlli di sicurezza che dmsforall offre, quelli che non offre e ciò che l'operatore deve fare.
---

Questa pagina elenca le protezioni che dmsforall offre nel codice, le lacune che restano in questa versione e ciò che Lei deve far funzionare da sé. La legga prima di mettere dati reali su un server.

## Cosa protegge dmsforall

**Separazione tra autorimesse.** Ogni autorimessa è un tenant. Ogni tabella per tenant ha una colonna `tenant_id` e la row-level security di PostgreSQL. L'API limita inoltre ogni query al tenant dell'utente connesso. Il tenant viene dalla sessione, mai da un parametro della richiesta. L'API si connette con un ruolo soggetto alla row-level security, e le migrazioni usano un ruolo diverso.

**Password e accesso.** Le password sono sottoposte ad hash con Argon2id. I tentativi di accesso sono limitati per indirizzo IP e per account. Dopo ripetute password errate, l'account viene bloccato per un certo periodo. Il reset della password avviene con un token inviato via e-mail.

**Sessioni.** Il cookie di sessione è HTTP-only. È contrassegnato come `Secure` per impostazione predefinita, e la configurazione di produzione rifiuta di avviarsi se questa opzione viene disattivata. L'API verifica l'intestazione `Origin` delle richieste che modificano dati.

**Diritti.** Ogni rotta verifica i diritti del ruolo con un'unica matrice dei diritti. Vedere [ruoli e diritti](../reference/roles-and-rights.md).

**Denaro.** Gli importi sono numeri interi in centesimi. Una fattura emessa è bloccata, e una correzione avviene tramite nota di credito. Il registro di audit registra chi ha modificato un'entità sensibile, quando, e i valori prima e dopo.

**Configurazione.** L'API valida ogni variabile all'avvio e rifiuta di partire con un valore non valido. In produzione rifiuta le password del database di sviluppo.

**Documentazione dell'API.** La documentazione OpenAPI è disattivata per impostazione predefinita. Viene pubblicata solo quando `OPENAPI_EXPOSER_DOCS=true`.

**Luogo dei dati.** Tutto funziona sul Suo server. dmsforall non invia dati a servizi di terzi. La segnalazione degli errori, facoltativa, va solo al server compatibile con Sentry che Lei imposta in `SENTRY_DSN`.

## Cosa dmsforall non protegge

- **Secondo fattore per gli account delle autorimesse.** L'autenticazione a due fattori (TOTP) non è disponibile per il personale delle autorimesse in questa versione. La console dell'operatore, che non è usata dalle autorimesse, richiede un secondo fattore. Usi password lunghe e uniche per tutti gli account.
- **Cifratura a riposo.** I volumi con nome di Docker non sono cifrati da Docker. Cifri il disco o la partizione sotto la cartella dei dati di Docker.
- **Backup fuori sede.** Il backup notturno è cifrato, ma resta sullo stesso server finché non configura una copia fuori sede. Un backup sullo stesso disco non protegge da una perdita del server. Vedere [Eseguire il backup e il ripristino](../get-started/backup-and-restore.md).
- **La cache dei PDF.** Non viene salvata nel backup. Viene rigenerata a partire dal database.
- **Il server stesso.** Il sistema operativo, l'host Docker, i suoi utenti e i suoi aggiornamenti sono di Sua responsabilità.
- **Accesso al database.** Chiunque conosca la password del superutente PostgreSQL può leggere tutti i dati. Tenga quella password separata dalle password delle applicazioni.
- **Sicurezza lato client.** Un browser lasciato sbloccato dà accesso all'account connesso. Imposti durate di sessione adeguate al Suo personale. Vedere le variabili `SESSION_*` nel [riferimento della configurazione](../reference/configuration.md).
- **Limiti di frequenza dietro un proxy.** I limiti usano l'indirizzo IP del client. Se `TRUST_PROXY_HOPS` è errato, tutti gli utenti possono condividere un solo limite, oppure un client può falsificare il proprio indirizzo.

## Cosa deve fare Lei

1. Serva dmsforall solo tramite HTTPS, con un certificato valido.
2. Sostituisca tutte le password di sviluppo prima del primo avvio. Usi un gestore di password.
3. Imposti `TRUST_PROXY_HOPS` al numero di proxy inversi davanti all'API.
4. Mantenga `OPENAPI_EXPOSER_DOCS=false` e `COOKIE_SECURE=true` in produzione.
5. Chiuda ogni porta tranne 80 e 443 sul firewall.
6. Mantenga aggiornati il server, Docker e le immagini. Vedere [Aggiornamento](../operations/upgrading.md).
7. Verifichi regolarmente il ripristino dei backup.
8. Riveda i ruoli del personale almeno una volta all'anno, e disattivi gli account delle persone che lasciano l'autorimessa.

Per segnalare una vulnerabilità, segua [SECURITY.md](https://github.com/selfhostr/dmsforall/blob/main/SECURITY.md). Non apra una segnalazione pubblica.
