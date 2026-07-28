/**
 * R-9 (plan-lot1-execution.md §5.5) : « toute contrainte UNIQUE ou EXCLUDE d'une table métier
 * commence par tenant_id ». Sans cette règle, une violation de contrainte révèle l'EXISTENCE d'une
 * ligne d'un autre tenant par le seul message d'erreur Postgres (« duplicate key value violates
 * unique constraint ») — une fuite que le RLS n'arrête pas, puisqu'elle a lieu AVANT toute
 * évaluation de politique (les contraintes sont vérifiées par l'index, pas par une requête filtrée).
 *
 * Test sur le CATALOGUE (`pg_index`), pas table par table : toute future table métier du produit
 * est couverte automatiquement, sans qu'il faille se souvenir d'ajouter une ligne ici.
 *
 * `pg_constraint` seul ne suffirait pas : une contrainte UNIQUE posée via
 * `create table (... unique (...))` y apparaît, mais un `create unique index ... where ...` (utilisé
 * pour les unicités PARTIELLES — `vehicule_vin_actif_uk`, `client_adresse_principale_uk` — car
 * `unique()` de table n'accepte ni prédicat ni expression) n'y apparaît PAS. `pg_index` couvre les
 * deux : une contrainte UNIQUE/EXCLUDE est TOUJOURS soutenue par un index.
 *
 * DEUX EXCEPTIONS DOCUMENTÉES, et seulement deux (voir `EXCEPTIONS_DOCUMENTEES` ci-dessous) :
 * `utilisateur.email` et `session.empreinte_token` sont uniques GLOBALEMENT, par décision assumée
 * du socle (0000_socle.sql) — un email ou un jeton de session doit pouvoir être résolu AVANT que le
 * tenant ne soit connu (c'est précisément ce lookup qui le détermine). Toute autre contrainte
 * UNIQUE/EXCLUDE d'une table portant `tenant_id` doit commencer par lui.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { demarrerBaseEphemere, type BaseEphemere } from '../../setup/postgres-ephemere';

let bdd: BaseEphemere;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
}, 180_000);

afterAll(async () => {
  await bdd?.fermer();
});

// -------------------------------------------------------------------------------------------
// Le vérificateur — isolé du test lui-même pour pouvoir le pointer, dans le même fichier, sur
// une table SAINE (le schéma réel) et sur une table VOLONTAIREMENT FAUTIVE (preuve que le
// vérificateur détecte réellement ce qu'il prétend détecter, pas seulement sur le papier).
// -------------------------------------------------------------------------------------------

interface LigneIndex {
  readonly table_nom: string;
  readonly index_nom: string;
  readonly attnums: readonly string[];
  readonly est_index_de_pk: boolean;
}

interface LigneAttribut {
  readonly table_nom: string;
  readonly attnum: number;
  readonly attname: string;
}

export interface ViolationR9 {
  readonly table: string;
  readonly contrainte: string;
  readonly premiereColonne: string;
}

/** `<table>.<contrainte>` — clé des deux exceptions documentées en tête de fichier. Toute entrée
 *  ajoutée ici DOIT porter, au point d'ajout, la même justification qu'en tête de fichier : ce
 *  n'est pas une liste qu'on complète pour faire taire un test rouge. */
const EXCEPTIONS_DOCUMENTEES: ReadonlySet<string> = new Set([
  'utilisateur.utilisateur_email_uk',
  'session.session_empreinte_token_uk',
]);

/** Repère toute violation de R-9 dans le schéma `public` réellement présent en base. */
async function releverViolationsR9(pool: Pool): Promise<ViolationR9[]> {
  const client = await pool.connect();
  try {
    const { rows: index } = await client.query<LigneIndex>(`
      select
        ct.relname as table_nom,
        ci.relname as index_nom,
        string_to_array(ix.indkey::text, ' ') as attnums,
        exists (
          select 1 from pg_constraint pk
           where pk.conindid = ix.indexrelid and pk.contype = 'p'
        ) as est_index_de_pk
      from pg_index ix
      join pg_class ct on ct.oid = ix.indrelid
      join pg_class ci on ci.oid = ix.indexrelid
      join pg_namespace n on n.oid = ct.relnamespace
      where n.nspname = 'public'
        and ct.relkind = 'r'
        and (ix.indisunique or ix.indisexclusion)
      order by ct.relname, ci.relname
    `);

    const { rows: attributs } = await client.query<LigneAttribut>(`
      select c.relname as table_nom, a.attnum, a.attname
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
    `);

    const nomParTableEtAttnum = new Map<string, Map<number, string>>();
    const tablesAvecTenantId = new Set<string>();
    for (const attribut of attributs) {
      if (!nomParTableEtAttnum.has(attribut.table_nom))
        nomParTableEtAttnum.set(attribut.table_nom, new Map());
      nomParTableEtAttnum.get(attribut.table_nom)!.set(attribut.attnum, attribut.attname);
      if (attribut.attname === 'tenant_id') tablesAvecTenantId.add(attribut.table_nom);
    }

    const violations: ViolationR9[] = [];
    for (const ligne of index) {
      if (ligne.est_index_de_pk) continue; // une PRIMARY KEY n'est ni UNIQUE ni EXCLUDE au sens de R-9
      if (!tablesAvecTenantId.has(ligne.table_nom)) continue; // pas de tenant_id à préfixer : hors périmètre R-9
      if (EXCEPTIONS_DOCUMENTEES.has(`${ligne.table_nom}.${ligne.index_nom}`)) continue;

      const premierAttnum = Number(ligne.attnums[0]);
      const premiereColonne =
        premierAttnum === 0
          ? '<expression>'
          : (nomParTableEtAttnum.get(ligne.table_nom)?.get(premierAttnum) ??
            '<colonne introuvable>');

      if (premiereColonne !== 'tenant_id') {
        violations.push({ table: ligne.table_nom, contrainte: ligne.index_nom, premiereColonne });
      }
    }
    return violations;
  } finally {
    client.release();
  }
}

describe("R-9 — toute contrainte UNIQUE/EXCLUDE d'une table métier commence par tenant_id", () => {
  it('le schéma réel ne contient AUCUNE violation (hors les deux exceptions documentées)', async () => {
    const violations = await releverViolationsR9(bdd.poolApp);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it(
    'preuve que le vérificateur détecte réellement une violation : une table témoin, avec une ' +
      'colonne tenant_id ET une contrainte UNIQUE qui ne commence PAS par elle, est signalée',
    async () => {
      const nomTable = `r9_temoin_${randomUUID().replace(/-/g, '')}`;
      const clientMigrateur = await bdd.poolMigrateur.connect();
      try {
        await clientMigrateur.query(`
          create table public.${nomTable} (
            id uuid not null default gen_random_uuid(),
            tenant_id uuid not null,
            valeur text not null,
            constraint ${nomTable}_pk primary key (id),
            -- LE DÉFAUT VISÉ : unique sur (valeur) seul, sans tenant_id en tête.
            constraint ${nomTable}_valeur_uk unique (valeur)
          )
        `);

        const violations = await releverViolationsR9(bdd.poolApp);
        const violationTemoin = violations.find((v) => v.table === nomTable);

        expect(
          violationTemoin,
          `le vérificateur devait signaler ${nomTable}_valeur_uk, violations trouvées : ${JSON.stringify(violations)}`,
        ).toBeDefined();
        expect(violationTemoin?.contrainte).toBe(`${nomTable}_valeur_uk`);
        expect(violationTemoin?.premiereColonne).toBe('valeur');
      } finally {
        await clientMigrateur.query(`drop table if exists public.${nomTable}`);
        clientMigrateur.release();
      }
    },
  );

  it("les deux exceptions documentées existent réellement et portent bien un tenant_id (sinon l'exception serait un allowlist mort)", async () => {
    const client: PoolClient = await bdd.poolSuperutilisateur.connect();
    try {
      for (const entree of EXCEPTIONS_DOCUMENTEES) {
        const [table] = entree.split('.');
        const { rows } = await client.query(
          `select 1 from pg_attribute a
             join pg_class c on c.oid = a.attrelid
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = $1 and a.attname = 'tenant_id' and not a.attisdropped`,
          [table],
        );
        expect(
          rows,
          `${table} devrait porter tenant_id (sinon ce n'est pas une exception à R-9, c'est hors périmètre)`,
        ).toHaveLength(1);
      }
    } finally {
      client.release();
    }
  });
});
