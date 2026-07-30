/**
 * Sérialisation d'une liste d'`EcritureExport` vers le CSV WinBIZ 20 colonnes (`EF-13`).
 *
 * Ce module orchestre `winbiz-decomposition.ts` (forme des lignes) et `winbiz-champs.ts`
 * (formatage de chaque champ), puis encode le résultat en Windows-1252 (`winbiz-encodage.ts`).
 * Il ne recalcule et ne choisit jamais un compte ou un montant (`EF-01`/`EF-03`) — il assemble.
 */

import type { EcritureExport } from '@dfa/shared';

import {
  formaterDateWinbiz,
  formaterLibelleWinbiz,
  formaterMontantWinbiz,
  formaterPieceWinbiz,
  formaterTauxWinbiz,
  nettoyerTexteWinbiz,
  verifierLongueurCompteWinbiz,
  type ChampTexteWinbiz,
} from './winbiz-champs';
import {
  ENTETE_COLONNES_WINBIZ,
  FIN_DE_LIGNE_WINBIZ,
  JOURNAL_PAR_DEFAUT_WINBIZ,
  LONGUEURS_CHAMPS_WINBIZ,
  SEPARATEUR_CHAMP_WINBIZ,
  TVA_CPT_WINBIZ,
  TVA_TYP_DUE_WINBIZ,
  WINBIZ_TVA_METH,
  baliseVtCodeWinbiz,
} from './winbiz.constantes';
import { decomposerEcritureWinbiz, type LigneWinbizDecomposee } from './winbiz-decomposition';
import { encoderWindows1252 } from './winbiz-encodage';
import { ErreurExportWinbiz } from './winbiz.erreurs';

/** Un avertissement non bloquant produit pendant la sérialisation — troncature, principalement. */
export interface AvertissementExportWinbiz {
  readonly reference: string;
  readonly code: 'PIECE_TRONQUEE' | 'LIBELLE_TRONQUE';
  readonly message: string;
}

/** Les 20 colonnes d'une ligne WinBIZ, DANS L'ORDRE — `EF-13` : « le nom des colonnes ne
 *  détermine pas le contenu, seul l'ordre fait foi ». Ce tuple EST donc le contrat de sortie. */
export type LigneCsvWinbiz = readonly [
  date: string,
  piece: string,
  libelle: string,
  cptDebit: string,
  cptCredit: string,
  montant: string,
  journal: string,
  meCours: string,
  meMnt: string,
  tvaTaux: string,
  tvaMnt: string,
  tvaCpt: string,
  tvaTyp: string,
  tvaMeth: string,
  tvaSoum: string,
  ecrMonnai: string,
  ecrMonqte: string,
  comment: string,
  ecrAna: string,
  ecrVtcode: string,
];

function poussetAvertissementTexte(
  reference: string,
  champ: ChampTexteWinbiz,
  code: 'PIECE_TRONQUEE' | 'LIBELLE_TRONQUE',
  nomChamp: string,
  avertissements: AvertissementExportWinbiz[],
): void {
  if (champ.tronque) {
    avertissements.push({
      reference,
      code,
      message:
        `Écriture « ${reference} » : ${nomChamp} tronqué à « ${champ.valeur} » pour tenir dans ` +
        'la longueur admise par WinBIZ.',
    });
  }
}

/**
 * Construit la ligne CSV (20 colonnes) correspondant à une ligne WinBIZ déjà décomposée.
 *
 * Le bloc TVA (colonnes 10-15 et 20) n'est rempli QUE si `ligne.ligneTva` est non nul — sinon
 * toutes ses colonnes restent vides, comme la seconde ligne de l'exemple officiel (`EF-15`), qui
 * montre que le bloc TVA peut rester entièrement vide EN CONSERVANT les séparateurs.
 */
export function construireLigneCsvWinbiz(
  ecriture: EcritureExport,
  ligne: LigneWinbizDecomposee,
  avertissements: AvertissementExportWinbiz[],
): LigneCsvWinbiz {
  const date = formaterDateWinbiz(ecriture.date);

  const piece = formaterPieceWinbiz(ecriture.reference);
  poussetAvertissementTexte(ecriture.reference, piece, 'PIECE_TRONQUEE', 'la pièce', avertissements);

  const libelleSource = ligne.ligneSource.libelle || ecriture.libelle;
  const libelle = formaterLibelleWinbiz(libelleSource);
  poussetAvertissementTexte(ecriture.reference, libelle, 'LIBELLE_TRONQUE', 'le libellé', avertissements);

  const compteDebit = verifierLongueurCompteWinbiz(ligne.compteDebit);
  const compteCredit = verifierLongueurCompteWinbiz(ligne.compteCredit);
  const montant = formaterMontantWinbiz(ligne.montantCentimes);

  const centreDeCharge =
    ecriture.centreDeCharge !== null
      ? nettoyerTexteWinbiz(ecriture.centreDeCharge, LONGUEURS_CHAMPS_WINBIZ.ecrAna).valeur
      : '';

  if (ligne.ligneTva === null) {
    return [
      date,
      piece.valeur,
      libelle.valeur,
      compteDebit,
      compteCredit,
      montant,
      JOURNAL_PAR_DEFAUT_WINBIZ,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '0',
      '',
      centreDeCharge,
      '',
    ];
  }

  const ligneTva = ligne.ligneTva;
  if (ligneTva.tauxPourmille === null) {
    throw new ErreurExportWinbiz(
      'DONNEE_TVA_INCOMPLETE',
      `Écriture « ${ecriture.reference} » : la ligne TVA (compte ${ligneTva.compte}) a un ` +
        'codeTva non nul mais aucun tauxPourmille — donnée incohérente en amont.',
      ecriture.reference,
    );
  }

  const tvaTaux = formaterTauxWinbiz(ligneTva.tauxPourmille);
  // Colonne 11 : le montant de TVA de CETTE ligne WinBIZ est, par construction, le montant même
  // de la ligne TVA du cœur (voir winbiz-decomposition.ts) — jamais une part recalculée.
  const tvaMnt = formaterMontantWinbiz(ligneTva.montantCentimes);
  const tvaCpt = ligneTva.sens === 'debit' ? TVA_CPT_WINBIZ.debit : TVA_CPT_WINBIZ.credit;
  const vtCode = baliseVtCodeWinbiz(ligneTva.codeTva as string);

  return [
    date,
    piece.valeur,
    libelle.valeur,
    compteDebit,
    compteCredit,
    montant,
    JOURNAL_PAR_DEFAUT_WINBIZ,
    '',
    '',
    tvaTaux,
    tvaMnt,
    tvaCpt,
    TVA_TYP_DUE_WINBIZ,
    WINBIZ_TVA_METH,
    '',
    '',
    '0',
    '',
    centreDeCharge,
    vtCode,
  ];
}

function echapperChamp(valeur: string): string {
  // `nettoyerTexteWinbiz` a déjà retiré `;`/CR/LF des champs texte libres ; les champs non-texte
  // (dates, montants, codes) ne peuvent structurellement pas en contenir. Filet de sécurité
  // défensif, pas une hypothèse relâchée sur l'appelant.
  return valeur.replace(/[;\r\n]/g, ' ');
}

export interface ResultatSerialisationWinbiz {
  /** Le fichier complet, encodé Windows-1252, CRLF, prêt à être transmis tel quel. */
  readonly contenu: Buffer;
  /** Nombre d'`EcritureExport` sources (avant décomposition) — c'est ce que compte
   *  `export_comptable.nb_ecritures` (MD-91). */
  readonly nbEcritures: number;
  /** Nombre de lignes CSV produites après décomposition (>= nbEcritures). Informationnel. */
  readonly nbLignesCsv: number;
  readonly totalDebitCentimes: bigint;
  readonly totalCreditCentimes: bigint;
  readonly avertissements: readonly AvertissementExportWinbiz[];
}

/**
 * Refuse un lot qui contient deux fois la même écriture liée à un document (même `documentId`
 * non nul) — garde-fou complémentaire à l'idempotence portée par `export_comptable` (celle-ci
 * empêche un DOCUMENT déjà exporté de repartir dans un nouveau lot ; celui-là empêche qu'UN SEUL
 * appel à cet adaptateur ne compte deux fois la même écriture, quelle qu'en soit la raison).
 *
 * @throws ErreurExportWinbiz `ECRITURE_DOUBLON`.
 */
function verifierAucunDoublon(ecritures: readonly EcritureExport[]): void {
  const vus = new Set<string>();
  for (const ecriture of ecritures) {
    if (ecriture.documentId === null) {
      continue;
    }
    if (vus.has(ecriture.documentId)) {
      throw new ErreurExportWinbiz(
        'ECRITURE_DOUBLON',
        `documentId « ${ecriture.documentId} » présent plus d'une fois dans ce lot — export en ` +
          'double refusé.',
        ecriture.reference,
      );
    }
    vus.add(ecriture.documentId);
  }
}

/**
 * Sérialise une liste d'écritures en fichier WinBIZ complet (en-tête compris).
 *
 * @throws ErreurExportWinbiz `LOT_VIDE` si `ecritures` est vide, ou toute erreur de
 *         `decomposerEcritureWinbiz`/`construireLigneCsvWinbiz` propagée telle quelle.
 */
export function serialiserEcrituresWinbiz(
  ecritures: readonly EcritureExport[],
): ResultatSerialisationWinbiz {
  if (ecritures.length === 0) {
    throw new ErreurExportWinbiz('LOT_VIDE', 'Aucune écriture à exporter vers WinBIZ.');
  }

  verifierAucunDoublon(ecritures);

  const avertissements: AvertissementExportWinbiz[] = [];
  const lignesCsv: LigneCsvWinbiz[] = [];
  let totalDebitCentimes = 0n;
  let totalCreditCentimes = 0n;

  for (const ecriture of ecritures) {
    const lignesDecomposees = decomposerEcritureWinbiz(ecriture);
    for (const ligne of lignesDecomposees) {
      lignesCsv.push(construireLigneCsvWinbiz(ecriture, ligne, avertissements));
      totalDebitCentimes += BigInt(ligne.montantCentimes);
      totalCreditCentimes += BigInt(ligne.montantCentimes);
    }
  }

  const lignesTexte = [ENTETE_COLONNES_WINBIZ.join(SEPARATEUR_CHAMP_WINBIZ)];
  for (const champs of lignesCsv) {
    lignesTexte.push(champs.map(echapperChamp).join(SEPARATEUR_CHAMP_WINBIZ));
  }
  const texte = lignesTexte.join(FIN_DE_LIGNE_WINBIZ) + FIN_DE_LIGNE_WINBIZ;

  const { octets } = encoderWindows1252(texte);

  return {
    contenu: octets,
    nbEcritures: ecritures.length,
    nbLignesCsv: lignesCsv.length,
    totalDebitCentimes,
    totalCreditCentimes,
    avertissements,
  };
}
