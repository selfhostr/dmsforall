import type { TFunction } from 'i18next';

import { messageErreur } from '@/api/erreurs';

import { ErreurPreparationPhoto } from './preparer-photo';

/** Message garagiste pour un échec de préparation ou d'envoi de photo. Le `detail` du serveur n'est
 *  jamais affiché (règle du front : uniquement le `code`, traduit) — les refus prévisibles (HEIC,
 *  trop lourde, 20 photos) sont donc détectés AVANT l'envoi par `PhotosLigne`. */
export function messageErreurPhoto(erreur: unknown, t: TFunction): string {
  if (erreur instanceof ErreurPreparationPhoto) {
    if (erreur.motif === 'trop_lourde') return t('or:photos.erreurs.tropLourde');
    if (erreur.motif === 'heic') return t('or:photos.erreurs.heic');
    return t('or:photos.erreurs.illisible');
  }
  return messageErreur(erreur, t);
}
