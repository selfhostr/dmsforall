/**
 * Test unitaire colocalisé, propriété l'équipe infrastructure (`GET /sante` expose `VERSION_APP` /
 * `VERSION_APP_BRANCHE`, voir `apps/api/src/config/version-app.ts` pour leur calcul). Seule la
 * méthode `sante()` est couverte ici : elle est pure (aucun accès base/Redis), contrairement à
 * `pret()` — pas besoin d'un module Nest complet ni de doubles pour `JETON_DB`/`JETON_REDIS`,
 * seulement des valeurs `undefined` jamais lues par le chemin testé.
 */
import { describe, expect, it } from 'vitest';

import type { Config } from '../config';
import { SanteController } from './sante.controller';

describe('SanteController.sante — GET /sante', () => {
  it('expose VERSION_APP et VERSION_APP_BRANCHE tels que portés par la config validée', () => {
    const config = {
      VERSION_APP: '0.1.234+a1b2c3d',
      VERSION_APP_BRANCHE: 'main',
    } as Config;
    const controleur = new SanteController(
      config,
      undefined as unknown as ConstructorParameters<typeof SanteController>[1],
      undefined as unknown as ConstructorParameters<typeof SanteController>[2],
    );

    expect(controleur.sante()).toEqual({
      statut: 'ok',
      version: '0.1.234+a1b2c3d',
      branche: 'main',
    });
  });
});
