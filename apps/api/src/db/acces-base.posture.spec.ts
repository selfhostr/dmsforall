/**
 * Verdict de `verifierPostureRls()` sur l'inventaire du catalogue (bloquant QA B4).
 *
 * Ces cas couvrent la partie TypeScript de la décision. La partie SQL — « qu'est-ce qu'une
 * politique isolante » — est vérifiée sur vraie base par les tests d'intégration : ici on
 * s'assure qu'une fois le catalogue lu, aucune configuration dangereuse n'est acceptée et que
 * le diagnostic rendu est exploitable sans ouvrir le code.
 */

import { describe, expect, it } from 'vitest';

import {
  analyserPostureTables,
  lireDeclaration,
  MARQUEUR_HORS_PORTEE,
  MARQUEUR_REFERENTIEL,
  MARQUEUR_SUPPRESSION,
} from './acces-base.service';
import type { PostureTable } from './acces-base.service';

const ROLE = 'dfa_app';

/** Justification en clair assez longue pour satisfaire l'exigence de motivation. */
const RAISON = 'référentiel produit identique pour tous les tenants, alimenté par migration';

/**
 * Table conforme au socle : FORCE RLS + une politique isolante, SELECT/INSERT/UPDATE, ni DELETE
 * ni TRUNCATE. C'est exactement le motif que l'étape 1 va répéter une trentaine de fois.
 */
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
    commentaire: null,
    peut_selectionner: true,
    peut_inserer: true,
    peut_modifier: true,
    peut_supprimer: false,
    peut_tronquer: false,
    est_partition: false,
    table_mere: null,
    ...overrides,
  };
}

/** Référentiel partagé conforme : pas de tenant_id, déclaré, SELECT seul. */
function referentielConforme(overrides: Partial<PostureTable> = {}): PostureTable {
  return tableConforme({
    table_name: 'transition_autorisee',
    porte_tenant_id: false,
    rls_force: false,
    politiques_isolantes: 0,
    politiques_non_isolantes: ['transition_lecture [ALL] USING NON ISOLANT (true), WITH CHECK absent'],
    inventaire_politiques: ['transition_lecture [ALL] USING NON ISOLANT (true), WITH CHECK absent'],
    commentaire: `Transitions d'états autorisées. [${MARQUEUR_REFERENTIEL}] ${RAISON}`,
    peut_selectionner: true,
    peut_inserer: false,
    peut_modifier: false,
    peut_supprimer: false,
    ...overrides,
  });
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

  it('accepte __dfa_migrations, déclarée hors de portée et sans aucun privilège', () => {
    const problemes = analyserPostureTables(
      [
        tableConforme({
          table_name: '__dfa_migrations',
          porte_tenant_id: false,
          rls_force: false,
          politiques_isolantes: 0,
          inventaire_politiques: [],
          commentaire: `Suivi des migrations. [${MARQUEUR_HORS_PORTEE}] table d'infrastructure du runner, dfa_app n'y a aucun privilège`,
          peut_selectionner: false,
          peut_inserer: false,
          peut_modifier: false,
          peut_supprimer: false,
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

// =================================================================================================
// Préalable étape 1 — tables SANS tenant_id (référentiels partagés)
//
// Comportement AVANT 0002, constaté en exécution sur la base de développement : une table sans
// tenant_id était purement ignorée. Une table métier à laquelle on avait oublié tenant_id, munie
// de la politique du socle recopiée (`using (true) with check (true)`), démarrait l'API sans un
// mot — et dfa_app y insérait, lisait et supprimait toutes les lignes hors contexte tenant.
// =================================================================================================

describe('analyserPostureTables — tables sans tenant_id', () => {
  it('REFUSE une table sans tenant_id qui ne déclare rien (le trou n°1)', () => {
    const problemes = analyserPostureTables(
      [
        tableConforme({
          table_name: 'ligne_ordre_reparation',
          porte_tenant_id: false,
          politiques_isolantes: 0,
          politiques_non_isolantes: [],
          inventaire_politiques: ['lor_isolation [ALL] USING NON ISOLANT (true), WITH CHECK NON ISOLANT (true)'],
          commentaire: null,
        }),
      ],
      ROLE,
    );

    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain('ligne_ordre_reparation');
    expect(problemes[0]).toContain('aucune déclaration de posture');
    // Le message doit donner les DEUX issues, sans laisser deviner laquelle est la bonne.
    expect(problemes[0]).toContain('tenant_id uuid not null');
    expect(problemes[0]).toContain(MARQUEUR_REFERENTIEL);
  });

  it('accepte un référentiel partagé déclaré et en lecture seule', () => {
    expect(analyserPostureTables([referentielConforme()], ROLE)).toEqual([]);
  });

  it('tolère « using (true) » sur un référentiel : SELECT seul rend la politique inoffensive', () => {
    // Le même motif sur une table à tenant_id est refusé (cas B4 plus haut). Ici il ne peut
    // qu'autoriser la lecture d'un contenu identique pour tous les tenants.
    const t = referentielConforme();
    expect(t.politiques_non_isolantes).not.toEqual([]);
    expect(analyserPostureTables([t], ROLE)).toEqual([]);
  });

  it('REFUSE un référentiel déclaré sur lequel dfa_app peut écrire', () => {
    const problemes = analyserPostureTables(
      [referentielConforme({ peut_inserer: true, peut_modifier: true })],
      ROLE,
    );

    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain('INSERT, UPDATE');
    expect(problemes[0]).toContain('lecture seule');
  });

  it('empêche une table métier de « passer pour un référentiel » : la déclaration n\'ouvre rien', () => {
    // Le scénario exact à interdire : on oublie tenant_id, et pour faire taire le démarrage on
    // colle le marqueur. Comme la table reste inscriptible, elle est refusée quand même.
    const problemes = analyserPostureTables(
      [
        referentielConforme({
          table_name: 'pointage',
          commentaire: `Pointages atelier. [${MARQUEUR_REFERENTIEL}] ${RAISON}`,
          peut_inserer: true,
          peut_modifier: true,
        }),
      ],
      ROLE,
    );

    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain('pointage');
  });

  it('REFUSE « hors portée » revendiqué par une table réellement accessible', () => {
    const problemes = analyserPostureTables(
      [
        referentielConforme({
          commentaire: `Table technique. [${MARQUEUR_HORS_PORTEE}] ${RAISON}`,
          peut_selectionner: true,
        }),
      ],
      ROLE,
    );

    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain('SELECT');
    expect(problemes[0]).toContain(MARQUEUR_HORS_PORTEE);
  });

  it('REFUSE les deux marqueurs de portée posés ensemble', () => {
    const problemes = analyserPostureTables(
      [
        referentielConforme({
          commentaire: `[${MARQUEUR_REFERENTIEL}] [${MARQUEUR_HORS_PORTEE}] ${RAISON}`,
        }),
      ],
      ROLE,
    );

    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain("s'excluent");
  });

  it('REFUSE un marqueur de portée posé sur une table qui porte tenant_id', () => {
    const problemes = analyserPostureTables(
      [tableConforme({ commentaire: `[${MARQUEUR_REFERENTIEL}] ${RAISON}` })],
      ROLE,
    );

    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain('porte tenant_id');
  });

  it('REFUSE un marqueur sans justification en clair', () => {
    const problemes = analyserPostureTables(
      [referentielConforme({ commentaire: `[${MARQUEUR_REFERENTIEL}]` })],
      ROLE,
    );

    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain('sans justification');
  });

  it('REFUSE un marqueur mal orthographié plutôt que de l\'ignorer', () => {
    // Le pire des cas : l'auteur croit avoir déclaré, le contrôle ne voit rien, et la table
    // passerait pour non déclarée… ou pour déclarée, selon le sens du vent.
    const problemes = analyserPostureTables(
      [referentielConforme({ commentaire: `[dfa:referentiel_partage] ${RAISON}` })],
      ROLE,
    );

    expect(problemes.join('\n')).toContain('inconnu');
    expect(problemes.join('\n')).toContain('dfa:referentiel_partage');
  });
});

// =================================================================================================
// Préalable étape 1 — DELETE et TRUNCATE
// =================================================================================================

describe('analyserPostureTables — suppression physique', () => {
  it('REFUSE DELETE sur une table métier non déclarée (le trou n°2)', () => {
    // C'est exactement ce que `alter default privileges … grant delete` produisait sur CHAQUE
    // nouvelle table, sans qu'aucune migration n'ait à le demander.
    const problemes = analyserPostureTables([tableConforme({ peut_supprimer: true })], ROLE);

    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain('DELETE sans déclaration');
    expect(problemes[0]).toContain('revoke delete on public.ordre_reparation');
    expect(problemes[0]).toContain(MARQUEUR_SUPPRESSION);
  });

  it('accepte DELETE sur une table qui le déclare (session)', () => {
    const problemes = analyserPostureTables(
      [
        tableConforme({
          table_name: 'session',
          rls_force: false,
          peut_supprimer: true,
          commentaire:
            `Sessions authentifiées. [${MARQUEUR_SUPPRESSION}] la purge des sessions expirées et la ` +
            `révocation suppriment physiquement la ligne, garder une empreinte de jeton révoqué serait ` +
            `garder un secret dérivé sans contrepartie d'audit.`,
        }),
      ],
      ROLE,
    );

    expect(problemes).toEqual([]);
  });

  it('REFUSE TRUNCATE partout, y compris sur une table par ailleurs déclarée', () => {
    // TRUNCATE ne consulte aucune politique : un seul ordre viderait tous les tenants.
    const problemes = analyserPostureTables(
      [
        tableConforme({
          peut_tronquer: true,
          peut_supprimer: true,
          commentaire: `Table métier. [${MARQUEUR_SUPPRESSION}] purge légitime documentée ici même`,
        }),
      ],
      ROLE,
    );

    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain('TRUNCATE');
    expect(problemes[0]).toContain('contourne');
  });

  it('signale DELETE même quand la table est par ailleurs irréprochable', () => {
    const problemes = analyserPostureTables(
      [tableConforme({ peut_supprimer: true, commentaire: 'Ordres de réparation.' })],
      ROLE,
    );

    expect(problemes).toHaveLength(1);
  });
});

// =================================================================================================
// Préalable étape 1 — tables partitionnées (audit_atelier)
//
// Mesuré en exécution sur PostgreSQL 16 : une partition créée par « create table … partition of »
// n'hérite NI de relrowsecurity, NI de FORCE, NI des politiques de sa mère — mais elle hérite des
// PRIVILÈGES, que les default privileges lui accordent à la création. Avec deux tenants en base,
// « select from le_parent » rendait 1 ligne (correct) et « select from la_partition » 2 lignes
// (fuite intégrale), pendant que le parent, lui, était irréprochable.
// =================================================================================================

describe('analyserPostureTables — partitions', () => {
  /**
   * Partition CONFORME : aucun privilège pour dfa_app (règle R3 — l'accès applicatif passe par
   * la table mère), et malgré cela la posture d'isolation complète, parce qu'une partition
   * n'hérite ni de RLS, ni de FORCE, ni des politiques de sa mère.
   */
  const partitionConforme = (o: Partial<PostureTable> = {}): PostureTable =>
    tableConforme({
      table_name: 'audit_atelier_2026_08',
      est_partition: true,
      table_mere: 'audit_atelier',
      peut_selectionner: false,
      peut_inserer: false,
      peut_modifier: false,
      ...o,
    });

  /** Ce que produit un `create table … partition of` sans rien de plus : privilèges hérités, aucune posture. */
  const partitionNue = (o: Partial<PostureTable> = {}): PostureTable =>
    partitionConforme({
      rls_active: false,
      rls_force: false,
      politiques_isolantes: 0,
      politiques_non_isolantes: [],
      inventaire_politiques: [],
      peut_selectionner: true,
      peut_inserer: true,
      peut_modifier: true,
      ...o,
    });

  it('REFUSE une partition qui n\'a pas repris la posture de sa mère', () => {
    const problemes = analyserPostureTables([partitionNue()], ROLE);

    // Deux fautes distinctes, deux messages : les privilèges hérités (R3) et l'absence de RLS.
    expect(problemes).toHaveLength(2);
    expect(problemes.join('\n')).toContain('ROW LEVEL SECURITY non activé');
    for (const probleme of problemes) {
      expect(probleme).toContain('audit_atelier_2026_08');
    }
  });

  it('REFUSE les privilèges hérités par une partition, même irréprochable par ailleurs', () => {
    // Le cas réellement dangereux : la mère est parfaite, la partition porte politique et FORCE,
    // et pourtant `select … from audit_atelier_2026_08` rend tous les tenants — parce que ce
    // chemin d'accès ne consulte aucune politique de la mère.
    const problemes = analyserPostureTables(
      [partitionConforme({ peut_selectionner: true, peut_inserer: true })],
      ROLE,
    );

    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain('SELECT, INSERT');
    expect(problemes[0]).toContain('revoke all on public.audit_atelier_2026_08 from dfa_app');
    expect(problemes[0]).toContain('TOUS les tenants');
  });

  it('explique le piège de la partition, sinon on cherche au mauvais endroit', () => {
    // La partition est créée par un job mensuel, pas écrite à la main : sans cette explication,
    // le message envoie relire une migration où tout est correct.
    const probleme = analyserPostureTables([partitionNue()], ROLE).join('\n');

    expect(probleme).toContain('PARTITION de audit_atelier');
    expect(probleme).toContain("n'hérite");
    expect(probleme).toContain('PRIVILÈGES');
    expect(probleme).toContain('enable + force');
  });

  it('accepte une partition sans aucun privilège ET portant sa propre posture', () => {
    expect(analyserPostureTables([partitionConforme()], ROLE)).toEqual([]);
  });

  it('n\'ajoute l\'explication qu\'aux partitions, jamais à une table ordinaire', () => {
    const [probleme] = analyserPostureTables([tableConforme({ rls_active: false })], ROLE);

    expect(probleme).not.toContain('PARTITION');
  });

  it('réclame « revoke all » et non « revoke delete » quand une partition détient DELETE', () => {
    // Un seul message, et surtout le BON remède : retirer DELETE laisserait SELECT, donc la
    // fuite. R3 remplace les contrôles DELETE/TRUNCATE ordinaires, elle ne s'y ajoute pas.
    const problemes = analyserPostureTables(
      [partitionConforme({ peut_supprimer: true, peut_tronquer: true })],
      ROLE,
    );

    expect(problemes).toHaveLength(1);
    expect(problemes[0]).toContain('DELETE, TRUNCATE');
    expect(problemes[0]).toContain('revoke all');
    expect(problemes[0]).not.toContain('DELETE sans déclaration');
  });
});

// =================================================================================================
// Lecture des déclarations
// =================================================================================================

describe('lireDeclaration', () => {
  it('rend un jeu vide sur un commentaire absent ou blanc', () => {
    for (const c of [null, '', '   ']) {
      const d = lireDeclaration(c);
      expect(d.marqueurs.size).toBe(0);
      expect(d.inconnus).toEqual([]);
      expect(d.justification).toBe('');
    }
  });

  it('extrait plusieurs marqueurs et normalise la justification', () => {
    const d = lireDeclaration(
      `Référentiel.  [${MARQUEUR_REFERENTIEL}]\n  identique\tpour tous les tenants.`,
    );

    expect([...d.marqueurs]).toEqual([MARQUEUR_REFERENTIEL]);
    expect(d.justification).toBe('Référentiel. identique pour tous les tenants.');
  });

  it('classe en inconnu tout marqueur dfa: hors vocabulaire, sans le compter comme justification', () => {
    const d = lireDeclaration('[dfa:referentiel]');

    expect(d.marqueurs.size).toBe(0);
    expect(d.inconnus).toEqual(['dfa:referentiel']);
    expect(d.justification).toBe('');
  });

  it('ignore un crochet qui n\'est pas un marqueur dfa:', () => {
    const d = lireDeclaration('Table des OR [voir spécification §4.2] et de leurs lignes.');

    expect(d.marqueurs.size).toBe(0);
    expect(d.inconnus).toEqual([]);
    expect(d.justification).toContain('spécification');
  });

  it('reste stable sur plusieurs lectures du même commentaire (regex globale réutilisée)', () => {
    // `MOTIF_MARQUEUR` porte le drapeau /g : un `.test()` conserverait `lastIndex` entre appels
    // et rendrait le verdict dépendant de l'ordre des tables. `matchAll` et `replace` n'ont pas
    // ce défaut — ce cas verrouille la propriété.
    const commentaire = `Sessions. [${MARQUEUR_SUPPRESSION}] purge des sessions expirées.`;
    const a = lireDeclaration(commentaire);
    const b = lireDeclaration(commentaire);

    expect([...a.marqueurs]).toEqual([...b.marqueurs]);
    expect(a.justification).toBe(b.justification);
  });
});
