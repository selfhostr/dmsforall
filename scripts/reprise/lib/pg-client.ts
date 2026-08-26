/**
 * Fabrique de connexion Postgres — même détour `createRequire` que `lib/tenant.ts` pour
 * `@node-rs/argon2` (voir son en-tête pour la mesure complète) : `pg` n'est déclaré que dans les
 * dépendances de `@dfa/api`, jamais hissé à la racine (`node_modules/pg` absent à la racine du
 * dépôt, vérifié). Un `import` nu depuis un fichier de CE périmètre (`scripts/reprise/`) n'est pas
 * fiable pour cette raison — centralisé ici plutôt que répété à chaque script appelant.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Client as ClientPg, ClientConfig } from 'pg';

const RACINE_DEPOT = resolve(__dirname, '../../..');
const requireDepuisApi = createRequire(resolve(RACINE_DEPOT, 'apps/api/package.json'));

export function nouveauClientPg(config: ClientConfig): ClientPg {
  const { Client } = requireDepuisApi('pg') as { Client: new (c: ClientConfig) => ClientPg };
  return new Client(config);
}

export type { Client as ClientPg } from 'pg';
