/**
 * Réversibilité des migrations : up → down → up doit produire un schéma final identique, et
 * chaque migration "up" doit avoir un pendant "down" (le contrat gelé §3 interdit les
 * migrations destructives sans annulation possible — voir aussi CONTRIBUTING.md "migrations
 * réversibles, expand/contract, jamais destructives").
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  demarrerBaseEphemere,
  appliquerMigrationsUp,
  appliquerMigrationsDown,
  listerFichiersMigrationsUp,
  listerFichiersMigrationsDown,
  dumperSchema,
  type BaseEphemere,
} from '../setup/postgres-ephemere';

let bdd: BaseEphemere;

beforeAll(async () => {
  // appliquerMigrations: false — ce spec pilote lui-même la séquence up/down/up.
  bdd = await demarrerBaseEphemere({ appliquerMigrations: false });
}, 180_000);

afterAll(async () => {
  // Défensif : si `beforeAll` a échoué avant d'initialiser la base, `?.` évite de masquer la
  // VRAIE erreur (celle du beforeAll) derrière un TypeError secondaire ici.
  await bdd?.fermer();
});

describe('réversibilité des migrations', () => {
  it('chaque migration "up" a un fichier ".down.sql" correspondant : aucune migration sans annulation', () => {
    const montantes = listerFichiersMigrationsUp();
    const descendantes = listerFichiersMigrationsDown();
    expect(montantes.length, 'au moins une migration est attendue pour le socle étape 0').toBeGreaterThan(0);
    expect(descendantes.length, 'chaque migration up doit avoir son pendant down').toBe(montantes.length);
  });

  it('appliquer toutes les migrations, les annuler intégralement, puis les réappliquer produit un schéma identique', async () => {
    const client = new Client({ connectionString: bdd.migrateur.url });
    await client.connect();
    try {
      await appliquerMigrationsUp(client);
      const schemaApresPremiereMontee = await dumperSchema(bdd.conteneur, bdd.migrateur);

      await appliquerMigrationsDown(client);

      // Une annulation complète ne doit laisser aucune table applicative derrière elle —
      // sinon "down" n'annule pas vraiment "up", il fait semblant.
      const tablesRestantes = await client.query(
        "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'",
      );
      expect(tablesRestantes.rows.map((r) => r.relname), 'aucune table applicative ne doit survivre au down').toEqual([]);

      await appliquerMigrationsUp(client);
      const schemaApresSecondeMontee = await dumperSchema(bdd.conteneur, bdd.migrateur);

      expect(schemaApresSecondeMontee).toBe(schemaApresPremiereMontee);
    } finally {
      await client.end();
    }
  }, 120_000);
});
