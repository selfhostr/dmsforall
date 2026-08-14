import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { FournisseurController } from './fournisseur.controller';

/**
 * Même défaut que `pneus/depot-pneus.controller.ts` (défaut n°3) : `desactiver` et `reactiver`
 * documentaient `200` (`@ApiOkResponse`) mais rendaient RÉELLEMENT `201` (défaut de NestJS sur
 * `@Post()` sans `@HttpCode(...)` explicite).
 *
 * Ce test vérifie la métadonnée `@HttpCode(...)` réellement posée sur le handler.
 */
describe('FournisseurController — @HttpCode explicite sur chaque POST qui rend 200', () => {
  it('desactiver() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), plus 201 par défaut', () => {
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, FournisseurController.prototype.desactiver),
    ).toBe(200);
  });

  it('reactiver() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), plus 201 par défaut', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, FournisseurController.prototype.reactiver)).toBe(
      200,
    );
  });

  it('creer() reste @HttpCode(201) — établit l’identité d’un fournisseur inédit', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, FournisseurController.prototype.creer)).toBe(
      201,
    );
  });
});
