---
title: Importare dati da un sistema esistente
description: Trasferire clienti, veicoli, documenti e lavori aperti di un'autorimessa da un archivio di database esistente in dmsforall, con un piano da verificare prima.
---

L'importazione porta i dati di un'autorimessa dal suo software attuale in dmsforall. Procede per fasi, e nulla viene scritto prima che Lei abbia verificato il piano.

Alla fine di questa pagina saprà quali sono le fasi di un'importazione e cosa controllare prima di confermarla.

## Cosa legge l'importazione

L'importazione legge archivi di database. Il tipo di file viene riconosciuto dal contenuto del file, non dal nome:

- database Microsoft Access (`.mdb`, `.accdb`), oppure un archivio che li contiene;
- tabelle dBase e FoxPro (`.dbf`).

L'importazione è stata testata con archivi esportati da Auto-i. Non affiliato ad Auto-i.

:::caution
Gli archivi Access vengono letti con i programmi `mdbtools`. Il container dell'API li include. Se esegue l'API fuori dal container, installi prima `mdbtools`, altrimenti l'importazione si interrompe con un errore che indica che lo strumento manca.
:::

## Le fasi

1. **Caricamento.** Carichi l'archivio. Il sistema verifica che sia un tipo supportato.
2. **Analisi.** Il sistema legge le tabelle e conta i record.
3. **Convalida.** Il sistema propone cosa importerà e cosa lascerà fuori, con il motivo di ogni scelta.
4. **Importazione.** Dopo la Sua conferma del piano, i record vengono scritti nel database dell'autorimessa.
5. **Rapporto.** Il rapporto elenca ciò che è stato importato, ciò che è stato saltato e ciò che richiede una decisione di una persona.

Risultato dopo il rapporto: i clienti e i veicoli importati compaiono nella ricerca, e i documenti aperti compaiono nei loro elenchi.

## Verificare il piano

Prima di confermare, controlli:

- il numero di clienti e veicoli rispetto a quanto si aspetta;
- le fatture aperte e i loro importi;
- gli ordini di riparazione aperti e il loro stato;
- le voci che il piano lascia fuori, e il motivo.

Un'importazione può essere annullata dalla schermata di importazione. Verifichi il rapporto dell'importazione annullata prima di avviarne un'altra.

:::caution
Conservi l'archivio originale finché il rapporto non è stato verificato e l'autorimessa non ha usato il nuovo sistema per almeno un ciclo completo di fatturazione.
:::

:::caution
L'importazione scrive nel database dell'autorimessa. Faccia un backup prima di iniziare. Vedere [Eseguire il backup e il ripristino](../get-started/backup-and-restore.md).
:::
