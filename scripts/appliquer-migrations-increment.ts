/**
 * Aide programmatique pour verifier-reversibilite-migrations.sh — jamais utilisée ailleurs.
 *
 * `migrer.ts` (apps/api/src/db/migrer.ts) applique TOUTES les migrations non encore suivies
 * trouvées dans SON répertoire par défaut (apps/api/src/db/migrations/), en une seule passe : sa
 * CLI (`pnpm db:migrate`) ne permet pas d'en appliquer une seule à la fois. Pour vérifier chaque
 * migration individuellement (voir l'en-tête du script appelant pour l'arbitrage), il faut pouvoir
 * exposer les migrations UNE PAR UNE à `appliquerMigrations` — sa fonction exportée accepte déjà
 * une option `repertoire`, documentée dans son propre en-tête comme le point d'entrée « programme »
 * (déjà utilisé ainsi par les tests d'intégration). Ce fichier se contente d'appeler cette
 * fonction sur un répertoire choisi par l'appelant — une COPIE de travail jetable, jamais
 * apps/api/src/db/migrations/ directement — sans toucher une seule ligne de migrer.ts.
 *
 * Usage : pnpm --filter @dfa/api exec tsx <chemin absolu de ce fichier> <répertoire>
 * Lit DATABASE_URL_MIGRATION dans l'environnement (déjà validée par le script appelant).
 */

import { appliquerMigrations } from '../apps/api/src/db/migrer';

async function principal(): Promise<void> {
  const repertoire = process.argv[2];
  if (repertoire === undefined || repertoire === '') {
    throw new Error('Usage : tsx appliquer-migrations-increment.ts <répertoire>');
  }
  const urlMigration = process.env.DATABASE_URL_MIGRATION;
  if (urlMigration === undefined || urlMigration === '') {
    throw new Error('DATABASE_URL_MIGRATION manquante dans l’environnement.');
  }

  // Pas de garde « au moins une migration appliquée » ici : le tout premier appel du script
  // appelant sert exprès à faire créer __dfa_migrations par appliquerMigrations() (fait
  // inconditionnellement, avant la boucle sur les fichiers) sur un répertoire encore VIDE, pour
  // que le dump « avant toute migration » inclue déjà cette table d'infrastructure — sinon la
  // comparaison down/avant de la toute première migration verrait apparaître __dfa_migrations à
  // tort comme une différence imputable à cette migration, alors que ce n'est pas de son ressort.
  await appliquerMigrations({
    urlMigration,
    repertoire,
    journaliser: (message: string) => process.stdout.write(`  ${message}\n`),
  });
}

principal().catch((erreur: unknown) => {
  const message = erreur instanceof Error ? erreur.message : String(erreur);
  process.stderr.write(`Échec : ${message}\n`);
  process.exitCode = 1;
});
