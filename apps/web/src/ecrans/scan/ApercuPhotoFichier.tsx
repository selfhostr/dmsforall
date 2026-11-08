import { useEffect, useRef } from 'react';

/** Largeur max de l'aperçu dessiné : au-delà, le canevas ne gagne rien à l'écran. */
const LARGEUR_APERCU_MAX = 960;

interface Props {
  readonly fichier: File;
  readonly alt: string;
  readonly className?: string;
}

/**
 * Aperçu d'une photo dessiné sur un `<canvas>` (pas de `<img src>`, pas d'URL d'objet) : le fichier
 * est décodé par `createImageBitmap`, puis dessiné à échelle réduite en gardant son ratio réel (la
 * taille du canevas est fixée sur l'image décodée, `h-auto` garde ce ratio à l'écran). Le bitmap est
 * fermé au démontage ou au changement de fichier. Un échec de décodage n'affiche rien : le contrôle
 * qualité a déjà traité l'erreur en amont.
 *
 * `role="img"` + `aria-label` : le canevas reste annoncé comme image, avec le même texte alternatif
 * qu'un `<img alt>`.
 */
export function ApercuPhotoFichier({ fichier, alt, className }: Props) {
  const canevas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let bitmap: ImageBitmap | undefined;
    let annule = false;

    createImageBitmap(fichier)
      .then((image) => {
        if (annule) {
          image.close();
          return;
        }
        bitmap = image;
        const element = canevas.current;
        const contexte = element?.getContext('2d');
        if (!element || !contexte) return;
        const echelle = Math.min(1, LARGEUR_APERCU_MAX / image.width);
        element.width = Math.round(image.width * echelle);
        element.height = Math.round(image.height * echelle);
        contexte.drawImage(image, 0, 0, element.width, element.height);
      })
      .catch(() => undefined);

    return () => {
      annule = true;
      bitmap?.close();
    };
  }, [fichier]);

  return <canvas ref={canevas} role="img" aria-label={alt} className={className} />;
}
