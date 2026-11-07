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
  /** Garage non assujetti à la TVA : mention imprimée en en-tête et sous le total. */
  readonly nonAssujettiTva: string;
  /** Devis : titre, variante brouillon (pas de numéro), validité et mention de non-facture. */
  readonly devisNumero: (numero: string) => string;
  readonly devisBrouillon: string;
  readonly valableJusqu: string;
  readonly devisMention: string;
  /** Facture sans bulletin QR : coordonnées bancaires du garage non renseignées. */
  readonly paiementNonRenseigne: string;
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
  nonAssujettiTva: 'Non assujetti à la TVA',
  devisNumero: (numero) => `Devis n° ${numero}`,
  devisBrouillon: 'Devis (brouillon)',
  valableJusqu: "Valable jusqu'au",
  devisMention: "Ce devis n'est pas une facture.",
  paiementNonRenseigne:
    'Coordonnées de paiement : non renseignées sur ce document — voir les conditions de paiement ou contacter le garage.',
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
  nonAssujettiTva: 'Nicht mehrwertsteuerpflichtig',
  devisNumero: (numero) => `Offerte Nr. ${numero}`,
  devisBrouillon: 'Offerte (Entwurf)',
  valableJusqu: 'Gültig bis',
  devisMention: 'Diese Offerte ist keine Rechnung.',
  paiementNonRenseigne:
    'Zahlungsangaben: auf diesem Dokument nicht hinterlegt — siehe Zahlungsbedingungen oder Garage kontaktieren.',
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
  nonAssujettiTva: "Non soggetto all'IVA",
  devisNumero: (numero) => `Preventivo n. ${numero}`,
  devisBrouillon: 'Preventivo (bozza)',
  valableJusqu: 'Valido fino al',
  devisMention: 'Questo preventivo non è una fattura.',
  paiementNonRenseigne:
    'Coordinate di pagamento: non indicate su questo documento — vedere le condizioni di pagamento o contattare il garage.',
};

const LIBELLES_PAR_LANGUE: Readonly<Record<Langue, LibellesFacture>> = { fr: FR, de: DE, it: IT };

export function libellesImpression(langue: Langue): LibellesFacture {
  return LIBELLES_PAR_LANGUE[langue];
}
