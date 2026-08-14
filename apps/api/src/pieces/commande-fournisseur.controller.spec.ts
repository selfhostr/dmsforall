import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { CommandeFournisseurController } from './commande-fournisseur.controller';

/**
 * Défaut signalé par `pneus/depot-pneus.controller.ts` (défaut n°3, non corrigé à l'époque dans ce
 * module) : `envoyer`, `annuler-reliquat` et `annuler` documentaient `200` (`@ApiOkResponse`) mais
 * rendaient RÉELLEMENT `201` — NestJS pose `201` par défaut sur tout `@Post()` dépourvu de
 * `@HttpCode(...)` explicite, et ces trois routes n'en portaient pas.
 *
 * Ce test vérifie la métadonnée `@HttpCode(...)` réellement posée sur le handler — exactement ce
 * que Nest consulte pour déterminer le statut HTTP réel (`Reflect.getMetadata(HTTP_CODE_METADATA,
 * handler)`), sans dépendre de faire tourner un serveur HTTP complet.
 *
 * `creer` et `reception` créent une ressource adressable propre (commande, mouvements de stock) :
 * `201` leur est dû et n'est pas retesté ici (déjà explicite via `@HttpCode(HttpStatus.CREATED)`).
 */
describe('CommandeFournisseurController — @HttpCode explicite sur chaque POST qui rend 200', () => {
  it('envoyer() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), plus 201 par défaut', () => {
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, CommandeFournisseurController.prototype.envoyer),
    ).toBe(200);
  });

  it('annulerReliquat() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), plus 201 par défaut', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        CommandeFournisseurController.prototype.annulerReliquat,
      ),
    ).toBe(200);
  });

  it('annuler() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), plus 201 par défaut', () => {
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, CommandeFournisseurController.prototype.annuler),
    ).toBe(200);
  });

  it('reception() reste @HttpCode(201) — crée des mouvements de stock, réponse distincte de la commande', () => {
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, CommandeFournisseurController.prototype.reception),
    ).toBe(201);
  });
});
