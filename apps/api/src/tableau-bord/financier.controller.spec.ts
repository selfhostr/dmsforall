import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import type { RoleUtilisateur } from '@dfa/shared';

import { CLE_META_ACTION, GardeDroit } from '../common/droits';
import type { PrincipalAuthentifie, ServiceContexteRequete } from '../common/contexte';
import { ErreurMetier } from '../common/erreurs';
import { MATRICE_DROITS } from '../auth/matrice-droits';

import { TableauBordFinancierController } from './financier.controller';

/**
 * Preuve RÉSEAU (pas seulement un masquage client) que `marges`/`stockPieces`/`chiffreAffaires`
 * n'atteignent JAMAIS la réponse d'un rôle sans `tableau_bord.financier.lire` (RF-115) : le guard
 * refuse `403 DROIT_INSUFFISANT` en `canActivate()`, AVANT que `TableauBordFinancierController
 * .financier()` — donc `ServiceTableauBordFinancier.obtenir()`, donc la moindre requête
 * d'agrégation — ne s'exécute. `auth/matrice-droits.spec.ts` prouve déjà que
 * `tableau_bord.financier.lire` est exactement `['comptable', 'direction']` (RF-115, `admin`
 * explicitement exclu) ; ce fichier prouve, à la frontière de CE contrôleur précis, que le guard
 * est bien câblé sur la bonne action et bloque réellement AVANT le handler — pas de dérive
 * possible entre l'action déclarée ici et celle testée là-bas (protection contre une faute de
 * frappe dans la chaîne de caractères de `@ExigerDroit(...)`).
 */
describe('TableauBordFinancierController — un rôle sans le droit financier ne reçoit RIEN dans la réponse réseau (RF-115)', () => {
  it("financier() porte @ExigerDroit('tableau_bord.financier.lire') — pas une autre action, pas @Public, pas @AucunDroitRequis", () => {
    const action = Reflect.getMetadata(
      CLE_META_ACTION,
      TableauBordFinancierController.prototype.financier,
    );
    expect(action).toBe('tableau_bord.financier.lire');
  });

  it('financier() rend 200 (aucun @HttpCode custom nécessaire sur un GET) — sanity check de la décoration Nest par défaut', () => {
    // GET sans @HttpCode explicite : 200 par défaut chez Nest (contrairement à @Post(), qui
    // documenterait 200 mais rendrait 201 par défaut sans @HttpCode(200) — piège réel déjà
    // rencontré ailleurs dans ce dépôt, voir fournisseur.controller.spec.ts). Rien à décorer ici :
    // ce test verrouille l'ABSENCE de métadonnée custom qui romprait ce défaut.
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, TableauBordFinancierController.prototype.financier),
    ).toBeUndefined();
  });

  for (const role of Object.keys(MATRICE_DROITS) as RoleUtilisateur[]) {
    const autorise = (MATRICE_DROITS[role] as readonly string[]).includes(
      'tableau_bord.financier.lire',
    );

    it(`rôle "${role}" — ${autorise ? 'AUTORISÉ (direction/comptable)' : 'REFUSÉ avant le handler, aucune donnée financière ne part sur le réseau'}`, () => {
      const principal: PrincipalAuthentifie = {
        sessionId: 'session-id',
        tenantId: 'tenant-id',
        utilisateurId: 'utilisateur-id',
        role,
        langue: 'fr',
      };
      const contexte = {
        exigerPrincipal: vi.fn(() => principal),
      } as unknown as ServiceContexteRequete;
      const reflector = {
        getAllAndOverride: vi.fn((cle: string) =>
          cle === CLE_META_ACTION ? 'tableau_bord.financier.lire' : undefined,
        ),
      } as unknown as Reflector;
      const executionContext = {
        getHandler: () => TableauBordFinancierController.prototype.financier,
        getClass: () => TableauBordFinancierController,
      } as unknown as ExecutionContext;
      const guard = new GardeDroit(reflector, contexte);

      if (autorise) {
        expect(guard.canActivate(executionContext)).toBe(true);
      } else {
        // Le point du test : le guard lève AVANT tout appel au service. Aucune donnée
        // financière (`marges`, `stockPieces`, `chiffreAffaires`, `encoursClientsCentimes`...)
        // n'est donc jamais construite ni sérialisée pour ce rôle — pas un masquage après coup.
        expect(() => guard.canActivate(executionContext)).toThrow(ErreurMetier);
        try {
          guard.canActivate(executionContext);
          expect.fail('devait lever ErreurMetier');
        } catch (erreur) {
          expect(erreur).toBeInstanceOf(ErreurMetier);
          expect((erreur as ErreurMetier).code).toBe('DROIT_INSUFFISANT');
          expect((erreur as ErreurMetier).status).toBe(403);
        }
      }
    });
  }

  it('RF-115 littéral — "admin" est explicitement REFUSÉ (pas un oubli de recopie de "direction")', () => {
    expect(MATRICE_DROITS.admin).not.toContain('tableau_bord.financier.lire');
  });
});
