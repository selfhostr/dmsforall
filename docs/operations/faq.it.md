---
title: Domande frequenti
description: Risposte alle domande più frequenti su dmsforall, la sua licenza, le sue funzioni e i suoi limiti.
---

## Esiste una versione ospitata?

No. dmsforall è un software che Lei fa funzionare sul proprio server. Il progetto non offre alcun servizio ospitato né alcuna edizione a pagamento. La licenza è MIT.

## Quanto costa?

Il software è gratuito con licenza MIT. I Suoi costi sono il server, il nome di dominio, il certificato TLS, i backup e il Suo tempo.

## Quali lingue usa l'interfaccia?

Francese, tedesco e italiano. La documentazione è in inglese.

## Più autorimesse possono usare una sola installazione?

Sì. Ogni autorimessa è un tenant, con dati propri, separati tramite row-level security. Ogni autorimessa ha i suoi utenti e le sue sedi.

## Supporta il mio software di contabilità?

L'esportazione contabile è disponibile solo per WinBIZ. Altri formati, come Bexio, Abacus, Banana e il CSV generico, non sono disponibili in questa versione.

## Invia SMS?

No. Gli SMS sono previsti nel modello dei dati, ma in questa versione non è collegato alcun fornitore di SMS. I solleciti vengono inviati via e-mail.

## Legge gli estratti conto bancari?

No. La riconciliazione degli estratti conto bancari (camt.054) non è disponibile in questa versione.

## Posso vedere il margine su ogni ricambio?

Non in modo affidabile. La valutazione del magazzino con il metodo FIFO è stabilita, ma non ancora implementata.

## Posso importare i dati del mio software attuale?

Sì, da archivi Microsoft Access e dBase/FoxPro. L'importazione è stata testata con archivi esportati da Auto-i. Non affiliato ad Auto-i. Vedere [Importare dati](../using/data-import.md).

## È conforme alla legge svizzera?

dmsforall è realizzato per il diritto e l'IVA svizzeri, con fatture con QR-fattura e importi in centesimi. Il progetto non offre alcuna garanzia giuridica o fiscale. Prima di farvi affidamento, faccia controllare le fatture, l'IVA e le esportazioni da una fiduciaria.

## Dove sono conservati i miei dati?

Sul server che Lei gestisce. dmsforall non invia dati al progetto né a terzi. La posizione di quel server è una Sua scelta.

## Esiste una demo?

Per uno sviluppatore, `pnpm db:seed` carica un'autorimessa dimostrativa su un database di sviluppo. Vedere [Contribuire](../development/contributing.md). Gli account demo non vengono creati in produzione.

## Funziona su tablet o telefono?

L'interfaccia funziona in un browser. Ha impostazioni di densità per schermi d'ufficio, tablet e per le schermate di appuntamenti e rilevamento delle ore.

## Posso cambiare il tema?

Sì. Sono disponibili i temi chiaro e scuro. La scelta viene memorizzata nel browser di ogni dispositivo.

## Come aggiorno a una nuova versione?

Segua [Aggiornare dmsforall](upgrading.md).
