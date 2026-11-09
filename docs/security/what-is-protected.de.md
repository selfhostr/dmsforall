---
title: Was geschützt ist und was nicht
description: Die Sicherheitsmassnahmen, die dmsforall bietet, jene, die es nicht bietet, und was der Betreiber tun muss.
---

Diese Seite listet die Schutzmassnahmen auf, die dmsforall im Code bietet, die Lücken, die in dieser Version bestehen, und was Sie selbst betreiben müssen. Lesen Sie sie, bevor Sie echte Daten auf einen Server legen.

## Was dmsforall schützt

**Trennung zwischen Garagen.** Jede Garage ist ein Mandant. Jede Mandanten-Tabelle hat eine Spalte `tenant_id` und die Row-Level-Security von PostgreSQL. Die API begrenzt zudem jede Abfrage auf den Mandanten der angemeldeten Person. Der Mandant stammt aus der Sitzung, nie aus einem Anfrageparameter. Die API verbindet sich mit einer Rolle, für die Row-Level-Security gilt, und die Migrationen verwenden eine andere Rolle.

**Passwörter und Anmeldung.** Passwörter werden mit Argon2id gehasht. Anmeldeversuche sind pro IP-Adresse und pro Konto begrenzt. Nach wiederholten falschen Passwörtern wird das Konto für eine gewisse Zeit gesperrt. Das Zurücksetzen des Passworts erfolgt mit einem Token, das per E-Mail gesendet wird.

**Sitzungen.** Das Sitzungs-Cookie ist nur über HTTP zugänglich. Es ist standardmässig als `Secure` markiert, und die Produktionskonfiguration startet nicht, wenn dies abgeschaltet ist. Die API prüft den Header `Origin` von Anfragen, die Daten ändern.

**Rechte.** Jede Route prüft die Rechte der Rolle gegen eine einzige Rechtematrix. Siehe [Rollen und Rechte](../reference/roles-and-rights.md).

**Geld.** Beträge sind ganze Zahlen in Rappen. Eine ausgestellte Rechnung ist gesperrt, und eine Korrektur erfolgt durch eine Gutschrift. Das Prüfprotokoll erfasst, wer eine sensible Entität wann geändert hat, mit den Werten vorher und nachher.

**Konfiguration.** Die API prüft jede Variable beim Start und startet nicht bei einem ungültigen Wert. In der Produktion lehnt sie die Passwörter der Entwicklungsdatenbank ab.

**API-Dokumentation.** Die OpenAPI-Dokumentation ist standardmässig ausgeschaltet. Sie wird nur veröffentlicht, wenn `OPENAPI_EXPOSER_DOCS=true` gesetzt ist.

**Ort der Daten.** Alles läuft auf Ihrem Server. dmsforall sendet keine Daten an einen Drittdienst. Die optionale Fehlermeldung geht nur an den Sentry-kompatiblen Server, den Sie in `SENTRY_DSN` festlegen.

## Was dmsforall nicht schützt

- **Zweiter Faktor für Garagenkonten.** Die Zwei-Faktor-Authentifizierung (TOTP) ist für das Personal der Garagen in dieser Version nicht verfügbar. Die Betreiberkonsole, die von Garagen nicht genutzt wird, verlangt einen zweiten Faktor. Verwenden Sie für alle Konten lange, einzigartige Passwörter.
- **Verschlüsselung im Ruhezustand.** Docker-Named-Volumes werden von Docker nicht verschlüsselt. Verschlüsseln Sie die Festplatte oder Partition, auf der das Docker-Datenverzeichnis liegt.
- **Backups ausserhalb des Standorts.** Das nächtliche Backup ist verschlüsselt, bleibt aber auf demselben Server, bis Sie eine Kopie ausserhalb einrichten. Ein Backup auf derselben Festplatte schützt nicht vor dem Verlust des Servers. Siehe [Sichern und wiederherstellen](../get-started/backup-and-restore.md).
- **Der PDF-Cache.** Er wird nicht gesichert. Er wird aus der Datenbank neu erzeugt.
- **Der Server selbst.** Das Betriebssystem, der Docker-Host, seine Benutzer und seine Aktualisierungen liegen in Ihrer Verantwortung.
- **Zugriff auf die Datenbank.** Wer das Passwort des PostgreSQL-Superusers kennt, kann alle Daten lesen. Bewahren Sie dieses Passwort getrennt von den Passwörtern der Anwendung auf.
- **Sicherheit auf dem Client.** Ein Browser, der unverschlossen bleibt, gibt Zugriff auf das angemeldete Konto. Legen Sie Sitzungsdauern fest, die zu Ihrem Personal passen. Siehe die Variablen `SESSION_*` in der [Konfigurationsreferenz](../reference/configuration.md).
- **Rate-Limits hinter einem Proxy.** Die Limits verwenden die IP-Adresse des Clients. Ist `TRUST_PROXY_HOPS` falsch gesetzt, können alle Benutzer dasselbe Limit teilen, oder ein Client kann seine Adresse fälschen.

## Was Sie tun müssen

1. Betreiben Sie dmsforall nur über HTTPS, mit einem gültigen Zertifikat.
2. Ersetzen Sie alle Entwicklungspasswörter vor dem ersten Start. Verwenden Sie einen Passwort-Manager.
3. Setzen Sie `TRUST_PROXY_HOPS` auf die Anzahl der Reverse-Proxys vor der API.
4. Belassen Sie in der Produktion `OPENAPI_EXPOSER_DOCS=false` und `COOKIE_SECURE=true`.
5. Schliessen Sie an der Firewall jeden Port ausser 80 und 443.
6. Halten Sie Server, Docker und die Images aktuell. Siehe [Aktualisieren](../operations/upgrading.md).
7. Testen Sie regelmässig die Wiederherstellung Ihrer Backups.
8. Prüfen Sie mindestens einmal im Jahr die Rollen Ihres Personals und deaktivieren Sie die Konten von Personen, die die Garage verlassen.

Um eine Sicherheitslücke zu melden, folgen Sie [SECURITY.md](https://github.com/selfhostr/dmsforall/blob/main/SECURITY.md). Öffnen Sie kein öffentliches Ticket.
