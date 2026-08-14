import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { schemaUpsertRegleRelance } from '@dfa/shared';

import { MATRICE_DROITS, type Action } from '../auth/matrice-droits';
import { CLE_META_ACTION } from '../common/droits';

import { RelancesController } from './relances.controller';
import { schemaTypeRelance } from './schemas';

/** Rôles qui détiennent une action donnée dans MATRICE_DROITS, triés pour comparaison stable. */
function rolesAyant(action: Action): string[] {
  return (Object.keys(MATRICE_DROITS) as (keyof typeof MATRICE_DROITS)[])
    .filter((role) => (MATRICE_DROITS[role] as readonly Action[]).includes(action))
    .sort();
}

describe('RelancesController — @HttpCode explicite conforme à la doc Swagger (garde-fou de non-régression)', () => {
  it('upserter() (PUT) porte @HttpCode(200) — déjà correct', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, RelancesController.prototype.upserter)).toBe(
      200,
    );
  });

  it('planifier() porte @HttpCode(200) — déjà correct, ce n’est pas une création de document', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, RelancesController.prototype.planifier)).toBe(
      200,
    );
  });

  it('envoyer() porte @HttpCode(200) — déjà correct', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, RelancesController.prototype.envoyer)).toBe(200);
  });
});

describe('RelancesController — droit exigé par route, et RF-115 (admin sans droit financier)', () => {
  const casAttendus: readonly [string, object, Action][] = [
    ['lister', RelancesController.prototype.lister, 'relances.facturation.regle.lire'],
    ['upserter', RelancesController.prototype.upserter, 'relances.facturation.regle.ecrire'],
    ['planifier', RelancesController.prototype.planifier, 'relances.facturation.planifier'],
    ['envoyer', RelancesController.prototype.envoyer, 'relances.facturation.envoyer'],
  ];

  it.each(casAttendus)('%s() exige exactement %s', (_nom, handler, actionAttendue) => {
    expect(Reflect.getMetadata(CLE_META_ACTION, handler)).toBe(actionAttendue);
  });

  /**
   * RF-115, littéral et non négociable (`auth/matrice-droits.ts`, tête de section relances) :
   * « admin est un rôle technique et n'a aucun droit financier ». Configurer ou déclencher un
   * rappel de facture EST un geste financier — un seul jeu de rôles (`direction`, `comptable`)
   * gouverne les QUATRE routes de ce contrôleur, y compris LIRE (même lire la politique de
   * recouvrement expose une décision commerciale, voir l'en-tête de `relances.controller.ts`).
   * Un test qui attendrait `admin` permissif ici encoderait exactement le bug que RF-115 interdit.
   */
  it('les quatre actions relances sont réservées à direction + comptable SEULS — admin exclu (RF-115)', () => {
    const attendu = ['comptable', 'direction'].sort();
    for (const [, , action] of casAttendus) {
      const roles = rolesAyant(action);
      expect(roles, `rôles pour ${action}`).toEqual(attendu);
      expect(roles, `admin ne doit JAMAIS détenir ${action} (RF-115)`).not.toContain('admin');
    }
  });

  it('aucun rôle opérationnel (receptionnaire, chef_atelier, technicien, magasinier, vendeur, poste_atelier) ne détient une action relances', () => {
    const rolesExclus = [
      'receptionnaire',
      'chef_atelier',
      'technicien',
      'magasinier',
      'vendeur',
      'poste_atelier',
    ];
    for (const [, , action] of casAttendus) {
      for (const role of rolesExclus) {
        expect(rolesAyant(action)).not.toContain(role);
      }
    }
  });
});

describe('RelancesController — validation d’entrée (schémas réels, pas de mock)', () => {
  it('schemaTypeRelance rejette un type inconnu — doit rendre 400, jamais atteindre le service', () => {
    expect(schemaTypeRelance.safeParse('type-invente').success).toBe(false);
  });

  it('schemaUpsertRegleRelance rejette actif=true sans canal (au moins un canal requis pour activer)', () => {
    const resultat = schemaUpsertRegleRelance.safeParse({
      actif: true,
      delaisJours: [7],
      canaux: [],
    });
    expect(resultat.success).toBe(false);
  });

  it('schemaUpsertRegleRelance rejette actif=true sans palier (au moins un délai requis pour activer)', () => {
    const resultat = schemaUpsertRegleRelance.safeParse({
      actif: true,
      delaisJours: [],
      canaux: ['email'],
    });
    expect(resultat.success).toBe(false);
  });

  it('schemaUpsertRegleRelance rejette un canal en double', () => {
    const resultat = schemaUpsertRegleRelance.safeParse({
      actif: true,
      delaisJours: [7],
      canaux: ['email', 'email'],
    });
    expect(resultat.success).toBe(false);
  });

  it('schemaUpsertRegleRelance accepte une règle désactivée sans canal ni palier (état de configuration initial)', () => {
    const resultat = schemaUpsertRegleRelance.safeParse({
      actif: false,
      delaisJours: [],
      canaux: [],
    });
    expect(resultat.success).toBe(true);
  });

  it('schemaUpsertRegleRelance rejette un délai négatif', () => {
    const resultat = schemaUpsertRegleRelance.safeParse({
      actif: true,
      delaisJours: [-1],
      canaux: ['email'],
    });
    expect(resultat.success).toBe(false);
  });
});

describe('RelancesController — isolation tenant (jamais un paramètre de requête)', () => {
  it('schemaUpsertRegleRelance rejette un tenantId envoyé dans le corps (`.strict()` refuse les clés inconnues) — le tenant vient TOUJOURS de la session, jamais du corps', () => {
    // `.strict()` refuse désormais les clés inconnues dès le parse — un appelant qui tenterait
    // de faire voyager `tenantId` dans le corps reçoit une erreur `unrecognized_keys` avant même
    // d'atteindre `this.contexte.contexteTenant()` (`relances.controller.ts::upserter`).
    // Avant : z.object() sans .strict() élaguait silencieusement `tenantId`, le refus était par
    // omission. Après : refus explicite. Les deux GARANTISSENT que `tenantId` du corps ne peut pas
    // contourner le tenant de la session (RM-01 / isolement tenant).
    const resultat = schemaUpsertRegleRelance.safeParse({
      actif: false,
      delaisJours: [],
      canaux: [],
      tenantId: 'un-tenant-different-arbitraire',
    });
    expect(resultat.success).toBe(false);
    if (!resultat.success) {
      expect(resultat.error.issues[0]?.code).toBe('unrecognized_keys');
    }
  });

  it('schemaUpsertRegleRelance accepte une règle valide sans tenantId — le comportement normal reste inchangé', () => {
    const resultat = schemaUpsertRegleRelance.safeParse({
      actif: false,
      delaisJours: [],
      canaux: [],
    });
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect(resultat.data).not.toHaveProperty('tenantId');
    }
  });
});
