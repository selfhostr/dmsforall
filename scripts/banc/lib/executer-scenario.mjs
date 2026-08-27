/**
 * Exécuteur de scénario : rejoue la MÊME requête `n` fois avec une concurrence bornée, et
 * collecte latence + statut de chacune. Pas de bibliothèque de charge (k6/autocannon/artillery) —
 * voir README.md pour la justification : Node 22 fournit déjà `fetch` natif et un pool de
 * promesses borné tient en vingt lignes, ça n'ajoute donc aucune dépendance au dépôt.
 */
import { resumerLatences } from './stats.mjs';

/**
 * @param {object} options
 * @param {string} options.nom
 * @param {() => Promise<{statut:number, dureeMs:number}>} options.executerUneRequete
 * @param {number} options.n
 * @param {number} options.concurrence
 */
export async function executerScenario({ nom, executerUneRequete, n, concurrence }) {
  const resultats = [];
  let indexSuivant = 0;

  async function travailleur() {
    while (indexSuivant < n) {
      indexSuivant += 1;
      resultats.push(await executerUneRequete());
    }
  }

  const debutScenario = Date.now();
  await Promise.all(Array.from({ length: Math.min(concurrence, n) }, () => travailleur()));
  const dureeScenarioMs = Date.now() - debutScenario;

  const parStatut = {};
  for (const r of resultats) parStatut[r.statut] = (parStatut[r.statut] ?? 0) + 1;

  const latencesOk = resultats
    .filter((r) => r.statut >= 200 && r.statut < 300)
    .map((r) => r.dureeMs);

  return {
    nom,
    n,
    concurrence,
    dureeScenarioMs,
    parStatut,
    latences: resumerLatences(latencesOk),
  };
}
