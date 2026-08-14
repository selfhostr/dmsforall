import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { ConsigneController } from './consigne.controller';

/**
 * Même défaut que `pneus/depot-pneus.controller.ts` (défaut n°3) : `marquerRetourFournisseur`
 * documentait `200` (`@ApiOkResponse`) mais rendait RÉELLEMENT `201` (défaut de NestJS sur
 * `@Post()` sans `@HttpCode(...)` explicite). Le mouvement `retour_consigne` généré est un
 * effet de bord non exposé dans la réponse — laquelle reste `ConsigneEchangeStandardDto`, la
 * consigne existante mutée — d'où `200`, pas `201`.
 *
 * Ce test vérifie la métadonnée `@HttpCode(...)` réellement posée sur le handler.
 */
describe('ConsigneController — @HttpCode explicite sur le POST qui rend 200', () => {
  it('marquerRetourFournisseur() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), plus 201 par défaut', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        ConsigneController.prototype.marquerRetourFournisseur,
      ),
    ).toBe(200);
  });
});
