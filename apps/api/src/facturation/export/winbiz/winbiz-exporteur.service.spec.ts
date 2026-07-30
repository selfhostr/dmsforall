import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { EcritureExport, LigneEcritureExport } from '@dfa/shared';

import { WinbizExporteurService } from './winbiz-exporteur.service';
import { ErreurExportWinbiz } from './winbiz.erreurs';

function ligne(partiel: Partial<LigneEcritureExport> & Pick<LigneEcritureExport, 'compte' | 'sens' | 'montantCentimes'>): LigneEcritureExport {
  return { codeTva: null, tauxPourmille: null, baseTvaCentimes: null, libelle: '', ...partiel };
}

function ecritureDePaiement(indice: number): EcritureExport {
  return {
    reference: `PAY-${String(indice).padStart(5, '0')}`,
    date: '2026-07-29',
    libelle: `Paiement ${indice}`,
    centreDeCharge: null,
    documentId: `doc-paiement-${indice}`,
    lignes: [
      ligne({ compte: '1020', sens: 'debit', montantCentimes: 1000 + indice }),
      ligne({ compte: '1100', sens: 'credit', montantCentimes: 1000 + indice }),
    ],
  };
}

describe('WinbizExporteurService — contrat AccountingExporter', () => {
  it('déclare cible = winbiz et les capacités du pilote', () => {
    const service = new WinbizExporteurService();
    expect(service.cible).toBe('winbiz');
    expect(service.capacites).toEqual({
      multiDevise: false,
      centresDeCharge: true,
      codesTva: true,
      granularite: ['detaille', 'agrege'],
    });
  });
});

describe('WinbizExporteurService.genererLot', () => {
  it('produit une empreinte SHA-256 correspondant EXACTEMENT au contenu produit (MD-91, EF-07)', () => {
    const service = new WinbizExporteurService();
    const lot = service.genererLot([ecritureDePaiement(1), ecritureDePaiement(2)], 'export-2026-07.csv');

    const empreinteAttendue = createHash('sha256').update(lot.contenu).digest('hex');
    expect(lot.empreinteSha256).toBe(empreinteAttendue);
    expect(lot.empreinteSha256).toHaveLength(64);
  });

  it('est déterministe : la même liste d’écritures produit le même contenu et la même empreinte (rejouabilité, RF-111)', () => {
    const service = new WinbizExporteurService();
    const ecritures = [ecritureDePaiement(1), ecritureDePaiement(2), ecritureDePaiement(3)];

    const premier = service.genererLot(ecritures, 'lot.csv');
    const second = service.genererLot(ecritures, 'lot.csv');

    expect(Buffer.compare(premier.contenu, second.contenu)).toBe(0);
    expect(premier.empreinteSha256).toBe(second.empreinteSha256);
  });

  it('conserve le nom de fichier fourni par l’appelant', () => {
    const service = new WinbizExporteurService();
    const lot = service.genererLot([ecritureDePaiement(1)], 'export-tenant-42-2026-S1.csv');
    expect(lot.nomFichier).toBe('export-tenant-42-2026-S1.csv');
  });
});

describe('WinbizExporteurService.genererLots — découpage sous la limite de 100 Ko (EF-18 a)', () => {
  it('produit un seul lot quand tout tient sous la limite', () => {
    const service = new WinbizExporteurService();
    const ecritures = Array.from({ length: 10 }, (_, i) => ecritureDePaiement(i));

    const lots = service.genererLots(ecritures, (i) => `lot-${i}.csv`);

    expect(lots).toHaveLength(1);
    expect(lots[0]!.nbEcritures).toBe(10);
  });

  it('répartit en plusieurs lots quand la taille maximale est volontairement réduite, sans perdre ni dupliquer d’écriture', () => {
    const service = new WinbizExporteurService();
    const ecritures = Array.from({ length: 50 }, (_, i) => ecritureDePaiement(i));

    // Taille artificiellement petite pour forcer plusieurs lots en test, sans dépendre de la
    // vraie limite de 100 Ko (qu'il faudrait des milliers d'écritures pour atteindre).
    const lots = service.genererLots(ecritures, (i) => `lot-${i}.csv`, 500);

    expect(lots.length).toBeGreaterThan(1);

    const nbEcrituresTotal = lots.reduce((s, l) => s + l.nbEcritures, 0);
    expect(nbEcrituresTotal).toBe(50);

    // Chaque lot individuellement équilibré.
    for (const lot of lots) {
      expect(lot.totalDebitCentimes).toBe(lot.totalCreditCentimes);
    }

    // La somme des lots égale la somme calculée sur le tout (aucune perte, aucun double
    // comptage) : 1000+i pour i de 0 à 49 = 50*1000 + Σ(0..49) = 50000 + 1225 = 51225.
    const totalDebitTousLots = lots.reduce((s, l) => s + l.totalDebitCentimes, 0n);
    expect(totalDebitTousLots).toBe(51225n);

    // Chaque lot porte le nom produit par la fabrique, dans l'ordre.
    lots.forEach((lot, i) => expect(lot.nomFichier).toBe(`lot-${i}.csv`));
  });

  it('refuse un lot vide', () => {
    const service = new WinbizExporteurService();
    expect(() => service.genererLots([], (i) => `lot-${i}.csv`)).toThrow(ErreurExportWinbiz);
  });
});
