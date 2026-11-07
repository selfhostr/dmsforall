import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReponsePhotoLigne } from '@dfa/shared';

import { urlVignettePhoto } from '@/hooks/atelier/photos.api';

import { VisionneusePhoto } from './VisionneusePhoto';

interface Props {
  readonly orId: string;
  readonly photos: readonly ReponsePhotoLigne[];
}

/** Rangée de vignettes cliquables (cible 44 px) ; un clic ouvre la visionneuse plein écran. */
export function VignettesPhotos({ orId, photos }: Props) {
  const { t } = useTranslation('or');
  const [indexOuvert, setIndexOuvert] = useState<number | null>(null);

  if (photos.length === 0) return null;

  return (
    <>
      <ul className="flex flex-wrap gap-2" aria-label={t('photos.liste')}>
        {photos.map((photo, index) => (
          <li key={photo.id}>
            <button
              type="button"
              className="block h-11 w-11 overflow-hidden rounded-md bg-muted anneau-focus"
              aria-label={t('photos.ouvrir', { numero: index + 1, total: photos.length })}
              onClick={() => setIndexOuvert(index)}
            >
              <img
                src={urlVignettePhoto(photo.id)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          </li>
        ))}
      </ul>
      <VisionneusePhoto
        orId={orId}
        photos={photos}
        indexOuvert={indexOuvert}
        onIndexChange={setIndexOuvert}
      />
    </>
  );
}
