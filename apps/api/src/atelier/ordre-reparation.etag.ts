/**
 * `ETag` faible d'un ordre de réparation (contrats-api-etape-1.md §9) — dérivé de
 * `ordre_reparation.version`, entier monotone incrémenté par trigger sur les colonnes d'EN-TÊTE
 * seulement (Δ2, `migrations/0008_atelier.sql`). `PATCH /ordres-reparation/{id}` exige
 * `If-Match: W/"<version>"` ; les autres endpoints qui rendent le document complet (transitions,
 * actions groupées de lignes) posent aussi cet en-tête pour que le client puisse chaîner un
 * `PATCH` sans relire.
 *
 * VOLONTAIREMENT une copie locale, pas un import de `parametrage/etag.ts` : ce module documente
 * lui-même (`calculerEtag`) qu'il sert un dispositif DIFFÉRENT (cache HTTP `If-None-Match`/`304`),
 * pas l'optimistic concurrency de `If-Match` — les confondre serait le bug, pas la duplication.
 */
export function etagOrdreReparation(version: number): string {
  return `W/"${String(version)}"`;
}
