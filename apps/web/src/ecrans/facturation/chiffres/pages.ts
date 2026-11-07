import type { PageCurseur } from '@dfa/shared';

/** Garde-fou : au-delà, on s'arrête et on le dit (`incomplet`) plutôt que de boucler indéfiniment. */
export const PAGES_MAX = 10;
export const TAILLE_PAGE = 200;

export interface ToutesLesPages<T> {
  readonly elements: readonly T[];
  /** Vrai si la limite de pages a été atteinte alors qu'il en restait : les totaux sont des minimums. */
  readonly incomplet: boolean;
}

/** Lit une collection à curseur jusqu'au bout (ou jusqu'à `PAGES_MAX` pages). */
export async function chargerToutesLesPages<T>(
  charger: (curseur: string | undefined) => Promise<PageCurseur<T>>,
): Promise<ToutesLesPages<T>> {
  const elements: T[] = [];
  let curseur: string | undefined;
  for (let page = 0; page < PAGES_MAX; page += 1) {
    const reponse = await charger(curseur);
    elements.push(...reponse.donnees);
    if (reponse.curseurSuivant === null) {
      return { elements, incomplet: false };
    }
    curseur = reponse.curseurSuivant;
  }
  return { elements, incomplet: true };
}
