import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NOMBRE_MAX_PHOTOS_PAR_LIGNE } from '@dfa/shared';

import { useAjouterPhotoLigne, usePhotosLigne } from '@/hooks/atelier/usePhotosOr';
import { useSession } from '@/hooks/useSession';

import { BoutonPhoto } from './BoutonPhoto';
import { peutAjouterPhoto } from './droits';
import { messageErreurPhoto } from './messages-photo';
import { preparerPhoto } from './preparer-photo';
import { VignettesPhotos } from './VignettesPhotos';

interface Props {
  readonly orId: string;
  readonly ligneId: string;
  /** Faux pour une ligne facturée : on regarde, on n'ajoute plus. */
  readonly modifiable?: boolean;
  /** Nom du travail, pour distinguer les boutons « Photo » des lecteurs d'écran. */
  readonly designation?: string;
  readonly grand?: boolean;
  /** Libellé du bouton, « Photo » par défaut. */
  readonly libelleBouton?: string;
}

/**
 * Photos d'UNE ligne d'OR : bouton « Photo », compteur (« 2 photos »), vignettes cliquables. Le
 * bouton n'apparaît que pour un rôle qui peut ajouter ; les vignettes se voient quel que soit le
 * rôle (lecture ouverte). Chaque photo est réduite par le navigateur avant envoi.
 */
export function PhotosLigne({
  orId,
  ligneId,
  modifiable = true,
  designation,
  grand = false,
  libelleBouton,
}: Props) {
  const { t } = useTranslation(['or', 'commun']);
  const session = useSession();
  const { photos } = usePhotosLigne(orId, ligneId);
  const ajout = useAjouterPhotoLigne(orId);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enPreparation, setEnPreparation] = useState(false);

  const peutAjouter = modifiable && peutAjouterPhoto(session.data?.actions);
  const complet = photos.length >= NOMBRE_MAX_PHOTOS_PAR_LIGNE;

  async function surChoix(fichier: File) {
    setErreur(null);
    setEnPreparation(true);
    try {
      const prete = await preparerPhoto(fichier);
      await ajout.mutateAsync({ ligneId, photo: prete.photo, vignette: prete.vignette });
    } catch (echec) {
      setErreur(messageErreurPhoto(echec, t));
    } finally {
      setEnPreparation(false);
    }
  }

  if (photos.length === 0 && !peutAjouter) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {peutAjouter ? (
          <BoutonPhoto
            libelle={libelleBouton ?? t('or:photos.bouton')}
            libelleAccessible={
              designation
                ? t('or:photos.boutonPour', { designation })
                : (libelleBouton ?? t('or:photos.bouton'))
            }
            onChoisie={(fichier) => void surChoix(fichier)}
            desactive={complet}
            enCours={enPreparation || ajout.isPending}
            grand={grand}
          />
        ) : null}
        {photos.length > 0 ? (
          <span className="texte-libelle text-muted-foreground">
            {t('or:photos.compteur', { count: photos.length })}
          </span>
        ) : null}
        {complet && peutAjouter ? (
          <span className="texte-libelle text-muted-foreground">
            {t('or:photos.complet', { max: NOMBRE_MAX_PHOTOS_PAR_LIGNE })}
          </span>
        ) : null}
      </div>
      <VignettesPhotos orId={orId} photos={photos} />
      {erreur ? (
        <p role="alert" className="texte-libelle text-destructive">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
