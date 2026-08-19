Glossaire de terminologie – DFA
================================

Terminologie automobile et métier garage suisse : FR (source) / DE (conventions suisses) / IT (Tessin).

Conventions appliquées :

- DE : conventions suisses (« ss » au lieu de « ß »), vouvoiement (Sie)
- IT : italien de Suisse (Tessin), vocabulaire automobile suisse
- Ambiguïtés/variations signalées en notes

Termes métier essentiels
-------------------------

- Ordine di riparazione (OR) — DE : Reparaturauftrag ; IT : Ordine di riparazione. Commandement de travail en atelier. Clé du modèle métier. Les trois termes sont stables intercantonaux.
- Atelier — DE : Werkstatt ; IT : Officina. Le lieu physique de réparation/entretien. Terminologie stable.
- Voiture neuve (VN) — DE : Neuwagen ; IT : Veicolo nuovo. Classe commerciale : jamais immatriculée avant la vente. Stable.
- Voiture d'occasion (VO) — DE : Gelegenheitswagen / Occasion ; IT : Veicolo usato / Auto usata. VO peut aussi se dire « Occasion » en DE suisse romande. IT : « usato » est intercantonale, « auto usata » courant en Tessin.
- Expertise / Contrôle technique — DE : MFK (Motorfahrzeugkontrolle) ; IT : Collaudo / Ispezione tecnica. En Suisse, l'expertise obligatoire s'appelle MFK. IT : « collaudo » (test), « ispezione » (inspection) sont interchangeables en Tessin. Variable selon contexte (achat vs maintenance).
- Pointage horaire — DE : Zeiterfassung ; IT : Registrazione oraria. Enregistrement des heures travaillées par technicien/magasinier. Terminologie stable.
- Devis — DE : Angebot / Offerte ; IT : Preventivo. Proposition non-engageante. « Offerte » moins courant en DE suisse alémanique.
- Facture — DE : Rechnung ; IT : Fattura. Document de facturation engageant. Stable.
- Avoir / Note de crédit — DE : Gutschrift / Kreditnote ; IT : Nota di credito / Avere. Correction de facture (retour marchandise, ajustement prix). DE : « Gutschrift » favori en Suisse. IT : « avere » est terme comptable classique.
- Pièce / Article — DE : Ersatzteil / Teil ; IT : Pezzo / Ricambio. Composant automobile. DE : « Ersatzteil » = spare part exact. « Teil » courant à l'oral. IT : « ricambio » plus commercial, « pezzo » technique.
- Stock / Inventaire — DE : Lager / Bestand ; IT : Magazzino / Inventario. Quantités en reserve. DE : « Bestand » = stock comptable, « Lager » = lieu. IT : stable.
- Client — DE : Kunde ; IT : Cliente. Personne physique ou morale achetant services/pièces. Stable.
- Véhicule — DE : Fahrzeug ; IT : Veicolo. Objet automobile générique (voiture, moto, camion…). Stable.
- Plaque d'immatriculation — DE : Kennzeichen / Nummernschild ; IT : Targa. Identifiant véhicule. DE : « Nummernschild » = littéral ; « Kennzeichen » = officiel fédéral suisse. IT : stable.
- Mise en circulation — DE : Inbetriebnahme / Immatriculation ; IT : Immissione in circolazione / Messa in circolazione. Premier enregistrement véhicule chez l'autorité. DE : contexte administratif = « Immatriculation ». IT : « immissione » formel, « messa » courant.
- Reprise / Permuta — DE : Inzahlungnahme / Tausch ; IT : Ripresa / Permuta. Reprise VO en échange d'achat VN. DE : « Inzahlungnahme » = techniquement trade-in. « Tausch » = troc courant à l'oral en Suisse alémanique. IT : « permuta » = troc, « ripresa » = terme général de reprise. Variable selon garage/contrat.
- Technicien / Mécanicien — DE : Techniker / Mechaniker ; IT : Meccanico / Tecnico. Rôle : travail atelier + réparations. DE : « Mechaniker » = manual skill, « Techniker » = diagnostic/électronique. IT : « meccanico » tradition, « tecnico » moderne/diagnostic. Courant : les deux termes côexistent.
- Magasinier — DE : Lagermeister / Lagerverwaltung ; IT : Addetto al magazzino / Responsabile magazzino. Gestion stock pièces. DE : « Lagermeister » = chef magasin, « Lagerverwaltung » = fonction. IT : stable.
- Chef d'atelier — DE : Werkstattleiter ; IT : Responsabile officina. Supervision atelier, planification OR, responsable QA. Stable.
- Chiffre d'affaires — DE : Umsatz ; IT : Fatturato / Volume d'affari. Montant total ventes/services. Stable.
- TVA / Taxe sur la valeur ajoutée — DE : MwSt. / Mehrwertsteuer ; IT : IVA / Imposta sul valore aggiunto. Taxe fédérale suisse. Taux CH : 8.1% standard, 2.6% réduit, 3.8% logement. Stable.
- QR-facture — DE : QR-Rechnung ; IT : Fattura QR. Standard suisse de paiement depuis 2022. Terminologie stable.
- Export comptable — DE : Buchhaltungsexport ; IT : Esportazione contabile. Envoi données vers fiduciaire (Bexio, WinBIZ, Abacus, Banana). Terminologie interne, stable.
- Session utilisateur — DE : Benutzer-Sitzung ; IT : Sessione utente. Authentification + durée de connexion. Stable.

Notes critiques pour le développement
---------------------------------------

- OR (Reparaturauftrag/Ordine) — Clé à tous niveaux : workflow, API, BD, audit. Pas d'alias.
- Expertise (MFK) — Contexte légal CH ; ne jamais « test » ou « inspection » générique en interface suisse.
- VO/VN — Classification commerciale stricte, pas intercorrélée. Vérifier contrats garage.
- Reprise — Varie par garage (certains la nomment « permuta », d'autres « part-exchange ») et canton. À valider avec chaque premier garage avant modulo Ventes.
- Pointage — Fonction souvent externalisée (Zeiterfassung dédiée) ; risque de confusion avec « pointeur » = badge d'accès.
- TVA — Calculée par ligne, arrondie au 5 centimes (CHF). Règle immuable en Suisse.
- Allemand suisse — Vouvoiement formel (Sie) partout. Jamais de « ß », toujours « ss ». Éviter jargon informatique (ex : « Passwort » pas « Password »).
- Italien (Tessin) — Formel aussi. « Officina » préféré à « garage » en IT. « Meccanico » + « tecnico » coexistent — préférer contexte (diagnostic = tecnico, repair = meccanico).

Termes de l'étape 1 (Atelier + Clients) — STABLE
--------------------------------------------------

- Réceptionnaire — DE : Annahmestelle / Berater ; IT : Receptionist / Accettatore. Agent au comptoir. DE : « Berater » courant en Suisse alémanique, parfois « Annahmebeamte » pour l'autorité. IT : « accettatore » plus formel.
- Chef d'atelier — DE : Werkstattleiter ; IT : Responsabile officina. Supervision, planification. DE : variant « Schichtleiter » si poste ; IT stable.
- Réception (étape B) — DE : Annahme ; IT : Accettazione / Presa in carico. Premier bilan du véhicule. IT : « accettazione » légale, « presa in carico » courant atelier.
- Localisation du véhicule — DE : Fahrzeugposition / Standort ; IT : Localizzazione / Ubicazione. Où est le véhicule en ce moment. Terminologie stable.
- Travaux reportés — DE : Zurückgestellte Arbeiten ; IT : Lavori rinviati. Constatations non exécutées, représentées au prochain RDV. Stable.
- Véhicule de remplacement — DE : Ersatzfahrzeug ; IT : Veicolo sostitutivo. Voiture de courtoisie. Terminologie stable.
- Boîte à clés — DE : Schlüsselversteck ; IT : Cassetta con chiavi. Dépôt de nuit. Terminologie régionale, stable en Suisse.
- Mandat de réparation — DE : Reparaturvollmacht ; IT : Mandato di riparazione. Accord signé client. Stable.
- Devis complémentaire — DE : Nachtragsofferte / Kostenvoranschlag ; IT : Preventivo supplementare. Accord sur travaux constatés. Supra noté. DE : « Nachtragsofferte » + précis, « Kostenvoranschlag » + générique. IT : stable.
- Contrôle qualité — DE : Qualitätskontrolle ; IT : Controllo qualità. Inspection post-travaux. Stable.
- Signature réception — DE : Annahmesignatur ; IT : Firma di accettazione. Mandat signé à la réception. Stable.
- Pièce à restituer — DE : Austauschteil / Ersatzteil-Rückgabe ; IT : Pezzo da restituire / Ricambio da rendere. Pièce remplacée remise au client. Terminologie stable.
- Montant plafond — DE : Kostendach / Kostengrenze ; IT : Tetto di spesa. Supra noté.

Termes à surveiller après lancements phase 1 (Atelier + Clients)
-------------------------------------------------------------------

- Ambiguïtés régionales (certains cantons, certains garagistes) :
  - Reprise/Permuta : valider avec 3+ garages VD/VS/TI
  - Expertise : si garage offre MFK externe, comment l'appeler en IT/DE ?
  - Réceptionnaire : titre exact varie par garage (conseiller, chargé, agent) — jamais « administrateur » ou jargon IT
- Évolution possible (feedback utilisateur) :
  - Rôles : « Chef d'atelier » parfois aussi « Superviseur » en DE
  - Pointage : si intégration externe, exposer termes de cette interface (ex: Swisstime labels)
  - Localisation : certains garages utilisent des localisations supplémentaires spécifiques (« post 1 », « post 2 »)
