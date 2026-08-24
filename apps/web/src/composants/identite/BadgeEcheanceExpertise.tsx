import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formaterDate } from '@/lib/formats';

import { BadgeAttribut } from './BadgeAttribut';

interface Props {
  /** `ReponseVehiculeExpertise.prochaineEcheanceLe` / `ReponseContexteAtelier.expertise.prochaineLe`.
   *  `null` -> aucune échéance connue, le composant ne rend rien (RM-28/RM-29). */
  readonly prochaineLe: string | null;
  /** `ReponseContexteAtelier.expertise.echue` — calculé serveur, jamais recalculé côté client. */
  readonly echue: boolean;
  readonly className?: string;
}

/** Nombre de mois pleins entre aujourd'hui et une date d'échéance (arrondi à l'entier supérieur).
 *  Affichage uniquement — la décision « échue » vient toujours du serveur (`echue`), jamais
 *  recalculée ici : ne sert qu'à composer le mot relatif de `vehicules:expertise.eche`. */
function moisRestants(dateEcheanceIso: string, maintenant: Date): number {
  const echeance = new Date(dateEcheanceIso);
  const joursRestants = (echeance.getTime() - maintenant.getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(joursRestants / 30));
}

/**
 * Échéance d'expertise (MFK) — forme + mot, jamais de couleur de la palette statut (§5.4).
 * Invariant n°5 (docs/plan-etape-1-frontend.md §11) : le relatif (« échoit dans 2 mois »)
 * n'apparaît jamais seul, toujours accompagné de la date absolue (`formaterDate`).
 *
 * Gardé en réserve, non câblé : la liste des véhicules (`EcranListeVehicules`) trie déjà par
 * `prochaineExpertiseLe:asc`, ce qui en ferait un candidat naturel pour une pastille par ligne,
 * mais sa projection `VehiculeResume` n'expose ni `prochaineEcheanceLe` ni `echue` — le serveur ne
 * calcule aujourd'hui `echue` que pour le contexte-atelier d'UN véhicule
 * (`apps/api/src/vehicules/service-vehicule-contexte-atelier.ts`), jamais pour une liste. La fiche
 * véhicule montre déjà cette échéance via `BlocEcheances` (plus détaillé qu'une pastille) : y
 * ajouter ce badge serait redondant. À câbler dans la liste si ces deux champs rejoignent un jour
 * cette projection côté API.
 */
export function BadgeEcheanceExpertise({ prochaineLe, echue, className }: Props) {
  const { t } = useTranslation('vehicules');

  if (!prochaineLe) {
    return null;
  }

  const mot = echue
    ? t('vehicules:expertise.echue')
    : t('vehicules:expertise.eche', { mois: moisRestants(prochaineLe, new Date()) });

  return (
    <BadgeAttribut
      icone={<CalendarClock aria-hidden className="h-3.5 w-3.5 shrink-0" />}
      accentue={echue}
      className={className}
    >
      {mot} · {formaterDate(prochaineLe)}
    </BadgeAttribut>
  );
}
