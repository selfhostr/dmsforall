import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ModuleApp } from '@dfa/shared';

import { messageErreur } from '@/api/erreurs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { EtatErreur } from '@/composants/commun/EtatErreur';
import { ListeModules } from '@/ecrans/parametrage/ListeModules';
import { usePeut } from '@/droits';
import { useModifierModules } from '@/hooks/parametrage/useModifierModules';
import { useModules } from '@/hooks/parametrage/useModules';

import { PiedEtape } from '../PiedEtape';
import type { PropsEtape } from '../types-etape';

/**
 * Étape 2 — Ce que vous utilisez. Les mêmes interrupteurs que Réglages > Modules, et le même
 * réglage (`PATCH /parametres-entreprise/modules`). Tout est activé au départ ; rien n'est écrit si
 * la personne ne touche à rien.
 */
export function EtapeModules({ onSuivant, onRetour, onPasser }: PropsEtape) {
  const { t } = useTranslation(['assistant', 'parametrage', 'erreurs']);
  const requete = useModules();
  const modifier = useModifierModules();
  const peutModifier = usePeut('parametrage.modules.modifier');
  const [choix, setChoix] = useState<readonly ModuleApp[] | undefined>(undefined);

  if (requete.isPending) {
    return (
      <div role="status" aria-label={t('assistant:chargement')} className="space-y-3">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }
  if (requete.isError) {
    return (
      <EtatErreur
        titre={t('assistant:erreur.titre')}
        description={messageErreur(requete.error, t)}
        onReessayer={() => void requete.refetch()}
      />
    );
  }

  const enregistres = requete.data.modulesDesactives;
  const desactives = choix ?? enregistres;
  const modifie = choix !== undefined && choix.join() !== enregistres.join();

  function soumettre(evenement: FormEvent) {
    evenement.preventDefault();
    if (!modifie) {
      onSuivant();
      return;
    }
    modifier.mutate({ modulesDesactives: [...desactives] }, { onSuccess: onSuivant });
  }

  return (
    <form onSubmit={soumettre} className="flex flex-col gap-5">
      <ListeModules
        desactives={desactives}
        desactiveTout={modifier.isPending}
        lectureSeule={!peutModifier}
        onChange={setChoix}
      />
      {peutModifier ? null : (
        <p className="texte-corps text-foreground">{t('parametrage:modules.lectureSeule')}</p>
      )}
      {modifier.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t('assistant:erreur.enregistrement')} {messageErreur(modifier.error, t)}
          </AlertDescription>
        </Alert>
      ) : null}
      <PiedEtape onRetour={onRetour} onPasser={onPasser} enCours={modifier.isPending} />
    </form>
  );
}
