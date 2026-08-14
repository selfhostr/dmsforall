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
    // Issue #136 : réutilise DÉLIBÉRÉMENT `relances.facturation.regle.lire` — voir la doc
    // d'en-tête de `relances.controller.ts` pour l'arbitrage (pas d'accès de cette tâche à
    // `auth/matrice-droits.ts` pour poser une action dédiée, et le même périmètre de rôles est de
    // toute façon celui qui convient : l'historique d'envoi expose la même politique commerciale
    // que la configuration des relances).
    [
      'listerHistorique',
      RelancesController.prototype.listerHistorique,
      'relances.facturation.regle.lire',
    ],
  ];

  it.each(casAttendus)('%s() exige exactement %s', (_nom, handler, actionAttendue) => {
    expect(Reflect.getMetadata(CLE_META_ACTION, handler)).toBe(actionAttendue);
  });

  /**
   * RF-115, littéral et non négociable (`auth/matrice-droits.ts`, tête de section relances) :
   * « admin est un rôle technique et n'a aucun droit financier ». Configurer ou déclencher un
   * rappel de facture — ou consulter qui a été relancé et quand — EST un geste financier : un seul
   * jeu de rôles (`direction`, `comptable`) gouverne les CINQ routes de ce contrôleur, y compris
   * LIRE (même lire la politique de recouvrement expose une décision commerciale, voir l'en-tête
   * de `relances.controller.ts`). Un test qui attendrait `admin` permissif ici encoderait
   * exactement le bug que RF-115 interdit.
   */
  it('les actions relances sont réservées à direction + comptable SEULS — admin exclu (RF-115)', () => {
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
  it('schemaUpsertRegleRelance ignore un tenantId envoyé dans le corps — le tenant vient TOUJOURS de la session, jamais du corps de la requête', () => {
    // z.object() sans .strict() élague silencieusement les clés inconnues à l'analyse : un
    // appelant qui tenterait de faire voyager `tenantId` dans le corps verrait ce champ disparaître
    // avant même d'atteindre `this.contexte.contexteTenant()` (`relances.controller.ts::upserter`).
    const resultat = schemaUpsertRegleRelance.safeParse({
      actif: false,
      delaisJours: [],
      canaux: [],
      tenantId: 'un-tenant-different-arbitraire',
    });
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect(resultat.data).not.toHaveProperty('tenantId');
    }
  });
});
