import { useTranslation } from 'react-i18next';

import { Plaque } from '@/composants/identite/Plaque';
import { cn } from '@/lib/utils';

import { BadgeStatutRendezVous } from './BadgeStatutRendezVous';
import type { RendezVousCarte } from './types';

interface Props {
  readonly rendezVous: RendezVousCarte;
  readonly onOuvrir: (rendezVous: RendezVousCarte) => void;
  /** `true` en vue Jour (grille horaire, plus de place) — motif complet + durée visibles. `false`
   *  (défaut) en vue Semaine (carte compacte, motif court seul) — voir la conception, Écran 1. */
  readonly dense?: boolean;
  readonly className?: string;
}

/** Heure souhaitée si connue, sinon le moment de la journée — jamais une heure inventée : le
 *  contrat ne porte qu'un `moment` (matin/après-midi/toute la journée) par défaut, `heureSouhaitee`
 *  est un raffinement optionnel du réceptionniste. */
function libelleCreneau(rendezVous: RendezVousCarte, t: (cle: string) => string): string {
  if (rendezVous.heureSouhaitee) return rendezVous.heureSouhaitee.slice(0, 5);
  return t(`planning:moments.${rendezVous.moment}`);
}

/**
 * Carte compacte d'un rendez-vous — créneau, client, véhicule (plaque), motif, statut. Cible
 * tactile pleine carte (jamais un petit bouton interne, `docs/conception-rendez-vous-ecrans.md`
 * §Accessibilité) : la carte ENTIÈRE est le bouton, `min-h-11` garantit les 44px même en vue Semaine
 * dense.
 */
export function CarteRendezVous({ rendezVous, onOuvrir, dense = false, className }: Props) {
  const { t } = useTranslation('planning');
  const creneau = libelleCreneau(rendezVous, t);

  return (
    <button
      type="button"
      onClick={() => onOuvrir(rendezVous)}
      aria-label={t('planning:carte.ouvrir', { client: rendezVous.clientNom, heure: creneau })}
      className={cn(
        'flex min-h-11 w-full flex-col gap-0.5 rounded-md border border-transparent bg-muted/60 p-1.5 text-left transition-colors hover:border-input hover:bg-muted anneau-focus',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="texte-libelle font-semibold tabular-nums text-foreground">{creneau}</span>
        {rendezVous.vehiculePlaque ? (
          <Plaque
            canton={rendezVous.vehiculeCanton}
            numero={rendezVous.vehiculePlaque}
            taille="sm"
          />
        ) : null}
      </div>
      <span className="truncate texte-libelle text-foreground">{rendezVous.clientNom}</span>
      <span className="truncate texte-libelle text-muted-foreground">
        {rendezVous.motifLibelle}
      </span>
      {dense && rendezVous.clientTelephone ? (
        <span className="truncate texte-libelle tabular-nums text-muted-foreground">
          {rendezVous.clientTelephone}
        </span>
      ) : null}
      {dense ? (
        <div className="flex items-center justify-between gap-1 pt-0.5">
          <span className="truncate texte-libelle text-muted-foreground">
            {rendezVous.vehiculeDesignation ?? '—'}
          </span>
          <BadgeStatutRendezVous statut={rendezVous.statut} />
        </div>
      ) : (
        <BadgeStatutRendezVous statut={rendezVous.statut} className="w-fit" />
      )}
    </button>
  );
}
