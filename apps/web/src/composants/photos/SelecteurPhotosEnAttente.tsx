import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NOMBRE_MAX_PHOTOS_PAR_LIGNE } from '@dfa/shared';

import { Button } from '@/components/ui/button';

import { BoutonPhoto } from './BoutonPhoto';
import { messageErreurPhoto } from './messages-photo';
import { preparerPhoto, type PhotoPreparee } from './preparer-photo';

export interface PhotoEnAttente extends PhotoPreparee {
  readonly id: string;
  readonly apercuUrl: string;
}

interface Props {
  readonly photos: readonly PhotoEnAttente[];
  readonly onChange: (photos: readonly PhotoEnAttente[]) => void;
  readonly desactive?: boolean;
}

let compteur = 0;

/**
 * Photos prises AVANT que la ligne existe (dialogue d'ajout d'un travail constaté) : elles sont
 * réduites tout de suite, gardées en mémoire avec un aperçu, et envoyées par le dialogue dès que
 * la ligne est créée. Retirer une vignette l'oublie simplement (rien n'est parti au serveur).
 */
export function SelecteurPhotosEnAttente({ photos, onChange, desactive = false }: Props) {
  const { t } = useTranslation(['or', 'commun']);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enPreparation, setEnPreparation] = useState(false);

  // Libère les URL d'aperçu quand le sélecteur disparaît (liste lue par ref : le nettoyage de
  // démontage doit voir la DERNIÈRE liste, pas celle du premier rendu).
  const dernieres = useRef(photos);
  dernieres.current = photos;
  useEffect(
    () => () => {
      for (const p of dernieres.current) URL.revokeObjectURL(p.apercuUrl);
    },
    [],
  );

  async function ajouter(fichier: File) {
    setErreur(null);
    setEnPreparation(true);
    try {
      const prete = await preparerPhoto(fichier);
      compteur += 1;
      onChange([
        ...photos,
        { ...prete, id: `attente-${compteur}`, apercuUrl: URL.createObjectURL(prete.photo) },
      ]);
    } catch (echec) {
      setErreur(messageErreurPhoto(echec, t));
    } finally {
      setEnPreparation(false);
    }
  }

  function retirer(id: string) {
    const retiree = photos.find((p) => p.id === id);
    if (retiree) URL.revokeObjectURL(retiree.apercuUrl);
    onChange(photos.filter((p) => p.id !== id));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <BoutonPhoto
          libelle={t('or:photos.ajouter')}
          onChoisie={(fichier) => void ajouter(fichier)}
          desactive={desactive || photos.length >= NOMBRE_MAX_PHOTOS_PAR_LIGNE}
          enCours={enPreparation}
        />
        {photos.length > 0 ? (
          <span className="texte-libelle text-muted-foreground">
            {t('or:photos.compteur', { count: photos.length })}
          </span>
        ) : null}
      </div>
      {photos.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t('or:photos.liste')}>
          {photos.map((photo, index) => (
            <li key={photo.id} className="relative">
              <img
                src={photo.apercuUrl}
                alt={t('or:photos.apercuAttente', { numero: index + 1 })}
                className="h-16 w-16 rounded-md bg-muted object-cover"
              />
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute -right-2 -top-2 h-11 w-11 rounded-full"
                aria-label={t('or:photos.retirer', { numero: index + 1 })}
                disabled={desactive}
                onClick={() => retirer(photo.id)}
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {erreur ? (
        <p role="alert" className="texte-libelle text-destructive">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
