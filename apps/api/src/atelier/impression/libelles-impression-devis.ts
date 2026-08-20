/**
 * Libellés du PDF de devis complémentaire (`GET
 * /ordres-reparation/{orId}/devis-complementaires/{devisId}/pdf`) — même doctrine que
 * `libelles-impression-or.ts` : dictionnaire minimal, LOCAL à ce module, PAS le mécanisme i18next
 * du front (pas de navigateur côté serveur pour interpoler des clés ICU). La langue d'impression
 * est celle du CLIENT (`document.client.langueCorrespondance`), même choix que la feuille
 * d'atelier et la facture — ce document part potentiellement chez lui (canal e-mail/SMS/lien).
 *
 * Vocabulaire garagiste (CONTRIBUTING.md « jamais de jargon IT ») : `CanalDevis`/`DecisionDevis` sont des
 * codes techniques — ce fichier porte leur traduction affichable, séparément par langue. La
 * traduction de `TypeLigneOr` N'EST PAS dupliquée ici : `donnees-impression-devis.ts` réutilise
 * `libellesImpressionOr(langue).typeLigneOr`, déjà établi et testé — même table, une seule source.
 */

import type { CanalDevis, DecisionDevis, Langue } from '@dfa/shared';

export interface LibellesDevis {
  readonly devisNumero: (numeroOrdre: number, numeroOr: string) => string;
  readonly dateEnvoi: string;
  readonly canal: string;
  readonly canaux: Readonly<Record<CanalDevis, string>>;
  readonly statutEnAttente: string;
  readonly statutRepondu: (decisionLabel: string) => string;
  readonly decisions: Readonly<Record<DecisionDevis, string>>;
  readonly dateReponse: string;
  readonly interlocuteur: string;
  readonly client: string;
  readonly vehicule: string;
  readonly immatriculation: string;
  readonly plaqueNonRenseignee: string;
  readonly vin: string;
  readonly vinNonRenseigne: string;
  readonly lignesTitre: string;
  readonly colonneDesignation: string;
  readonly colonneQuantite: string;
  readonly colonnePrixUnitaire: string;
  readonly colonneTva: string;
  readonly colonneTotal: string;
  readonly aucuneLigne: string;
  readonly recapitulatifTva: string;
  readonly tauxTvaLabel: string;
  readonly baseHt: string;
  readonly montantTva: string;
  readonly totalHt: string;
  readonly totalTva: string;
  readonly totalTtc: string;
  readonly mentionTvaComprise: string;
  readonly nouveauPlafond: string;
  readonly impactRestitution: string;
  readonly signatureClient: string;
  readonly signatureDate: string;
  /** Rappel imprimé en pied de page : un devis n'engage pas comptablement le garage, à la
   *  différence d'une facture — voir la tête de fichier de `generation-pdf-devis.ts`. */
  readonly mentionEngagement: string;
}

const FR: LibellesDevis = {
  devisNumero: (numeroOrdre, numeroOr) => `Devis complémentaire n° ${numeroOrdre} — OR ${numeroOr}`,
  dateEnvoi: 'Envoyé le',
  canal: 'Canal',
  canaux: {
    telephone: 'Téléphone',
    sms: 'SMS',
    email: 'E-mail',
    comptoir: 'Comptoir',
    lien: 'Lien',
  },
  statutEnAttente: 'En attente de réponse du client',
  statutRepondu: (decisionLabel) => `Répondu — ${decisionLabel}`,
  decisions: { accepte: 'Accepté', refuse: 'Refusé', partiel: 'Partiellement accepté' },
  dateReponse: 'Répondu le',
  interlocuteur: 'Interlocuteur',
  client: 'Client',
  vehicule: 'Véhicule',
  immatriculation: 'Immatriculation',
  plaqueNonRenseignee: 'Plaque non renseignée',
  vin: 'N° de châssis (VIN)',
  vinNonRenseigne: 'VIN non renseigné',
  lignesTitre: 'Travaux proposés',
  colonneDesignation: 'Désignation',
  colonneQuantite: 'Qté',
  colonnePrixUnitaire: 'Prix unitaire',
  colonneTva: 'TVA',
  colonneTotal: 'Total',
  aucuneLigne: 'Aucune ligne dans ce devis.',
  recapitulatifTva: 'Récapitulatif TVA',
  tauxTvaLabel: 'Taux',
  baseHt: 'Base HT',
  montantTva: 'Montant TVA',
  totalHt: 'Total HT',
  totalTva: 'Total TVA',
  totalTtc: 'Total TTC',
  mentionTvaComprise: 'Montants exprimés TVA comprise.',
  nouveauPlafond: 'Nouveau plafond demandé',
  impactRestitution: 'Impact sur la date de restitution',
  signatureClient: 'Signature du client',
  signatureDate: 'Date',
  mentionEngagement:
    "Ce document est un devis : il n'engage pas comptablement le garage et ne remplace pas une facture.",
};

const DE: LibellesDevis = {
  devisNumero: (numeroOrdre, numeroOr) =>
    `Nachtragsofferte Nr. ${numeroOrdre} — Werkstattauftrag ${numeroOr}`,
  dateEnvoi: 'Versendet am',
  canal: 'Kanal',
  canaux: {
    telephone: 'Telefon',
    sms: 'SMS',
    email: 'E-Mail',
    comptoir: 'Am Schalter',
    lien: 'Link',
  },
  statutEnAttente: 'Wartet auf Antwort des Kunden',
  statutRepondu: (decisionLabel) => `Beantwortet — ${decisionLabel}`,
  decisions: { accepte: 'Angenommen', refuse: 'Abgelehnt', partiel: 'Teilweise angenommen' },
  dateReponse: 'Beantwortet am',
  interlocuteur: 'Ansprechperson',
  client: 'Kunde',
  vehicule: 'Fahrzeug',
  immatriculation: 'Kontrollschild',
  plaqueNonRenseignee: 'Kein Kontrollschild erfasst',
  vin: 'Fahrgestellnummer (VIN)',
  vinNonRenseigne: 'VIN nicht erfasst',
  lignesTitre: 'Vorgeschlagene Arbeiten',
  colonneDesignation: 'Bezeichnung',
  colonneQuantite: 'Menge',
  colonnePrixUnitaire: 'Einzelpreis',
  colonneTva: 'MWST',
  colonneTotal: 'Total',
  aucuneLigne: 'Keine Position in dieser Offerte.',
  recapitulatifTva: 'MWST-Übersicht',
  tauxTvaLabel: 'Satz',
  baseHt: 'Basis Netto',
  montantTva: 'MWST-Betrag',
  totalHt: 'Total Netto',
  totalTva: 'Total MWST',
  totalTtc: 'Total Brutto',
  mentionTvaComprise: 'Beträge verstehen sich inklusive MWST.',
  nouveauPlafond: 'Beantragtes neues Kostendach',
  impactRestitution: 'Auswirkung auf das Rückgabedatum',
  signatureClient: 'Unterschrift des Kunden',
  signatureDate: 'Datum',
  mentionEngagement:
    'Dieses Dokument ist eine Offerte: Sie verpflichtet die Werkstatt buchhalterisch nicht und ersetzt keine Rechnung.',
};

const IT: LibellesDevis = {
  devisNumero: (numeroOrdre, numeroOr) =>
    `Preventivo supplementare n. ${numeroOrdre} — Ordine ${numeroOr}`,
  dateEnvoi: 'Inviato il',
  canal: 'Canale',
  canaux: {
    telephone: 'Telefono',
    sms: 'SMS',
    email: 'E-mail',
    comptoir: 'Al banco',
    lien: 'Link',
  },
  statutEnAttente: 'In attesa di risposta del cliente',
  statutRepondu: (decisionLabel) => `Risposto — ${decisionLabel}`,
  decisions: { accepte: 'Accettato', refuse: 'Rifiutato', partiel: 'Parzialmente accettato' },
  dateReponse: 'Risposto il',
  interlocuteur: 'Interlocutore',
  client: 'Cliente',
  vehicule: 'Veicolo',
  immatriculation: 'Targa',
  plaqueNonRenseignee: 'Targa non indicata',
  vin: 'N. di telaio (VIN)',
  vinNonRenseigne: 'VIN non indicato',
  lignesTitre: 'Lavori proposti',
  colonneDesignation: 'Designazione',
  colonneQuantite: 'Qtà',
  colonnePrixUnitaire: 'Prezzo unitario',
  colonneTva: 'IVA',
  colonneTotal: 'Totale',
  aucuneLigne: 'Nessuna riga in questo preventivo.',
  recapitulatifTva: 'Riepilogo IVA',
  tauxTvaLabel: 'Aliquota',
  baseHt: 'Base netto',
  montantTva: 'Importo IVA',
  totalHt: 'Totale netto',
  totalTva: 'Totale IVA',
  totalTtc: 'Totale lordo',
  mentionTvaComprise: 'Importi espressi IVA inclusa.',
  nouveauPlafond: 'Nuovo massimale richiesto',
  impactRestitution: 'Impatto sulla data di restituzione',
  signatureClient: 'Firma del cliente',
  signatureDate: 'Data',
  mentionEngagement:
    'Questo documento è un preventivo: non impegna contabilmente il garage e non sostituisce una fattura.',
};

const LIBELLES_PAR_LANGUE: Readonly<Record<Langue, LibellesDevis>> = { fr: FR, de: DE, it: IT };

export function libellesImpressionDevis(langue: Langue): LibellesDevis {
  return LIBELLES_PAR_LANGUE[langue];
}
