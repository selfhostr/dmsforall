import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { schemaIdentificationPin } from '@dfa/shared';

import { MATRICE_DROITS, type Action } from '../auth/matrice-droits';
import { CLE_META_ACTION } from '../common/droits';

import { PinController } from './pin.controller';
import { schemaAttributionPin, schemaRevocationPin } from './pin-contrats';

/** Rôles qui détiennent une action donnée dans MATRICE_DROITS, triés pour comparaison stable. */
function rolesAyant(action: Action): string[] {
  return (Object.keys(MATRICE_DROITS) as (keyof typeof MATRICE_DROITS)[])
    .filter((role) => (MATRICE_DROITS[role] as readonly Action[]).includes(action))
    .sort();
}

describe('PinController — @HttpCode explicite conforme à la doc Swagger (garde-fou de non-régression)', () => {
  it('identifier() porte @HttpCode(200) — déjà correct, ce test empêche un futur retrait accidentel', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, PinController.prototype.identifier)).toBe(200);
  });

  it('attribuer() porte @HttpCode(200) — déjà correct', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, PinController.prototype.attribuer)).toBe(200);
  });

  it('revoquer() porte @HttpCode(200) — déjà correct', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, PinController.prototype.revoquer)).toBe(200);
  });
});

describe('PinController — droit exigé par route (câblage réel de @ExigerDroit)', () => {
  it('identifier() exige atelier.pointage.identifier — réservé au compte de service poste_atelier', () => {
    expect(Reflect.getMetadata(CLE_META_ACTION, PinController.prototype.identifier)).toBe(
      'atelier.pointage.identifier',
    );
    expect(rolesAyant('atelier.pointage.identifier')).toEqual(['poste_atelier']);
  });

  it('attribuer()/revoquer() exigent atelier.pointage.gerer_pin — encadrement seul (chef_atelier/direction/admin)', () => {
    expect(Reflect.getMetadata(CLE_META_ACTION, PinController.prototype.attribuer)).toBe(
      'atelier.pointage.gerer_pin',
    );
    expect(Reflect.getMetadata(CLE_META_ACTION, PinController.prototype.revoquer)).toBe(
      'atelier.pointage.gerer_pin',
    );
    expect(rolesAyant('atelier.pointage.gerer_pin')).toEqual(
      ['admin', 'chef_atelier', 'direction'].sort(),
    );
  });

  it('un technicien ne peut pas s’auto-attribuer un PIN (RM-128 : l’auto-service est explicitement reporté)', () => {
    expect(rolesAyant('atelier.pointage.gerer_pin')).not.toContain('technicien');
  });

  it('la borne (poste_atelier) ne détient jamais gerer_pin — un écran mural ne gère pas les PIN de ses collègues', () => {
    expect(rolesAyant('atelier.pointage.gerer_pin')).not.toContain('poste_atelier');
  });
});

describe('PinController — validation d’entrée (schémas réels, pas de mock)', () => {
  it('schemaIdentificationPin rejette un code à 3 chiffres', () => {
    expect(schemaIdentificationPin.safeParse({ codePin: '407' }).success).toBe(false);
  });

  it('schemaIdentificationPin rejette un code non numérique', () => {
    expect(schemaIdentificationPin.safeParse({ codePin: 'abcd' }).success).toBe(false);
  });

  it('schemaIdentificationPin accepte un code à 4 chiffres', () => {
    expect(schemaIdentificationPin.safeParse({ codePin: '4071' }).success).toBe(true);
  });

  it('schemaAttributionPin rejette un siteId mal formé (pas un uuid)', () => {
    const resultat = schemaAttributionPin.safeParse({
      siteId: 'pas-un-uuid',
      utilisateurId: '6c9e2d4b-7a10-4e2e-8f0a-1c9e2e2f0a4b',
      codePin: '4071',
    });
    expect(resultat.success).toBe(false);
  });

  it('schemaAttributionPin rejette un corps sans utilisateurId', () => {
    const resultat = schemaAttributionPin.safeParse({
      siteId: '5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10',
      codePin: '4071',
    });
    expect(resultat.success).toBe(false);
  });

  it('schemaRevocationPin rejette un corps vide', () => {
    expect(schemaRevocationPin.safeParse({}).success).toBe(false);
  });

  it('schemaRevocationPin accepte un corps complet (pas de codePin — révocation, pas attribution)', () => {
    const resultat = schemaRevocationPin.safeParse({
      siteId: '5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10',
      utilisateurId: '6c9e2d4b-7a10-4e2e-8f0a-1c9e2e2f0a4b',
    });
    expect(resultat.success).toBe(true);
  });
});

describe('PinController — isolation tenant (jamais un paramètre de requête)', () => {
  it('siteId est un champ métier LÉGITIME de ces deux schémas (le gestionnaire administre plusieurs sites), tenantId n’en est JAMAIS un', () => {
    expect(Object.keys(schemaAttributionPin.shape)).toContain('siteId');
    expect(Object.keys(schemaAttributionPin.shape)).not.toContain('tenantId');
    expect(Object.keys(schemaRevocationPin.shape)).toContain('siteId');
    expect(Object.keys(schemaRevocationPin.shape)).not.toContain('tenantId');
  });

  it('schemaIdentificationPin ne porte aucun champ site/tenant — le site vient de la session de la borne, jamais de la requête', () => {
    const cles = Object.keys(schemaIdentificationPin.shape);
    expect(cles).not.toContain('tenantId');
    expect(cles).not.toContain('siteId');
    expect(cles).toEqual(['codePin']);
  });
});
