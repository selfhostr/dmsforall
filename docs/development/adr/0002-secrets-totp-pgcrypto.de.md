# ADR 0002: TOTP-Geheimnisse mit pgcrypto verschlüsselt

Diese Entscheidung wurde am 27.08.2026 von @laupernoe angenommen. Sie legt fest, wie TOTP-Geheimnisse im Ruhezustand geschützt werden.

## Ausgangslage

Zwei Funktionen brauchen dieselbe Entscheidung: der zweite Faktor für das Personal der Garage und die Anmeldung an der Betreiberkonsole. Die Konsole ist gebaut (Migration 0048, der Pool `dfa_console`, fünf `SECURITY DEFINER`-Funktionen, eine eigene Oberfläche), aber die Anmeldung ist erst erreichbar, wenn eine Frage geklärt ist: Wie wird das TOTP-Geheimnis geschützt, das in `exploitation.exploitant.totp_secret_chiffre` gespeichert ist?

Solange diese Frage offen ist, lässt sich die Flotte der Garagen nur über SQL verwalten, und es kann kein zweiter Faktor angeboten werden.

## Entscheidung

Verschlüsselung innerhalb von PostgreSQL mit `pgcrypto`.

## Bedingung, unter der diese Entscheidung gilt

Der Schlüssel darf nie in der Datenbank gespeichert werden, auch nicht in der Konfiguration des PostgreSQL-Servers. Er wird der Abfrage beim Verschlüsseln und Entschlüsseln aus der Konfiguration der Anwendung übergeben.

Ohne diese Bedingung verliert die Entscheidung den grössten Teil ihres Werts: Ein Schlüssel, der neben den Daten liegt, die er schützt, schützt nichts. Mit ihr reicht der Lesezugriff auf die Datenbank (Backup, Replika, Dump) nicht aus, um die Geheimnisse zu gewinnen.

## Begründung

Weniger bewegliche Teile als ein externer Secrets-Manager, der eine betriebliche Abhängigkeit hinzufügen würde, die im Produkt bisher durch nichts gerechtfertigt ist.

Das übliche Risiko dieses Ansatzes, «ein gestohlenes Backup enthält alles», ist bereits verringert: Backups werden mit `age` verschlüsselt, ein gestohlenes Backup ist also nicht im Klartext lesbar. Die Verschlüsselung mit `pgcrypto` ist eine zweite Schicht, nicht die einzige.

## Kosten

Die Rotation des Schlüssels erfolgt von Hand und verlangt, die bestehenden Geheimnisse neu zu verschlüsseln. Bei der aktuellen Grösse, zunächst einige Betreiber und später einige hundert Garagen, ist das vertretbar. Bewerten Sie es neu, wenn die Anzahl der Geheimnisse die Rotation unpraktisch macht.

## Verworfen

- **Eine eigene Umgebungsvariable**, wie beim Schlüssel von `age`. Sie passt zur bestehenden Einrichtung, überlässt aber die gesamte Entschlüsselung der Anwendung.
- **Ein Secrets-Manager** (SOPS, Vault, der Dienst eines Hosters). Die robusteste Option, verworfen, um heute keine betriebliche Komponente hinzuzufügen, die nicht gerechtfertigt ist.
- **TOTP aufschieben.** Verworfen, weil die Konsole sonst ohne festen Termin unerreichbar bliebe.
