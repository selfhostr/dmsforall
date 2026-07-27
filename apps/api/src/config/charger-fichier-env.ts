import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Charge le fichier `.env` de la racine du monorepo dans `process.env`.
 *
 * Node ne lit AUCUN fichier `.env` de lui-même : sans cet appel, toutes les variables sans
 * valeur par défaut manquent et l'application refuse de démarrer — ce qui est le comportement
 * voulu, mais pour la mauvaise raison.
 *
 * On s'appuie sur `process.loadEnvFile` (natif depuis Node 20.12) plutôt que sur `dotenv` :
 * une dépendance de moins sur un chemin de code qui s'exécute avant toute validation.
 *
 * Le fichier est OPTIONNEL et son absence n'est pas une erreur : en production et en CI, les
 * variables viennent de l'environnement du conteneur ou du runner, jamais d'un fichier.
 * C'est aussi pourquoi cette fonction ne valide rien — la validation reste la responsabilité
 * exclusive de `chargerConfig`, qui s'applique quelle que soit l'origine des variables.
 *
 * À appeler en TOUTE PREMIÈRE instruction des points d'entrée (`main.ts`, `migrer.ts`,
 * `seed-dev.ts`, `exporter-openapi.ts`), avant `chargerConfig`.
 */
export function chargerFichierEnv(): void {
  // `src/config/` en dev via tsx, `dist/config/` après build : même profondeur dans les deux cas.
  const chemin = resolve(__dirname, '../../../..', '.env');
  if (!existsSync(chemin)) return;
  process.loadEnvFile(chemin);
}
