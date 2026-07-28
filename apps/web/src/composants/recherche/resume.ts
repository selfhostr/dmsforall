/**
 * Lecture défensive de `ResultatRecherche.resume` (contrats-api-etape-1.md §7.5) : le contrat le
 * type volontairement en `Record<string, unknown>` (additif, dépendant de `type`) — ces
 * accesseurs évitent tout `as` non vérifié dans les composants de résultat.
 */
export function texteResume(valeur: unknown): string | null {
  return typeof valeur === 'string' && valeur.length > 0 ? valeur : null;
}

export function nombreResume(valeur: unknown): number | null {
  return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : null;
}

export function booleenResume(valeur: unknown): boolean {
  return valeur === true;
}

export function objetResume(valeur: unknown): Record<string, unknown> | null {
  return typeof valeur === 'object' && valeur !== null ? (valeur as Record<string, unknown>) : null;
}
