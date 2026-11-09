---
title: Häufig gestellte Fragen
description: Antworten auf die häufigsten Fragen zu dmsforall, zur Lizenz, zu den Funktionen und zu den Grenzen.
---

## Gibt es eine gehostete Version?

Nein. dmsforall ist Software, die Sie auf Ihrem eigenen Server betreiben. Das Projekt bietet keinen gehosteten Dienst und keine kostenpflichtige Ausgabe. Die Lizenz ist MIT.

## Was kostet es?

Die Software ist unter der MIT-Lizenz kostenlos. Ihre Kosten sind der Server, der Domainname, das TLS-Zertifikat, die Backups und Ihre Zeit.

## Welche Sprachen unterstützt die Oberfläche?

Französisch, Deutsch und Italienisch. Die Dokumentation ist auf Englisch verfasst.

## Können mehrere Garagen eine Installation nutzen?

Ja. Jede Garage ist ein Mandant mit eigenen Daten, die durch Row-Level-Security getrennt sind. Jede Garage hat eigene Benutzer und eigene Standorte.

## Unterstützt es meine Buchhaltungssoftware?

Der Buchhaltungsexport ist nur für WinBIZ verfügbar. Andere Formate wie Bexio, Abacus, Banana und generisches CSV sind in dieser Version nicht verfügbar.

## Versendet es SMS?

Nein. SMS ist im Datenmodell vorgesehen, aber in dieser Version ist kein SMS-Anbieter angebunden. Mahnungen werden per E-Mail versendet.

## Liest es Kontoauszüge ein?

Nein. Der Abgleich von Kontoauszügen (camt.054) ist in dieser Version nicht verfügbar.

## Kann ich die Marge jedes Teils sehen?

Nicht zuverlässig. Die Bewertung des Lagers nach FIFO ist beschlossen, aber noch nicht umgesetzt.

## Kann ich die Daten meiner bisherigen Software übernehmen?

Ja, aus Archiven von Microsoft Access und dBase/FoxPro. Der Import wurde mit Archiven getestet, die aus Auto-i exportiert wurden. Keine Verbindung zu Auto-i. Siehe [Daten importieren](../using/data-import.md).

## Ist es in der Schweiz rechtskonform?

dmsforall ist für das Schweizer Recht und die Schweizer MWST gebaut, mit QR-Rechnungen und Beträgen in Rappen. Das Projekt gibt keine rechtliche oder steuerliche Garantie. Lassen Sie Ihre Rechnungen, Ihre MWST und Ihre Exporte von einem Treuhänder prüfen, bevor Sie sich darauf verlassen.

## Wo werden meine Daten gespeichert?

Auf dem Server, den Sie betreiben. dmsforall sendet keine Daten an das Projekt oder an Dritte. Wo dieser Server steht, entscheiden Sie.

## Gibt es eine Demo?

Für Entwicklerinnen und Entwickler lädt `pnpm db:seed` eine Demo-Garage in eine Entwicklungsdatenbank. Siehe [Mitarbeit](../development/contributing.md). Die Demo-Konten werden in der Produktion nicht angelegt.

## Funktioniert es auf einem Tablet oder Smartphone?

Die Oberfläche läuft im Browser. Sie hat Dichte-Einstellungen für Büro-Bildschirme, Tablets sowie für die Bildschirme zu Terminen und zur Zeiterfassung.

## Kann ich das Design ändern?

Ja. Das helle und das dunkle Design sind in der Oberfläche verfügbar. Die Wahl wird im Browser jedes Geräts gespeichert.

## Wie aktualisiere ich auf eine neue Version?

Folgen Sie [dmsforall aktualisieren](upgrading.md).
