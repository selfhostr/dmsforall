import { describe, expect, it } from 'vitest';

import { schemaCreationLigneDocument } from './ligne';

/**
 * RP-43 — le pont vente comptoir ↔ facturation : `articleId`/`siteId` sur
 * `schemaCreationLigneDocument`. Prouvé ICI, au niveau du contrat (zod), avant toute logique
 * serveur :
 *  1. Les deux se fournissent ENSEMBLE, jamais l'un sans l'autre (une référence orpheline vers un
 *     article sans site, ou l'inverse, n'a pas de sens pour fabriquer un mouvement de stock).
 *  2. Réservés à `type = 'piece'` — une ligne `forfait`/`texte`/… avec `articleId` n'a pas de sens,
 *     le stock ne se décrémente jamais pour ces types.
 *  3. Une ligne `piece` SANS `articleId`/`siteId` reste valide (non-régression : les documents
 *     existants, et les lignes `piece` qui ne référencent pas d'article de référentiel, continuent
 *     de fonctionner exactement comme avant ce lot).
 */
const ID_ARTICLE = '11111111-1111-4111-8111-111111111111';
const ID_SITE = '22222222-2222-4222-8222-222222222222';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'piece',
    designation: 'Plaquettes de frein avant',
    prixUnitaireTtcCentimes: 8900,
    tauxTvaPourmille: 81,
    datePrestation: '2026-08-04',
    ...overrides,
  };
}

describe('schemaCreationLigneDocument — pont stock pièces (RP-43, articleId/siteId)', () => {
  it("accepte une ligne 'piece' avec articleId ET siteId fournis ensemble", () => {
    const resultat = schemaCreationLigneDocument.safeParse(
      payload({ articleId: ID_ARTICLE, siteId: ID_SITE }),
    );
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect(resultat.data.articleId).toBe(ID_ARTICLE);
      expect(resultat.data.siteId).toBe(ID_SITE);
    }
  });

  it("accepte une ligne 'piece' SANS articleId ni siteId — non-régression (piece sans article de référentiel)", () => {
    const resultat = schemaCreationLigneDocument.safeParse(payload());
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect(resultat.data.articleId).toBeUndefined();
      expect(resultat.data.siteId).toBeUndefined();
    }
  });

  it('refuse articleId SANS siteId (référence orpheline)', () => {
    const resultat = schemaCreationLigneDocument.safeParse(payload({ articleId: ID_ARTICLE }));
    expect(resultat.success).toBe(false);
  });

  it('refuse siteId SANS articleId (référence orpheline)', () => {
    const resultat = schemaCreationLigneDocument.safeParse(payload({ siteId: ID_SITE }));
    expect(resultat.success).toBe(false);
  });

  it("refuse articleId/siteId sur une ligne type = 'forfait' (pas de stock à décrémenter)", () => {
    const resultat = schemaCreationLigneDocument.safeParse(
      payload({
        type: 'forfait',
        articleId: ID_ARTICLE,
        siteId: ID_SITE,
      }),
    );
    expect(resultat.success).toBe(false);
  });

  it("refuse articleId/siteId sur une ligne type = 'texte' (cumulé avec le refus déjà existant du prix)", () => {
    const resultat = schemaCreationLigneDocument.safeParse({
      type: 'texte',
      designation: 'Note libre',
      tauxTvaPourmille: 0,
      datePrestation: '2026-08-04',
      articleId: ID_ARTICLE,
      siteId: ID_SITE,
    });
    expect(resultat.success).toBe(false);
  });
});
