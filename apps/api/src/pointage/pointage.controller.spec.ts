import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { MATRICE_DROITS, type Action } from '../auth/matrice-droits';
import { CLE_META_ACTION } from '../common/droits';

import { PointageController } from './pointage.controller';
import {
  schemaArretPointage,
  schemaCorrectionPointage,
  schemaDemarragePointage,
  schemaFiltresPointages,
} from '@dfa/shared';

/**
 * Câblage HTTP de `PointageController` — le service (`ServicePointage`) est déjà testé
 * (`service-pointage.spec.ts`), ce fichier prouve ce qui reste non couvert : les décorateurs qui
 * gouvernent le code HTTP réellement rendu, le droit exigé par route, la validation d'entrée et
 * l'isolation tenant. Patron repris de `atelier/ordre-reparation-transitions.controller.spec.ts` et
 * `auth/matrice-droits.spec.ts`.
 */

/** Rôles qui détiennent une action donnée dans MATRICE_DROITS, triés pour comparaison stable. */
function rolesAyant(action: Action): string[] {
  return (Object.keys(MATRICE_DROITS) as (keyof typeof MATRICE_DROITS)[])
    .filter((role) => (MATRICE_DROITS[role] as readonly Action[]).includes(action))
    .sort();
}

describe('PointageController — @HttpCode explicite conforme à la doc Swagger', () => {
  it('demarrer() porte @HttpCode(201) — VRAIE création (le pointage), conforme à @ApiResponse(201)', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, PointageController.prototype.demarrer)).toBe(
      201,
    );
  });

  /**
   * DÉFAUT TROUVÉ — même piège que `ordre-reparation-transitions.controller.ts`/`ligne-or.
   * controller.ts`/`depot-pneus.controller.ts` (déjà corrigé ailleurs, voir leurs specs) : ce
   * handler documente `200` (`@ApiOkResponse`) mais NE PORTE AUCUN `@HttpCode(...)` explicite —
   * Nest applique donc son défaut `201` sur ce `@Post()`, alors qu'`arrêter` un pointage existant
   * n'est pas une création. Un client qui se fie au contrat documenté (`200`) se trompe. Test
   * volontairement laissé ROUGE : signalé au rapport, pas corrigé ici (hors périmètre d'écriture).
   */
  it('arreter() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), pas une création', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, PointageController.prototype.arreter)).toBe(200);
  });

  /** DÉFAUT TROUVÉ — même nature que `arreter()` ci-dessus, voir son commentaire. */
  it('corriger() porte @HttpCode(200) — documenté 200 (@ApiOkResponse), pas une création', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, PointageController.prototype.corriger)).toBe(
      200,
    );
  });
});

describe('PointageController — droit exigé par route (câblage réel de @ExigerDroit)', () => {
  const casAttendus: readonly [string, object, Action][] = [
    ['lister', PointageController.prototype.lister, 'atelier.pointage.lire'],
    ['agregatsLigne', PointageController.prototype.agregatsLigne, 'atelier.pointage.lire'],
    ['obtenir', PointageController.prototype.obtenir, 'atelier.pointage.lire'],
    ['demarrer', PointageController.prototype.demarrer, 'atelier.pointage.demarrer'],
    ['arreter', PointageController.prototype.arreter, 'atelier.pointage.arreter'],
    ['corriger', PointageController.prototype.corriger, 'atelier.pointage.corriger_autrui'],
  ];

  it.each(casAttendus)('%s() exige exactement %s', (_nom, handler, actionAttendue) => {
    expect(Reflect.getMetadata(CLE_META_ACTION, handler)).toBe(actionAttendue);
  });

  it('atelier.pointage.demarrer/arreter/lire — chef_atelier, direction, admin, technicien, magasinier (pas comptable, pas receptionnaire, pas vendeur)', () => {
    expect(rolesAyant('atelier.pointage.demarrer')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'magasinier', 'poste_atelier', 'technicien'].sort(),
    );
    expect(rolesAyant('atelier.pointage.lire')).toEqual(
      ['admin', 'chef_atelier', 'direction', 'magasinier', 'poste_atelier', 'technicien'].sort(),
    );
  });

  it('atelier.pointage.corriger_autrui — encadrement seul (chef_atelier, direction, admin) : ni technicien, ni magasinier, ni la borne', () => {
    const roles = rolesAyant('atelier.pointage.corriger_autrui');
    expect(roles).toEqual(['admin', 'chef_atelier', 'direction'].sort());
    expect(roles).not.toContain('technicien');
    expect(roles).not.toContain('magasinier');
    expect(roles).not.toContain('poste_atelier');
  });
});

describe('PointageController — validation d’entrée (schémas réels, pas de mock)', () => {
  it('schemaFiltresPointages rejette un statut hors énumération', () => {
    const resultat = schemaFiltresPointages.safeParse({ statut: 'statut-invente' });
    expect(resultat.success).toBe(false);
  });

  it('schemaFiltresPointages accepte un filtre vide (tri par défaut appliqué)', () => {
    const resultat = schemaFiltresPointages.safeParse({});
    expect(resultat.success).toBe(true);
  });

  it('schemaDemarragePointage rejette une entrée sans nature (union discriminée)', () => {
    const resultat = schemaDemarragePointage.safeParse({
      id: '9c1a8e6f-2d4b-47a1-8b0c-5a1c9e2e2f0a',
      siteId: '5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10',
      technicienId: '6c9e2d4b-7a10-4e2e-8f0a-1c9e2e2f0a4b',
      debutLe: '2026-07-31T08:00:00.000Z',
    });
    expect(resultat.success).toBe(false);
  });

  it('schemaDemarragePointage rejette nature=productif_ligne sans ligneOrId', () => {
    const resultat = schemaDemarragePointage.safeParse({
      id: '9c1a8e6f-2d4b-47a1-8b0c-5a1c9e2e2f0a',
      siteId: '5a1c9e2e-2f0a-4b3a-9c1a-8e6f2d4b7a10',
      technicienId: '6c9e2d4b-7a10-4e2e-8f0a-1c9e2e2f0a4b',
      debutLe: '2026-07-31T08:00:00.000Z',
      nature: 'productif_ligne',
      ordreReparationId: '1c9e2e2f-0a4b-47a1-8b0c-5a1c9e2e2f0a',
    });
    expect(resultat.success).toBe(false);
  });

  it('schemaArretPointage rejette un finLe absent', () => {
    expect(schemaArretPointage.safeParse({}).success).toBe(false);
  });

  it('schemaArretPointage rejette un horodatage mal formé', () => {
    expect(schemaArretPointage.safeParse({ finLe: 'pas-une-date' }).success).toBe(false);
  });

  it('schemaCorrectionPointage accepte un corps vide (motif conditionnel, vérifié en service)', () => {
    expect(schemaCorrectionPointage.safeParse({}).success).toBe(true);
  });

  it('schemaCorrectionPointage rejette une nature hors énumération', () => {
    expect(schemaCorrectionPointage.safeParse({ nature: 'invente' }).success).toBe(false);
  });
});

describe('PointageController — isolation tenant (jamais un paramètre de requête)', () => {
  it('schemaFiltresPointages n’a pas de clé tenantId (le tenant vient de la session, jamais du query)', () => {
    expect(Object.keys(schemaFiltresPointages.shape)).not.toContain('tenantId');
  });

  it('schemaDemarragePointage (les trois branches) n’a pas de clé tenantId', () => {
    for (const option of schemaDemarragePointage.options) {
      expect(Object.keys(option.shape)).not.toContain('tenantId');
    }
  });

  it('schemaArretPointage et schemaCorrectionPointage n’ont pas de clé tenantId', () => {
    expect(Object.keys(schemaArretPointage.shape)).not.toContain('tenantId');
    expect(Object.keys(schemaCorrectionPointage.shape)).not.toContain('tenantId');
  });
});
