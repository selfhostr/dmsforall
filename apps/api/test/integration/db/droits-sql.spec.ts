/**
 * Garde-fou : croise les opérations SQL réellement émises par le code applicatif
 * (`scripts/verifier-droits-sql.ts`, voir son en-tête pour l'arbitrage complet — mécanismes
 * écartés, taux de faux positifs mesuré, choix du branchement) avec les droits réellement
 * accordés à `dfa_app` sur une vraie base migrée. Objectif explicite : attraper ce que
 * `verifierPostureRls()` (apps/api/src/db/acces-base.service.ts) ne peut structurellement PAS
 * voir — un DELETE (ou INSERT/UPDATE) que le code émet mais que la migration n'a jamais accordé.
 *
 * Défaut historique qui a motivé ce fichier : la migration créant `reprise_analyse` accordait
 * `select, insert, update` à `dfa_app`, un service faisait `DELETE FROM public.reprise_analyse` à
 * chaque appel — 500 sur toutes les archives, invisible pour 5700 tests verts (aucun n'exerçait
 * ce chemin). La migration corrective (0068, pas encore sur `dev` au moment d'écrire ce fichier —
 * elle vit sur une autre branche) ajoute `grant delete`. Les deux tests de la seconde section
 * REPRODUISENT ces deux états sur une table jetable, plutôt que de dépendre de la présence de ces
 * deux migrations précises sur cette branche.
 *
 * Périmètre d'écriture : `apps/api/test/**` (CONTRIBUTING.md, exclusif à cette tâche : garde-fou
 * droits SQL).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { demarrerBaseEphemere, type BaseEphemere } from '../../setup/postgres-ephemere';
import {
  extraireTableMap,
  extraireOperationsCode,
  formaterProblemes,
  verifierDroits,
  type OperationTable,
} from '../../../../../scripts/verifier-droits-sql';

describe('droits SQL : code applicatif vs droits accordés à dfa_app', () => {
  let base: BaseEphemere;

  beforeAll(async () => {
    base = await demarrerBaseEphemere();
  }, 180_000);

  afterAll(async () => {
    await base.fermer();
  });

  const interroger = (sql: string, params: unknown[]) => base.poolApp.query(sql, params);

  // -----------------------------------------------------------------------------------------
  // LE garde-fou réel : tourne contre le VRAI code applicatif et les VRAIES migrations de ce
  // dépôt (mêmes migrations que `pnpm db:migrate` en dev/prod, rejouées par ce harnais comme un
  // déploiement réel — voir l'en-tête de postgres-ephemere.ts). C'est CE test qui doit rester
  // vert en continu et rouge le jour où une migration retire/oublie un droit dont le code a
  // besoin — pas une simulation.
  // -----------------------------------------------------------------------------------------
  it("n'a aucun droit manquant entre le code applicatif et les migrations réelles", async () => {
    const tableMap = extraireTableMap();
    const operations = extraireOperationsCode(tableMap);

    // Garde contre une extraction silencieusement cassée (répertoire déplacé, regex qui ne
    // matche plus rien) : sans ce plancher, un refactor qui casse l'extraction ferait passer ce
    // test à VIDE — vert pour la mauvaise raison, exactement le risque que ce fichier existe pour
    // éliminer. Mesuré sur ce dépôt le 24.08.2026 : 90 paires (table, privilège) distinctes.
    expect(operations.length).toBeGreaterThan(50);

    const problemes = await verifierDroits(interroger, operations);
    expect(problemes, formaterProblemes(problemes)).toEqual([]);
  });

  // -----------------------------------------------------------------------------------------
  // Reproduction du défaut historique (reprise_analyse, 0067 fautive → 0068 corrective) sur une
  // table jetable : prouve que le CONTRÔLE LUI-MÊME échoue sur l'état fautif et passe sur l'état
  // corrigé, indépendamment de la présence de ces deux migrations sur `dev`.
  // -----------------------------------------------------------------------------------------
  describe('reproduit 0067 (fautive) → 0068 (corrigée)', () => {
    const nomTable = 'droits_sql_fixture_reprise_analyse';
    const operationDelete: OperationTable = {
      table: nomTable,
      privilege: 'DELETE',
      fichier: 'fixture-test',
      ligne: 1,
    };

    beforeAll(async () => {
      // Créée et accordée par dfa_migrator (propriétaire), exactement comme une migration réelle
      // — jamais par le superutilisateur, qui contournerait la question posée.
      await base.poolMigrateur.query(
        `create table public.${nomTable} (id integer generated always as identity primary key)`,
      );
      // État 0067, mot pour mot : `grant select, insert, update on public.reprise_analyse to dfa_app`.
      await base.poolMigrateur.query(
        `grant select, insert, update on public.${nomTable} to dfa_app`,
      );
    });

    afterAll(async () => {
      await base.poolMigrateur.query(`drop table if exists public.${nomTable}`);
    });

    it('échoue (détecte le DELETE manquant) sur l’état fautif — équivalent de 0067', async () => {
      const problemes = await verifierDroits(interroger, [operationDelete]);
      expect(problemes).toEqual([
        {
          type: 'droit-manquant',
          table: nomTable,
          privilege: 'DELETE',
          exemple: operationDelete,
        },
      ]);
    });

    it('passe une fois le droit accordé — équivalent de 0068', async () => {
      // État 0068 : `grant delete on public.reprise_analyse to dfa_app`, ajouté par-dessus 0067.
      await base.poolMigrateur.query(`grant delete on public.${nomTable} to dfa_app`);

      const problemes = await verifierDroits(interroger, [operationDelete]);
      expect(problemes).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------------------------
  // Bonus (extension naturelle du même mécanisme, voir en-tête de scripts/verifier-droits-sql.ts
  // §2) : une table référencée par le code mais absente du schéma migré — renommage oublié,
  // migration non appliquée. Même requête (`to_regclass`) que le contrôle de droits, aucun
  // mécanisme supplémentaire.
  // -----------------------------------------------------------------------------------------
  it('détecte une table référencée par le code mais absente du schéma migré', async () => {
    const operation: OperationTable = {
      table: 'table_qui_nexiste_pas_dans_le_schema_migre',
      privilege: 'INSERT',
      fichier: 'fixture-test',
      ligne: 1,
    };

    const problemes = await verifierDroits(interroger, [operation]);
    expect(problemes).toEqual([
      { type: 'table-absente', table: operation.table, exemple: operation },
    ]);
  });
});
