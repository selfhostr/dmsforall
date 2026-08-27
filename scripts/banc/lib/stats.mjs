/**
 * Statistiques de latence — percentiles au rang le plus proche (« nearest-rank »).
 *
 * Pas d'interpolation linéaire : sur des échantillons de quelques dizaines de mesures (ce que ce
 * banc produit par scénario), l'interpolation donne une fausse précision. Le rang le plus proche
 * est la méthode la plus simple à vérifier à la main sur un petit tableau trié, et c'est celle
 * qu'on veut ici — un banc de mesure dont on ne peut pas re-vérifier le calcul à l'œil ne sert à
 * rien.
 */

/** @param {readonly number[]} valeurs @param {number} p */
export function percentile(valeurs, p) {
  if (valeurs.length === 0) return null;
  const triees = [...valeurs].sort((a, b) => a - b);
  const rang = Math.ceil((p / 100) * triees.length);
  const index = Math.min(Math.max(rang - 1, 0), triees.length - 1);
  return triees[index];
}

/** @param {readonly number[]} latencesMs */
export function resumerLatences(latencesMs) {
  if (latencesMs.length === 0) {
    return { n: 0, min: null, p50: null, p95: null, p99: null, max: null, moyenne: null };
  }
  const somme = latencesMs.reduce((a, b) => a + b, 0);
  return {
    n: latencesMs.length,
    min: Math.min(...latencesMs),
    p50: percentile(latencesMs, 50),
    p95: percentile(latencesMs, 95),
    p99: percentile(latencesMs, 99),
    max: Math.max(...latencesMs),
    moyenne: Math.round((somme / latencesMs.length) * 10) / 10,
  };
}

/** Arrondit à l'entier le plus proche pour un affichage en ms — jamais de décimales trompeuses. */
export function ms(valeur) {
  return valeur === null ? '—' : `${Math.round(valeur)}`;
}
