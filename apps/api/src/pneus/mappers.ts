import type { ReponseDepotPneus } from '@dfa/shared';

import type { LigneDepotPneus } from '../db/schema';

/**
 * `Date` → ISO-8601 pour l'AFFICHAGE (jamais pour une valeur de curseur — voir
 * `common/pagination/valeur-temporelle.ts` : la précision milliseconde de `toISOString()` reste
 * appropriée ici, seule la construction du CURSEUR doit passer par `valeurCurseurTimestamptz()`).
 */
function enIso(valeur: Date | string): string {
  return valeur instanceof Date ? valeur.toISOString() : valeur;
}

/** Ligne SQL brute (colonnes aliasées `snake_case → camelCase`, voir `service-depot-pneus.ts`)
 *  → réponse de contrat. Mêmes champs que `LigneDepotPneus` (Drizzle), mais les horodatages
 *  peuvent arriver en `Date` (chargement normal) ou en `string` (relecture après `tx.execute`
 *  aliasé) — `enIso` accepte les deux. */
export function versDepotPneusResponse(ligne: LigneDepotPneus): ReponseDepotPneus {
  return {
    id: ligne.id,
    vehiculeId: ligne.vehiculeId,
    siteId: ligne.siteId,
    saison: ligne.saison,
    statut: ligne.statut,
    codeCase: ligne.codeCase,
    dimension: ligne.dimension,
    etat: ligne.etat,
    entreLe: enIso(ligne.entreLe),
    dernierMouvementLe: enIso(ligne.dernierMouvementLe),
    motifSortie: ligne.motifSortie,
    ligneOrDernierChangementId: ligne.ligneOrDernierChangementId,
    creeLe: enIso(ligne.creeLe),
    modifieLe: enIso(ligne.modifieLe),
  };
}
