import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { DepotPneusController } from './depot-pneus.controller';

/**
 * Défaut n°3 (rapport de livraison) : `changer-saison` et `sortir` documentaient `200`
 * (`@ApiOkResponse`, la documentation Swagger) mais rendaient RÉELLEMENT `201` — mesuré en
 * exécution contre l'API en marche : NestJS pose `201` par défaut sur tout `@Post()` dépourvu de
 * `@HttpCode(...)` explicite, et ces deux routes n'en portaient pas. Un client qui se fie au
 * contrat documenté (`200`) se trompe.
 *
 * Ce test vérifie la métadonnée `@HttpCode(...)` réellement posée sur le handler — c'est
 * EXACTEMENT ce que Nest consulte pour déterminer le statut HTTP réel (`Reflect.getMetadata(
 * HTTP_CODE_METADATA, handler)`), donc un test qui rougirait si le décorateur disparaissait à
 * nouveau, sans dépendre de faire tourner un serveur HTTP complet.
 */
describe('DepotPneusController — défaut n°3 : @HttpCode explicite sur chaque POST qui rend 200', () => {
  it('changerSaison() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), plus 201 par défaut', () => {
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, DepotPneusController.prototype.changerSaison),
    ).toBe(200);
  });

  it('sortir() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), plus 201 par défaut', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, DepotPneusController.prototype.sortir)).toBe(
      200,
    );
  });

  it('deplacer() (défaut n°2, nouvelle route) porte @HttpCode(200) dès sa création — jamais le piège du défaut par défaut', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, DepotPneusController.prototype.deplacer)).toBe(
      200,
    );
  });
});
