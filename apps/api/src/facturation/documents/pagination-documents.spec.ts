import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TRIS_DOCUMENTS_VENTE } from '@dfa/shared';

import { decoderCurseurDocuments, encoderCurseurDocuments } from './pagination-documents';

const ID = '0e2424ea-8c3c-4653-9d13-54265a03a033';

function forger(objet: unknown): string {
  return Buffer.from(JSON.stringify(objet), 'utf8').toString('base64url');
}

describe('pagination-documents — curseur keyset', () => {
  it('aller-retour exact, microsecondes de cree_le conservées', () => {
    const curseur = encoderCurseurDocuments('dateDocument:desc', {
      id: ID,
      cle: '2026-02-10',
      creeLeTexte: '2026-02-10 09:29:38.68287+00',
    });
    expect(decoderCurseurDocuments(curseur, 'dateDocument:desc')).toEqual({
      cle: '2026-02-10',
      creeLe: '2026-02-10T09:29:38.682870+00:00',
      id: ID,
    });
  });

  it('clé NULL : encodée vide, décodée null (jamais confondue avec une valeur)', () => {
    const curseur = encoderCurseurDocuments('numeroSequence:asc', {
      id: ID,
      cle: null,
      creeLeTexte: '2026-02-10 09:29:38+00',
    });
    expect(decoderCurseurDocuments(curseur, 'numeroSequence:asc')?.cle).toBeNull();
  });

  it('pas de curseur : première page', () => {
    expect(decoderCurseurDocuments(undefined, 'dateDocument:desc')).toBeNull();
  });

  it.each([
    ['ancien format (offset)', Buffer.from('50', 'utf8').toString('base64url')],
    ['illisible', 'pas du base64 json'],
    ['sans séparateur', forger({ t: 'dateDocument:desc', v: '2026-02-10', i: ID })],
    [
      'date impossible',
      forger({ t: 'dateDocument:desc', v: '2026-13-45|2026-02-10 09:00:00+00', i: ID }),
    ],
    ['cree_le non horodaté', forger({ t: 'dateDocument:desc', v: '2026-02-10|hier', i: ID })],
    [
      'id non UUID',
      forger({ t: 'dateDocument:desc', v: '2026-02-10|2026-02-10 09:00:00+00', i: 'x' }),
    ],
    ['autre tri', forger({ t: 'dateDocument:asc', v: '2026-02-10|2026-02-10 09:00:00+00', i: ID })],
    ['valeur numérique', forger({ t: 'dateDocument:desc', v: 12, i: ID })],
  ])('rejette en curseur_invalide : %s', (_nom, curseur) => {
    expect(() => decoderCurseurDocuments(curseur, 'dateDocument:desc')).toThrow(
      /Curseur de pagination invalide/,
    );
  });

  it('valide le FOND de la clé selon le type du tri (entier, horodatage)', () => {
    const creeLe = '2026-02-10 09:00:00+00';
    expect(() =>
      decoderCurseurDocuments(
        forger({ t: 'soldeCentimes:desc', v: `12abc|${creeLe}`, i: randomUUID() }),
        'soldeCentimes:desc',
      ),
    ).toThrow();
    expect(() =>
      decoderCurseurDocuments(
        forger({ t: 'relanceLe:asc', v: `demain|${creeLe}`, i: randomUUID() }),
        'relanceLe:asc',
      ),
    ).toThrow();
    expect(
      decoderCurseurDocuments(
        forger({ t: 'soldeCentimes:desc', v: `-125000|${creeLe}`, i: ID }),
        'soldeCentimes:desc',
      )?.cle,
    ).toBe('-125000');
  });

  it('couvre chacun des tris du contrat', () => {
    for (const tri of TRIS_DOCUMENTS_VENTE) {
      const curseur = encoderCurseurDocuments(tri, {
        id: ID,
        cle: tri.startsWith('dateDocument')
          ? '2026-02-10'
          : tri.startsWith('relance')
            ? '2026-02-10 09:00:00+00'
            : '42',
        creeLeTexte: '2026-02-10 09:00:00+00',
      });
      expect(decoderCurseurDocuments(curseur, tri)?.id).toBe(ID);
    }
  });
});
