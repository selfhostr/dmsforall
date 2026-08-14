import { describe, expect, it } from 'vitest';
import { ROLES_UTILISATEUR, type RoleUtilisateur } from '@dfa/shared';

import { ErreurMetier } from '../common/erreurs';
import { ROLE_RESERVE_A_LUI_MEME, verifierAttributionRoleAutorisee } from './gouvernance-roles';

const ROLES_NON_ADMIN: RoleUtilisateur[] = ROLES_UTILISATEUR.filter((r) => r !== 'admin');

describe('verifierAttributionRoleAutorisee — issue #137, seule règle hiérarchique', () => {
  it("un acteur admin peut attribuer 'admin' (bootstrap du premier compte direction d'un nouveau garage — c'est le geste même que ce chantier remplace, seed direct en base)", () => {
    expect(() => verifierAttributionRoleAutorisee('admin', 'admin')).not.toThrow();
  });

  it.each(ROLES_NON_ADMIN)(
    "un acteur %s (non-admin) NE PEUT PAS attribuer 'admin' — 403 DROIT_INSUFFISANT, jamais un 200 silencieux",
    (acteurRole) => {
      expect(() => verifierAttributionRoleAutorisee(acteurRole, 'admin')).toThrow(ErreurMetier);
      try {
        verifierAttributionRoleAutorisee(acteurRole, 'admin');
        expect.unreachable('devait lever');
      } catch (erreur) {
        expect(erreur).toBeInstanceOf(ErreurMetier);
        expect((erreur as ErreurMetier).code).toBe('DROIT_INSUFFISANT');
        expect((erreur as ErreurMetier).status).toBe(403);
        // Nomme le champ fautif (piège CONTRIBUTING.md : un refus doit nommer ce qui bloque).
        expect((erreur as ErreurMetier).erreurs?.[0]?.champ).toBe('role');
      }
    },
  );

  it('direction (le patron) peut attribuer TOUT rôle métier non-admin — chef_atelier, technicien, vendeur, receptionnaire, magasinier, comptable — sans exception', () => {
    const roleCiblesMetier = ROLES_UTILISATEUR.filter(
      (r) => r !== 'admin' && r !== 'poste_atelier',
    );
    for (const cible of roleCiblesMetier) {
      expect(() => verifierAttributionRoleAutorisee('direction', cible)).not.toThrow();
    }
  });

  it('un acteur de rôle métier quelconque (technicien, vendeur…) peut attribuer un rôle métier non-admin à un tiers — cette fonction ne gouverne QUE la réserve admin, pas qui a par ailleurs le droit socle.utilisateur.creer (matrice-droits.ts, vérifié séparément par le guard)', () => {
    expect(() => verifierAttributionRoleAutorisee('technicien', 'vendeur')).not.toThrow();
  });

  it('ROLE_RESERVE_A_LUI_MEME vaut exactement "admin", constante publique plutôt que littéral recopié ailleurs', () => {
    expect(ROLE_RESERVE_A_LUI_MEME).toBe('admin');
  });
});
