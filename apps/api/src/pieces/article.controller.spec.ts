import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { ArticleController } from './article.controller';

/**
 * Même défaut que `pneus/depot-pneus.controller.ts` (défaut n°3) : `ajouterReference`,
 * `marquerObsolete` et `desactiver` documentaient `200` (`@ApiOkResponse`) mais rendaient
 * RÉELLEMENT `201` (défaut de NestJS sur `@Post()` sans `@HttpCode(...)` explicite).
 *
 * Les quatre actions post-création (`ajouterReference`, `marquerObsolete`, `desactiver`,
 * `reactiver`) rendent toutes le MÊME type de réponse que `creer` (`ArticleAvecAvertissementsDto`)
 * mais en mutant un article EXISTANT plutôt qu'en établissant l'identité d'un article inédit —
 * `reactiver` portait déjà `@HttpCode(HttpStatus.OK)` avant ce correctif, ce test étend cette
 * cohérence aux trois autres.
 *
 * Ce test vérifie la métadonnée `@HttpCode(...)` réellement posée sur le handler — exactement ce
 * que Nest consulte pour déterminer le statut HTTP réel, sans serveur HTTP complet.
 */
describe('ArticleController — @HttpCode explicite sur chaque POST qui rend 200', () => {
  it('ajouterReference() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), plus 201 par défaut', () => {
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, ArticleController.prototype.ajouterReference),
    ).toBe(200);
  });

  it('marquerObsolete() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), plus 201 par défaut', () => {
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, ArticleController.prototype.marquerObsolete),
    ).toBe(200);
  });

  it('desactiver() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), plus 201 par défaut', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ArticleController.prototype.desactiver)).toBe(
      200,
    );
  });

  it('reactiver() reste @HttpCode(200) — déjà correct avant ce correctif', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ArticleController.prototype.reactiver)).toBe(
      200,
    );
  });

  it('creer() reste @HttpCode(201) — établit l’identité d’un article inédit', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ArticleController.prototype.creer)).toBe(201);
  });
});
