---
title: Depositare e cambiare i set di pneumatici
description: Registrare i set di pneumatici in deposito, seguirne lo stato e restituirli quando il cliente li ritira.
---

Il modulo pneumatici conserva i set stagionali dei clienti che lasciano i loro pneumatici in deposito presso l'autorimessa.

Alla fine di questa pagina potrà registrare un set in deposito, spostarlo e restituirlo al cliente.

## Registrare un set in deposito

1. Apra il cliente e il veicolo.
2. Scelga **Nuovo deposito** e inserisca la stagione, estiva o invernale, e il luogo nel capannone.

Risultato: il set compare come `en_depot`.

Un veicolo può avere un solo set attivo in deposito per ogni stagione.

## Stati

| Stato        | Significato                                                      |
| ------------ | ---------------------------------------------------------------- |
| `en_depot`   | In deposito, in attesa.                                          |
| `monte`      | Montato sul veicolo, per esempio durante il cambio di stagione.  |
| `a_relancer` | Nessun movimento da un po' di tempo. Il cliente va ricontattato. |
| `sorti`      | Uscito. Il motivo è obbligatorio.                                |

Quando un set resta troppo tempo senza movimenti, il suo stato diventa `a_relancer` automaticamente.

## Far uscire un set

Scelga **Fai uscire** e indichi il motivo: restituito al cliente, veicolo venduto, smaltito, oppure altro. Lo stato diventa `sorti`. Un set uscito non può essere riaperto. Crei invece un nuovo record di deposito.

:::caution
Non elimini un record di deposito per farlo uscire. Usi l'azione di uscita, così la cronologia resta completa.
:::
