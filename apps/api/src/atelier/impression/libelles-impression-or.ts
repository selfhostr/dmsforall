/**
 * Libellés de la feuille d'atelier (`GET /ordres-reparation/{orId}/pdf`) — même doctrine que
 * `facturation/impression/libelles-impression.ts` : dictionnaire minimal, LOCAL à ce module,
 * PAS le mécanisme i18next du front (pas de navigateur côté serveur pour interpoler des clés
 * ICU). La langue d'impression est celle du CLIENT (`document.client.langueCorrespondance`) —
 * cette feuille est accrochée au rétroviseur, donc potentiellement lue par lui, pas seulement par
 * le mécanicien.
 *
 * Vocabulaire garagiste (CONTRIBUTING.md « jamais de jargon IT ») : les enums `TypeOrdreReparation` et
 * `StatutOrdreReparation` sont des codes techniques (`en_cours`, `main_oeuvre_bareme`…) — ce
 * fichier porte leur traduction affichable, séparément par langue.
 */

import type { Langue, StatutOrdreReparation, TypeLigneOr, TypeOrdreReparation } from '@dfa/shared';

export interface LibellesOr {
  readonly ordreReparationNumero: (numero: string) => string;
  readonly site: string;
  readonly dateOuverture: string;
  readonly type: string;
  readonly statut: string;
  readonly vehicule: string;
  readonly immatriculation: string;
  readonly plaqueNonRenseignee: string;
  readonly vin: string;
  readonly vinNonRenseigne: string;
  readonly kilometrageEntree: string;
  readonly kilometrageSortie: string;
  readonly kilometrageNonReleve: string;
  readonly restitutionPromise: string;
  readonly restitutionNonDefinie: string;
  readonly technicien: string;
  readonly demandesTitre: string;
  readonly aucuneDemande: string;
  readonly lignesTitre: string;
  readonly colonneDesignation: string;
  readonly colonneQuantite: string;
  readonly aucuneLigne: string;
  readonly typeOrdreReparation: Readonly<Record<TypeOrdreReparation, string>>;
  readonly statutOrdreReparation: Readonly<Record<StatutOrdreReparation, string>>;
  readonly typeLigneOr: Readonly<Record<TypeLigneOr, string>>;
}

const FR: LibellesOr = {
  ordreReparationNumero: (numero) => `Ordre de réparation n° ${numero}`,
  site: 'Site',
  dateOuverture: "Date d'ouverture",
  type: "Type d'intervention",
  statut: 'Statut',
  vehicule: 'Véhicule',
  immatriculation: 'Immatriculation',
  plaqueNonRenseignee: 'Plaque non renseignée',
  vin: 'N° de châssis (VIN)',
  vinNonRenseigne: 'VIN non renseigné',
  kilometrageEntree: "Kilométrage à l'entrée",
  kilometrageSortie: 'Kilométrage à la sortie',
  kilometrageNonReleve: 'Non relevé',
  restitutionPromise: 'Restitution prévue',
  restitutionNonDefinie: 'Non définie',
  technicien: 'Technicien',
  demandesTitre: 'Demandes du client / instructions',
  aucuneDemande: 'Aucune demande enregistrée.',
  lignesTitre: 'Travaux à effectuer',
  colonneDesignation: 'Désignation',
  colonneQuantite: 'Qté',
  aucuneLigne: 'Aucune ligne enregistrée.',
  typeOrdreReparation: {
    service: 'Service',
    reparation: 'Réparation',
    diagnostic: 'Diagnostic',
    expertise: 'Expertise',
    pneus: 'Pneus',
    carrosserie: 'Carrosserie',
    retouche: 'Retouche',
    interne: 'Interne',
  },
  statutOrdreReparation: {
    planifie: 'Planifié',
    ouvert: 'Ouvert',
    en_cours: 'En cours',
    controle: 'Contrôle qualité',
    termine: 'Terminé',
    facture: 'Facturé',
    restitue: 'Restitué',
    cloture: 'Clôturé',
    annule: 'Annulé',
  },
  typeLigneOr: {
    main_oeuvre_bareme: 'Main-d’œuvre',
    main_oeuvre_temps_reel: 'Main-d’œuvre',
    forfait: 'Forfait',
    piece: 'Pièce',
    fourniture: 'Fourniture',
    sous_traitance: 'Sous-traitance',
    produit_atelier: 'Produit atelier',
    taxe: 'Taxe',
    remise: 'Remise',
    texte: 'Remarque',
  },
};

const DE: LibellesOr = {
  ordreReparationNumero: (numero) => `Werkstattauftrag Nr. ${numero}`,
  site: 'Standort',
  dateOuverture: 'Eröffnungsdatum',
  type: 'Auftragsart',
  statut: 'Status',
  vehicule: 'Fahrzeug',
  immatriculation: 'Kontrollschild',
  plaqueNonRenseignee: 'Kein Kontrollschild erfasst',
  vin: 'Fahrgestellnummer (VIN)',
  vinNonRenseigne: 'VIN nicht erfasst',
  kilometrageEntree: 'Kilometerstand bei Eingang',
  kilometrageSortie: 'Kilometerstand bei Ausgang',
  kilometrageNonReleve: 'Nicht erfasst',
  restitutionPromise: 'Voraussichtliche Rückgabe',
  restitutionNonDefinie: 'Nicht festgelegt',
  technicien: 'Techniker',
  demandesTitre: 'Kundenwünsche / Anweisungen',
  aucuneDemande: 'Keine Anfrage erfasst.',
  lignesTitre: 'Auszuführende Arbeiten',
  colonneDesignation: 'Bezeichnung',
  colonneQuantite: 'Menge',
  aucuneLigne: 'Keine Position erfasst.',
  typeOrdreReparation: {
    service: 'Service',
    reparation: 'Reparatur',
    diagnostic: 'Diagnose',
    expertise: 'Prüfung',
    pneus: 'Reifen',
    carrosserie: 'Karosserie',
    retouche: 'Nacharbeit',
    interne: 'Intern',
  },
  statutOrdreReparation: {
    planifie: 'Geplant',
    ouvert: 'Eröffnet',
    en_cours: 'In Arbeit',
    controle: 'Qualitätskontrolle',
    termine: 'Fertig',
    facture: 'Fakturiert',
    restitue: 'Zurückgegeben',
    cloture: 'Abgeschlossen',
    annule: 'Storniert',
  },
  typeLigneOr: {
    main_oeuvre_bareme: 'Arbeitszeit',
    main_oeuvre_temps_reel: 'Arbeitszeit',
    forfait: 'Pauschale',
    piece: 'Ersatzteil',
    fourniture: 'Verbrauchsmaterial',
    sous_traitance: 'Fremdleistung',
    produit_atelier: 'Werkstattprodukt',
    taxe: 'Gebühr',
    remise: 'Rabatt',
    texte: 'Bemerkung',
  },
};

const IT: LibellesOr = {
  ordreReparationNumero: (numero) => `Ordine di riparazione n. ${numero}`,
  site: 'Sede',
  dateOuverture: 'Data di apertura',
  type: "Tipo d'intervento",
  statut: 'Stato',
  vehicule: 'Veicolo',
  immatriculation: 'Targa',
  plaqueNonRenseignee: 'Targa non indicata',
  vin: 'N. di telaio (VIN)',
  vinNonRenseigne: 'VIN non indicato',
  kilometrageEntree: "Chilometraggio all'entrata",
  kilometrageSortie: "Chilometraggio all'uscita",
  kilometrageNonReleve: 'Non rilevato',
  restitutionPromise: 'Restituzione prevista',
  restitutionNonDefinie: 'Non definita',
  technicien: 'Tecnico',
  demandesTitre: 'Richieste del cliente / istruzioni',
  aucuneDemande: 'Nessuna richiesta registrata.',
  lignesTitre: 'Lavori da eseguire',
  colonneDesignation: 'Designazione',
  colonneQuantite: 'Qtà',
  aucuneLigne: 'Nessuna riga registrata.',
  typeOrdreReparation: {
    service: 'Service',
    reparation: 'Riparazione',
    diagnostic: 'Diagnosi',
    expertise: 'Perizia',
    pneus: 'Pneumatici',
    carrosserie: 'Carrozzeria',
    retouche: 'Ritocco',
    interne: 'Interno',
  },
  statutOrdreReparation: {
    planifie: 'Pianificato',
    ouvert: 'Aperto',
    en_cours: 'In corso',
    controle: 'Controllo qualità',
    termine: 'Terminato',
    facture: 'Fatturato',
    restitue: 'Restituito',
    cloture: 'Chiuso',
    annule: 'Annullato',
  },
  typeLigneOr: {
    main_oeuvre_bareme: 'Manodopera',
    main_oeuvre_temps_reel: 'Manodopera',
    forfait: 'Forfait',
    piece: 'Ricambio',
    fourniture: 'Materiale di consumo',
    sous_traitance: 'Subappalto',
    produit_atelier: "Prodotto d'officina",
    taxe: 'Tassa',
    remise: 'Sconto',
    texte: 'Nota',
  },
};

const LIBELLES_PAR_LANGUE: Readonly<Record<Langue, LibellesOr>> = { fr: FR, de: DE, it: IT };

export function libellesImpressionOr(langue: Langue): LibellesOr {
  return LIBELLES_PAR_LANGUE[langue];
}
