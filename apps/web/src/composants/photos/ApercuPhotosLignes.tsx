import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { listerPhotosOr } from '@/hooks/atelier/photos.api';
import { clePhotosOr } from '@/hooks/atelier/usePhotosOr';

import { VignettesPhotos } from './VignettesPhotos';

interface Props {
  readonly orId: string;
  readonly ligneIds: readonly string[];
}

/** Photos des lignes concernées, en lecture seule — sous les yeux de qui décide (accord du
 *  client, devis complémentaire). Ne rend rien s'il n'y en a aucune. */
export function ApercuPhotosLignes({ orId, ligneIds }: Props) {
  const { t } = useTranslation('or');
  const requete = useQuery({
    queryKey: clePhotosOr(orId),
    queryFn: () => listerPhotosOr(orId),
    staleTime: 30_000,
    retry: false,
    select: (toutes) => toutes.filter((photo) => ligneIds.includes(photo.ligneId)),
  });
  const photos = requete.data ?? [];
  if (photos.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="texte-libelle text-muted-foreground">
        {t('photos.apercuDevis', { count: photos.length })}
      </p>
      <VignettesPhotos orId={orId} photos={photos} />
    </div>
  );
}
