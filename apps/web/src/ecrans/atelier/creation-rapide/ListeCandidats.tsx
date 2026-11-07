import { History, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import type { CandidatVehicule } from './candidats';

export function LigneVehicule({ vehicule }: { readonly vehicule: CandidatVehicule }) {
  const { t } = useTranslation('or');
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      {vehicule.plaque ? (
        <span className="inline-flex h-6 w-fit items-center rounded border border-input bg-muted px-1.5 texte-corps font-semibold tabular-nums text-foreground">
          {vehicule.plaque}
        </span>
      ) : null}
      <span className="texte-corps font-medium text-foreground">{vehicule.designation}</span>
      {vehicule.detenteurNom ? (
        <span className="texte-libelle text-muted-foreground">{vehicule.detenteurNom}</span>
      ) : null}
      {vehicule.orOuvert ? (
        <Badge variant="secondary" className="gap-1">
          <Wrench aria-hidden className="h-3 w-3" />
          {t('nouveau.rapide.orDejaOuvert')}
        </Badge>
      ) : null}
      {vehicule.plaqueHistorique ? (
        <Badge variant="secondary" className="gap-1">
          <History aria-hidden className="h-3 w-3" />
          {t('nouveau.rapide.anciennePlaque')}
        </Badge>
      ) : null}
    </span>
  );
}

interface Props {
  readonly libelle: string;
  readonly candidats: readonly CandidatVehicule[];
  readonly onChoisir: (candidat: CandidatVehicule) => void;
}

/** Radiogroup de cartes (même geste que `SelecteurVehiculeOrdre`) : comparer des plaques. */
export function ListeCandidats({ libelle, candidats, onChoisir }: Props) {
  return (
    <div role="radiogroup" aria-label={libelle} className="flex flex-col gap-2">
      {candidats.map((candidat) => (
        <button
          key={candidat.id}
          type="button"
          role="radio"
          aria-checked={false}
          onClick={() => onChoisir(candidat)}
          className={cn(
            'flex min-h-11 items-center justify-between gap-3 rounded-md border border-input p-3 text-left transition-colors hover:bg-muted',
          )}
        >
          <LigneVehicule vehicule={candidat} />
        </button>
      ))}
    </div>
  );
}
