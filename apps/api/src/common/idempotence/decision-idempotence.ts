/**
 * Décision pure de `ServiceIdempotence.executer` — isolée de tout accès base pour être testable
 * sans conteneur, sur le même modèle que `analyserPostureTables` (`db/acces-base.service.ts`) :
 * la requête SQL obtient des FAITS (a-t-on gagné la course d'insertion ? quelle ligne existante,
 * le cas échéant ?), cette fonction en tire le VERDICT.
 */

export interface LigneCleIdempotenceExistante {
  readonly empreinteRequete: Buffer;
  readonly statut: 'en_cours' | 'termine';
  readonly statutHttp: number | null;
  readonly reponse: unknown;
}

export type DecisionIdempotence =
  /** Clé inconnue (ou insertion gagnée) : exécuter `travail` puis mémoriser. */
  | { readonly type: 'nouvelle_execution' }
  /** Même clé, même empreinte, exécution antérieure terminée : rejouer sans ré-exécuter `travail`. */
  | { readonly type: 'rejeu'; readonly statutHttp: number; readonly corps: unknown }
  /** Même clé, empreinte DIFFÉRENTE : réutilisation fautive de la clé. */
  | { readonly type: 'conflit_empreinte' }
  /** Même clé, même empreinte, exécution antérieure ENCORE en cours (requête concurrente). */
  | { readonly type: 'requete_en_cours' }
  /**
   * Conflit à l'insertion (on a perdu la course) mais ligne introuvable à la relecture, DANS LA
   * MÊME TRANSACTION. Ne devrait jamais se produire sous "read committed" + contrainte unique
   * (voir `ServiceIdempotenceImpl.executer`) — remonté comme anomalie plutôt que retenté en
   * silence, pour ne jamais masquer un bug de concurrence par un comportement qui a l'air correct.
   */
  | { readonly type: 'anomalie' };

/**
 * @param aGagneLaCourse `true` si `insert … on conflict (…) do nothing` a inséré la ligne (donc
 *   personne d'autre ne détenait déjà cette clé au moment de l'insertion).
 * @param ligneExistante la ligne relue si `!aGagneLaCourse`, `null` sinon (ou en cas d'anomalie).
 */
export function deciderIdempotence(
  aGagneLaCourse: boolean,
  ligneExistante: LigneCleIdempotenceExistante | null,
  empreinteDemandee: Buffer,
): DecisionIdempotence {
  if (aGagneLaCourse) {
    return { type: 'nouvelle_execution' };
  }

  if (ligneExistante === null) {
    return { type: 'anomalie' };
  }

  if (!empreinteDemandee.equals(ligneExistante.empreinteRequete)) {
    return { type: 'conflit_empreinte' };
  }

  if (ligneExistante.statut === 'en_cours') {
    return { type: 'requete_en_cours' };
  }

  return { type: 'rejeu', statutHttp: ligneExistante.statutHttp ?? 500, corps: ligneExistante.reponse };
}
