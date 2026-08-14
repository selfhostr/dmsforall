import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formaterDureeLisible, useChronoPointage } from '@/hooks/pointage/temps-pointage';

interface Props {
  readonly cibleLibelle: string;
  /** Début de l'activité indirecte EN COURS (`pointageActuel.debutLe`) — c'est littéralement
   *  l'instant où la cible productive a été interrompue. Chrono live via `useChronoPointage`
   *  (même hook que `CartePointageEnCours`) plutôt qu'une durée figée au montage : le bandeau reste
   *  correct même si le technicien laisse l'activité indirecte tourner de longues minutes. */
  readonly interrompuDepuisLe: string;
  /** Cumul déjà pointé aujourd'hui sur CETTE cible (segments antérieurs, hors segment en cours) —
   *  `0` ou `undefined` -> pas de second sous-texte (RM « deux nombres, jamais un seul » : un
   *  cumul nul ne se distingue pas de son absence pour l'utilisateur, jamais affiché). */
  readonly cumulAujourdhuiSecondes: number | undefined;
  readonly onReprendre: () => void;
  readonly enTraitement: boolean;
}

/**
 * Bandeau STATIONNAIRE en tête d'écran, offert dès qu'une reprise est possible — pas seulement
 * depuis une pause : TOUTE activité indirecte (nettoyage, attente pièces, magasin, formation,
 * absence…) laisse la cible productive mémorisée (`dernierCible`, `EcranPointageTechnicien.tsx`)
 * atteignable en UN SEUL appui, sans repasser par « Mes OR du jour » ni aucune question
 * intermédiaire. Vient EN COMPLÉMENT du bouton « Reprendre » déjà présent dans
 * `CartePointageEnCours` (même callback `onReprendre` côté appelant) — celui-ci reste le geste
 * accessible pendant qu'on regarde la carte en détail, le bandeau est le rappel qu'on ne peut pas
 * manquer en arrivant sur l'écran.
 *
 * Élément tactile UNIQUE (le bandeau entier est le bouton, ~80 px de haut) plutôt qu'un texte à
 * côté d'un petit bouton séparé — un doigt ganté vise large, pas un contrôle précis dans un coin.
 */
export function BandeauReprisePointage({
  cibleLibelle,
  interrompuDepuisLe,
  cumulAujourdhuiSecondes,
  onReprendre,
  enTraitement,
}: Props) {
  const { t } = useTranslation('pointage');
  const chrono = useChronoPointage(interrompuDepuisLe);
  const dureeInterruption = formaterDureeLisible(chrono.secondes);
  const cumulAffiche =
    cumulAujourdhuiSecondes && cumulAujourdhuiSecondes > 0
      ? formaterDureeLisible(cumulAujourdhuiSecondes)
      : undefined;

  return (
    <button
      type="button"
      disabled={enTraitement}
      onClick={onReprendre}
      aria-label={t('pointage:technicien.bandeauReprise.libelleAccessible', {
        cible: cibleLibelle,
      })}
      className="flex min-h-[80px] w-full items-center gap-4 rounded-lg border-2 border-primary bg-primary/10 px-4 py-3 text-left transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
    >
      <RotateCcw aria-hidden="true" className="h-8 w-8 shrink-0 text-primary" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="texte-titre-section truncate font-semibold">
          {t('pointage:technicien.bandeauReprise.titre', { cible: cibleLibelle })}
        </span>
        <span className="texte-libelle text-muted-foreground">
          {t('pointage:technicien.bandeauReprise.interrompuDepuis', { duree: dureeInterruption })}
          {cumulAffiche
            ? ` · ${t('pointage:technicien.bandeauReprise.cumulJour', { cumul: cumulAffiche })}`
            : null}
        </span>
      </span>
    </button>
  );
}
