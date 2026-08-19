import type {
  ChampsOrigineFactureFournisseur,
  ReponseDocumentFactureFournisseur,
  ReponseFactureFournisseur,
  ReponseLigneFactureFournisseur,
} from '@dfa/shared';

import { enDate } from '../../db';
import type {
  LigneFactureFournisseur,
  LigneFactureFournisseurDocument,
  LigneFactureFournisseurLigne,
} from '../../db/schema';

/** `bytea` -> hexadécimal minuscule, forme exposée par l'API (jamais le binaire brut, jamais
 *  base64 — l'empreinte d'un document est une valeur d'AUDIT lisible, pas un secret). */
export function hexDepuisBytea(valeur: Buffer): string {
  return valeur.toString('hex');
}

export function versDocumentResponse(
  document: LigneFactureFournisseurDocument,
): ReponseDocumentFactureFournisseur {
  return {
    typeMime: document.typeMime,
    tailleOctets: document.tailleOctets,
    empreinteSha256: hexDepuisBytea(document.empreinteSha256),
    deposeParId: document.deposeParId,
    deposeLe: enDate(document.deposeLe).toISOString(),
  };
}

export function versLigneFactureFournisseurResponse(
  ligne: LigneFactureFournisseurLigne,
): ReponseLigneFactureFournisseur {
  const ecart =
    ligne.commandeFournisseurLigneId &&
    ligne.ecartPrixUnitaireCentimes !== null &&
    ligne.ecartQuantiteMillieme !== null &&
    ligne.ecartTotalCentimes !== null
      ? {
          prixUnitaireCentimes: ligne.ecartPrixUnitaireCentimes,
          quantiteMillieme: ligne.ecartQuantiteMillieme,
          totalCentimes: ligne.ecartTotalCentimes,
        }
      : null;

  return {
    id: ligne.id,
    numeroOrdre: ligne.numeroOrdre,
    referenceArticle: ligne.referenceArticle,
    designation: ligne.designation,
    quantiteMillieme: ligne.quantiteMillieme,
    prixUnitaireCentimes: ligne.prixUnitaireCentimes,
    totalLigneCentimes: ligne.totalLigneCentimes,
    origine: ligne.origine,
    articleId: ligne.articleId,
    commandeFournisseurLigneId: ligne.commandeFournisseurLigneId,
    ecart,
  };
}

export function versFactureFournisseurResponse(
  facture: LigneFactureFournisseur,
  document: LigneFactureFournisseurDocument,
  lignes: readonly LigneFactureFournisseurLigne[],
): ReponseFactureFournisseur {
  return {
    id: facture.id,
    statut: facture.statut,
    document: versDocumentResponse(document),
    fournisseurId: facture.fournisseurId,
    commandeFournisseurId: facture.commandeFournisseurId,
    ibanCreancier: facture.ibanCreancier,
    nomCreancier: facture.nomCreancier,
    numeroFacture: facture.numeroFacture,
    dateFacture: facture.dateFacture,
    montantTotalCentimes: facture.montantTotalCentimes,
    devise: facture.devise,
    referencePaiement: facture.referencePaiement,
    champsOrigine: (facture.champsOrigine ?? {}) as ChampsOrigineFactureFournisseur,
    lignes: lignes
      .slice()
      .sort((a, b) => a.numeroOrdre - b.numeroOrdre)
      .map(versLigneFactureFournisseurResponse),
    valideParId: facture.valideParId,
    valideLe: facture.valideLe ? enDate(facture.valideLe).toISOString() : null,
    motifRejet: facture.motifRejet,
    creeLe: enDate(facture.creeLe).toISOString(),
    modifieLe: enDate(facture.modifieLe).toISOString(),
  };
}
