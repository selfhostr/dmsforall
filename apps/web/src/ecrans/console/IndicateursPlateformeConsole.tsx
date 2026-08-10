import { HelpCircle } from 'lucide-react';
import type { IndicateurIndisponible } from '@dfa/shared';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import type { IdIndicateurConsole, ValeurIndicateurConsole } from './indicateurs-plateforme';

interface Props {
  readonly valeurs: readonly ValeurIndicateurConsole[];
  readonly filtreActif: IdIndicateurConsole | null;
  /** Clic sur une carte déjà active la désactive (bascule) — même geste que retirer le filtre
   *  depuis le badge « Filtré : … » au-dessus de la table. */
  readonly onBasculerFiltre: (id: IdIndicateurConsole) => void;
  /**
   * Indicateurs que cette version de l'API ne sait PAS mesurer (`resume.indicateursIndisponibles`,
   * `@dfa/shared`) — rendus à part, jamais comme une carte à `0` : « on ne sait pas » et « c'est
   * bon » ne partagent jamais le même rendu (CONTRIBUTING.md, « une absence de donnée n'est pas une
   * valeur »). Non cliquables : aucune donnée par garage n'existe derrière pour filtrer la table.
   */
  readonly indisponibles: readonly IndicateurIndisponible[];
}

/**
 * Rangée de cartes cliquables (§2.1 de la conception) — chacune FILTRE la table en dessous plutôt
 * que d'être un chiffre qu'on regarde et qu'on oublie (§0 : « un indicateur qui n'appelle aucune
 * action n'a rien à faire ici »). De vrais `<button>`, jamais un `<div onClick>` (guide
 * d'accessibilité du dépôt) ; `aria-pressed` porte l'état actif pour un lecteur d'écran, la carte
 * active se distingue aussi visuellement (bordure + fond), jamais par la couleur seule.
 */
export function IndicateursPlateformeConsole({
  valeurs,
  filtreActif,
  onBasculerFiltre,
  indisponibles,
}: Props) {
  const { t } = useTranslation('console');

  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label={t('console:plateforme.indicateurs.groupe')}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      >
        {valeurs.map(({ id, icone: Icone, total }) => {
          const actif = filtreActif === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={actif}
              onClick={() => onBasculerFiltre(id)}
              className={cn(
                'flex min-h-[44px] flex-col items-start gap-1 rounded-lg border bg-card p-4 text-left shadow-sm transition-colors',
                'hover:border-primary/50 hover:bg-muted/50',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                actif && 'border-primary bg-primary/5 ring-1 ring-primary',
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="texte-donnee-proeminente leading-none text-foreground">
                  {total}
                </span>
                <Icone
                  className={cn(
                    'h-5 w-5 shrink-0',
                    actif ? 'text-primary' : 'text-muted-foreground',
                  )}
                  aria-hidden="true"
                />
              </span>
              <span className="text-sm text-muted-foreground">
                {t(`console:plateforme.indicateurs.${id}.libelle`)}
              </span>
            </button>
          );
        })}
      </div>

      {indisponibles.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 texte-libelle text-muted-foreground">
          <span className="font-medium">
            {t('console:plateforme.indicateursIndisponibles.titre')}
          </span>
          {indisponibles.map(({ code }) => (
            <span
              key={code}
              className="inline-flex items-center gap-1 rounded-full border border-input px-2 py-0.5"
            >
              <HelpCircle className="h-3 w-3" aria-hidden="true" />
              {t(`console:plateforme.indicateursIndisponibles.code.${code}`)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
