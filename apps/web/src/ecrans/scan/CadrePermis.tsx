import { cn } from '@/lib/utils';

import type { FractionsCadre } from './geometrieCadre';

interface Props {
  /** Positionné en POURCENTAGES exacts sur la boîte rendue d'un `<img>` (voir `geometrieCadre.ts`
   *  pour pourquoi ça tombe exactement sur les mêmes points que les pixels de recadrage réels,
   *  sans mesure DOM). TOUJOURS requis : ce composant ne sert plus qu'à une chose, superposer la
   *  zone de recadrage sur une photo RÉELLEMENT prise (`PanneauRefusPhoto.tsx`). */
  readonly fractions: FractionsCadre;
  readonly className?: string;
}

/**
 * CADRE VISUEL — superposition sur la photo déjà prise, montrant exactement la zone que
 * `reduireImagePourEnvoi` recadrerait. N'existe QUE dans ce cas : plus de variante « maquette avant
 * capture » (ancien usage sans `fractions`, retiré — voir la doc de tête d'`EcranScan.tsx`, § sur
 * la confusion qu'elle provoquait). La prise de vue elle-même passe par l'appareil photo natif du
 * téléphone (plein écran, hors de notre contrôle) : un cadre affiché AVANT de déclencher n'est
 * jamais visible pendant la capture, donc ne guide personne — seul un cadre posé SUR une photo déjà
 * prise a un sens, ici.
 *
 * L'assombrissement du pourtour (`box-shadow` géant, technique courante des scanners de document)
 * dirige l'œil vers l'intérieur du cadre sans avoir besoin d'un second calque.
 */
export function CadrePermis({ fractions, className }: Props) {
  const style = {
    left: `${fractions.xFrac * 100}%`,
    top: `${fractions.yFrac * 100}%`,
    width: `${fractions.largeurFrac * 100}%`,
    height: `${fractions.hauteurFrac * 100}%`,
  };

  return (
    <div
      aria-hidden="true"
      style={style}
      className={cn(
        'pointer-events-none absolute rounded-lg border-[3px] border-primary',
        'shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]',
        className,
      )}
    />
  );
}
