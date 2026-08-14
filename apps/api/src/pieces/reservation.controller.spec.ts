import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { ReservationController } from './reservation.controller';

/**
 * Même défaut que `pneus/depot-pneus.controller.ts` (défaut n°3) : `satisfaire` et `liberer`
 * documentaient `200` (`@ApiOkResponse`) mais rendaient RÉELLEMENT `201` (défaut de NestJS sur
 * `@Post()` sans `@HttpCode(...)` explicite). Les deux mutent une réservation EXISTANTE — le
 * mouvement `sortie_or` que `satisfaire` génère est un effet de bord non exposé dans la réponse
 * (`ReservationPieceDto`, la réservation elle-même).
 *
 * Ce test vérifie la métadonnée `@HttpCode(...)` réellement posée sur le handler.
 */
describe('ReservationController — @HttpCode explicite sur chaque POST qui rend 200', () => {
  it('satisfaire() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), plus 201 par défaut', () => {
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, ReservationController.prototype.satisfaire),
    ).toBe(200);
  });

  it('liberer() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), plus 201 par défaut', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, ReservationController.prototype.liberer)).toBe(
      200,
    );
  });
});
