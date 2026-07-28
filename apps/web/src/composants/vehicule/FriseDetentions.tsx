import { User } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReponseVehiculeDetention } from '@dfa/shared';

import { Badge } from '@/components/ui/badge';
import { EtatVide } from '@/composants/commun/EtatVide';
import { formaterDate } from '@/lib/formats';

export interface ProprietesFriseDetentions {
  /** Déjà triées par l'appelant (la plus récente en tête). Une seule entrée porte `finLe: null`
   *  — le détenteur courant, garanti par contrainte d'exclusion en base (RM-20/21). */
  readonly detentions: readonly ReponseVehiculeDetention[];
  readonly className?: string;
}

export function FriseDetentions({ detentions, className }: ProprietesFriseDetentions) {
  const { t } = useTranslation('vehicules');

  if (detentions.length === 0) {
    return <EtatVide titre={t('detentions.titre')} description={t('vide.detentions')} />;
  }

  return (
    <ol className={className ? `${className} flex flex-col` : 'flex flex-col'}>
      {detentions.map((detention) => {
        const courante = detention.finLe === null;
        return (
          <li
            key={detention.id}
            className="flex flex-wrap items-start gap-3 border-l-2 border-muted py-2 pl-4"
          >
            <User aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-0.5">
              <p className="texte-corps font-medium">{detention.client.nomAffiche}</p>
              <p className="texte-libelle text-muted-foreground">
                {formaterDate(detention.debutLe)}
                {' – '}
                {detention.finLe ? formaterDate(detention.finLe) : t('detentions.detenteur')}
              </p>
              {detention.motifFin ? (
                <p className="texte-libelle text-muted-foreground">
                  {t(`detentions.motifs.${detention.motifFin}`)}
                </p>
              ) : null}
            </div>
            {courante ? (
              <Badge variant="outline" className="ml-auto border-statut-succes/40 text-statut-succes">
                {t('detentions.detenteur')}
              </Badge>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
