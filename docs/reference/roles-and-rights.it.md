---
title: Ruoli e diritti
description: Come funzionano i diritti in dmsforall - una griglia per persona, i ruoli come preimpostazioni e dove sono definiti i diritti.
---

Ogni persona ha una **griglia** di diritti, non un unico ruolo esclusivo. La griglia stabilisce, per sei aree, se la persona non vede nulla, può vedere oppure può agire. Un ruolo (`direction`, `vendeur`...) è solo una **preimpostazione**: la griglia iniziale assegnata a una nuova persona, che il titolare può poi modificare. I diritti sono verificati dall'API a ogni richiesta, a partire dalla griglia della persona letta dal database. L'interfaccia web nasconde le azioni che una persona non può compiere, ma l'autorità è l'API.

## La griglia

| Area          | Niente         | Vedere                            | Fare                                        |
| ------------- | -------------- | --------------------------------- | ------------------------------------------- |
| `atelier`     | nessun accesso | ordini di riparazione, registro   | avviare, controllare, timbrare, righe       |
| `accueil`     | nessun accesso | clienti, veicoli, appuntamenti    | accettazione, preventivi, appuntamenti      |
| `facturation` | nessun accesso | documenti, incassi                | bozza, emissione, incassi                   |
| `pieces`      | nessun accesso | articoli, magazzino, prenotazioni | movimenti di magazzino, ordini, ricevimento |
| `ventes`      | nessun accesso | veicoli in stock, vendite         | vendite di auto nuove e d'occasione         |
| `finances`    | nessun accesso | cruscotto, esportazione contabile | rimborsi, correzioni, esportazione          |

`Fare` include `Vedere`. Altri tre interruttori si trovano fuori dalla griglia:

- `encadrer` - correggere le ore di altre persone, riaprire un ordine di riparazione, sbloccare un blocco, impostazioni dell'officina.
- `gererEmployes` ("Dipendenti e impostazioni") - account e terminali dell'officina. Segue la preimpostazione; non è modificabile un interruttore alla volta.
- `patron` - atti irreversibili: l'IBAN del creditore, l'avvio di una ripresa dati, l'uscita dell'autorimessa. Segue la preimpostazione (solo `direction`).

Tre opzioni per persona:

- `voitMontants` - vede prezzi, totali e importi. Senza questa opzione una persona non può usare Fatturazione: Fare, Vendite: Fare o un qualsiasi livello di Finanze, e il PDF della fattura (che riporta l'importo) viene rifiutato.
- `voitPrixAchat` - vede i prezzi d'acquisto e i margini sui ricambi.
- `avoirsPlafonnes` - le note di credito sono limitate al tetto impostato nelle impostazioni dell'officina. È un vincolo, non un potere.

Gli importi vengono **rimossi dal server** dalle risposte; l'interruttore viene letto dalla griglia della persona a ogni richiesta.

## Preimpostazioni

| Preimpostazione  | Ruolo memorizzato | Sintesi                                                                                                    |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `direction`      | `direction`       | Tutto, compresi `encadrer`, `gererEmployes`, `patron`.                                                     |
| `admin`          | `admin`           | Amministratore tecnico: officina, accettazione, account. Nessun denaro, magazzino o vendita.               |
| `comptable`      | `comptable`       | Fatturazione e finanze; vede il resto. Legge il blocco creditore ma non può cambiare l'IBAN.               |
| `fiduciaire`     | `comptable`       | Contabile esterno: Fatturazione e Finanze solo in Vedere, nient'altro. Vede gli importi, non scrive nulla. |
| `receptionnaire` | `receptionnaire`  | Banco: accettazione, preventivi, fatture, incassi. Note di credito limitate.                               |
| `vendeur`        | `vendeur`         | Vendite più fatturazione. Note di credito limitate.                                                        |
| `chef_atelier`   | `chef_atelier`    | Responsabile officina: `encadrer`, ricambi, fatturazione. Note di credito limitate.                        |
| `technicien`     | `technicien`      | Solo officina, senza importi.                                                                              |
| `magasinier`     | `magasinier`      | Ricambi e fatturazione al banco, e rilevamento delle ore. Note di credito limitate.                        |

`fiduciaire` non ha un valore proprio nell'enum `role_utilisateur`: viene memorizzato con `role = comptable` e riconosciuto dalla sua griglia.

`poste_atelier` non è una preimpostazione: è un **profilo dispositivo fisso** per un terminale d'officina (legge gli ordini di riparazione, rileva le ore, identifica tramite PIN). La sua griglia viene ignorata.

Nessuna persona perde un diritto nel passaggio dai ruoli alle preimpostazioni. Un test (`apps/api/src/auth/matrice-droits.spec.ts`) verifica, per ogni azione e per ogni ruolo, che la preimpostazione mantenga almeno i diritti precedenti, e fissa ogni diritto aggiunto.

## Come un'azione si collega alla griglia

Ciascuna delle circa 170 azioni (`apps/api/src/auth/matrice-droits.ts`, le etichette sulle rotte) è collegata a una o due capacità interne in `apps/api/src/auth/capacites-actions.ts`. Una persona possiede l'azione quando la sua griglia concede una di queste capacità. La tabella è tipizzata `Record<Action, ...>`: un'azione non classificata non compila. `MATRICE_DROITS[role]` è ormai solo l'elenco delle azioni della preimpostazione di quel ruolo.

## Separazione dei compiti

Il livello "Fare" da solo non dà ogni azione della sua area. Una persona che gestisce il magazzino ricambi (Ricambi: Fare) senza alcuna autorità commerciale (né Vendite: Fare, né Finanze: Fare) non può verificare il proprio lavoro su un ordine di riparazione, emettere preventivi, fatture o note di credito, né convalidare fatture di fornitori. Un responsabile officina (`encadrer`) in quella situazione può emettere preventivi e verificare gli ordini, ma non registra incassi, non emette fatture o note di credito, non gestisce i movimenti di magazzino né convalida le fatture dei fornitori. Queste regole si trovano in `capacitesDeLaGrille` (`packages/shared/src/contrats/capacites.ts`).

## Chi può modificare una griglia

`PATCH /api/v1/utilisateurs/{id}/capacites` e il cambio di ruolo richiedono il diritto `socle.utilisateur.modifier` (Dipendenti e impostazioni). In aggiunta:

- non può modificare la propria griglia o il proprio ruolo, né reimpostare o riattivare il proprio account tramite le rotte dei dipendenti;
- disattivare, riattivare e reimpostare l'accesso di una persona seguono le stesse regole della modifica della sua griglia (una persona con meno diritti non può prendere il controllo di una con più diritti, né sospenderla);
- non può concedere ciò che non possiede Lei stesso (l'API indica il campo non conforme);
- non può modificare una persona che possiede più di Lei; solo un `admin` può modificare un `admin`;
- `admin` (l'integratore) può assegnare qualsiasi preimpostazione aziendale, quindi può creare il primo titolare di un'autorimessa;
- l'ultimo `patron` attivo non può essere retrocesso o disattivato (verificato con un blocco per autorimessa, così due retrocessioni simultanee non possono rimuoverli entrambi);
- le modifiche sono registrate nell'audit (prima e dopo); le sessioni di una persona i cui diritti vengono ridotti vengono revocate.

## Tetto delle note di credito

Una persona con l'opzione `avoirsPlafonnes` può emettere note di credito solo fino al tetto impostato nelle impostazioni dell'officina.

## Terminali d'officina

Le persone con `gererEmployes` creano, disattivano e reimpostano i terminali d'officina (`socle.borne.*`, `POST /api/v1/bornes`). Il server genera il login e la password del terminale e mostra la password una sola volta. I PIN sono personali per ogni tecnico e vengono gestiti separatamente.

## Cosa riceve l'interfaccia web

`GET /api/v1/auth/moi` restituisce l'elenco ordinato delle azioni che la persona possiede (`actions`) e la sua griglia (`capacites`, con `prereglage` e `personnalisee`). `GET /api/v1/capacites/modele` restituisce le aree, i livelli, le opzioni e le preimpostazioni con le chiavi i18n, per disegnare la schermata "chi può fare cosa".

## Sedi

Un utente può avere accesso a tutte le sedi dell'autorimessa, oppure a una sola. Il terminale d'officina ha sempre una sola sede.

## Cambiare un ruolo

Cambiare il ruolo di una persona applica la preimpostazione del nuovo ruolo e sostituisce la sua griglia (l'audit conserva quella precedente). Per reimpostare una griglia personalizzata, applichi di nuovo la preimpostazione. Quando una persona lascia l'autorimessa, disattivi il suo account invece di eliminarlo. Il registro di audit fa riferimento all'account, quindi deve restare al suo posto.
