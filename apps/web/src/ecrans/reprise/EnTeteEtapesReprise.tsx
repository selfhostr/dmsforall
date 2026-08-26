import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

export type EtapeReprise = 'depot' | 'analyse' | 'validation' | 'import';

const ORDRE_ETAPES: readonly EtapeReprise[] = ['depot', 'analyse', 'validation', 'import'];

interface Props {
  readonly etapeActive: EtapeReprise;
}

/**
 * Bandeau des quatre étapes du parcours de reprise — présentation pure, dérivée de
 * `dossier.statut` par l'appelant (`EcranReprise`, voir `determinerEtapeAffichee`). `aria-
 * current="step"` sur l'étape active (WCAG 2.4.8 « Location ») ; les étapes déjà passées portent
 * une coche plutôt qu'un simple numéro — repère visuel rapide pour un garagiste qui revient sur
 * l'écran après avoir laissé la reprise tourner en tâche de fond.
 */
export function EnTeteEtapesReprise({ etapeActive }: Props) {
  const { t } = useTranslation('reprise');
  const indexActif = ORDRE_ETAPES.indexOf(etapeActive);

  return (
    <ol className="flex flex-wrap items-center gap-groupe" aria-label={t('reprise:titre')}>
      {ORDRE_ETAPES.map((etape, index) => {
        const estActive = etape === etapeActive;
        const estPassee = index < indexActif;
        /* DESIGN.md « bordure structurelle uniquement » — CONSERVÉE : ce `li` EST un badge
         *  d'état (étape active/passée/à venir), même langage visuel qu'un `Badge` (pilule +
         *  contour), jamais un simple groupe de contenu. */
        return (
          <li
            key={etape}
            aria-current={estActive ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1.5 texte-libelle font-medium',
              estActive && 'border-primary bg-primary/10 text-primary',
              estPassee && !estActive && 'border-input text-muted-foreground',
              !estActive && !estPassee && 'border-input text-muted-foreground opacity-60',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                // `texte-petit`, pas `texte-libelle` : ce badge a besoin de SA PROPRE couleur par
                // état (primary/foreground/muted-foreground) — `texte-libelle` imposerait
                // `muted-foreground` et écraserait les trois couleurs conditionnelles ci-dessous
                // (piège documenté dans `index.css`, juste au-dessus de `.texte-libelle`).
                'flex h-5 w-5 items-center justify-center rounded-full texte-petit',
                estActive && 'bg-primary text-primary-foreground',
                estPassee && !estActive && 'bg-muted text-foreground',
                !estActive && !estPassee && 'bg-muted text-muted-foreground',
              )}
            >
              {estPassee ? <Check aria-hidden="true" className="h-3 w-3" /> : index + 1}
            </span>
            {t(`reprise:etapes.${etape}`)}
          </li>
        );
      })}
    </ol>
  );
}
