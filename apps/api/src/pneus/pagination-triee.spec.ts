import { describe, expect, it } from 'vitest';

import { decoderCurseurPourTri, encoderCurseurTrie } from './pagination-triee';

/**
 * Défaut n°1 (rapport de livraison) : `GET /sites/{siteId}/hangar-pneus` — et les autres listes
 * du module — répondaient `500 ERREUR_INTERNE` sur un curseur v2 SYNTAXIQUEMENT valide (forme
 * `{t,v,i}` correcte, `t` égal au tri demandé, `i` un uuid) mais dont la valeur `v` n'était pas le
 * texte natif PostgreSQL d'un `timestamptz` — reproduit en exécution réelle contre l'API en
 * marche (voir le rapport de livraison), PAS par les 19 tests d'intégration existants : ceux-ci
 * n'exercent que des curseurs absents ou ENCODÉS PAR LE SERVEUR (donc déjà valides). Un curseur
 * FORGÉ avec une valeur arbitraire dans `v` n'est exercé nulle part côté intégration.
 *
 * `decoderCurseurPourTri` doit désormais rejeter un tel curseur en `VALIDATION_ECHOUEE` (400)
 * AVANT toute requête SQL — c'est la correction : la valeur ne doit plus jamais atteindre
 * `construireConditionKeyset` (donc la base) sans être un timestamptz PostgreSQL bien formé.
 */
describe('decoderCurseurPourTri — défaut n°1 : curseur syntaxiquement valide, valeur non temporelle', () => {
  function curseurV2(v: unknown): string {
    const brut = JSON.stringify({
      t: 'dernierMouvementLe:desc',
      v,
      i: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
    });
    return Buffer.from(brut, 'utf8').toString('base64url');
  }

  it('rejette (VALIDATION_ECHOUEE) une valeur qui n’est pas un timestamptz PostgreSQL — c’était le crash reproduit', () => {
    const curseur = curseurV2('not-a-real-timestamp');

    expect(() => decoderCurseurPourTri(curseur, 'dernierMouvementLe:desc')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
    );
  });

  it('rejette une valeur numérique — aucun tri du module pneus n’est numérique', () => {
    const curseur = curseurV2(42);

    expect(() => decoderCurseurPourTri(curseur, 'dernierMouvementLe:desc')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
    );
  });

  it('rejette une chaîne vide', () => {
    const curseur = curseurV2('');

    expect(() => decoderCurseurPourTri(curseur, 'dernierMouvementLe:desc')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
    );
  });

  it('accepte une valeur null (branche NULLS LAST) sans lever', () => {
    const curseur = curseurV2(null);

    expect(() => decoderCurseurPourTri(curseur, 'dernierMouvementLe:desc')).not.toThrow();
  });

  it('accepte le texte natif PostgreSQL (avec microseconde) tel que produit par la base réelle — valeur rendue INCHANGÉE (seule la validité de forme est jugée ici, pas la normalisation)', () => {
    const curseur = curseurV2('2026-04-01 08:00:00.123456+00');

    const decode = decoderCurseurPourTri(curseur, 'dernierMouvementLe:desc');

    expect(decode).toEqual({
      valeur: '2026-04-01 08:00:00.123456+00',
      id: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
    });
  });

  it('accepte un curseur produit par encoderCurseurTrie() à partir d’une valeur déjà normalisée — round-trip serveur intact', () => {
    const curseur = encoderCurseurTrie({
      tri: 'dernierMouvementLe:desc',
      valeur: '2026-04-01T08:00:00.123456+00:00',
      id: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
    });

    const decode = decoderCurseurPourTri(curseur, 'dernierMouvementLe:desc');

    expect(decode?.valeur).toBe('2026-04-01T08:00:00.123456+00:00');
  });
});
