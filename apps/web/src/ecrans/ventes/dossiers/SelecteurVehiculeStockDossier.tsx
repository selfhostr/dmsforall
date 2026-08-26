import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { VehiculeStockResume } from '@dfa/shared';

import { ErreurReseau, messageErreur } from '@/api/erreurs';
import { Input } from '@/components/ui/input';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { EtatVide } from '@/composants/commun/EtatVide';
import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { useVehiculesStockDisponibles } from '@/hooks/ventes/dossiers/useVehiculesStockDisponibles';
import { formaterMontant } from '@/lib/formats';
import { cn } from '@/lib/utils';

const DELAI_DEBOUNCE_MS = 300;

interface Props {
  readonly valeur: string | null;
  readonly onChangeValeur: (vehiculeStockId: string, vehicule: VehiculeStockResume) => void;
  readonly libelle: string;
}

/**
 * Recherche d'un véhicule EN STOCK `disponible`/`en_commande` pour l'associer à un dossier de vente
 * à la création (RV-30, optionnel dès la création) — même doctrine que `SelecteurClientDossier` :
 * radiogroup de cartes, requête bornée à 20 résultats (`useVehiculesStockDisponibles`), pas de
 * pagination dans ce sélecteur (affiner la recherche est la sortie normale).
 *
 * Périmètre : véhicules DÉJÀ mis en stock uniquement — la mise en stock elle-même
 * (`POST /vehicules/{id}/stock`) appartient à l'écran « parc en stock » d'un autre agent
 * (`ecrans/ventes/stock/**`, hors périmètre de celui-ci).
 */
export function SelecteurVehiculeStockDossier({ valeur, onChangeValeur, libelle }: Props) {
  const { t } = useTranslation(['ventes', 'commun', 'erreurs']);
  const [qSaisie, setQSaisie] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const identifiant = window.setTimeout(() => setQ(qSaisie), DELAI_DEBOUNCE_MS);
    return () => window.clearTimeout(identifiant);
  }, [qSaisie]);

  const requete = useVehiculesStockDisponibles(q);
  const vehicules = requete.data ?? [];

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        aria-label={libelle}
        placeholder={t('ventes:dossier.nouveau.vehicule.rechercherPlaceholder')}
        value={qSaisie}
        onChange={(evenement) => setQSaisie(evenement.target.value)}
      />

      {q.trim() === '' ? null : requete.isPending ? (
        <EtatChargement lignes={2} />
      ) : requete.isError ? (
        <EtatErreur
          titre={t(
            requete.error instanceof ErreurReseau
              ? 'erreurs:reseau.titre'
              : 'erreurs:inattendue.titre',
          )}
          description={messageErreur(requete.error, t)}
          onReessayer={() => void requete.refetch()}
        />
      ) : vehicules.length === 0 ? (
        <EtatVide
          titre={t('ventes:dossier.nouveau.vehicule.titre')}
          description={t('ventes:dossier.nouveau.vehicule.aucun')}
        />
      ) : (
        <div role="radiogroup" aria-label={libelle} className="flex flex-col gap-2">
          {/* DESIGN.md « bordure structurelle uniquement » — CONSERVÉE : contrôle de saisie
           *  (`role="radio"`), pas un groupe de contenu — voir le même commentaire dans
           *  `SelecteurClientDossier.tsx`. */}
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
                  'flex items-center justify-between gap-3 rounded-md border p-3 text-left transition-colors anneau-focus',
                  selectionne ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted',
                )}
              >
                <IdentiteVehicule vehicule={vehicule.vehicule} />
                {vehicule.prixVenteAfficheCentimes !== null ? (
                  <span className="texte-libelle tabular-nums text-muted-foreground">
                    {formaterMontant(vehicule.prixVenteAfficheCentimes)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
