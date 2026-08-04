import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { VehiculeResume } from '@dfa/shared';

import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useListeVehicules } from '@/hooks/vehicules/useListeVehicules';
import { messageErreur } from '@/api/erreurs';
import { cn } from '@/lib/utils';

const DELAI_ANTI_REBOND_MS = 300;

interface Props {
  readonly valeur: string | null;
  readonly onChangeValeur: (vehiculeId: string, vehicule: VehiculeResume) => void;
  readonly erreur?: string;
}

/**
 * Sélection du véhicule repris parmi les véhicules DÉJÀ connus de DFA — recherche par
 * plaque/désignation (`GET /vehicules?q=`), même patron de recherche anti-rebond que
 * `useRechercheComptoir` (300ms), rendu radiogroup identique à
 * `ecrans/atelier/SelecteurVehiculeOrdre.tsx` (invariant n°1, `IdentiteVehicule`).
 *
 * LIMITE CONNUE, signalée (§8.1 du design : « référence à un véhicule existant OU nouvellement
 * créé ») : ce composant ne couvre QUE le cas « véhicule déjà connu ». La création à la volée
 * d'un véhicule pas encore enregistré n'est pas câblée ici — `/vehicules/nouveau` n'a pas de route
 * indépendante à ce jour (même constat que `SelecteurVehiculeOrdre.tsx`, ligne 28 : proposer un
 * lien mènerait sur un 404). À combler quand cette route existera.
 */
export function SelecteurVehiculeRepris({ valeur, onChangeValeur, erreur }: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'erreurs']);
  const [saisie, setSaisie] = useState('');
  const [termeDebounce, setTermeDebounce] = useState('');

  useEffect(() => {
    const identifiant = window.setTimeout(
      () => setTermeDebounce(saisie.trim()),
      DELAI_ANTI_REBOND_MS,
    );
    return () => window.clearTimeout(identifiant);
  }, [saisie]);

  const requete = useListeVehicules({ q: termeDebounce, tri: 'plaque:asc' });
  const rechercheActive = termeDebounce.length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="reprise-vehicule-recherche">
        {t('ventes:reprise.creation.champVehicule')} *
      </Label>
      <Input
        id="reprise-vehicule-recherche"
        placeholder={t('ventes:reprise.creation.champVehiculePlaceholder')}
        value={saisie}
        onChange={(evenement) => setSaisie(evenement.target.value)}
        aria-invalid={erreur ? true : undefined}
      />

      {!rechercheActive ? (
        <p className="texte-libelle text-muted-foreground">
          {t('ventes:reprise.creation.champVehiculeIndication')}
        </p>
      ) : requete.isLoading ? (
        <EtatChargement lignes={2} />
      ) : requete.isError ? (
        <p className="texte-libelle text-destructive" role="alert">
          {messageErreur(requete.error, t)}
        </p>
      ) : requete.vehicules.length === 0 ? (
        <EtatVide
          titre={t('ventes:reprise.creation.champVehicule')}
          description={t('ventes:reprise.creation.aucunVehiculeTrouve')}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <div
            role="radiogroup"
            aria-label={t('ventes:reprise.creation.champVehicule')}
            className="flex max-h-64 flex-col gap-2 overflow-y-auto"
          >
            {requete.vehicules.map((vehicule) => {
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
                  <IdentiteVehicule vehicule={vehicule} taillePlaque="sm" />
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
      )}

      {erreur ? (
        <p className="texte-libelle text-destructive" role="alert">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
