import { describe, expect, it } from 'vitest';

import { requetesAmorcageRoles } from './amorcer-roles';

const guillemets = (v: string): string => `'${v.replace(/'/g, "''")}'`;
const identifiant = (v: string): string => `"${v}"`;

describe('requetesAmorcageRoles', () => {
  const requetes = requetesAmorcageRoles(
    { baseDeDonnees: 'dfa', motDePasseApp: "a'b", motDePasseMigrator: 'mig' },
    guillemets,
    identifiant,
  );

  it('crée les deux rôles sans superutilisateur ni contournement de la RLS', () => {
    const creations = requetes.filter((r) => r.includes('CREATE ROLE'));
    expect(creations).toHaveLength(2);
    for (const creation of creations) {
      expect(creation).toContain('NOSUPERUSER');
      expect(creation).toContain('NOBYPASSRLS');
    }
  });

  it('réaligne les mots de passe, échappés, à chaque démarrage', () => {
    expect(requetes).toContain(
      "ALTER ROLE dfa_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'a''b'",
    );
    expect(requetes.some((r) => r.includes("PASSWORD 'mig'"))).toBe(true);
  });

  it('donne le schéma public au migrateur et le retire à PUBLIC', () => {
    expect(requetes).toContain('ALTER SCHEMA public OWNER TO dfa_migrator');
    expect(requetes).toContain('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    expect(requetes).toContain('GRANT CREATE ON DATABASE "dfa" TO dfa_migrator');
  });
});
