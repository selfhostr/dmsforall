---
title: Gestire ricambi e magazzino
description: Tenere il catalogo dei ricambi, seguire il magazzino per sede, prenotare ricambi sugli ordini e ordinare dai fornitori.
---

Il modulo ricambi contiene il catalogo dei ricambi, il magazzino di ogni sede e i movimenti che lo modificano. I ricambi possono essere prenotati su un ordine di riparazione, ordinati dai fornitori e fatturati tramite fatture dei fornitori.

Alla fine di questa pagina potrà aggiungere un articolo, registrare un movimento di magazzino e prenotare un ricambio su un ordine.

## Articoli

Un articolo ha un riferimento, una descrizione, un prezzo del fornitore, un prezzo di vendita, un'aliquota IVA e un luogo di stoccaggio. Dia a ogni articolo un riferimento chiaro, perché il banco cerca proprio il riferimento.

## Movimenti di magazzino

Ogni variazione del magazzino viene registrata come movimento. I tipi sono:

- entrata di merce da una consegna del fornitore;
- uscita per un ordine di riparazione;
- vendita al banco;
- reso al fornitore, oppure reso dal cliente;
- trasferimento tra sedi;
- rettifica di inventario;
- rottura o perdita;
- restituzione di una cauzione (_consigne_).

Ogni movimento registra chi lo ha fatto e quando.

## Prenotazioni

Quando un ricambio viene aggiunto a un ordine di riparazione, viene prenotato. Il magazzino mostrato come disponibile è il magazzino meno le prenotazioni. Una prenotazione viene rilasciata quando il ricambio viene montato, oppure quando la riga viene annullata.

## Ordini ai fornitori

Crei un ordine al fornitore dall'elenco dei fornitori. Quando arriva la consegna, registri l'entrata. Il magazzino aumenta quando l'entrata viene registrata, non quando l'ordine viene inviato.

## Fatture dei fornitori

Una fattura del fornitore può essere inserita a mano, oppure letta da un PDF se è configurato il servizio OCR facoltativo. Controlli gli importi prima di approvare la fattura.

:::caution
La valutazione del magazzino con il metodo FIFO (first in, first out) è stabilita, ma non ancora implementata. I margini per ricambio o per ordine non sono affidabili in questa versione.
:::
