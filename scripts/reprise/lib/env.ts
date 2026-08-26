/**
 * Chargement minimal du `.env` racine — jamais `apps/api/.env` (piège documenté dans CONTRIBUTING.md :
 * « Front ne lit que le .env racine »). Ce harnais tourne hors NestJS (`tsx` direct), donc hors du
 * pipeline `@nestjs/config` habituel : pas de dépendance à un module de config applicatif, juste de
 * quoi lire `DATABASE_URL_MIGRATION` et les deux ports (API/front) dont ce harnais a besoin.
 *
 * Ne redéfinit RIEN qui existe déjà dans `process.env` (permet de surcharger en ligne de commande :
 * `DFA_API_URL=... pnpm ...`), et ne fait AUCUNE validation zod — ce n'est pas la config de l'API,
 * seulement des valeurs de convenance pour un script d'outillage.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE_DEPOT = resolve(__dirname, '../../..');

function chargerDotenv(chemin: string): void {
  if (!existsSync(chemin)) return;
  const contenu = readFileSync(chemin, 'utf8');
  for (const ligneBrute of contenu.split('\n')) {
    const ligne = ligneBrute.trim();
    if (ligne === '' || ligne.startsWith('#')) continue;
    const indexEgal = ligne.indexOf('=');
    if (indexEgal === -1) continue;
    const cle = ligne.slice(0, indexEgal).trim();
    let valeur = ligne.slice(indexEgal + 1).trim();
    // Retire des guillemets simples/doubles englobants, s'il y en a (le .env du dépôt n'en a
    // aucun jusqu'ici, mais un futur secret pourrait en porter).
    if (
      (valeur.startsWith('"') && valeur.endsWith('"')) ||
      (valeur.startsWith("'") && valeur.endsWith("'"))
    ) {
      valeur = valeur.slice(1, -1);
    }
    if (process.env[cle] === undefined) process.env[cle] = valeur;
  }
}

chargerDotenv(resolve(RACINE_DEPOT, '.env'));

function exiger(cle: string): string {
  const valeur = process.env[cle];
  if (valeur === undefined || valeur === '') {
    throw new Error(
      `${cle} manquante — vérifier le \`.env\` racine (${resolve(RACINE_DEPOT, '.env')}) ou l'exporter avant l'appel.`,
    );
  }
  return valeur;
}

export interface ConfigHarnaisReprise {
  /** Connexion `dfa_migrator` — seule habilitée à créer/purger un tenant (opération
   *  d'exploitation, pas applicative — même doctrine que `seed-dev.ts`). */
  readonly urlMigration: string;
  /** Base HTTP de l'API NestJS (défaut : `http://localhost:3000`, port confirmé par le contexte
   *  de mission — `pnpm dev` tourne déjà). */
  readonly apiUrl: string;
  /** `Origin` à poser sur CHAQUE requête HTTP : sans lui, le garde-fou anti-CSRF de l'API rend un
   *  403 qui s'affiche comme un refus d'identifiants (piège documenté, ne pas le redécouvrir). */
  readonly origine: string;
  readonly racineDepot: string;
}

export function chargerConfig(): ConfigHarnaisReprise {
  return {
    urlMigration: exiger('DATABASE_URL_MIGRATION'),
    apiUrl: process.env['DFA_REPRISE_API_URL'] ?? 'http://localhost:3000',
    origine: process.env['DFA_REPRISE_ORIGINE'] ?? 'http://localhost:5173',
    racineDepot: RACINE_DEPOT,
  };
}
