import { describe, expect, it } from 'vitest';

import type { ReponseLigneOr, ReponseOrdreReparation } from '@dfa/shared';

import {
  compterLignesAssigneesPointables,
  lignesAssigneesPointables,
  lignesPointables,
  ligneEstReellementPointableRM93,
} from './lignes-assignees';

const TECHNICIEN_ID = 'tech-1';

function construireLigne(overrides: Partial<ReponseLigneOr> = {}): ReponseLigneOr {
  return {
    id: 'ligne-1',
    ordreReparationId: 'or-1',
    numeroOrdre: 1,
    type: 'fourniture',
    origine: 'constatee',
    statut: 'en_cours',
    payeur: 'client',
    payeurClientId: null,
    blocage: 'aucun',
    designation: 'Plaquettes de frein avant',
    referenceTexte: null,
    articleId: null,
    quantiteMillieme: 1000,
    tempsBaremeCentiemes: null,
    tempsBaremeConstructeurCentiemes: null,
    tempsReelCentiemes: null,
    rabaisPourmille: 0,
    tauxTvaPourmille: 81,
    figeLe: null,
    technicienId: null,
    codeOperation: null,
    codeDefaut: null,
    numeroSinistre: null,
    numeroAccord: null,
    urgence: null,
    securite: false,
    fournieParClient: false,
    aRestituer: false,
    restituee: false,
    motifAnnulation: null,
    factureId: null,
    creeLe: '2026-08-03T06:00:00.000Z',
    modifieLe: '2026-08-03T06:00:00.000Z',
    ...overrides,
  };
}

function construireOr(lignes: readonly ReponseLigneOr[]): Pick<ReponseOrdreReparation, 'lignes'> {
  return { lignes };
}

describe('lignes-assignees', () => {
  it('ne compte pas une ligne dont `technicienId` est `null` — régression OR-2026-15', () => {
    const or = construireOr([
      construireLigne({ id: 'l1', technicienId: null }),
      construireLigne({ id: 'l2', technicienId: null }),
    ]);

    expect(compterLignesAssigneesPointables(or, TECHNICIEN_ID)).toBe(0);
    expect(lignesAssigneesPointables(or, TECHNICIEN_ID)).toEqual([]);
  });

  it('ne compte pas une ligne assignée à un AUTRE technicien', () => {
    const or = construireOr([construireLigne({ id: 'l1', technicienId: 'un-autre-technicien' })]);

    expect(compterLignesAssigneesPointables(or, TECHNICIEN_ID)).toBe(0);
  });

  it('compte uniquement les lignes assignées au technicien donné, pas le total de l’OR', () => {
    const or = construireOr([
      construireLigne({ id: 'l1', technicienId: TECHNICIEN_ID }),
      construireLigne({ id: 'l2', technicienId: TECHNICIEN_ID }),
      construireLigne({ id: 'l3', technicienId: 'un-autre-technicien' }),
      construireLigne({ id: 'l4', technicienId: null }),
    ]);

    expect(compterLignesAssigneesPointables(or, TECHNICIEN_ID)).toBe(2);
    expect(lignesAssigneesPointables(or, TECHNICIEN_ID).map((l) => l.id)).toEqual(['l1', 'l2']);
  });

  it.each(['refusee', 'annulee', 'facturee'] as const)(
    'exclut une ligne assignée mais au statut non pointable (%s)',
    (statut) => {
      const or = construireOr([construireLigne({ id: 'l1', technicienId: TECHNICIEN_ID, statut })]);

      expect(compterLignesAssigneesPointables(or, TECHNICIEN_ID)).toBe(0);
    },
  );

  it.each(['proposee', 'a_valider', 'validee', 'en_cours', 'realisee'] as const)(
    'inclut une ligne assignée au statut pointable (%s)',
    (statut) => {
      const or = construireOr([construireLigne({ id: 'l1', technicienId: TECHNICIEN_ID, statut })]);

      expect(compterLignesAssigneesPointables(or, TECHNICIEN_ID)).toBe(1);
    },
  );

  describe('lignesPointables — arbitrage @laupernoe du 14.08.2026, NE PAS ROUVRIR', () => {
    it('inclut une ligne pointable même SANS assignation (`technicienId: null`)', () => {
      const or = construireOr([construireLigne({ id: 'l1', technicienId: null })]);

      expect(lignesPointables(or).map((l) => l.id)).toEqual(['l1']);
    });

    it('inclut une ligne pointable assignée à un AUTRE technicien — jamais filtrée', () => {
      const or = construireOr([construireLigne({ id: 'l1', technicienId: 'un-autre-technicien' })]);

      expect(lignesPointables(or).map((l) => l.id)).toEqual(['l1']);
    });

    it('mélange assignée-à-moi / assignée-à-un-autre / non-assignée : les trois ressortent', () => {
      const or = construireOr([
        construireLigne({ id: 'l1', technicienId: TECHNICIEN_ID }),
        construireLigne({ id: 'l2', technicienId: 'un-autre-technicien' }),
        construireLigne({ id: 'l3', technicienId: null }),
      ]);

      expect(lignesPointables(or).map((l) => l.id)).toEqual(['l1', 'l2', 'l3']);
    });

    it.each(['refusee', 'annulee', 'facturee'] as const)(
      'exclut toujours une ligne au statut non pointable (%s), assignation ou non',
      (statut) => {
        const or = construireOr([construireLigne({ id: 'l1', technicienId: null, statut })]);

        expect(lignesPointables(or)).toEqual([]);
      },
    );

    it.each(['proposee', 'a_valider', 'validee', 'en_cours', 'realisee'] as const)(
      'inclut une ligne au statut pointable (large) (%s)',
      (statut) => {
        const or = construireOr([construireLigne({ id: 'l1', technicienId: null, statut })]);

        expect(lignesPointables(or).map((l) => l.id)).toEqual(['l1']);
      },
    );
  });

  describe('ligneEstReellementPointableRM93 — vraie règle serveur (RM-93)', () => {
    it.each(['validee', 'en_cours'] as const)(
      'accepte UNIQUEMENT les statuts que le serveur accepte (%s)',
      (statut) => {
        const ligne = construireLigne({ id: 'l1', statut });

        expect(ligneEstReellementPointableRM93(ligne)).toBe(true);
      },
    );

    it.each(['proposee', 'a_valider', 'realisee', 'refusee', 'annulee', 'facturee'] as const)(
      'refuse les autres statuts (%s)',
      (statut) => {
        const ligne = construireLigne({ id: 'l1', statut });

        expect(ligneEstReellementPointableRM93(ligne)).toBe(false);
      },
    );
  });
});
