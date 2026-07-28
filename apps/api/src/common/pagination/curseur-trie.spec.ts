/**
 * Extension ADDITIVE du curseur (v2, contrats-api-etape-1.md §6.1) : `decoderCurseurTrie` /
 * `encoderCurseurTrie`. Le critère de non-régression associé — « les tests existants de
 * `curseur.spec.ts` passent SANS modification » — est vérifié par ce fichier n'y touchant pas :
 * toute la couverture v1 reste dans `curseur.spec.ts`, celui-ci ne couvre QUE le comportement
 * nouveau : round-trip v2, décodage v1 réinterprété comme `t = TRI_DEFAUT_CREATION`, et le rejet
 * d'un curseur dont le tri ne correspond pas à celui demandé.
 */

import { TRI_DEFAUT_CREATION } from '@dfa/shared';
import { describe, expect, it } from 'vitest';
import { ErreurMetier } from '../erreurs/erreur-metier';
import { decoderCurseur, decoderCurseurTrie, encoderCurseur, encoderCurseurTrie } from './curseur';

function attendErreurCurseurInvalide(fonction: () => unknown): void {
  let erreurCapturee: unknown;
  try {
    fonction();
  } catch (erreur) {
    erreurCapturee = erreur;
  }
  expect(erreurCapturee, 'devait lever une erreur').toBeInstanceOf(ErreurMetier);
  const erreur = erreurCapturee as ErreurMetier;
  expect(erreur.code).toBe('VALIDATION_ECHOUEE');
  expect(erreur.status).toBe(400);
  expect(erreur.erreurs?.[0]?.champ).toBe('curseur');
}

function encoderObjetBrut(objet: unknown): string {
  return Buffer.from(JSON.stringify(objet), 'utf8').toString('base64url');
}

describe('encoderCurseurTrie / decoderCurseurTrie — round-trip v2', () => {
  it('un curseur v2 encodé puis décodé restitue exactement tri, valeur et id (valeur chaîne)', () => {
    const curseur = encoderCurseurTrie({
      tri: 'restitutionPromiseLe:asc',
      valeur: '2026-08-01T00:00:00.000Z',
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    });
    const decode = decoderCurseurTrie(curseur, 'restitutionPromiseLe:asc');
    expect(decode).toEqual({
      tri: 'restitutionPromiseLe:asc',
      valeur: '2026-08-01T00:00:00.000Z',
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    });
  });

  it('accepte une valeur de tri entière', () => {
    const curseur = encoderCurseurTrie({ tri: 'numero:desc', valeur: 4213, id: 'a1b2c3d4-e5f6-4789-a012-3456789abcde' });
    const decode = decoderCurseurTrie(curseur, 'numero:desc');
    expect(decode.valeur).toBe(4213);
  });

  it('accepte une valeur de tri null (colonne nullable, NULLS LAST)', () => {
    const curseur = encoderCurseurTrie({ tri: 'restitutionPromiseLe:asc', valeur: null, id: 'a1b2c3d4-e5f6-4789-a012-3456789abcde' });
    const decode = decoderCurseurTrie(curseur, 'restitutionPromiseLe:asc');
    expect(decode.valeur).toBeNull();
  });
});

describe('decoderCurseurTrie — non-régression v1 : le curseur historique reste décodable', () => {
  it('un curseur v1 {c,i} valide se décode avec tri = TRI_DEFAUT_CREATION quand on le demande', () => {
    const curseurV1 = encoderCurseur({ creeLe: new Date('2026-01-01T00:00:00.000Z'), id: 'a1b2c3d4-e5f6-4789-a012-3456789abcde' });
    const decode = decoderCurseurTrie(curseurV1, TRI_DEFAUT_CREATION);
    expect(decode).toEqual({
      tri: TRI_DEFAUT_CREATION,
      valeur: '2026-01-01T00:00:00.000Z',
      id: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
    });
  });

  it('un curseur v1 décodé par decoderCurseur (l\'ancienne fonction) et par decoderCurseurTrie donnent la même date/id', () => {
    const curseurV1 = encoderCurseur({ creeLe: new Date('2025-06-15T12:30:00.000Z'), id: '3fa85f64-5717-4562-b3fc-2c963f66afa6' });
    const viaV1 = decoderCurseur(curseurV1);
    const viaTrie = decoderCurseurTrie(curseurV1, TRI_DEFAUT_CREATION);
    expect(viaTrie.valeur).toBe(viaV1.creeLe.toISOString());
    expect(viaTrie.id).toBe(viaV1.id);
  });

  it('un curseur v1 demandé avec un tri différent de TRI_DEFAUT_CREATION est refusé (un curseur v1 ne connaît qu\'un seul tri)', () => {
    const curseurV1 = encoderCurseur({ creeLe: new Date('2026-01-01T00:00:00.000Z'), id: 'a1b2c3d4-e5f6-4789-a012-3456789abcde' });
    attendErreurCurseurInvalide(() => decoderCurseurTrie(curseurV1, 'numero:asc'));
  });
});

describe('decoderCurseurTrie — un curseur dont le tri diffère du tri demandé est TOUJOURS refusé', () => {
  it('t présent mais différent de triAttendu -> VALIDATION_ECHOUEE, jamais une page silencieusement fausse', () => {
    const curseur = encoderCurseurTrie({ tri: 'numero:asc', valeur: 'X-001', id: 'a1b2c3d4-e5f6-4789-a012-3456789abcde' });
    attendErreurCurseurInvalide(() => decoderCurseurTrie(curseur, 'creeLe:desc'));
  });
});

describe('decoderCurseurTrie — toute entrée cliente invalide produit VALIDATION_ECHOUEE, jamais une exception non typée', () => {
  it('chaîne vide', () => {
    attendErreurCurseurInvalide(() => decoderCurseurTrie('', 'creeLe:desc'));
  });

  it('charabia base64url', () => {
    attendErreurCurseurInvalide(() => decoderCurseurTrie('pas-du-tout-un-curseur-valide-!!!', 'creeLe:desc'));
  });

  it('JSON valide mais qui est un tableau', () => {
    attendErreurCurseurInvalide(() => decoderCurseurTrie(encoderObjetBrut(['t', 'v', 'i']), 'creeLe:desc'));
  });

  it('forme v2 sans le champ "v"', () => {
    attendErreurCurseurInvalide(() =>
      decoderCurseurTrie(encoderObjetBrut({ t: 'creeLe:desc', i: 'a1b2c3d4-e5f6-4789-a012-3456789abcde' }), 'creeLe:desc'),
    );
  });

  it('forme v2 avec "t" qui n\'est pas une chaîne', () => {
    attendErreurCurseurInvalide(() =>
      decoderCurseurTrie(encoderObjetBrut({ t: 42, v: 'x', i: 'a1b2c3d4-e5f6-4789-a012-3456789abcde' }), 'creeLe:desc'),
    );
  });

  it('forme v2 avec "v" d\'un type non admis (objet)', () => {
    attendErreurCurseurInvalide(() =>
      decoderCurseurTrie(
        encoderObjetBrut({ t: 'creeLe:desc', v: { imbrique: true }, i: 'a1b2c3d4-e5f6-4789-a012-3456789abcde' }),
        'creeLe:desc',
      ),
    );
  });

  it('forme v2 avec "i" malformé', () => {
    attendErreurCurseurInvalide(() =>
      decoderCurseurTrie(encoderObjetBrut({ t: 'creeLe:desc', v: 'x', i: 'pas-un-uuid' }), 'creeLe:desc'),
    );
  });

  it('ni forme v1 ni forme v2 (objet sans aucun champ reconnu)', () => {
    attendErreurCurseurInvalide(() => decoderCurseurTrie(encoderObjetBrut({ z: 1 }), 'creeLe:desc'));
  });

  it('JSON valide mais null', () => {
    attendErreurCurseurInvalide(() => decoderCurseurTrie(encoderObjetBrut(null), 'creeLe:desc'));
  });
});
