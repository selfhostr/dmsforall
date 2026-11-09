---
title: Neu- und Occasionswagen verkaufen
description: Den Bestand an Neu- und Occasionswagen führen, Verkaufsdossiers, Inzahlungnahmen sowie Bestätigungen von Finanzierung oder Leasing verwalten.
---

Das Verkaufs-Modul umfasst Neuwagen (VN, _véhicules neufs_) und Occasionswagen (VO, _véhicules d'occasion_). Es verfolgt das Fahrzeug von der Bestellung bis zur Übergabe, das dazugehörige Verkaufsdossier, die Inzahlungnahme des Fahrzeugs des Kunden und die Finanzierung.

Am Ende dieser Seite können Sie ein Fahrzeug in den Bestand aufnehmen, ein Verkaufsdossier eröffnen und es bis zur Übergabe verfolgen.

## Status der Fahrzeuge

| Status        | Bedeutung                        |
| ------------- | -------------------------------- |
| `en_commande` | Bestellt, noch nicht im Bestand. |
| `disponible`  | Im Bestand und verkaufsbereit.   |
| `reserve`     | Für einen Kunden reserviert.     |
| `vendu`       | Verkauft.                        |
| `livre`       | Dem Kunden übergeben.            |

## Status der Verkaufsdossiers

Ein Verkaufsdossier geht von `prospection` (In Anbahnung) über `engage` (Verbindlich bestellt) zu `en_preparation` (In Vorbereitung), `pret_a_livrer` (Übergabebereit), `livre` (Übergeben) und `clos` (Abgeschlossen). Ein Dossier kann auch `annule` (Storniert) oder `abandonne` (Aufgegeben) sein.

## Inzahlungnahme

Das Fahrzeug des Kunden kann als Teil der Zahlung in Zahlung genommen werden. Die Inzahlungnahme geht von `estimee` (Geschätzter Wert) über `negociee` (In Verhandlung) zu `confirmee` (Bestätigt) oder `refusee` (Abgelehnt).

## Finanzierung

Ein Verkauf kann bar (`comptant`), mit einem Bankkredit (`credit`) oder mit Leasing (`leasing`) bezahlt werden.

- Bei Barzahlung ist die Finanzierung sofort bestätigt.
- Bei einem Kredit oder Leasing beginnt die Bestätigung mit `en_attente` (Ausstehend). Die Finanzierungsgesellschaft bestätigt oder lehnt sie dann ab. Erfassen Sie die Antwort im Verkaufsdossier.

:::caution
Beim Leasing wird das Fahrzeug an die Leasinggesellschaft verkauft, nicht an den Kunden. Die Rechnung muss diesem Aufbau folgen. Prüfen Sie das mit Ihrem Treuhänder.
:::
