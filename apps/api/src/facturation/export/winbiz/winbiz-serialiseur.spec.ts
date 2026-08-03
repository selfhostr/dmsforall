import { describe, expect, it } from 'vitest';

import type { EcritureExport, LigneEcritureExport } from '@dfa/shared';

import {
  ENTETE_COLONNES_WINBIZ,
  SEPARATEUR_CHAMP_WINBIZ,
  FIN_DE_LIGNE_WINBIZ,
} from './winbiz.constantes';
import { serialiserEcrituresWinbiz } from './winbiz-serialiseur';
import { ErreurExportWinbiz } from './winbiz.erreurs';

function ligne(
  partiel: Partial<LigneEcritureExport> &
    Pick<LigneEcritureExport, 'compte' | 'sens' | 'montantCentimes'>,
): LigneEcritureExport {
  return { codeTva: null, tauxPourmille: null, baseTvaCentimes: null, libelle: '', ...partiel };
}

function ecriture(
  partiel: Partial<EcritureExport> & Pick<EcritureExport, 'lignes'>,
): EcritureExport {
  return {
    reference: 'FA-2026-00123',
    date: '2026-07-29',
    libelle: 'Facture 2026-00123',
    centreDeCharge: null,
    documentId: 'doc-1',
    ...partiel,
  };
}

const PAIEMENT_SIMPLE = ecriture({
  reference: 'PAY-00042',
  documentId: 'doc-paiement-42',
  lignes: [
    ligne({ compte: '1020', sens: 'debit', montantCentimes: 150000 }),
    ligne({ compte: '1100', sens: 'credit', montantCentimes: 150000 }),
  ],
});

const FACTURE_TVA = ecriture({
  reference: 'FA-2026-00123',
  documentId: 'doc-facture-123',
  lignes: [
    ligne({ compte: '1100', sens: 'debit', montantCentimes: 10810, libelle: 'Débiteurs' }),
    ligne({ compte: '3200', sens: 'credit', montantCentimes: 10000, libelle: 'Vente pièces' }),
    ligne({
      compte: '1170',
      sens: 'credit',
      montantCentimes: 810,
      codeTva: 'V81',
      tauxPourmille: 81,
      baseTvaCentimes: 10000,
      libelle: 'TVA due 8.1%',
    }),
  ],
});

describe('serialiserEcrituresWinbiz — équilibre et comptage', () => {
  it('refuse un lot vide', () => {
    expect(() => serialiserEcrituresWinbiz([])).toThrow(ErreurExportWinbiz);
  });

  it('compte nbEcritures = nombre de EcritureExport source, nbLignesCsv = lignes décomposées', () => {
    const resultat = serialiserEcrituresWinbiz([PAIEMENT_SIMPLE, FACTURE_TVA]);
    expect(resultat.nbEcritures).toBe(2); // deux EcritureExport
    expect(resultat.nbLignesCsv).toBe(3); // 1 (paiement) + 2 (facture décomposée)
  });

  it('Σ débit == Σ crédit, EXACTEMENT, par construction (chaque ligne WinBIZ porte le même montant des deux côtés)', () => {
    const resultat = serialiserEcrituresWinbiz([PAIEMENT_SIMPLE, FACTURE_TVA]);
    expect(resultat.totalDebitCentimes).toBe(resultat.totalCreditCentimes);
    // 150000 (paiement) + 10000 + 810 (facture décomposée) = 160810
    expect(resultat.totalDebitCentimes).toBe(160810n);
    expect(typeof resultat.totalDebitCentimes).toBe('bigint');
  });

  it('refuse deux écritures qui partagent le même documentId (export en double)', () => {
    const doublon = ecriture({
      reference: 'FA-DOUBLON',
      documentId: 'doc-facture-123',
      lignes: PAIEMENT_SIMPLE.lignes,
    });
    expect(() => serialiserEcrituresWinbiz([FACTURE_TVA, doublon])).toThrow(ErreurExportWinbiz);
  });
});

describe('serialiserEcrituresWinbiz — forme du fichier', () => {
  it('commence par la ligne d’en-tête officielle, 20 colonnes, terminée par CRLF', () => {
    const resultat = serialiserEcrituresWinbiz([PAIEMENT_SIMPLE]);
    const texte = resultat.contenu.toString('latin1');
    const lignesFichier = texte.split(FIN_DE_LIGNE_WINBIZ);

    expect(lignesFichier[0]).toBe(ENTETE_COLONNES_WINBIZ.join(SEPARATEUR_CHAMP_WINBIZ));
    expect(lignesFichier[0]!.split(SEPARATEUR_CHAMP_WINBIZ)).toHaveLength(20);
    // Toutes les lignes de données ont aussi 20 colonnes.
    for (const l of lignesFichier.slice(1, -1)) {
      if (l.length === 0) continue;
      expect(l.split(SEPARATEUR_CHAMP_WINBIZ)).toHaveLength(20);
    }
  });

  it('sépare chaque ligne par CRLF, jamais LF seul', () => {
    const resultat = serialiserEcrituresWinbiz([PAIEMENT_SIMPLE]);
    const texte = resultat.contenu.toString('latin1');
    expect(texte).toContain('\r\n');
    // Aucun \n qui ne soit pas précédé d'un \r.
    expect(texte.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('ligne d’une facture avec TVA : bloc TVA rempli conformément à EF-13/EF-15, la ligne produit reste vide', () => {
    const resultat = serialiserEcrituresWinbiz([FACTURE_TVA]);
    const texte = resultat.contenu.toString('latin1');
    const lignesDonnees = texte
      .split(FIN_DE_LIGNE_WINBIZ)
      .slice(1)
      .filter((l) => l.length > 0);
    expect(lignesDonnees).toHaveLength(2);

    const parCompteCredit = new Map(
      lignesDonnees.map((l) => {
        const champs = l.split(SEPARATEUR_CHAMP_WINBIZ);
        return [champs[4], champs] as const;
      }),
    );

    const ligneVenteProduit = parCompteCredit.get('3200')!;
    const ligneVenteTva = parCompteCredit.get('1170')!;

    // Colonnes : 0 date, 1 pièce, 2 libellé, 3 cpt_debit, 4 cpt_credit, 5 montant, 6 journal,
    // 7 me_cours, 8 me_mnt, 9 tva_taux, 10 tva_mnt, 11 tva_cpt, 12 tva_typ, 13 tva_meth,
    // 14 tva_soum, 15 ecr_monnai, 16 ecr_monqte, 17 comment, 18 ecr_ana, 19 ecr_vtcode.
    expect(ligneVenteProduit[3]).toBe('1100'); // Cpt_debit : débiteurs (pivot)
    expect(ligneVenteProduit[4]).toBe('3200'); // Cpt_credit : produit
    expect(ligneVenteProduit[5]).toBe('100'); // 10000 centimes → "100"
    expect(ligneVenteProduit[6]).toBe('v'); // Journal : ventes
    expect(ligneVenteProduit[9]).toBe(''); // pas de bloc TVA sur la ligne produit
    expect(ligneVenteProduit[16]).toBe('0'); // Ecr_monqte : monnaie locale
    expect(ligneVenteProduit[19]).toBe('');

    expect(ligneVenteTva[3]).toBe('1100'); // Cpt_debit : débiteurs (pivot), même compte des deux côtés
    expect(ligneVenteTva[4]).toBe('1170'); // Cpt_credit : TVA due
    expect(ligneVenteTva[5]).toBe('8.1'); // 810 centimes → "8.1"
    expect(ligneVenteTva[9]).toBe('8.1'); // TVA_taux
    expect(ligneVenteTva[10]).toBe('8.1'); // TVA_mnt — même valeur que Montant ICI (la ligne EST la TVA)
    expect(ligneVenteTva[11]).toBe('c'); // TVA_cpt : la ligne TVA du cœur est côté crédit
    expect(ligneVenteTva[12]).toBe('2'); // TVA_typ : TVA due
    expect(ligneVenteTva[13]).toBe('2'); // TVA_meth : WINBIZ_TVA_METH, voir winbiz.constantes.ts
    expect(ligneVenteTva[19]).toBe('<vt_code=V81>');
  });
});

describe('serialiserEcrituresWinbiz — encodage réel produit, octets vérifiés', () => {
  it('encode un libellé accentué en Windows-1252, PAS en UTF-8', () => {
    const avecAccent = ecriture({
      reference: 'FA-ACCENT-1',
      documentId: 'doc-accent-1',
      lignes: [
        ligne({ compte: '1020', sens: 'debit', montantCentimes: 100, libelle: 'Révision Genève' }),
        ligne({ compte: '1100', sens: 'credit', montantCentimes: 100, libelle: 'Révision Genève' }),
      ],
    });

    const resultat = serialiserEcrituresWinbiz([avecAccent]);

    // La preuve « octets, pas intention » : le buffer ne contient PAS la séquence UTF-8 de é/è
    // (0xC3 0xA9 pour é, 0xC3 0xA8 pour è) — il contient les octets Windows-1252 (0xE9, 0xE8).
    const octetsUtf8DeE9Aigu = Buffer.from('é', 'utf-8');
    expect(resultat.contenu.includes(octetsUtf8DeE9Aigu)).toBe(false);

    expect(resultat.contenu.includes(Buffer.from([0xe9]))).toBe(true); // é
    expect(resultat.contenu.includes(Buffer.from([0xe8]))).toBe(true); // è

    // Relu en latin1 (identique à Windows-1252 sur cette plage), le texte redevient lisible.
    const relu = resultat.contenu.toString('latin1');
    expect(relu).toContain('Révision Genève');
  });
});

describe('serialiserEcrituresWinbiz — avertissements de troncature', () => {
  it('signale une Pièce tronquée sans faire échouer l’export', () => {
    const numeroLong = ecriture({
      reference: 'FA-2026-0004567', // 15 caractères, > 10
      documentId: 'doc-long',
      lignes: [
        ligne({ compte: '1020', sens: 'debit', montantCentimes: 100 }),
        ligne({ compte: '1100', sens: 'credit', montantCentimes: 100 }),
      ],
    });

    const resultat = serialiserEcrituresWinbiz([numeroLong]);
    expect(resultat.avertissements).toHaveLength(1);
    expect(resultat.avertissements[0]).toMatchObject({
      reference: 'FA-2026-0004567',
      code: 'PIECE_TRONQUEE',
    });
  });
});
