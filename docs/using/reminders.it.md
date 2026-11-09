---
title: Inviare solleciti di pagamento
description: Configurare i termini per i solleciti delle fatture scadute, e capire quando un sollecito viene inviato o interrotto.
---

I solleciti servono a recuperare le fatture non pagate. Viene pianificato un sollecito per ogni termine impostato, calcolato dalla data di scadenza della fattura, e inviato via e-mail al cliente.

Alla fine di questa pagina saprà come impostare i termini e quando un sollecito si interrompe.

## Impostare i termini

1. Apra **Impostazioni › Solleciti di pagamento**.
2. Scelga la regola di sollecito per le fatture scadute.
3. Inserisca i termini, in giorni dopo la data di scadenza, per esempio `10` e `30`.
4. Salvi la regola.

Risultato: ogni termine crea un sollecito pianificato per ogni fattura scaduta.

## Quando viene inviato un sollecito

L'attività che prepara e invia i solleciti viene eseguita ogni ora, al minuto 12 per impostazione predefinita. Il sollecito viene inviato via e-mail all'indirizzo del cliente.

## Quando un sollecito si interrompe

Un sollecito pianificato si interrompe automaticamente nei seguenti casi:

- la fattura è pagata, oppure la pratica è gestita in altro modo;
- il cliente ha ritirato il consenso ai solleciti;
- il cliente non ha un indirizzo e-mail valido.

Il motivo viene registrato sul sollecito.

:::caution
In questa versione, i solleciti vengono inviati solo via e-mail. Un sollecito pianificato via SMS non viene inviato. I solleciti vengono consegnati solo quando il server è in produzione e l'autorimessa ha un server di invio funzionante (**Impostazioni › Invio delle e-mail**), oppure quando l'installazione ne ha uno. Senza uno dei due, il sollecito non viene inviato e il motivo viene registrato. Vedere il [riferimento della configurazione](../reference/configuration.md).
:::
