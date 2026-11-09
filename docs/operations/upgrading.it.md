---
title: Aggiornare dmsforall
description: Aggiornare in sicurezza un'installazione di produzione, con un backup, le migrazioni, un controllo di stato e un piano di ripristino.
---

Al termine di questa pagina, la Sua installazione è in esecuzione con la nuova versione, e sa come tornare indietro se qualcosa non funziona.

## Prima di aggiornare

1. Legga il [changelog](https://github.com/selfhostr/dmsforall/blob/main/CHANGELOG.md) per ogni versione compresa tra la Sua e la nuova. Annoti ogni modifica alle variabili di configurazione.
2. Esegua un backup e verifichi che sia completo. Vedere [Eseguire il backup e il ripristino](../get-started/backup-and-restore.md).
3. Controlli lo spazio libero su disco. Le migrazioni e i backup ne richiedono.
4. Pianifichi una finestra breve e lo comunichi al personale. Il personale non deve lavorare durante l'aggiornamento.

## Aggiornamento

Dalle versioni successive alla 0.3.0, le code vengono gestite da Valkey invece che da Redis. Non serve modificare nulla: il nome del servizio `redis`, l'impostazione `REDIS_URL` e il volume `dfa_redis_data` restano invariati, e Valkey legge i file append-only esistenti. `docker compose pull` scarica la nuova immagine.

1. Imposti `DFA_VERSION` in `.env` sul nuovo tag (aggiunga la riga se il file non ne ha una). Se le note di rilascio segnalano una modifica a `docker-compose.yml`, scarichi prima il nuovo file dalla release. Vedere [Verificare le immagini](../security/verify-images.md).
2. Scarichi le nuove immagini e riavvii lo stack:

   ```sh
   docker compose pull
   docker compose up -d
   ```

3. Il servizio `migrate` applica le migrazioni del database prima dell'avvio dell'API. Verifichi che sia terminato senza errori:

   ```sh
   docker compose ps -a migrate
   ```

4. Controlli l'endpoint di stato:

   ```sh
   curl -s https://garage.example.org/api/v1/sante
   ```

5. Acceda e controlli un documento per ogni area che utilizza.

## Se qualcosa non funziona

- **La migrazione è fallita.** L'API non si avvia con la nuova versione, e la versione precedente resta in esecuzione. Legga i log del servizio `migrate`, risolva la causa e avvii di nuovo lo stack.
- **L'API non si avvia.** Legga i log. Un errore di configurazione elenca ogni variabile non valida. Corregga la variabile e riavvii.
- **La nuova versione si comporta in modo anomalo.** Ripristini il backup eseguito prima dell'aggiornamento. È il modo supportato per tornare allo stato precedente.

:::caution
Non esegua gli script inversi delle migrazioni su un database che ha ricevuto dati reali dopo l'aggiornamento. Ogni script inverso è verificato in sviluppo, ma può eliminare dati scritti dopo l'aggiornamento. Ripristini piuttosto il backup.
:::

:::caution
Non modifichi mai un file di migrazione già applicato. Il migratore verifica un checksum di ogni file e rifiuta di eseguirsi se uno è stato modificato.
:::
