import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import type { ModeleCapacites } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Skeleton } from '@/components/ui/skeleton';
import { EtatErreur } from '@/composants/commun/EtatErreur';

import { EditeurGrilleCapacites } from './EditeurGrilleCapacites';
import type { EtatGrilleEditable } from './useGrilleEditable';

interface Props {
  readonly requete: UseQueryResult<ModeleCapacites>;
  readonly etat: EtatGrilleEditable;
  readonly erreursChamp?: Readonly<Record<string, string>>;
}

/** « Qui peut quoi » avec ses trois états : chargement (squelettes), erreur (réessayer), grille. */
export function SectionQuiPeutQuoi({ requete, etat, erreursChamp }: Props) {
  const { t } = useTranslation(['capacites', 'erreurs']);

  if (requete.isPending) {
    return (
      <div
        className="flex flex-col gap-2"
        role="status"
        aria-label={t('capacites:editeur.chargement')}
      >
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (requete.isError) {
    return (
      <EtatErreur
        titre={t('capacites:editeur.erreurTitre')}
        description={messageErreur(requete.error, t)}
        onReessayer={() => void requete.refetch()}
      />
    );
  }
  return <EditeurGrilleCapacites modele={requete.data} etat={etat} erreursChamp={erreursChamp} />;
}
