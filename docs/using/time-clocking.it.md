---
title: Rilevare il tempo sugli ordini di riparazione
description: Permettere ai tecnici di timbrare il proprio tempo sugli ordini di riparazione dal terminale d'officina, e chiudere e bloccare la giornata.
---

Il rilevamento delle ore registra quanto tempo ogni tecnico lavora su ogni ordine di riparazione. I dati alimentano gli indicatori di produttività dell'officina.

Alla fine di questa pagina un tecnico potrà timbrare l'inizio e la fine su un ordine dal terminale d'officina, e saprà come si chiude la giornata.

## Configurare il terminale d'officina

1. Crei un account con il ruolo `poste_atelier` per la sede. Questo account è il terminale, non una persona.
2. Apra l'account del terminale sullo schermo in officina. Mostra l'elenco degli ordini aperti.
3. Ogni tecnico si identifica con il proprio PIN.

Risultato: il terminale mostra chi è in servizio e su quale ordine.

## Timbrare l'inizio e la fine

1. Il tecnico inserisce il proprio PIN.
2. Il tecnico sceglie l'ordine.
3. Timbra l'inizio quando il lavoro comincia, e la fine quando si ferma.

Un tecnico può anche timbrare il tempo dal proprio account, sul computer o su un telefono, se il ruolo lo consente.

## Stati

Una registrazione di tempo è `en_cours` mentre è in corso, poi `termine`. Le registrazioni di una giornata diventano `valide` quando il responsabile dell'officina le ha verificate, e `verrouille` quando il periodo viene bloccato. Una registrazione bloccata non può essere modificata.

## Chiudere la giornata

Ogni sede ha un orario di chiusura. Quando l'orario è passato, le registrazioni aperte vengono chiuse automaticamente se è attiva l'attività di chiusura automatica. L'attività viene eseguita ogni notte alle 00:30 UTC per impostazione predefinita. Il responsabile dell'officina verifica poi le registrazioni della giornata.

:::caution
Il PIN identifica il tecnico dietro una registrazione di tempo. Tenga i PIN riservati e non li scriva sul terminale.
:::

:::caution
L'account del terminale non ha alcun diritto sul denaro. Non può vedere gli importi né emettere documenti.
:::
