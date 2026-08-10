import { type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageCurseur, ReponseTauxHoraire } from '@dfa/shared';

import { useListeCurseur } from '@/hooks/pagination-curseur';

import { clesParametrage } from './cles';
import { listerTauxHoraires } from './taux-horaires.api';

/** `GET /referentiels/taux-horaires` — pagination par curseur (`BoutonChargerPlus`), même patron
 *  que `useListeClients`. Ouvert à tout rôle authentifié (`parametrage.referentiel.lire`). */
export function useListeTauxHoraires(): UseInfiniteQueryResult<
  InfiniteData<PageCurseur<ReponseTauxHoraire>>,
  unknown
> {
  const { resultat } = useListeCurseur<ReponseTauxHoraire>({
    cle: clesParametrage.tauxHoraires.liste(),
    // Même écart `null`/`undefined` que `useListePrestations` — voir le commentaire là-bas.
    charger: (curseur) => listerTauxHoraires(curseur ?? null),
  });
  return resultat;
}
