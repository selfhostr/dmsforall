/**
 * Garde structurelle pour le correctif 0036 (500 réel, confirmé par requête HTTP et log Postgres :
 * créer une ligne d'OR de type `remise` seule sur un OR neuf faisait échouer
 * `ordre_reparation_total_valide_chk check (total_valide_centimes >= 0)`).
 *
 * Ce test ne remplace PAS une preuve d'intégration sur vraie base (déjà assurée par
 * `test/lot1/metier-arithmetique-totaux-or.spec.ts`, hors périmètre d'écriture ici) : il vérifie,
 * statiquement et rapidement (aucune base requise), que :
 *   1. la migration montante 0036 supprime bien la contrainte fautive ;
 *   2. la migration descendante la restaure MOT POUR MOT (réversibilité, cf.
 *      `scripts/verifier-reversibilite-migrations.sh`) ;
 *   3. AUCUNE migration ultérieure ne la réintroduit en silence — c'est le scénario de régression
 *      qu'un test purement applicatif (mocks, sans Postgres réel) ne peut PAS détecter, puisque le
 *      défaut corrigé ici vivait entièrement dans une contrainte SQL, jamais dans le code service.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOSSIER_MIGRATIONS = join(__dirname);
const DOSSIER_DOWN = join(__dirname, 'down');

const NOM_CONTRAINTE = 'ordre_reparation_total_valide_chk';

function contenu(dossier: string, fichier: string): string {
  return readFileSync(join(dossier, fichier), 'utf8');
}

describe('0036 — total_valide_centimes peut être transitoirement négatif', () => {
  it('la migration montante supprime la contrainte ordre_reparation_total_valide_chk', () => {
    const montante = contenu(DOSSIER_MIGRATIONS, '0036_ordre_reparation_total_valide_negatif.sql');
    expect(montante).toMatch(/drop constraint\s+ordre_reparation_total_valide_chk/i);
  });

  it("la migration descendante réajoute la contrainte D'ORIGINE (>= 0), mot pour mot", () => {
    const descendante = contenu(
      DOSSIER_DOWN,
      '0036_ordre_reparation_total_valide_negatif.down.sql',
    );
    expect(descendante).toMatch(
      /add constraint ordre_reparation_total_valide_chk check \(total_valide_centimes >= 0\)/i,
    );
  });

  it(
    'aucune migration postérieure à 0036 ne réintroduit une contrainte >= 0 sur ' +
      'total_valide_centimes (régression silencieuse que seul un test structurel détecte : le ' +
      'défaut vivait dans le SQL, pas dans le code service)',
    () => {
      const fichiers = readdirSync(DOSSIER_MIGRATIONS).filter(
        (nom) => nom.endsWith('.sql') && /^\d{4}_/.test(nom) && Number(nom.slice(0, 4)) > 36,
      );

      for (const fichier of fichiers) {
        const texte = contenu(DOSSIER_MIGRATIONS, fichier);
        expect(
          texte,
          `${fichier} réintroduit ${NOM_CONTRAINTE} (>= 0) — régression du correctif 0036`,
        ).not.toMatch(/total_valide_centimes\s*>=\s*0/i);
      }
    },
  );

  it('la table porte désormais un commentaire de colonne expliquant pourquoi une valeur négative est légitime', () => {
    const montante = contenu(DOSSIER_MIGRATIONS, '0036_ordre_reparation_total_valide_negatif.sql');
    expect(montante).toMatch(
      /comment on column public\.ordre_reparation\.total_valide_centimes is/i,
    );
    expect(montante).toMatch(/transitoirement négatif/i);
  });
});
