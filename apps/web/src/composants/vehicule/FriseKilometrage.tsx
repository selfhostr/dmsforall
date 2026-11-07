import { Gauge, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReponseVehiculeKilometrage, SourceKilometrage } from '@dfa/shared';

import { Badge } from '@/components/ui/badge';
import { EtatVide } from '@/composants/commun/EtatVide';
import { formaterDateHeure, formaterKilometrage } from '@/lib/formats';

export interface ProprietesFriseKilometrage {
  /** Déjà triés par l'appelant (tri serveur, `TRI_DEFAUT_KILOMETRAGES`) — ce composant ne
   *  retrie jamais côté client. */
  readonly releves: readonly ReponseVehiculeKilometrage[];
  readonly className?: string;
}

const CLES_SOURCE: Record<SourceKilometrage, string> = {
  reception: 'kilometrage.sources.reception',
  ordre_reparation: 'kilometrage.sources.or',
  expertise: 'kilometrage.sources.expertise',
  vente: 'kilometrage.sources.vente',
  declaratif: 'kilometrage.sources.declaratif',
  import: 'kilometrage.sources.import',
};

/**
 * Historique des relevés — APPEND-ONLY (RM-23/24/25) : un relevé faux se corrige par un nouveau
 * relevé motivé, jamais réécrit. Cette frise est purement une lecture ; elle ne recalcule ni ne
 * réordonne rien, elle affiche `valeurKm` (canonique, convertie côté serveur — CT-08) et, si la
 * saisie d'origine était en milles, la valeur d'origine en complément.
 */
export function FriseKilometrage({ releves, className }: ProprietesFriseKilometrage) {
  const { t } = useTranslation('vehicules');

  if (releves.length === 0) {
    return <EtatVide description={t('vide.kilometrage')} />;
  }

  return (
    <ol className={className ? `${className} flex flex-col` : 'flex flex-col'}>
      {releves.map((releve) => (
        <li
          key={releve.id}
          className="flex flex-wrap items-start gap-3 border-l-2 border-muted py-2 pl-4"
        >
          <Gauge aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-0.5">
            <p className="texte-corps font-medium">
              {formaterKilometrage(releve.valeurKm, 'km')}
              {releve.unite !== 'km' ? (
                <span className="ml-2 texte-libelle text-muted-foreground">
                  ({formaterKilometrage(releve.valeur, releve.unite)})
                </span>
              ) : null}
            </p>
            <p className="texte-libelle text-muted-foreground">
              {formaterDateHeure(releve.releveLe)}
            </p>
            {releve.motifRegression ? (
              <p className="flex items-center gap-1 texte-libelle font-medium text-foreground">
                <TriangleAlert aria-hidden className="h-3.5 w-3.5 shrink-0" />
                {t(`kilometrage.motifsRegression.${releve.motifRegression}`)}
              </p>
            ) : null}
          </div>
          <Badge variant="secondary" className="ml-auto">
            {t(CLES_SOURCE[releve.source])}
          </Badge>
        </li>
      ))}
    </ol>
  );
}
