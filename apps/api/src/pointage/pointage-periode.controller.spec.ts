import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import {
  schemaDeverrouillagePeriodePointage,
  schemaVerrouillagePeriodePointage,
} from '@dfa/shared';

import { MATRICE_DROITS, type Action } from '../auth/matrice-droits';
import { CLE_META_ACTION } from '../common/droits';

import { PointagePeriodeController } from './pointage-periode.controller';

/** Rôles qui détiennent une action donnée dans MATRICE_DROITS, triés pour comparaison stable. */
function rolesAyant(action: Action): string[] {
  return (Object.keys(MATRICE_DROITS) as (keyof typeof MATRICE_DROITS)[])
    .filter((role) => (MATRICE_DROITS[role] as readonly Action[]).includes(action))
    .sort();
}

describe('PointagePeriodeController — @HttpCode explicite conforme à la doc Swagger', () => {
  /**
   * DÉFAUT TROUVÉ — même piège que `PointageController.arreter()`/`.corriger()` (voir leur
   * spec) : ces deux handlers documentent `200` (`@ApiOkResponse`) sans porter AUCUN
   * `@HttpCode(...)` explicite — Nest applique donc son défaut `201` sur ces `@Post()`, alors que
   * verrouiller/déverrouiller une période transitionne des pointages EXISTANTS, ce n'est pas une
   * création. Tests volontairement laissés ROUGES : signalés au rapport, pas corrigés ici (hors
   * périmètre d'écriture).
   */
  it('verrouiller() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), pas une création', () => {
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, PointagePeriodeController.prototype.verrouiller),
    ).toBe(200);
  });

  it('deverrouiller() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), pas une création', () => {
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, PointagePeriodeController.prototype.deverrouiller),
    ).toBe(200);
  });
});

describe('PointagePeriodeController — droit exigé par route (câblage réel de @ExigerDroit)', () => {
  it('verrouiller() exige atelier.pointage.verrouiller_periode', () => {
    expect(
      Reflect.getMetadata(CLE_META_ACTION, PointagePeriodeController.prototype.verrouiller),
    ).toBe('atelier.pointage.verrouiller_periode');
  });

  it('deverrouiller() exige atelier.pointage.deverrouiller_periode', () => {
    expect(
      Reflect.getMetadata(CLE_META_ACTION, PointagePeriodeController.prototype.deverrouiller),
    ).toBe('atelier.pointage.deverrouiller_periode');
  });

  it('les deux actions sont réservées à chef_atelier/direction/admin — jamais comptable (arbitrage @laupernoe du 2026-08-03, comptable reste lecture-seule hors facturation/ventes)', () => {
    const attendu = ['admin', 'chef_atelier', 'direction'].sort();
    expect(rolesAyant('atelier.pointage.verrouiller_periode')).toEqual(attendu);
    expect(rolesAyant('atelier.pointage.deverrouiller_periode')).toEqual(attendu);

    expect(rolesAyant('atelier.pointage.verrouiller_periode')).not.toContain('comptable');
    expect(rolesAyant('atelier.pointage.deverrouiller_periode')).not.toContain('comptable');
  });

  it('ni technicien, ni magasinier, ni receptionnaire, ni la borne (poste_atelier) ne peuvent verrouiller/déverrouiller une période', () => {
    const rolesExclus = ['technicien', 'magasinier', 'receptionnaire', 'poste_atelier', 'vendeur'];
    for (const role of rolesExclus) {
      expect(rolesAyant('atelier.pointage.verrouiller_periode')).not.toContain(role);
      expect(rolesAyant('atelier.pointage.deverrouiller_periode')).not.toContain(role);
    }
  });
});

describe('PointagePeriodeController — validation d’entrée (schémas réels, pas de mock)', () => {
  it('schemaVerrouillagePeriodePointage rejette un siteId absent', () => {
    expect(schemaVerrouillagePeriodePointage.safeParse({ jusquauLe: '2026-07-31' }).success).toBe(
      false,
    );
  });

  it('schemaVerrouillagePeriodePointage accepte sans motif (motif optionnel au verrouillage)', () => {
    const resultat = schemaVerrouillagePeriodePointage.safeParse({
      siteId: '5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10',
      jusquauLe: '2026-07-31',
    });
    expect(resultat.success).toBe(true);
  });

  it('schemaDeverrouillagePeriodePointage rejette un motif absent — RM-95, contre-passation jamais silencieuse', () => {
    const resultat = schemaDeverrouillagePeriodePointage.safeParse({
      siteId: '5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10',
      jusquauLe: '2026-07-15',
    });
    expect(resultat.success).toBe(false);
  });

  it('schemaDeverrouillagePeriodePointage accepte un corps complet avec motif', () => {
    const resultat = schemaDeverrouillagePeriodePointage.safeParse({
      siteId: '5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10',
      jusquauLe: '2026-07-15',
      motif: 'Période exportée par erreur, à recalculer.',
    });
    expect(resultat.success).toBe(true);
  });
});

describe('PointagePeriodeController — isolation tenant (jamais un paramètre de requête)', () => {
  it('ni schemaVerrouillagePeriodePointage ni schemaDeverrouillagePeriodePointage n’ont de clé tenantId (siteId oui, tenantId jamais)', () => {
    expect(Object.keys(schemaVerrouillagePeriodePointage.shape)).toContain('siteId');
    expect(Object.keys(schemaVerrouillagePeriodePointage.shape)).not.toContain('tenantId');
    expect(Object.keys(schemaDeverrouillagePeriodePointage.shape)).toContain('siteId');
    expect(Object.keys(schemaDeverrouillagePeriodePointage.shape)).not.toContain('tenantId');
  });
});
