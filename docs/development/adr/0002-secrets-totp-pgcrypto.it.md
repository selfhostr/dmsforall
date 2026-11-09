# ADR 0002: Segreti TOTP cifrati con pgcrypto

Questa decisione è stata accettata il 27.08.2026 da @laupernoe. Stabilisce come vengono protetti a riposo i segreti TOTP.

## Contesto

Due funzioni richiedono la stessa decisione: il secondo fattore per il personale dell'autorimessa e l'accesso alla console dell'operatore. La console è costruita (migrazione 0048, il pool `dfa_console`, cinque funzioni `SECURITY DEFINER`, una schermata dedicata), ma l'accesso non può essere raggiunto finché non si risolve una questione: come proteggere il segreto TOTP memorizzato in `exploitation.exploitant.totp_secret_chiffre`.

Finché la questione non è risolta, il parco delle autorimesse può essere amministrato solo tramite SQL, e non si può offrire alcun secondo fattore.

## Decisione

Cifratura all'interno di PostgreSQL, con `pgcrypto`.

## Condizione che rende valida questa decisione

La chiave non deve mai essere memorizzata nel database, né nella configurazione del server PostgreSQL. Viene fornita alla query al momento della cifratura e della decifratura, dalla configurazione dell'applicazione.

Senza questa condizione, la decisione perde gran parte del suo valore: una chiave conservata accanto ai dati che protegge non protegge nulla. Con questa condizione, l'accesso in lettura al database (backup, replica, dump) non basta per recuperare i segreti.

## Motivazione

Meno componenti in movimento di un gestore esterno di segreti, che aggiungerebbe una dipendenza operativa che nulla nel prodotto giustifica ancora.

Il rischio tipico di questo approccio, "un backup rubato contiene tutto", è già ridotto: i backup sono cifrati con `age`, quindi un backup rubato non è leggibile in chiaro. La cifratura `pgcrypto` è un secondo livello, non l'unico.

## Costi

La rotazione della chiave è manuale e richiede di ricifrare i segreti esistenti. Alla scala attuale, qualche operatore e poi qualche centinaio di autorimesse, è accettabile. Da rivalutare se il numero di segreti rende la rotazione impraticabile.

## Scartati

- **Una variabile d'ambiente dedicata**, come la chiave di `age`. È coerente con la configurazione esistente, ma lascia all'applicazione tutta la decifratura.
- **Un gestore di segreti** (SOPS, Vault, un servizio del fornitore di hosting). È l'opzione più robusta, scartata per non aggiungere un componente operativo non giustificato oggi.
- **Rinviare il TOTP.** Scartato, perché la console resterebbe irraggiungibile senza una data fissata.
