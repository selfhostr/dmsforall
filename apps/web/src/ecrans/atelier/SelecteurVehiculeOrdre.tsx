import { useTranslation } from 'react-i18next';

import type { VehiculeResume } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { useVehiculesClient } from '@/hooks/clients/useVehiculesClient';
import { cn } from '@/lib/utils';

interface Props {
  readonly clientId: string;
  readonly valeur: string | null;
  readonly onChangeValeur: (vehiculeId: string, vehicule: VehiculeResume) => void;
}

/**
 * Sélection du véhicule parmi ceux DÉTENUS par le client choisi (`GET /clients/{id}/vehicules`,
 * détentions ouvertes uniquement — RM-20) : `vehiculeId` n'arrive jamais pré-rempli dans l'URL
 * (seuls `clientId`/`site` le sont, voir `EcranFicheClient.tsx`), donc ce choix est TOUJOURS à
 * faire au comptoir, contrairement au client. Radiogroup de cartes plutôt qu'un `<select>` : le
 * réceptionnaire compare des plaques et des désignations, pas des libellés texte dans une liste
 * déroulante — mêmes variantes d'identité que partout ailleurs (`IdentiteVehicule`, invariant n°1).
 *
 * Aucune action « créer un véhicule » sur l'état vide : `/vehicules/nouveau` n'a pas encore de
 * route câblée (voir `routes/routeur.tsx`) — proposer un lien y mènerait sur un 404, pire que pas
 * de lien du tout (même principe que `EcranFonctionAVenir` : jamais un lien cassé).
 */
export function SelecteurVehiculeOrdre({ clientId, valeur, onChangeValeur }: Props) {
  const { t } = useTranslation(['or', 'commun', 'erreurs']);
  const requete = useVehiculesClient(clientId);

  if (requete.isPending) {
    return <EtatChargement lignes={2} />;
  }

  if (requete.isError) {
    const estErreurReseau = requete.error instanceof ErreurReseau;
    return (
      <EtatErreur
        titre={t(estErreurReseau ? 'erreurs:reseau.titre' : 'or:nouveau.vehicule.erreur')}
        description={messageErreur(requete.error, t)}
        onReessayer={() => void requete.refetch()}
      />
    );
  }

  const vehicules = requete.data.pages.flatMap((page) => page.donnees);

  if (vehicules.length === 0) {
    return <EtatVide titre={t('or:nouveau.vehicule.titre')} description={t('or:nouveau.vehicule.aucun')} />;
  }

  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label={t('or:nouveau.vehicule.titre')} className="flex flex-col gap-2">
        {vehicules.map((vehicule) => {
          const selectionne = vehicule.id === valeur;
          return (
            <button
              key={vehicule.id}
              type="button"
              role="radio"
              aria-checked={selectionne}
              onClick={() => onChangeValeur(vehicule.id, vehicule)}
              className={cn(
                'flex items-center justify-between gap-3 rounded-md border p-3 text-left transition-colors',
                selectionne ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted',
              )}
            >
              <IdentiteVehicule vehicule={vehicule} />
            </button>
          );
        })}
      </div>
      <BoutonChargerPlus
        aChargerPlus={Boolean(requete.hasNextPage)}
        enChargement={requete.isFetchingNextPage}
        onChargerPlus={() => void requete.fetchNextPage()}
      />
    </div>
  );
}
