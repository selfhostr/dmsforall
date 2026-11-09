---
title: Rollen und Rechte
description: Wie Rechte in dmsforall funktionieren - ein Raster pro Person, Rollen als Vorlagen und wo die Rechte festgelegt sind.
---

Jede Person hat ein **Raster** von Rechten, nicht eine einzige exklusive Rolle. Das Raster legt für sechs Bereiche fest, ob die Person nichts sieht, ansehen oder bearbeiten kann. Eine Rolle (`direction`, `vendeur` usw.) ist nur eine **Vorlage**: das Ausgangsraster für eine neue Person, das die Inhaberin oder der Inhaber danach anpassen kann. Die API prüft die Rechte bei jeder Anfrage anhand des Rasters der Person, das aus der Datenbank gelesen wird. Die Web-Oberfläche blendet die Aktionen aus, die eine Person nicht ausführen darf, aber massgebend ist die API.

## Das Raster

| Bereich       | Nichts       | Ansehen                          | Bearbeiten                                  |
| ------------- | ------------ | -------------------------------- | ------------------------------------------- |
| `atelier`     | kein Zugriff | Reparaturaufträge, Journal       | starten, prüfen, Zeit erfassen, Positionen  |
| `accueil`     | kein Zugriff | Kunden, Fahrzeuge, Termine       | Empfang, Offerten, Termine                  |
| `facturation` | kein Zugriff | Dokumente, Zahlungen             | Entwurf, ausstellen, Zahlungen erfassen     |
| `pieces`      | kein Zugriff | Artikel, Lager, Reservierungen   | Lagerbewegungen, Bestellungen, Wareneingang |
| `ventes`      | kein Zugriff | Lagerfahrzeuge, Verkaufsdossiers | Verkäufe von Neu- und Occasionswagen        |
| `finances`    | kein Zugriff | Übersicht, Buchhaltungsexport    | Rückerstattungen, Korrekturen, Export       |

`Bearbeiten` schliesst `Ansehen` ein. Drei weitere Schalter liegen ausserhalb des Rasters:

- `encadrer` (Leitet das Team) - die Stunden anderer korrigieren, einen RA wieder öffnen, eine Sperre aufheben, die Werkstatt-Einstellungen ändern.
- `gererEmployes` ("Mitarbeitende und Einstellungen") - Konten und Werkstatt-Terminals. Folgt der Vorlage; nicht einzeln pro Schalter einstellbar.
- `patron` - unumkehrbare Handlungen: die IBAN des Gläubigers, das Starten einer Datenübernahme, der Austritt der Garage. Folgt der Vorlage (nur `direction`).

Drei Optionen pro Person:

- `voitMontants` (Sieht die Beträge) - sieht Preise, Summen und Beträge. Ohne sie kann eine Person die Fakturierung auf Stufe Bearbeiten, den Verkauf auf Stufe Bearbeiten oder eine Stufe der Finanzen nicht verwenden, und das PDF der Rechnung (das den Betrag enthält) wird abgelehnt.
- `voitPrixAchat` (Sieht die Einkaufspreise) - sieht Einkaufspreise und Margen bei Ersatzteilen.
- `avoirsPlafonnes` (Gutschriften begrenzt) - Gutschriften sind auf die Obergrenze begrenzt, die in den Werkstatt-Einstellungen festgelegt ist. Das ist eine Einschränkung, keine Befugnis.

Die Beträge werden **vom Server** aus den Antworten entfernt. Der Schalter wird bei jeder Anfrage aus dem Raster der Person gelesen.

## Vorlagen

| Vorlage          | Gespeicherte Rolle | Zusammenfassung                                                                                                     |
| ---------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `direction`      | `direction`        | Alles, einschliesslich `encadrer`, `gererEmployes`, `patron`.                                                       |
| `admin`          | `admin`            | Technischer Administrator: Werkstatt, Empfang, Konten. Kein Zugriff auf Geld, Lager oder Verkauf.                   |
| `comptable`      | `comptable`        | Fakturierung und Finanzen; sieht den Rest. Liest den Gläubigerblock, kann aber die IBAN nicht ändern.               |
| `fiduciaire`     | `comptable`        | Externer Buchhalter: Fakturierung und Finanzen nur auf Stufe Ansehen, sonst nichts. Sieht Beträge, schreibt nichts. |
| `receptionnaire` | `receptionnaire`   | Schalter: Empfang, Offerten, Rechnungen, Zahlungen. Gutschriften begrenzt.                                          |
| `vendeur`        | `vendeur`          | Verkauf und Fakturierung. Gutschriften begrenzt.                                                                    |
| `chef_atelier`   | `chef_atelier`     | Werkstattleiter: `encadrer`, Ersatzteile, Fakturierung. Gutschriften begrenzt.                                      |
| `technicien`     | `technicien`       | Nur Werkstatt, keine Beträge.                                                                                       |
| `magasinier`     | `magasinier`       | Ersatzteile und Schalterfakturierung, und erfasst seine Stunden. Gutschriften begrenzt.                             |

`fiduciaire` hat im Enum `role_utilisateur` keinen eigenen Wert: Es wird mit `role = comptable` gespeichert und anhand seines Rasters erkannt.

`poste_atelier` ist keine Vorlage, sondern ein **festes Geräteprofil** für ein Werkstatt-Terminal (Reparaturaufträge lesen, Zeit erfassen, sich mit PIN identifizieren). Sein Raster wird ignoriert.

Beim Wechsel von Rollen zu Vorlagen verliert keine Person ein Recht. Ein Test (`apps/api/src/auth/matrice-droits.spec.ts`) prüft für jede Aktion und jede Rolle, dass die Vorlage mindestens die alten Rechte beibehält, und hält jedes hinzugefügte Recht fest.

## Wie eine Aktion dem Raster zugeordnet wird

Jede der rund 170 Aktionen (`apps/api/src/auth/matrice-droits.ts`, die Bezeichnungen auf den Routen) ist einer oder zwei internen Fähigkeiten zugeordnet, in `apps/api/src/auth/capacites-actions.ts`. Eine Person darf die Aktion ausführen, wenn ihr Raster eine dieser Fähigkeiten gewährt. Die Tabelle ist mit `Record<Action, ...>` typisiert: Eine nicht klassifizierte Aktion lässt sich nicht kompilieren. `MATRICE_DROITS[role]` ist jetzt nur noch die Liste der Aktionen der Vorlage dieser Rolle.

## Trennung der Aufgaben

Die Stufe Bearbeiten allein gibt nicht jede Aktion des Bereichs. Eine Person, die den Ersatzteil-Lagerbetrieb führt (Ersatzteile: Bearbeiten), aber keine kaufmännische Befugnis hat (kein Ventes: Bearbeiten, kein Finanzen: Bearbeiten), kann ihre eigene Arbeit an einem Reparaturauftrag nicht prüfen, keine Offerten, Rechnungen oder Gutschriften ausstellen und keine Lieferantenrechnungen freigeben. Eine Werkstattleitung (`encadrer`) in dieser Lage kann Offerten ausstellen und Aufträge prüfen, nimmt aber keine Zahlungen entgegen, stellt keine Rechnungen oder Gutschriften aus, führt die Lagerbewegungen nicht und gibt keine Lieferantenrechnungen frei. Diese Regeln stehen in `capacitesDeLaGrille` (`packages/shared/src/contrats/capacites.ts`).

## Wer ein Raster ändern darf

`PATCH /api/v1/utilisateurs/{id}/capacites` und der Wechsel der Rolle erfordern das Recht `socle.utilisateur.modifier` (Mitarbeitende und Einstellungen). Dazu gilt:

- Sie können Ihr eigenes Raster oder Ihre eigene Rolle nicht ändern und Ihr eigenes Konto über die Mitarbeiter-Routen nicht zurücksetzen oder wieder aktivieren;
- Deaktivieren, Wiederaktivieren und Zurücksetzen des Zugangs einer Person folgen denselben Regeln wie die Änderung ihres Rasters (eine schwächere Person kann eine stärkere nicht übernehmen oder sperren);
- Sie können nichts gewähren, was Sie selbst nicht besitzen (die API nennt das betreffende Feld);
- Sie können keine Person ändern, die mehr Rechte hat als Sie; nur ein `admin` kann einen `admin` ändern;
- `admin` (der Integrator) kann jede Geschäftsvorlage zuweisen, also den ersten Inhaber einer Garage anlegen;
- der letzte aktive `patron` kann nicht herabgestuft oder deaktiviert werden (geprüft unter einer Sperre pro Garage, damit zwei gleichzeitige Herabstufungen nicht beide entfernen);
- Änderungen werden protokolliert (vorher und nachher); die Sitzungen einer Person, deren Rechte sinken, werden widerrufen.

## Obergrenze für Gutschriften

Eine Person mit der Option `avoirsPlafonnes` darf Gutschriften nur bis zur Obergrenze ausstellen, die in den Werkstatt-Einstellungen festgelegt ist.

## Werkstatt-Terminals

Personen mit `gererEmployes` legen Werkstatt-Terminals an, deaktivieren sie und setzen sie zurück (`socle.borne.*`, `POST /api/v1/bornes`). Der Server erzeugt Anmeldename und Passwort des Terminals und zeigt das Passwort nur einmal an. Die PIN gehört je Techniker und wird getrennt verwaltet.

## Was die Web-Oberfläche erhält

`GET /api/v1/auth/moi` liefert die sortierte Liste der Aktionen, die die Person hat (`actions`), und ihr Raster (`capacites`, mit `prereglage` und `personnalisee`). `GET /api/v1/capacites/modele` liefert die Bereiche, Stufen, Optionen und Vorlagen mit i18n-Schlüsseln, um die Ansicht «Wer darf was» zu zeichnen.

## Standorte

Eine Benutzerin oder ein Benutzer kann auf alle Standorte der Garage oder nur auf einen Standort zugreifen. Das Werkstatt-Terminal hat immer genau einen Standort.

## Rolle wechseln

Wenn Sie die Rolle einer Person wechseln, wird die Vorlage der neuen Rolle angewendet und das Raster ersetzt (das Prüfprotokoll behält das alte Raster). Um ein angepasstes Raster zurückzusetzen, wenden Sie die Vorlage erneut an. Wenn eine Person die Garage verlässt, deaktivieren Sie ihr Konto, statt es zu löschen. Das Prüfprotokoll verweist auf das Konto, daher muss es bestehen bleiben.
