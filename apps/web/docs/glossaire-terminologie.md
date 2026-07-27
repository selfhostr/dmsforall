# Glossaire de terminologie – DFA

Terminologie automobile et métier garage suisse : FR (source) / DE (conventions suisses) / IT (Tessin).

**Conventions appliquées** :
- DE : conventions suisses (« ss » au lieu de « ß »), vouvoiement (Sie)
- IT : italien de Suisse (Tessin), vocabulaire automobile suisse
- Ambiguïtés/variations signalées en notes

## Termes métier essentiels

| FR | DE | IT | Notes & ambiguïtés |
|---|---|---|---|
| **Ordine di riparazione (OR)** | Reparaturauftrag | Ordine di riparazione | Commandement de travail en atelier. Clé du modèle métier. Les trois termes sont stables intercantonaux. |
| **Atelier** | Werkstatt | Officina | Le lieu physique de réparation/entretien. Terminologie stable. |
| **Voiture neuve (VN)** | Neuwagen | Veicolo nuovo | Classe commerciale : jamais immatriculée avant la vente. Stable. |
| **Voiture d'occasion (VO)** | Gelegenheitswagen / Occasion | Veicolo usato / Auto usata | VO peut aussi se dire « Occasion » en DE suisse romande. IT : « usato » est intercantonale, « auto usata » courant en Tessin. |
| **Expertise / Contrôle technique** | MFK (Motorfahrzeugkontrolle) | Collaudo / Ispezione tecnica | En Suisse, l'expertise obligatoire s'appelle MFK. IT : « collaudo » (test), « ispezione » (inspection) sont interchangeables en Tessin. Variable selon contexte (achat vs maintenance). |
| **Pointage horaire** | Zeiterfassung | Registrazione oraria | Enregistrement des heures travaillées par technicien/magasinier. Terminologie stable. |
| **Devis** | Angebot / Offerte | Preventivo | Proposition non-engageante. « Offerte » moins courant en DE suisse alémanique. |
| **Facture** | Rechnung | Fattura | Document de facturation engageant. Stable. |
| **Avoir / Note de crédit** | Gutschrift / Kreditnote | Nota di credito / Avere | Correction de facture (retour marchandise, ajustement prix). DE : « Gutschrift » favori en Suisse. IT : « avere » est terme comptable classique. |
| **Pièce / Article** | Ersatzteil / Teil | Pezzo / Ricambio | Composant automobile. DE : « Ersatzteil » = spare part exact. « Teil » courant à l'oral. IT : « ricambio » plus commercial, « pezzo » technique. |
| **Stock / Inventaire** | Lager / Bestand | Magazzino / Inventario | Quantités en reserve. DE : « Bestand » = stock comptable, « Lager » = lieu. IT : stable. |
| **Client** | Kunde | Cliente | Personne physique ou morale achetant services/pièces. Stable. |
| **Véhicule** | Fahrzeug | Veicolo | Objet automobile générique (voiture, moto, camion…). Stable. |
| **Plaque d'immatriculation** | Kennzeichen / Nummernschild | Targa | Identifiant véhicule. DE : « Nummernschild » = littéral ; « Kennzeichen » = officiel fédéral suisse. IT : stable. |
| **Mise en circulation** | Inbetriebnahme / Immatriculation | Immissione in circolazione / Messa in circolazione | Premier enregistrement véhicule chez l'autorité. DE : contexte administratif = « Immatriculation ». IT : « immissione » formel, « messa » courant. |
| **Reprise / Permuta** | Inzahlungnahme / Tausch | Ripresa / Permuta | Reprise VO en échange d'achat VN. DE : « Inzahlungnahme » = techniquement trade-in. « Tausch » = troc courant à l'oral en Suisse alémanique. IT : « permuta » = troc, « ripresa » = terme général de reprise. **Variable selon garage/contrat.** |
| **Technicien / Mécanicien** | Techniker / Mechaniker | Meccanico / Tecnico | Rôle : travail atelier + réparations. DE : « Mechaniker » = manual skill, « Techniker » = diagnostic/électronique. IT : « meccanico » tradition, « tecnico » moderne/diagnostic. Courant : les deux termes côexistent. |
| **Magasinier** | Lagermeister / Lagerverwaltung | Addetto al magazzino / Responsabile magazzino | Gestion stock pièces. DE : « Lagermeister » = chef magasin, « Lagerverwaltung » = fonction. IT : stable. |
| **Chef d'atelier** | Werkstattleiter | Responsabile officina | Supervision atelier, planification OR, responsable QA. Stable. |
| **Chiffre d'affaires** | Umsatz | Fatturato / Volume d'affari | Montant total ventes/services. Stable. |
| **TVA / Taxe sur la valeur ajoutée** | MwSt. / Mehrwertsteuer | IVA / Imposta sul valore aggiunto | Taxe fédérale suisse. Taux CH : 8.1% standard, 2.6% réduit, 3.8% logement. Stable. |
| **QR-facture** | QR-Rechnung | Fattura QR | Standard suisse de paiement depuis 2022. Terminologie stable. |
| **Export comptable** | Buchhaltungsexport | Esportazione contabile | Envoi données vers fiduciaire (Bexio, WinBIZ, Abacus, Banana). Terminologie interne, stable. |
| **Session utilisateur** | Benutzer-Sitzung | Sessione utente | Authentification + durée de connexion. Stable. |

## Notes critiques pour le développement

- **OR (Reparaturauftrag/Ordine)** : Clé à tous niveaux — workflow, API, BD, audit. Pas d'alias.
- **Expertise (MFK)** : Contexte légal CH ; ne **jamais** "test" ou "inspection" générique en interface suisse.
- **VO/VN** : Classification commerciale stricte, pas intercorrélée. Vérifier contrats garage.
- **Reprise** : Varie par garage (certains la nomment "permuta", d'autres "part-exchange") et canton. **À valider avec chaque premier garage avant modulo Ventes.**
- **Pointage** : Fonction souvent externalisée (Zeiterfassung dédiée) ; risque de confusion avec "pointeur" = badge d'accès.
- **TVA** : Calculée par ligne, arrondie au 5 centimes (CHF). Règle immuable en Suisse.
- **Allemand suisse** : Vouvoiement formel (Sie) partout. Jamais de « ß », toujours « ss ». Éviter jargon informatique (ex : « Passwort » pas « Password »).
- **Italien (Tessin)** : Formel aussi. « Officina » préféré à « garage » en IT. « Meccanico » + « tecnico » coexistent — préférer contexte (diagnostic = tecnico, repair = meccanico).

## Termes à surveiller après lancements phase 1 (Atelier + Clients)

- Ambiguïtés régionales (certains cantons, certains garagistes) :
  - Reprise/Permuta : valider avec 3+ garages VD/VS/TI
  - Expertise : si garage offre MFK externe, comment l'appeler en IT/DE ?
- Évolution possible (feedback utilisateur) :
  - Rôles : « Chef d'atelier » parfois aussi « Superviseur » en DE
  - Pointage : si intégration externe, exposer termes de cette interface (ex: Swisstime labels)

