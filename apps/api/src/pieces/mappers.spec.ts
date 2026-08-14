import { describe, expect, it } from 'vitest';

import type { LigneStockArticle } from '../db/schema';

import {
  versRechercheComptoirResultat,
  versStockResponse,
  versStockResumeArticle,
  type DonneesRechercheComptoir,
} from './mappers';

/**
 * Casier structuré (0056) — les mappers ne doivent JAMAIS confondre « pas de casier renseigné »
 * (aucune valeur) avec une valeur (`rayon`/`tiroir` restent `null`, jamais `''`) : voir la doctrine
 * du dépôt « absence de donnée ≠ valeur » (CONTRIBUTING.md). Trois cas distincts couverts pour chaque
 * point de sortie (`stocksResume` embarqué, `ReponseStockArticle`, recherche comptoir) : aucun
 * casier, texte libre seul, casier structuré (avec ou sans texte libre en plus).
 */

function ligneStock(champs: Partial<LigneStockArticle> = {}): LigneStockArticle {
  return {
    tenantId: 'tid-1',
    articleId: 'a1',
    siteId: 's1',
    quantitePhysiqueMillieme: 5000,
    quantiteReserveeMillieme: 1000,
    emplacement: null,
    rayon: null,
    tiroir: null,
    stockMinimumMillieme: null,
    quantiteCommandeStandardMillieme: null,
    creeLe: new Date('2026-08-14T08:00:00.000Z'),
    modifieLe: new Date('2026-08-14T08:00:00.000Z'),
    ...champs,
  } as LigneStockArticle;
}

describe('versStockResumeArticle — casier embarqué sur ReponseArticle.stocksResume', () => {
  it('aucun casier ni texte libre : les trois champs restent `null`, jamais une chaîne vide', () => {
    const resultat = versStockResumeArticle(ligneStock());
    expect(resultat.emplacement).toBeNull();
    expect(resultat.rayon).toBeNull();
    expect(resultat.tiroir).toBeNull();
  });

  it('texte libre seul (rayon/tiroir absents) : emplacement porté, rayon/tiroir restent `null`', () => {
    const resultat = versStockResumeArticle(ligneStock({ emplacement: 'étagère du fond' }));
    expect(resultat.emplacement).toBe('étagère du fond');
    expect(resultat.rayon).toBeNull();
    expect(resultat.tiroir).toBeNull();
  });

  it('casier structuré, avec texte libre en plus : les trois champs sont portés indépendamment', () => {
    const resultat = versStockResumeArticle(
      ligneStock({ emplacement: 'accès par le fond', rayon: 'B3', tiroir: '2' }),
    );
    expect(resultat.emplacement).toBe('accès par le fond');
    expect(resultat.rayon).toBe('B3');
    expect(resultat.tiroir).toBe('2');
  });
});

describe('versStockResponse — GET/PATCH .../stock/{siteId}, même doctrine', () => {
  it('casier structuré sans texte libre : emplacement `null`, rayon/tiroir portés', () => {
    const resultat = versStockResponse(ligneStock({ rayon: 'A1', tiroir: null }));
    expect(resultat.emplacement).toBeNull();
    expect(resultat.rayon).toBe('A1');
    expect(resultat.tiroir).toBeNull();
  });
});

describe('versRechercheComptoirResultat — GET /articles/recherche-comptoir', () => {
  function donnees(champs: Partial<DonneesRechercheComptoir> = {}): DonneesRechercheComptoir {
    return {
      articleId: 'a1',
      numeroArticle: 'P-000123',
      designation: 'Plaquettes avant',
      referencePrincipale: 'REF-1',
      prixVenteTtcCentimes: 4500,
      quantiteDisponibleMillieme: 2000,
      emplacement: null,
      rayon: null,
      tiroir: null,
      estEchangeStandard: false,
      montantConsigneTtcCentimes: null,
      ...champs,
    };
  }

  it('aucun casier : rayon/tiroir/emplacement `null`, résultat inchangé sinon (rétrocompatible)', () => {
    const resultat = versRechercheComptoirResultat(donnees());
    expect(resultat.emplacement).toBeNull();
    expect(resultat.rayon).toBeNull();
    expect(resultat.tiroir).toBeNull();
  });

  it('casier structuré : passthrough exact des deux champs', () => {
    const resultat = versRechercheComptoirResultat(donnees({ rayon: 'C4', tiroir: '1' }));
    expect(resultat.rayon).toBe('C4');
    expect(resultat.tiroir).toBe('1');
  });
});
