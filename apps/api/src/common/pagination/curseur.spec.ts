/**
 * `encoderCurseur` / `decoderCurseur` sont le SEUL point d'entrée de données client dans le
 * mécanisme de pagination de toutes les listes du produit (OR, clients, véhicules, pièces,
 * factures — ServiceSite.lister() est le premier consommateur, contrat §2.3). Un curseur est
 * une chaîne fournie par le client, potentiellement forgée à la main : ce test vérifie que
 * TOUTE anomalie de forme se traduit par l'erreur métier `VALIDATION_ECHOUEE` (→ 400), jamais
 * par une exception non typée qui remonterait en 500.
 */

import { describe, expect, it } from 'vitest';
import { ErreurMetier } from '../erreurs/erreur-metier';
import { decoderCurseur, encoderCurseur } from './curseur';

/** Encode un objet arbitraire en curseur opaque, sans passer par `encoderCurseur` (qui exige
 *  un `DonneesCurseur` bien formé) — pour construire les cas d'erreur "JSON valide mais champs
 *  absents ou mal typés". */
function encoderObjetBrut(objet: unknown): string {
  return Buffer.from(JSON.stringify(objet), 'utf8').toString('base64url');
}

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

describe('encoderCurseur / decoderCurseur — round-trip', () => {
  it('un curseur encodé puis décodé restitue exactement les mêmes creeLe et id', () => {
    const creeLe = new Date('2026-03-14T08:21:33.512Z');
    const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

    const curseur = encoderCurseur({ creeLe, id });
    const decode = decoderCurseur(curseur);

    expect(decode.id).toBe(id);
    expect(decode.creeLe.getTime()).toBe(creeLe.getTime());
  });

  it('le curseur encodé est une chaîne base64url opaque (pas de JSON ni de "=" de padding lisible tel quel)', () => {
    const curseur = encoderCurseur({ creeLe: new Date('2026-01-01T00:00:00.000Z'), id: '3fa85f64-5717-4562-b3fc-2c963f66afa6' });
    expect(curseur).not.toMatch(/[{}":]/);
  });
});

describe('decoderCurseur — toute entrée cliente invalide produit VALIDATION_ECHOUEE, jamais une exception non typée', () => {
  it('un curseur valide ne lève rien et rend les bonnes valeurs', () => {
    const curseur = encoderCurseur({
      creeLe: new Date('2025-12-25T10:00:00.000Z'),
      id: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
    });
    expect(() => decoderCurseur(curseur)).not.toThrow();
    const decode = decoderCurseur(curseur);
    expect(decode.id).toBe('a1b2c3d4-e5f6-4789-a012-3456789abcde');
  });

  it('un curseur tronqué (JSON coupé au milieu) lève VALIDATION_ECHOUEE', () => {
    const curseurComplet = encoderCurseur({
      creeLe: new Date('2025-12-25T10:00:00.000Z'),
      id: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
    });
    const tronque = curseurComplet.slice(0, Math.floor(curseurComplet.length / 2));
    attendErreurCurseurInvalide(() => decoderCurseur(tronque));
  });

  it('une chaîne vide lève VALIDATION_ECHOUEE', () => {
    attendErreurCurseurInvalide(() => decoderCurseur(''));
  });

  it('une chaîne qui ne décode pas vers du JSON valide (charabia base64url) lève VALIDATION_ECHOUEE', () => {
    // Le décodage base64url de Node est lenient (il ignore les caractères hors alphabet plutôt
    // que de lever) : c'est le JSON.parse qui échoue en aval sur les octets obtenus. C'est ce
    // chemin, et pas le `catch` autour de Buffer.from, qui protège en pratique ce cas.
    attendErreurCurseurInvalide(() => decoderCurseur('pas-du-tout-un-curseur-valide-!!!'));
  });

  it('un JSON valide mais qui n\'est pas un objet (ex. un tableau) lève VALIDATION_ECHOUEE', () => {
    attendErreurCurseurInvalide(() => decoderCurseur(encoderObjetBrut(['c', 'i'])));
  });

  it('un JSON valide mais qui est null lève VALIDATION_ECHOUEE', () => {
    attendErreurCurseurInvalide(() => decoderCurseur(encoderObjetBrut(null)));
  });

  it('un objet JSON valide sans le champ "c" lève VALIDATION_ECHOUEE', () => {
    attendErreurCurseurInvalide(() => decoderCurseur(encoderObjetBrut({ i: 'a1b2c3d4-e5f6-4789-a012-3456789abcde' })));
  });

  it('un objet JSON valide sans le champ "i" lève VALIDATION_ECHOUEE', () => {
    attendErreurCurseurInvalide(() => decoderCurseur(encoderObjetBrut({ c: '2025-12-25T10:00:00.000Z' })));
  });

  it('un champ "c" qui n\'est pas une chaîne (nombre) lève VALIDATION_ECHOUEE', () => {
    attendErreurCurseurInvalide(() =>
      decoderCurseur(encoderObjetBrut({ c: 1735120800000, i: 'a1b2c3d4-e5f6-4789-a012-3456789abcde' })),
    );
  });

  it('un champ "i" qui n\'est pas une chaîne (objet) lève VALIDATION_ECHOUEE', () => {
    attendErreurCurseurInvalide(() =>
      decoderCurseur(encoderObjetBrut({ c: '2025-12-25T10:00:00.000Z', i: { uuid: 'x' } })),
    );
  });

  it('une date "c" invalide (chaîne non parseable) lève VALIDATION_ECHOUEE', () => {
    attendErreurCurseurInvalide(() =>
      decoderCurseur(encoderObjetBrut({ c: 'pas-une-date', i: 'a1b2c3d4-e5f6-4789-a012-3456789abcde' })),
    );
  });

  it('un uuid "i" malformé (mauvais nombre de caractères) lève VALIDATION_ECHOUEE', () => {
    attendErreurCurseurInvalide(() =>
      decoderCurseur(encoderObjetBrut({ c: '2025-12-25T10:00:00.000Z', i: 'pas-un-uuid' })),
    );
  });

  it('un uuid "i" de bonne forme mais avec un caractère hors [0-9a-f] lève VALIDATION_ECHOUEE', () => {
    attendErreurCurseurInvalide(() =>
      decoderCurseur(encoderObjetBrut({ c: '2025-12-25T10:00:00.000Z', i: 'zzzzzzzz-5717-4562-b3fc-2c963f66afa6' })),
    );
  });
});
