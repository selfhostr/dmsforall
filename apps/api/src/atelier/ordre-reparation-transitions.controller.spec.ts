import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { OrdreReparationTransitionsController } from './ordre-reparation-transitions.controller';

/**
 * Défaut signalé côté facturation (`document-vente-transitions.controller.ts::emettre`), reproduit
 * ici : les 11 routes de transition d'OR documentaient `200` (`@ApiOkResponse`) mais, en l'absence
 * de `@HttpCode(...)` explicite, NestJS rendait RÉELLEMENT `201` — comportement par défaut de tout
 * `@Post()` non annoté. Une transition d'OR modifie une ressource existante, elle n'en crée pas.
 *
 * `POST :orId/facturer` fait exception : c'est une VRAIE création (brouillon(s) de facture), documentée
 * et codée `201` — testée ici aussi pour empêcher une régression inverse (retrait accidentel du
 * `@HttpCode(CREATED)` explicite).
 *
 * Ce test lit la métadonnée `@HttpCode(...)` réellement posée sur le handler — exactement ce que
 * Nest consulte pour déterminer le statut HTTP réel (`Reflect.getMetadata(HTTP_CODE_METADATA,
 * handler)`) — sans dépendre de faire tourner un serveur HTTP complet.
 */
describe('OrdreReparationTransitionsController — @HttpCode explicite conforme à la doc Swagger', () => {
  const casDocumentes200 = [
    ['receptionner', OrdreReparationTransitionsController.prototype.receptionner],
    ['demarrer', OrdreReparationTransitionsController.prototype.demarrer],
    ['reprendreTravaux', OrdreReparationTransitionsController.prototype.reprendreTravaux],
    ['passerEnControle', OrdreReparationTransitionsController.prototype.passerEnControle],
    ['refuserControle', OrdreReparationTransitionsController.prototype.refuserControle],
    ['validerControle', OrdreReparationTransitionsController.prototype.validerControle],
    ['terminer', OrdreReparationTransitionsController.prototype.terminer],
    ['rouvrir', OrdreReparationTransitionsController.prototype.rouvrir],
    ['restituer', OrdreReparationTransitionsController.prototype.restituer],
    ['cloturer', OrdreReparationTransitionsController.prototype.cloturer],
    ['annuler', OrdreReparationTransitionsController.prototype.annuler],
  ] as const;

  it.each(casDocumentes200)(
    '%s() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), plus 201 par défaut',
    (_nom, handler) => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
    },
  );

  it('facturer() porte @HttpCode(201) — VRAIE création (brouillon de facture), conforme à @ApiResponse(201)', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        OrdreReparationTransitionsController.prototype.facturer,
      ),
    ).toBe(201);
  });
});
