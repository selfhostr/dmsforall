/**
 * `STATUT_PAR_CODE_ERREUR` (`common/erreurs/erreur-metier.ts`) est un simple ré-export de
 * `STATUT_HTTP_PAR_CODE_ERREUR` (`@dfa/shared`, gelé) — typé `Record<CodeErreur, number>`, ce qui
 * rend déjà l'exhaustivité IMPOSSIBLE À ROMPRE À LA COMPILATION (ajouter un `CodeErreur` sans lui
 * donner de statut fait échouer `pnpm typecheck` dans `packages/shared`, pas ici).
 *
 * Ce test est le filet D'EXÉCUTION demandé par le plan lot 1 (L1-06, « STATUT_PAR_CODE_ERREUR
 * exhaustif, test typé sur CodeErreur ») : il reconfirme la propriété au runtime, contre le
 * contrat public tel qu'un consommateur (front, connecteur) le voit — sans dépendre d'un import
 * de `common/erreurs/` (hors périmètre de cet agent, livré et stable par ailleurs).
 */

import { CODES_ERREUR, STATUT_HTTP_PAR_CODE_ERREUR, type CodeErreur } from '@dfa/shared';
import { describe, expect, it } from 'vitest';

describe('STATUT_HTTP_PAR_CODE_ERREUR — exhaustivité sur les 53 codes du contrat (13 socle + 40 étape 1)', () => {
  it('associe un statut à CHAQUE code de CODES_ERREUR, et aucun de plus', () => {
    const codesAttendus = [...CODES_ERREUR].sort();
    const codesMappes = (Object.keys(STATUT_HTTP_PAR_CODE_ERREUR) as CodeErreur[]).sort();
    expect(codesMappes).toEqual(codesAttendus);
  });

  it("chaque statut est un code HTTP d'erreur plausible (400-599), jamais un 2xx", () => {
    for (const code of CODES_ERREUR) {
      const statut = STATUT_HTTP_PAR_CODE_ERREUR[code];
      expect(statut, `statut de ${code}`).toBeGreaterThanOrEqual(400);
      expect(statut, `statut de ${code}`).toBeLessThan(600);
    }
  });

  it('CODES_ERREUR ne contient aucun doublon (un statut par code, sans ambiguïté)', () => {
    expect(new Set(CODES_ERREUR).size).toBe(CODES_ERREUR.length);
  });
});
