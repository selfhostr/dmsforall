/**
 * Sérialisation CSV générique (`cible: 'csv'`) d'une liste d'`EcritureExport` : lisible par
 * n'importe quelle fiduciaire et par Excel, sans logiciel comptable en face.
 *
 * Format : UTF-8 AVEC BOM (Excel sait alors lire les accents), séparateur `;`, fins de ligne CRLF,
 * en-têtes en français, dates `jj.mm.aaaa`, montants en francs avec point décimal et deux
 * décimales (`1234.50`, sans séparateur de milliers : une cellule numérique pour Excel, un champ
 * non ambigu pour un import), toujours positifs (le sens est porté
 * par les colonnes débit/crédit : un avoir inverse les comptes, il ne passe pas en négatif).
 *
 * Une ligne par couple (compte débit, compte crédit) — les écritures multi-lignes sont décomposées
 * avec la MÊME fonction que WinBIZ (`decomposerEcritureWinbiz`, motif étoile) : les deux cibles
 * reçoivent exactement les mêmes écritures, au format de sérialisation près (CF-04).
 *
 * Aucun montant n'est recalculé ici : chaque `Montant` est le `montantCentimes` d'une ligne du cœur.
 * Injection de formule (CSV injection) : tout champ TEXTE commençant par `=`, `+`, `-`, `@`, tabulation
 * ou retour chariot est préfixé d'une apostrophe — le libellé et le nom du client viennent de
 * saisies utilisateur.
 */

import { createHash } from 'node:crypto';

import type { EcritureExport } from '@dfa/shared';

import { decomposerEcritureWinbiz } from '../winbiz/winbiz-decomposition';

export const BOM_UTF8 = Buffer.from([0xef, 0xbb, 0xbf]);

export const ENTETES_CSV_FIDUCIAIRE = [
  'Date',
  'Pièce',
  'Compte débit',
  'Compte crédit',
  'Libellé',
  'Montant CHF',
  'Code TVA',
  'Taux TVA %',
  'Base TVA CHF',
  'Montant TVA CHF',
  'Numéro de document',
  'Client',
] as const;

export interface LotCsv {
  readonly contenu: Buffer;
  readonly nomFichier: string;
  readonly nbEcritures: number;
  readonly nbLignesCsv: number;
  readonly totalDebitCentimes: bigint;
  readonly totalCreditCentimes: bigint;
  readonly empreinteSha256: string;
  readonly avertissements: readonly { readonly message: string }[];
}

/** `2026-07-31` → `31.07.2026`. */
export function formaterDateCsv(dateIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  if (!m) throw new Error(`Date d'écriture invalide pour l'export CSV : « ${dateIso} ».`);
  return `${m[3] ?? ''}.${m[2] ?? ''}.${m[1] ?? ''}`;
}

/** Centimes entiers → `1234.50` (négatif : `-1234.50`). Aucun flottant. */
export function formaterMontantCsv(centimes: number): string {
  if (!Number.isSafeInteger(centimes)) {
    throw new Error(`Montant non entier pour l'export CSV : ${String(centimes)}.`);
  }
  const signe = centimes < 0 ? '-' : '';
  const abs = Math.abs(centimes);
  const francs = Math.floor(abs / 100);
  const cts = String(abs % 100).padStart(2, '0');
  return `${signe}${String(francs)}.${cts}`;
}

/** `81` (pour mille) → `8.1`. */
export function formaterTauxCsv(tauxPourmille: number): string {
  return `${String(Math.floor(tauxPourmille / 10))}.${String(tauxPourmille % 10)}`;
}

/** Champ texte : neutralise les formules, double les guillemets, entoure si nécessaire. */
export function echapperChampTexte(valeur: string): string {
  const neutralise = /^[=+\-@\t\r]/.test(valeur) ? `'${valeur}` : valeur;
  return /[;"\r\n]/.test(neutralise) ? `"${neutralise.replace(/"/g, '""')}"` : neutralise;
}

export function serialiserEcrituresCsv(
  ecritures: readonly EcritureExport[],
  clientParReference: ReadonlyMap<string, string>,
  nomFichier: string,
): LotCsv {
  const lignes: string[] = [ENTETES_CSV_FIDUCIAIRE.join(';')];
  let total = 0n;

  for (const ecriture of ecritures) {
    const date = formaterDateCsv(ecriture.date);
    const client = clientParReference.get(ecriture.reference) ?? '';
    for (const l of decomposerEcritureWinbiz(ecriture)) {
      const tva = l.ligneTva;
      total += BigInt(l.montantCentimes);
      lignes.push(
        [
          date,
          echapperChampTexte(ecriture.reference),
          l.compteDebit,
          l.compteCredit,
          echapperChampTexte(l.ligneSource.libelle),
          formaterMontantCsv(l.montantCentimes),
          tva?.codeTva != null ? echapperChampTexte(tva.codeTva) : '',
          tva?.tauxPourmille != null ? formaterTauxCsv(tva.tauxPourmille) : '',
          tva?.baseTvaCentimes != null ? formaterMontantCsv(tva.baseTvaCentimes) : '',
          tva !== null ? formaterMontantCsv(l.montantCentimes) : '',
          ecriture.documentId !== null ? echapperChampTexte(ecriture.reference) : '',
          echapperChampTexte(client),
        ].join(';'),
      );
    }
  }

  const contenu = Buffer.concat([BOM_UTF8, Buffer.from(lignes.join('\r\n') + '\r\n', 'utf8')]);
  return {
    contenu,
    nomFichier,
    nbEcritures: ecritures.length,
    nbLignesCsv: lignes.length,
    totalDebitCentimes: total,
    totalCreditCentimes: total,
    empreinteSha256: createHash('sha256').update(contenu).digest('hex'),
    avertissements: [],
  };
}
