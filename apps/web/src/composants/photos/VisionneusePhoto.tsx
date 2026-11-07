import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponsePhotoLigne } from '@dfa/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { urlPhoto } from '@/hooks/atelier/photos.api';
import { useSupprimerPhoto } from '@/hooks/atelier/usePhotosOr';
import { formaterDateHeure } from '@/lib/formats';

import { messageErreurPhoto } from './messages-photo';

interface Props {
  readonly orId: string;
  readonly photos: readonly ReponsePhotoLigne[];
  /** Index de la photo ouverte, `null` -> fermée. */
  readonly indexOuvert: number | null;
  readonly onIndexChange: (index: number | null) => void;
}

/** Visionneuse plein écran : la photo en grand, sa légende, précédente / suivante, suppression
 *  (confirmée en deux temps) quand le serveur dit qu'elle est supprimable. */
export function VisionneusePhoto({ orId, photos, indexOuvert, onIndexChange }: Props) {
  const { t } = useTranslation(['or', 'commun']);
  const suppression = useSupprimerPhoto(orId);
  const [confirmation, setConfirmation] = useState(false);

  const photo = indexOuvert === null ? undefined : photos[indexOuvert];

  useEffect(() => {
    setConfirmation(false);
    suppression.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset volontaire à chaque changement de photo
  }, [photo?.id]);

  // Photo supprimée (la liste rétrécit) : fermer plutôt que d'afficher un voisin sans prévenir.
  useEffect(() => {
    if (indexOuvert !== null && !photo) onIndexChange(null);
  }, [indexOuvert, photo, onIndexChange]);

  if (indexOuvert === null || !photo) return null;

  const total = photos.length;

  function supprimer() {
    if (!photo) return;
    suppression.mutate(photo.id, {
      onSuccess: () => {
        setConfirmation(false);
        if (total <= 1) onIndexChange(null);
        else onIndexChange(Math.min(indexOuvert ?? 0, total - 2));
      },
    });
  }

  return (
    <Dialog open onOpenChange={(ouvert) => (ouvert ? undefined : onIndexChange(null))}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('or:photos.visionneuse.titre')}</DialogTitle>
          <DialogDescription>
            {t('or:photos.visionneuse.position', { numero: indexOuvert + 1, total })}
            {' · '}
            {formaterDateHeure(photo.creeLe)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 p-6 pt-0">
          <img
            src={urlPhoto(photo.id)}
            alt={photo.legende ?? t('or:photos.visionneuse.sansLegende')}
            className="max-h-[60vh] w-full rounded-md bg-muted object-contain"
          />
          {photo.legende ? <p className="texte-corps">{photo.legende}</p> : null}

          {suppression.isError ? (
            <p role="alert" className="texte-libelle text-destructive">
              {messageErreurPhoto(suppression.error, t)}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={indexOuvert === 0}
                onClick={() => onIndexChange(indexOuvert - 1)}
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                {t('or:photos.visionneuse.precedente')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={indexOuvert >= total - 1}
                onClick={() => onIndexChange(indexOuvert + 1)}
              >
                {t('or:photos.visionneuse.suivante')}
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
            {photo.supprimable ? (
              confirmation ? (
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setConfirmation(false)}>
                    {t('commun:actions.annuler')}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    enChargement={suppression.isPending}
                    onClick={supprimer}
                  >
                    {t('or:photos.visionneuse.confirmerSuppression')}
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="outline" onClick={() => setConfirmation(true)}>
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                  {t('or:photos.visionneuse.supprimer')}
                </Button>
              )
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
