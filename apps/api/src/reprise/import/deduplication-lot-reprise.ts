/**
 * Déduplication DE LOT, EN AMONT de l'écriture — pur, sans accès base.
 *
 * `detection-doublons.ts` (`apps/api/src/clients/`, PAS modifié ici — hors périmètre) compare UN
 * candidat à la fois contre la base existante ; il ne fait rien pour deux lignes DU MÊME LOT
 * SOURCE qui portent la même clé naturelle (le brief le signale explicitement : « aucune
 * déduplication à l'intérieur d'un lot »). Sans ce filtre, deux lignes source pour le même
 * `numero_origine` tenteraient toutes deux l'INSERT : la seconde échouerait sur l'index unique
 * partiel `(tenant_id, numero_origine)` (migration 0066) — pas une exception qui tue le lot
 * (même doctrine que les enums), mais un doublon-source qui mérite d'être VU, pas juste avalé par
 * la contrainte.
 *
 * `cle` : responsabilité de l'APPELANT (l'écrivain de domaine) — typiquement `numeroOrigine`
 * quand la source le porte, sinon une clé heuristique (nom normalisé + email, VIN…).
 */

export interface CandidatDedupLot<T> {
  readonly cle: string;
  readonly donnees: T;
  /** Position dans le lot source, pour une anomalie exploitable (`ligneSource`). */
  readonly ligneSource: number;
}

export interface ResultatDedupLot<T> {
  readonly retenus: readonly CandidatDedupLot<T>[];
  /** Doublons ÉCARTÉS — première occurrence gagne, les suivantes de même clé sont ici. */
  readonly ecartes: readonly CandidatDedupLot<T>[];
}

export function dedupliquerLot<T>(candidats: readonly CandidatDedupLot<T>[]): ResultatDedupLot<T> {
  const vus = new Set<string>();
  const retenus: CandidatDedupLot<T>[] = [];
  const ecartes: CandidatDedupLot<T>[] = [];
  for (const candidat of candidats) {
    if (vus.has(candidat.cle)) {
      ecartes.push(candidat);
      continue;
    }
    vus.add(candidat.cle);
    retenus.push(candidat);
  }
  return { retenus, ecartes };
}
