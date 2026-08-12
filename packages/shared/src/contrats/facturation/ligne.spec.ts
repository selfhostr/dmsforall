import { describe, expect, it } from 'vitest';

import { schemaCreationLigneDocument, schemaModificationLigneDocument } from './ligne';

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

/**
 * Issue #12 — `formeLigneDocument` était un `z.object` SANS `.strict()`, donc zod appliquait le
 * `.strip()` par défaut : un nom de champ inconnu (voisin plausible d'un vrai champ) disparaissait
 * SILENCIEUSEMENT, `201 Created` rendu, ligne créée à `montantTtcCentimes: 0`. Preuve en exécution
 * (branche `fix/champs-inconnus-et-compteur-seed`) : `POST /documents-vente/{id}/lignes` avec
 * `prixUnitaireCentimes` (au lieu de `prixUnitaireTtcCentimes`) rendait `201`, puis
 * `POST .../emettre` verrouillait un document `emis` à zéro (`MD-21` : plus aucune correction
 * possible autrement que par un avoir). Ces tests verrouillent le comportement corrigé — valeurs
 * exactes, jamais `toBeCloseTo` : une donnée d'argent ne s'approxime pas.
 */
describe('schemaCreationLigneDocument — champ inconnu REFUSÉ, nommé (issue #12, .strict())', () => {
  const LIGNE_VALIDE_TEXTE = {
    type: 'forfait',
    designation: 'Révision complète',
    quantiteMillieme: 1000,
    tauxTvaPourmille: 81,
    datePrestation: '2026-08-04',
  };

  it('reproduit exactement le geste de l’issue #12 : prixUnitaireCentimes (faux nom) est REFUSÉ, jamais accepté à 0', () => {
    const resultat = schemaCreationLigneDocument.safeParse({
      ...LIGNE_VALIDE_TEXTE,
      prixUnitaireCentimes: 8900, // faux nom de champ — le vrai est prixUnitaireTtcCentimes
    });
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    // Avant le correctif, ceci n'aurait jamais été atteint : `success` valait `true` et
    // `resultat.data.prixUnitaireTtcCentimes` valait `undefined` (donc 0 après calcul serveur),
    // sans la moindre issue de validation.
    expect(resultat.error.issues).toHaveLength(1);
    const issue = resultat.error.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    // Le corollaire de l'issue #12 : le message DOIT nommer le champ fautif, pas juste dire
    // « validation échouée ». `PipeZod` (apps/api/src/common/validation/pipe-zod.ts) restitue ce
    // message tel quel dans le `problem+json` rendu au client.
    expect(issue?.message).toBe('Unrecognized key: "prixUnitaireCentimes"');
  });

  it('le même champ correctement nommé (prixUnitaireTtcCentimes) est accepté, montant exact préservé', () => {
    const resultat = schemaCreationLigneDocument.safeParse({
      ...LIGNE_VALIDE_TEXTE,
      prixUnitaireTtcCentimes: 8900,
    });
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data.prixUnitaireTtcCentimes).toBe(8900);
  });

  it('une ligne par ailleurs valide, sans aucun champ superflu, reste acceptée (non-régression)', () => {
    const resultat = schemaCreationLigneDocument.safeParse({
      ...LIGNE_VALIDE_TEXTE,
      prixUnitaireTtcCentimes: 8900,
    });
    expect(resultat.success).toBe(true);
  });

  it('plusieurs champs inconnus à la fois : chacun est nommé dans le message (aucun ne se cache derrière un autre)', () => {
    const resultat = schemaCreationLigneDocument.safeParse({
      ...LIGNE_VALIDE_TEXTE,
      prixUnitaireTtcCentimes: 8900,
      montantTtcCentimes: 8900, // champ dérivé, jamais saisi côté client
      remiseCentimes: 100, // faux nom — le vrai est remiseMontantCentimes
    });
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    const issue = resultat.error.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect((issue as { keys?: readonly string[] } | undefined)?.keys).toEqual([
      'montantTtcCentimes',
      'remiseCentimes',
    ]);
  });

  it('PATCH (schemaModificationLigneDocument, .partial() hérite du .strict() de la base) refuse aussi un champ inconnu', () => {
    const resultat = schemaModificationLigneDocument.safeParse({
      prixUnitaireCentimes: 5000,
    });
    expect(resultat.success).toBe(false);
    if (resultat.success) return;
    expect(resultat.error.issues[0]?.message).toBe('Unrecognized key: "prixUnitaireCentimes"');
  });
});
