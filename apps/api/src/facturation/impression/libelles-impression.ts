/**
 * Libellés du CORPS de facture (hors bulletin QR, dont les libellés viennent de `swissqrbill`
 * lui-même — voir la consigne : « ne les traduis pas toi-même »). La langue d'impression est
 * celle du CLIENT (`figees.clientLangue`/`qr.qrLangue`), jamais celle de l'utilisateur connecté.
 *
 * PAS le mécanisme i18next du front (`apps/web/src/i18n/`, namespaces JSON chargés au navigateur) :
 * un PDF généré côté serveur n'a pas de navigateur pour interpoler des clés ICU. Dictionnaire
 * minimal et local à ce module — seuls les libellés réellement imprimés par
 * `generation-pdf-facture.ts` y figurent.
 */

import type { Langue } from '@dfa/shared';

export interface LibellesFacture {
  readonly facture: string;
  readonly factureNumero: (numero: string) => string;
  readonly dateDocument: string;
  readonly client: string;
  readonly designation: string;
  readonly quantite: string;
  readonly prixUnitaire: string;
  readonly tva: string;
  readonly total: string;
  readonly recapitulatifTva: string;
  readonly tauxTvaLabel: string;
  readonly baseHt: string;
  readonly montantTva: string;
  readonly totalHt: string;
  readonly totalTva: string;
  readonly totalTtc: string;
  readonly mentionTvaComprise: string;
}

const FR: LibellesFacture = {
  facture: 'Facture',
  factureNumero: (numero) => `Facture n° ${numero}`,
  dateDocument: 'Date',
  client: 'Client',
  designation: 'Désignation',
  quantite: 'Qté',
  prixUnitaire: 'Prix unitaire',
  tva: 'TVA',
  total: 'Total',
  recapitulatifTva: 'Récapitulatif TVA',
  tauxTvaLabel: 'Taux',
  baseHt: 'Base HT',
  montantTva: 'Montant TVA',
  totalHt: 'Total HT',
  totalTva: 'Total TVA',
  totalTtc: 'Total TTC',
  mentionTvaComprise: 'Prix TVA comprise',
};

const DE: LibellesFacture = {
  facture: 'Rechnung',
  factureNumero: (numero) => `Rechnung Nr. ${numero}`,
  dateDocument: 'Datum',
  client: 'Kunde',
  designation: 'Bezeichnung',
  quantite: 'Menge',
  prixUnitaire: 'Einzelpreis',
  tva: 'MWST',
  total: 'Total',
  recapitulatifTva: 'MWST-Zusammenfassung',
  tauxTvaLabel: 'Satz',
  baseHt: 'Basis Netto',
  montantTva: 'MWST-Betrag',
  totalHt: 'Total Netto',
  totalTva: 'Total MWST',
  totalTtc: 'Total Brutto',
  mentionTvaComprise: 'Preise inkl. MWST',
};

const IT: LibellesFacture = {
  facture: 'Fattura',
  factureNumero: (numero) => `Fattura n. ${numero}`,
  dateDocument: 'Data',
  client: 'Cliente',
  designation: 'Designazione',
  quantite: 'Qtà',
  prixUnitaire: 'Prezzo unitario',
  tva: 'IVA',
  total: 'Totale',
  recapitulatifTva: 'Riepilogo IVA',
  tauxTvaLabel: 'Aliquota',
  baseHt: 'Base netto',
  montantTva: 'Importo IVA',
  totalHt: 'Totale netto',
  totalTva: 'Totale IVA',
  totalTtc: 'Totale lordo',
  mentionTvaComprise: 'Prezzi IVA inclusa',
};

const LIBELLES_PAR_LANGUE: Readonly<Record<Langue, LibellesFacture>> = { fr: FR, de: DE, it: IT };

export function libellesImpression(langue: Langue): LibellesFacture {
  return LIBELLES_PAR_LANGUE[langue];
}
