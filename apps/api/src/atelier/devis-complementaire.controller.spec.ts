import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { DevisComplementaireController } from './devis-complementaire.controller';

/**
 * Même défaut que `ordre-reparation-transitions.controller.ts` (voir son spec pour le contexte
 * complet) : `repondre()` documentait `200` (`@ApiOkResponse`) sans porter `@HttpCode(...)`
 * explicite, donc rendait RÉELLEMENT `201` par défaut NestJS. Enregistrer la réponse du client à un
 * devis complémentaire modifie une ressource existante, ce n'en est pas la création.
 *
 * `creer()` crée réellement un devis complémentaire — `201` documenté et codé, testé ici aussi pour
 * empêcher une régression inverse.
 */
describe('DevisComplementaireController — @HttpCode explicite conforme à la doc Swagger', () => {
  it('repondre() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), plus 201 par défaut', () => {
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, DevisComplementaireController.prototype.repondre),
    ).toBe(200);
  });

  it('creer() porte @HttpCode(201) — VRAIE création, conforme à @ApiResponse(201)', () => {
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, DevisComplementaireController.prototype.creer),
    ).toBe(201);
  });
});
