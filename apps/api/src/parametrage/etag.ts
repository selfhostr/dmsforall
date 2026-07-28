/**
 * `ETag` faible sur un entier de version — partagé par `parametres-atelier` et `parametres-site`
 * (contrats-api-etape-1.md §8.2, §1.4). Volontairement PAS le même dispositif que l'`ETag`
 * d'optimistic concurrency de `GET /ordres-reparation/{id}` (§9, `If-Match` obligatoire sur son
 * `PATCH`) : ici, `ETag`/`If-None-Match` sert uniquement le cache HTTP (`staleTime` 30 min côté
 * front, §8.2 — « revalidation à coût nul »), le contrat n'impose pas `If-Match` sur
 * `PATCH /parametres-atelier` (seul `PATCH /ordres-reparation/{id}` le porte, §1.4).
 */

/** `W/"<version>"` — faible : le contenu est sémantiquement identique, pas octet pour octet. */
export function calculerEtag(version: number): string {
  return `W/"${String(version)}"`;
}

/**
 * `true` si l'en-tête `If-None-Match` (potentiellement une liste séparée par virgules, ou `*`)
 * couvre la version courante — auquel cas le contrôleur doit répondre `304` sans corps.
 */
export function ifNoneMatchSatisfait(enteteIfNoneMatch: string | undefined, version: number): boolean {
  if (!enteteIfNoneMatch) return false;
  if (enteteIfNoneMatch.trim() === '*') return true;
  const etag = calculerEtag(version);
  return enteteIfNoneMatch
    .split(',')
    .map((valeur) => valeur.trim())
    .includes(etag);
}
