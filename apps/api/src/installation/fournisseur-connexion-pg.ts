/**
 * Connexions `pg` du rôle propriétaire (`DATABASE_URL_MIGRATION`) pour l'installation.
 *
 * Pourquoi ce rôle et pas `dfa_app` : créer un tenant est une opération d'amorçage que le RLS
 * interdit à `dfa_app` (aucune visibilité ni écriture hors d'un tenant existant). C'est le même
 * rôle que le CLI `creer-garage`, et la même fonction `creerGarage` s'exécute. Le pool est
 * minuscule, créé à la première utilisation, et plus jamais sollicité une fois le garage créé
 * (voir `ServiceInstallation`).
 */
import { Pool } from 'pg';

import type { ConnexionInstallation, FournisseurConnexionInstallation } from './installation.types';

export class FournisseurConnexionPg implements FournisseurConnexionInstallation {
  private pool: Pool | null = null;

  constructor(private readonly url: string) {}

  async emprunter(): Promise<ConnexionInstallation> {
    this.pool ??= new Pool({
      connectionString: this.url,
      max: 2,
      idleTimeoutMillis: 10_000,
      application_name: 'dfa-installation',
    });
    const client = await this.pool.connect();
    return {
      query: async (texte, valeurs) => {
        const resultat = await client.query(texte, valeurs ? [...valeurs] : undefined);
        return { rows: resultat.rows as Array<Record<string, unknown>> };
      },
      liberer: (detruire) => client.release(detruire),
    };
  }

  async fermer(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    await pool?.end();
  }
}
