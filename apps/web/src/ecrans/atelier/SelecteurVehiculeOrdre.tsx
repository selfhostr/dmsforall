import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { VehiculeResume } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Button } from '@/components/ui/button';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { useVehiculesClient } from '@/hooks/clients/useVehiculesClient';
import { cn } from '@/lib/utils';

import { FormulaireVehiculeRapide } from './creation-rapide/FormulaireVehiculeRapide';

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
 * Client sans véhicule : plus de cul-de-sac. « Ajouter un véhicule » ouvre sur place un formulaire
 * minimal (plaque, marque, modèle — `FormulaireVehiculeRapide`), le véhicule est rattaché au client
 * et choisi aussitôt. Même action disponible sous la liste quand le client en a déjà (l'OR peut viser
 * un véhicule neuf pour lui).
 */
export function SelecteurVehiculeOrdre({ clientId, valeur, onChangeValeur }: Props) {
  const { t } = useTranslation(['or', 'commun', 'erreurs']);
  const requete = useVehiculesClient(clientId);
  const [ajoutOuvert, setAjoutOuvert] = useState(false);

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

  const formulaireAjout = ajoutOuvert ? (
    <FormulaireVehiculeRapide
      clientId={clientId}
      onAnnuler={() => setAjoutOuvert(false)}
      onCree={(vehicule) => {
        setAjoutOuvert(false);
        onChangeValeur(vehicule.id, vehicule);
      }}
    />
  ) : null;

  if (vehicules.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {formulaireAjout ?? (
          <EtatVide
            titre={t('or:nouveau.vehicule.titre')}
            description={t('or:nouveau.vehicule.aucun')}
            action={
              <Button type="button" onClick={() => setAjoutOuvert(true)}>
                <Plus aria-hidden className="h-4 w-4" />
                {t('or:nouveau.vehicule.ajouter.action')}
              </Button>
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        role="radiogroup"
        aria-label={t('or:nouveau.vehicule.titre')}
        className="flex flex-col gap-2"
      >
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
      {formulaireAjout ?? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => setAjoutOuvert(true)}
        >
          <Plus aria-hidden className="h-4 w-4" />
          {t('or:nouveau.vehicule.ajouter.action')}
        </Button>
      )}
    </div>
  );
}
