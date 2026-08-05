import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { VehiculeResume } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatVide } from '@/composants/commun/EtatVide';
import { BoutonChargerPlus } from '@/composants/comptoir/BoutonChargerPlus';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { useListeVehicules } from '@/hooks/vehicules/useListeVehicules';
import { cn } from '@/lib/utils';

const DELAI_ANTI_REBOND_MS = 300;

interface Props {
  readonly valeur: string | null;
  readonly onChangeValeur: (vehicule: VehiculeResume) => void;
}

/**
 * Sélection du véhicule pour lequel entrer un jeu en dépôt (RPP-01 : `vehiculeId` obligatoire) —
 * même patron que `ecrans/ventes/reprises/SelecteurVehiculeRepris.tsx` (recherche `GET
 * /vehicules?q=`, anti-rebond 300ms, `IdentiteVehicule`), copié plutôt qu'importé : ce périmètre
 * (`ecrans/pneus/**`) ne dépend pas d'un fichier propriété d'un autre agent (`ecrans/ventes/**`).
 */
export function SelecteurVehiculePourDepot({ valeur, onChangeValeur }: Props) {
  const { t } = useTranslation(['pneus', 'commun', 'erreurs']);
  const [saisie, setSaisie] = useState('');
  const [termeDebounce, setTermeDebounce] = useState('');

  useEffect(() => {
    const identifiant = window.setTimeout(
      () => setTermeDebounce(saisie.trim()),
      DELAI_ANTI_REBOND_MS,
    );
    return () => window.clearTimeout(identifiant);
  }, [saisie]);

  const rechercheActive = termeDebounce.length > 0;
  const requete = useListeVehicules(
    { q: termeDebounce, tri: 'plaque:asc' },
    { enabled: rechercheActive },
  );

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="depot-pneu-vehicule-recherche">{t('pneus:creation.champVehicule')} *</Label>
      <Input
        id="depot-pneu-vehicule-recherche"
        placeholder={t('pneus:creation.champVehiculePlaceholder')}
        value={saisie}
        onChange={(evenement) => setSaisie(evenement.target.value)}
      />

      {!rechercheActive ? (
        <p className="texte-libelle text-muted-foreground">
          {t('pneus:creation.champVehiculeIndication')}
        </p>
      ) : requete.isLoading ? (
        <EtatChargement lignes={2} />
      ) : requete.isError ? (
        <p className="texte-libelle text-destructive" role="alert">
          {messageErreur(requete.error, t)}
        </p>
      ) : requete.vehicules.length === 0 ? (
        <EtatVide
          titre={t('pneus:creation.champVehicule')}
          description={t('pneus:creation.aucunVehiculeTrouve')}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <div
            role="radiogroup"
            aria-label={t('pneus:creation.champVehicule')}
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
                  onClick={() => onChangeValeur(vehicule)}
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
    </div>
  );
}
