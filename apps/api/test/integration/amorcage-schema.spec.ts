/**
 * B5 (rapport QA étape 0) : le schéma `amorcage` est la SEULE surface du produit qui échappe au
 * RLS (voir 0001_socle_rls.sql §5) — ses 6 fonctions `SECURITY DEFINER` tournent avec les droits
 * de leur propriétaire, hors de tout contexte tenant. `amorcage-portee.spec.ts` borne l'usage du
 * jeton `JETON_DB_AMORCAGE` côté TypeScript (aucun fichier hors src/db et src/auth ne le
 * référence), mais rien ne vérifie la frontière qui compte réellement : celle posée en base.
 *
 * Ce fichier vérifie EXACTEMENT ce que le rapport QA demande, en base, indépendamment de tout
 * code applicatif :
 *   - le schéma `amorcage` contient EXACTEMENT les 6 fonctions attendues, ni plus ni moins ;
 *   - chacune est `SECURITY DEFINER` avec `search_path` figé (`pg_catalog, public`) — sans quoi
 *     une fonction SECURITY DEFINER est une escalade de privilèges classique (l'appelant pose son
 *     propre search_path et fait résoudre à la fonction, avec les droits de dfa_migrator, des
 *     objets de son cru) ;
 *   - le propriétaire de chacune est `dfa_migrator`, jamais un rôle plus privilégié ;
 *   - `dfa_app` a EXECUTE sur ces 6 fonctions et sur RIEN d'autre dans le schéma `amorcage` —
 *     et PUBLIC n'a EXECUTE sur aucune d'entre elles.
 *
 * Scénario que ce test doit attraper (rapport QA, B5) : l'étape 1 ajoute
 * `amorcage.utilisateur_par_jeton_invitation` en oubliant `set search_path = pg_catalog, public`
 * (escalade de privilèges), ou avec un `select u.*` (fuite de colonnes futures — TOTP, jeton de
 * récupération). Dans les deux cas, `verifierPostureRls()` reste vert (il ne regarde pas le
 * schéma `amorcage`) et aucun test existant ne rougit. Celui-ci doit rougir.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';

const FONCTIONS_AMORCAGE_ATTENDUES: readonly string[] = [
  'echec_connexion',
  'journaliser_securite',
  'reinitialiser_echecs',
  'session_par_empreinte',
  'session_toucher',
  'utilisateur_par_email',
].sort((a, b) => a.localeCompare(b, 'en'));

interface LigneFonctionAmorcage {
  readonly proname: string;
  readonly oid: string;
  readonly prosecdef: boolean;
  readonly proconfig: string[] | null;
  readonly proprietaire: string;
}

let bdd: BaseEphemere;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
}, 180_000);

afterAll(async () => {
  await bdd?.fermer();
});

async function listerFonctionsAmorcage(): Promise<LigneFonctionAmorcage[]> {
  const client = await bdd.poolSuperutilisateur.connect();
  try {
    const { rows } = await client.query<LigneFonctionAmorcage>(`
      select p.proname,
             p.oid::text                    as oid,
             p.prosecdef,
             p.proconfig,
             pg_get_userbyid(p.proowner)    as proprietaire
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'amorcage'
       order by p.proname
    `);
    return rows;
  } finally {
    client.release();
  }
}

describe("schéma amorcage — frontière hors-RLS bornée en base (B5, rapport QA étape 0)", () => {
  it('contient EXACTEMENT les 6 fonctions attendues, ni plus ni moins — une 7e fonction fait rougir ce test', async () => {
    const fonctions = await listerFonctionsAmorcage();
    const noms = fonctions.map((f) => f.proname).sort((a, b) => a.localeCompare(b, 'en'));
    expect(noms).toEqual(FONCTIONS_AMORCAGE_ATTENDUES);
  });

  it('chaque fonction est SECURITY DEFINER avec search_path figé à "pg_catalog, public"', async () => {
    const fonctions = await listerFonctionsAmorcage();
    expect(fonctions.length).toBeGreaterThan(0);

    for (const fonction of fonctions) {
      expect.soft(fonction.prosecdef, `${fonction.proname} doit être SECURITY DEFINER`).toBe(true);

      const entreeSearchPath = (fonction.proconfig ?? []).find((entree) => entree.startsWith('search_path='));
      expect.soft(entreeSearchPath, `${fonction.proname} doit fixer search_path (proconfig: ${JSON.stringify(fonction.proconfig)})`).toBeDefined();
      // Tolérant à l'espace après la virgule (format normalisé par Postgres, pas garanti stable
      // au caractère près selon la version) — mais jamais un search_path qui laisse entrer un
      // schéma contrôlé par l'appelant.
      expect
        .soft(
          entreeSearchPath?.replace(/\s+/g, ''),
          `${fonction.proname} : search_path attendu "pg_catalog, public", obtenu "${String(entreeSearchPath)}"`,
        )
        .toBe('search_path=pg_catalog,public');
    }
  });

  it('le propriétaire de chaque fonction est dfa_migrator', async () => {
    const fonctions = await listerFonctionsAmorcage();
    expect(fonctions.length).toBeGreaterThan(0);

    for (const fonction of fonctions) {
      expect.soft(fonction.proprietaire, `${fonction.proname} doit appartenir à dfa_migrator`).toBe('dfa_migrator');
    }
  });

  it('dfa_app a EXECUTE sur les 6 fonctions attendues et sur RIEN d\'autre dans le schéma amorcage', async () => {
    const client = await bdd.poolSuperutilisateur.connect();
    try {
      const { rows } = await client.query<{ proname: string; dfa_app_execute: boolean }>(`
        select p.proname,
               has_function_privilege('dfa_app', p.oid, 'EXECUTE') as dfa_app_execute
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'amorcage'
         order by p.proname
      `);

      // Corollaire de "exactement 6 fonctions" (premier test de ce fichier) : si dfa_app a
      // EXECUTE sur chacune des lignes retournées ICI, et qu'il n'y a que 6 lignes, alors
      // dfa_app n'a EXECUTE sur rien d'autre dans ce schéma par construction — pas besoin
      // d'énumérer tous les rôles absents de la base pour le prouver.
      expect(rows.map((r) => r.proname).sort((a, b) => a.localeCompare(b, 'en'))).toEqual(FONCTIONS_AMORCAGE_ATTENDUES);

      for (const ligne of rows) {
        expect.soft(ligne.dfa_app_execute, `dfa_app doit pouvoir exécuter amorcage.${ligne.proname}`).toBe(true);
      }
    } finally {
      client.release();
    }
  });

  it("PUBLIC n'a EXECUTE sur aucune fonction du schéma amorcage (revoke all ... from public appliqué systématiquement)", async () => {
    const client = await bdd.poolSuperutilisateur.connect();
    try {
      const { rows } = await client.query<{ proname: string; public_execute: boolean }>(`
        select p.proname,
               has_function_privilege('public', p.oid, 'EXECUTE') as public_execute
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'amorcage'
         order by p.proname
      `);
      expect(rows.length).toBeGreaterThan(0);

      for (const ligne of rows) {
        expect.soft(ligne.public_execute, `PUBLIC ne doit PAS pouvoir exécuter amorcage.${ligne.proname}`).toBe(false);
      }
    } finally {
      client.release();
    }
  });
});
