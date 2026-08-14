import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { MouvementController } from './mouvement.controller';

/**
 * Pas de défaut ici : `ajustementInventaire` documentait déjà `201` (`@ApiResponse({ status: 201
 * })`) et rendait déjà `201` (défaut NestJS sur `@Post()`) — aucun écart contrat/exécution.
 * Seule incohérence STYLISTIQUE trouvée pendant l'audit : c'était la seule route `POST` du
 * contrôleur à ne pas porter `@HttpCode(...)` explicitement, contrairement à ses cinq sœurs
 * (`casse`, `perte`, `transfert`, `retour-fournisseur`, `sortie-comptoir`, `retour-client`).
 * Corrigé pour ne plus dépendre du défaut implicite — la source même du défaut visé par ce lot de
 * correctifs ailleurs dans le module.
 *
 * Ce test verrouille explicitement les sept routes de création (toutes `201`) pour que
 * l'incohérence ne revienne pas en silence.
 */
describe('MouvementController — @HttpCode(201) explicite sur toutes les routes de création', () => {
  it.each([
    'casse',
    'perte',
    'transfert',
    'ajustementInventaire',
    'retourFournisseur',
    'sortieComptoir',
    'retourClient',
  ] as const)('%s() porte @HttpCode(201)', (methode) => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, MouvementController.prototype[methode])).toBe(
      201,
    );
  });
});
