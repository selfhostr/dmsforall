import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { messageErreur } from '@/api/erreurs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EtatChargement } from '@/composants/commun/EtatChargement';
import { EtatErreur } from '@/composants/commun/EtatErreur';

import type { EtatSection } from './useChiffres';

interface Props<T> {
  readonly titre: string;
  readonly description?: string;
  readonly etat: EtatSection<T>;
  readonly libelleErreur: string;
  /** Rendu des données ; la section gère elle-même chargement et erreur. */
  readonly children: (donnees: T) => ReactNode;
}

/** Une section de la page Chiffres : titre, puis chargement (squelette), erreur (réessayer) ou données. */
export function CarteChiffres<T>({ titre, description, etat, libelleErreur, children }: Props<T>) {
  const { t } = useTranslation('commun');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{titre}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {etat.isPending ? (
          <EtatChargement lignes={3} />
        ) : etat.isError ? (
          <EtatErreur
            titre={libelleErreur}
            description={messageErreur(etat.error, t)}
            onReessayer={() => etat.refetch()}
          />
        ) : etat.data !== undefined ? (
          children(etat.data)
        ) : null}
      </CardContent>
    </Card>
  );
}
