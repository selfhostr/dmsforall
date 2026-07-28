import { describe, expect, it } from 'vitest';
import { ROLES_UTILISATEUR } from '@dfa/shared';

import { MATRICE_DROITS } from './matrice-droits';

/**
 * Bloquant B3 (rapport QA étape 0) : `Record<RoleUtilisateur, …>` couvre la compilation (un rôle
 * manquant dans `MATRICE_DROITS` fait échouer `pnpm typecheck`), mais rien n'empêche quelqu'un de
 * réélargir le type à `Record<string, …>` pour « débloquer » un typecheck rouge sans réfléchir —
 * exactement ce que faisait le code avant correction. Ce test couvre CE cas-là : une parité
 * vérifiée à l'EXÉCUTION entre `ROLES_UTILISATEUR` (contrat partagé) et les clés réelles de
 * `MATRICE_DROITS`, dans les deux sens (aucun rôle oublié, aucune clé fantôme).
 */
describe('MATRICE_DROITS — parité avec ROLES_UTILISATEUR (bloquant B3)', () => {
  it('contient EXACTEMENT les mêmes rôles que ROLES_UTILISATEUR, ni plus ni moins', () => {
    const rolesMatrice = Object.keys(MATRICE_DROITS).sort();
    const rolesContrat = [...ROLES_UTILISATEUR].sort();

    expect(rolesMatrice).toEqual(rolesContrat);
  });

  it('chaque rôle de ROLES_UTILISATEUR a une entrée définie (jamais undefined) dans MATRICE_DROITS', () => {
    for (const role of ROLES_UTILISATEUR) {
      expect(MATRICE_DROITS[role]).toBeDefined();
      expect(Array.isArray(MATRICE_DROITS[role])).toBe(true);
    }
  });
});
