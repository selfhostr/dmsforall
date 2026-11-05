import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { clesParametrage } from './cles';
import { recupererBlocCreancier, type BlocCreancier } from './bloc-creancier.api';

/** `GET /parametres-facturation/creancier` — jamais un 404 (voir `BlocCreancier`) : un tenant
 *  qui n'a encore rien saisi reçoit un objet valide, tous champs `null`. `retry: false` — même
 *  raison que `useSession` : un `403 DROIT_INSUFFISANT` (le cas attendu pour un rôle `admin`,
 *  RF-115) est une donnée stable, pas un échec transitoire à retenter trois fois en silence
 *  avant que l'écran n'affiche enfin son état de refus. `staleTime` long — même convention que
 *  `useParametresAtelier`/`useParametresPieces` : un IBAN/QR-IBAN de créancier change rarement en
 *  cours de service, pas de raison de le rafraîchir à chaque montage de l'écran de réglages. */
export function useBlocCreancier(): UseQueryResult<BlocCreancier> {
  return useQuery({
    queryKey: clesParametrage.creancier(),
    queryFn: recupererBlocCreancier,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
