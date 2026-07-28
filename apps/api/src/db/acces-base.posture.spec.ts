/**
 * Verdict de `verifierPostureRls()` sur l'inventaire du catalogue (bloquant QA B4).
 *
 * Ces cas couvrent la partie TypeScript de la décision. La partie SQL — « qu'est-ce qu'une
 * politique isolante » — est vérifiée sur vraie base par les tests d'intégration : ici on
 * s'assure qu'une fois le catalogue lu, aucune configuration dangereuse n'est acceptée et que
 * le diagnostic rendu est exploitable sans ouvrir le code.
 */

import { describe, expect, it } from 'vitest';

import { analyserPostureTables } from './acces-base.service';
import type { PostureTable } from './acces-base.service';

const ROLE = 'dfa_app';

/** Table conforme au socle : FORCE RLS + une politique isolante, rien d'autre. */
function tableConforme(overrides: Partial<PostureTable> = {}): PostureTable {
  return {
    table_name: 'ordre_reparation',
    rls_active: true,
    rls_force: true,
    porte_tenant_id: true,
    politiques_isolantes: 1,
    politiques_non_isolantes: [],
    inventaire_politiques: [
      'or_isolation_tenant [ALL] USING isolant, WITH CHECK isolant',
    ],
    ...overrides,
  };
}

describe('analyserPostureTables', () => {
  it('accepte le motif du socle : FORCE RLS et une politique isolante', () => {
    expect(analyserPostureTables([tableConforme()], ROLE)).toEqual([]);
  });

  it('refuse une base sans aucune table (migrations non appliquées)', () => {
    expect(analyserPostureTables([], ROLE)).toHaveLength(1);
  });

  // --- Le bloquant B4 lui-même -----------------------------------------------------------------

  it('refuse « using (true) with check (true) » recopié sur une table métier', () => {
    const problemes = analyserPostureTables(
      [
        tableConforme({
          politiques_isolantes: 0,
          politiques_non_isolantes: [
            'or_isolation_tenant [ALL] USING NON ISOLANT (true), WITH CHECK NON ISOLANT (true)',
          ],
          inventaire_politiques: [
            'or_isolation_tenant [ALL] USING NON ISOLANT (true), WITH CHECK NON ISOLANT (true)',
          ],
        }),
      ],
      ROLE,
    );

    expect(problemes).toHaveLength(2);
    expect(problemes.join('\n')).toContain('NON ISOLANTE');
  });

  it('refuse une politique laxiste posée À CÔTÉ d\'une politique isolante', () => {
    // Cas que le comptage seul laissait passer : les politiques permissives sont OR-ées, donc
    // la politique de debug rouvre la table malgré la politique légitime.
    const problemes = analyserPostureTables(
      [
        tableConforme({
          politiques_isolantes: 1,
          politiques_non_isolantes: [
            'or_debug [ALL] USING NON ISOLANT (true), WITH CHECK NON ISOLANT (true)',
          ],
        }),
      ],
      ROLE,
    );

    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain('or_debug');
  });

  it('refuse une politique qui filtre sur autre chose que tenant_courant()', () => {
    const problemes = analyserPostureTables(
      [
        tableConforme({
          politiques_isolantes: 0,
          politiques_non_isolantes: [
            'or_isolation [ALL] USING NON ISOLANT ((statut = \'ouvert\')), WITH CHECK isolant',
          ],
          inventaire_politiques: [
            'or_isolation [ALL] USING NON ISOLANT ((statut = \'ouvert\')), WITH CHECK isolant',
          ],
        }),
      ],
      ROLE,
    );

    expect(problemes.length).toBeGreaterThan(0);
  });

  // --- Qualité du diagnostic (on le lira à 2 h du matin) ----------------------------------------

  it('nomme la table, la politique, l\'expression fautive et le rôle évalué', () => {
    const [probleme] = analyserPostureTables(
      [
        tableConforme({
          politiques_non_isolantes: [
            'or_debug [ALL] USING NON ISOLANT (true), WITH CHECK NON ISOLANT (true)',
          ],
        }),
      ],
      ROLE,
    );

    expect(probleme).toContain('ordre_reparation'); // la table
    expect(probleme).toContain('or_debug'); // la politique
    expect(probleme).toContain('USING NON ISOLANT (true)'); // ce qui cloche
    expect(probleme).toContain('dfa_app'); // pour quel rôle
    expect(probleme).toContain('tenant_courant()'); // ce qu'il faut écrire
  });

  it('énumère les politiques vues quand aucune n\'isole, y compris « aucune »', () => {
    const [probleme] = analyserPostureTables(
      [tableConforme({ politiques_isolantes: 0, inventaire_politiques: [] })],
      ROLE,
    );

    expect(probleme).toContain('Politiques applicables vues : aucune');
  });

  it('signale un découpage par commande, qui ne satisfait pas USING + WITH CHECK', () => {
    // `for select using (…)` + `for insert with check (…)` : chaque expression est isolante, donc
    // aucune n'est signalée comme laxiste — mais aucune politique ne porte les deux, ce que le
    // socle exige. Le message doit donner l'inventaire pour que la cause saute aux yeux.
    const [probleme] = analyserPostureTables(
      [
        tableConforme({
          politiques_isolantes: 0,
          politiques_non_isolantes: [],
          inventaire_politiques: [
            'or_ecriture [INSERT] USING absent, WITH CHECK isolant',
            'or_lecture [SELECT] USING isolant, WITH CHECK absent',
          ],
        }),
      ],
      ROLE,
    );

    expect(probleme).toContain('or_lecture [SELECT] USING isolant, WITH CHECK absent');
  });

  // --- Non-régressions : ne pas casser ce qui est légitime --------------------------------------

  it('ignore une table sans tenant_id (table technique, __dfa_migrations)', () => {
    const problemes = analyserPostureTables(
      [
        tableConforme({
          table_name: '__dfa_migrations',
          porte_tenant_id: false,
          rls_force: false,
          politiques_isolantes: 0,
          inventaire_politiques: [],
        }),
      ],
      ROLE,
    );

    expect(problemes).toEqual([]);
  });

  it('exige une politique sur « tenant », qui s\'isole sur id sans porter de tenant_id', () => {
    const problemes = analyserPostureTables(
      [
        tableConforme({
          table_name: 'tenant',
          porte_tenant_id: false,
          politiques_isolantes: 0,
          inventaire_politiques: [],
        }),
      ],
      ROLE,
    );

    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain('tenant');
  });

  it('tolère FORCE RLS absent sur les seules tables du chemin d\'amorçage', () => {
    for (const table of ['utilisateur', 'session', 'journal_securite']) {
      expect(
        analyserPostureTables([tableConforme({ table_name: table, rls_force: false })], ROLE),
      ).toEqual([]);
    }
  });

  it('refuse FORCE RLS absent sur une table métier', () => {
    const problemes = analyserPostureTables([tableConforme({ rls_force: false })], ROLE);

    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain('FORCE ROW LEVEL SECURITY');
  });

  it('signale RLS désactivé sans chercher plus loin', () => {
    const problemes = analyserPostureTables([tableConforme({ rls_active: false })], ROLE);

    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain('ROW LEVEL SECURITY non activé');
  });
});
