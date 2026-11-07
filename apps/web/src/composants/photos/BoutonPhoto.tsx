import { Camera } from 'lucide-react';
import { useRef, type ChangeEvent } from 'react';

import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  readonly libelle: string;
  /** Libellé lu par les lecteurs d'écran quand plusieurs boutons « Photo » cohabitent (une ligne
   *  chacun) : le nom du travail concerné. */
  readonly libelleAccessible?: string;
  readonly onChoisie: (fichier: File) => void;
  readonly desactive?: boolean;
  readonly enCours?: boolean;
  /** Borne / écran technicien : cible tactile de 72 px, comme les autres boutons de ces écrans. */
  readonly grand?: boolean;
  readonly variant?: ButtonProps['variant'];
  readonly className?: string;
}

/**
 * Ouvre l'appareil photo (tablette, téléphone : `capture="environment"`, caméra arrière) ou, sur
 * un poste sans caméra, le choix d'un fichier image. Un fichier par prise de vue.
 */
export function BoutonPhoto({
  libelle,
  libelleAccessible,
  onChoisie,
  desactive = false,
  enCours = false,
  grand = false,
  variant = 'outline',
  className,
}: Props) {
  const entree = useRef<HTMLInputElement>(null);

  function surChoix(evenement: ChangeEvent<HTMLInputElement>) {
    const fichier = evenement.target.files?.[0];
    // Remise à zéro : reprendre la MÊME photo (échec réseau) doit redéclencher `change`.
    evenement.target.value = '';
    if (fichier) onChoisie(fichier);
  }

  return (
    <>
      <input
        ref={entree}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="entree-photo"
        onChange={surChoix}
      />
      <Button
        type="button"
        variant={variant}
        size={grand ? 'lg' : 'default'}
        className={cn(grand && 'min-h-[72px] texte-annexe', className)}
        disabled={desactive}
        enChargement={enCours}
        aria-label={libelleAccessible}
        onClick={() => entree.current?.click()}
      >
        <Camera aria-hidden="true" className="h-4 w-4" />
        {libelle}
      </Button>
    </>
  );
}
