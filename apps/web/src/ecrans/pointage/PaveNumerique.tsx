import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const CHIFFRES_HAUT: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

interface Props {
  /** Nombre de chiffres déjà saisis — n'affiche JAMAIS le code lui-même (RM-126 côté écran : un
   *  PIN ne s'affiche pas en clair), seulement des pastilles pleines/vides. */
  readonly longueur: number;
  readonly longueurMax: number;
  /** `true` pendant une vérification serveur ou un verrouillage anti-balayage (423) — désactive
   *  TOUTES les touches, y compris « Effacer », le temps que l'appelant tranche. */
  readonly desactive: boolean;
  readonly onChiffre: (chiffre: string) => void;
  readonly onEffacer: () => void;
  readonly onValider: () => void;
  readonly className?: string;
}

/**
 * Pavé numérique tactile de la borne d'atelier — cibles larges (`h-20 w-20`, bien au-delà du
 * minimum 44px déjà appliqué au reste du produit) pour un doigt ganté ou mouillé. Composant
 * PUREMENT présentationnel et contrôlé : `EcranBornePointage.tsx` porte tout l'état (code saisi,
 * écoute du clavier physique) — voir son en-tête pour pourquoi la saisie au clavier physique n'est
 * PAS gérée ici (un seul point d'écoute pour tout l'écran, pas un par instance de ce pavé).
 *
 * Le code n'est JAMAIS rendu à l'écran : seules des pastilles pleines/vides matérialisent la
 * progression (0 à `longueurMax` chiffres saisis), lisibles à distance sur un mur d'atelier sans
 * révéler le PIN à quiconque regarde par-dessus l'épaule du technicien.
 */
export function PaveNumerique({
  longueur,
  longueurMax,
  desactive,
  onChiffre,
  onEffacer,
  onValider,
  className,
}: Props) {
  const { t } = useTranslation('pointage');
  const peutValider = longueur === longueurMax;

  return (
    <div className={cn('flex flex-col items-center gap-8', className)}>
      <div className="flex items-center gap-4" aria-hidden="true">
        {Array.from({ length: longueurMax }, (_, index) => (
          <span
            key={index}
            className={cn(
              'h-6 w-6 rounded-full border-2 transition-colors',
              index < longueur ? 'border-foreground bg-foreground' : 'border-muted-foreground',
            )}
          />
        ))}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {t('pointage:identification.pave.chiffresSaisis', { compte: longueur, total: longueurMax })}
      </span>

      <div className="grid grid-cols-3 gap-4">
        {CHIFFRES_HAUT.map((chiffre) => (
          <Button
            key={chiffre}
            type="button"
            variant="outline"
            className="h-20 w-20 texte-chiffre-geant"
            disabled={desactive}
            aria-label={t('pointage:identification.pave.chiffre', { chiffre })}
            onClick={() => onChiffre(chiffre)}
          >
            {chiffre}
          </Button>
        ))}

        <Button
          type="button"
          variant="secondary"
          className="h-20 w-20 texte-corps font-medium"
          disabled={desactive}
          onClick={onEffacer}
        >
          {t('pointage:identification.pave.effacer')}
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-20 w-20 texte-chiffre-geant"
          disabled={desactive}
          aria-label={t('pointage:identification.pave.chiffre', { chiffre: '0' })}
          onClick={() => onChiffre('0')}
        >
          0
        </Button>

        <Button
          type="button"
          variant="default"
          className="h-20 w-20 texte-corps font-medium"
          disabled={desactive || !peutValider}
          onClick={onValider}
        >
          {t('pointage:identification.pave.valider')}
        </Button>
      </div>
    </div>
  );
}
