import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { LigneOrController } from './ligne-or.controller';

/**
 * Même défaut que `ordre-reparation-transitions.controller.ts` (voir son spec pour le contexte
 * complet) : cinq routes de ce contrôleur documentaient `200` (`@ApiOkResponse`) sans porter
 * `@HttpCode(...)` explicite, donc rendaient RÉELLEMENT `201` par défaut NestJS — aucune n'est une
 * création, toutes modifient une ou plusieurs lignes/l'OR existant(es).
 *
 * `creer()` crée réellement une ligne d'OR — `201` documenté et codé, testé ici aussi pour empêcher
 * une régression inverse. `modifier()` (`@Patch`) n'est pas concernée : le défaut NestJS pour PATCH
 * est déjà `200`, aucun `@HttpCode` explicite n'y est nécessaire.
 */
describe('LigneOrController — @HttpCode explicite conforme à la doc Swagger', () => {
  const casDocumentes200 = [
    ['marquerRealisee', LigneOrController.prototype.marquerRealisee],
    ['validerLignes', LigneOrController.prototype.validerLignes],
    ['refuserLignes', LigneOrController.prototype.refuserLignes],
    ['annulerLignes', LigneOrController.prototype.annulerLignes],
    ['soumettreLignesADevis', LigneOrController.prototype.soumettreLignesADevis],
  ] as const;

  it.each(casDocumentes200)(
    '%s() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), plus 201 par défaut',
    (_nom, handler) => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
    },
  );

  it('creer() porte @HttpCode(201) — VRAIE création (ligne d’OR), conforme à @ApiResponse(201)', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, LigneOrController.prototype.creer)).toBe(201);
  });
});
