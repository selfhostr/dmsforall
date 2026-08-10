import { type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageCurseur, ReponsePrestation } from '@dfa/shared';

import { useListeCurseur } from '@/hooks/pagination-curseur';

import { clesParametrage } from './cles';
import { listerPrestations } from './prestations.api';

/** `GET /referentiels/prestations` — pagination par curseur, même patron que
 *  `useListeTauxHoraires`. */
export function useListePrestations(): UseInfiniteQueryResult<
  InfiniteData<PageCurseur<ReponsePrestation>>,
  unknown
> {
  const { resultat } = useListeCurseur<ReponsePrestation>({
    cle: clesParametrage.prestations.liste(),
    // `listerPrestations` attend `string | null` (« pas de curseur » y est écrit `null`) là où le
    // patron partagé écrit `undefined` — les deux sont traités à l'identique par cette API, qui
    // teste la valeur en truthiness.
    charger: (curseur) => listerPrestations(curseur ?? null),
  });
  return resultat;
}
