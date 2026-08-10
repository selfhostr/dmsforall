import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { palierAccessibleDureeConsole, useSecondesEcouleesConsole } from './temps-relatif';

export interface ProprietesBandeauContexteConsole {
  readonly nomGarage: string;
  /** Motif de l'accès, si saisi à l'entrée — la conception (§11 Q2) n'a pas encore tranché si la
   *  saisie est bloquante ou seulement enregistrée après coup dans l'audit. `undefined` = motif
   *  non applicable/non disponible, jamais rendu comme une chaîne vide (un champ vide et un motif
   *  réellement absent ne sont pas la même donnée). */
  readonly motif?: string;
  /** ISO 8601 — début de l'intervention en cours (`exploitation.intervention`, voir la conception
   *  accès §4.5). */
  readonly depuisIso: string;
  readonly onQuitter: () => void;
}

/**
 * Bandeau de contexte inter-tenant (§6 de la conception) — PRÉPARÉ MAIS NON MONTÉ dans ce lot :
 * le palier 1 ne fait jamais entrer dans un garage, donc rien n'appelle ce composant pour
 * l'instant (`EcranConsolePlateforme` ne le rend nulle part). Construit maintenant plutôt que
 * laissé pour plus tard parce que :
 *  - la conception le décrit comme « non négociable » dès qu'on franchit le palier 1, et fige déjà
 *    sa forme exacte (contenu, couleur, sticky) — rien à redécouvrir quand le palier 2 sera bâti ;
 *  - il est intégralement autoporté (aucune dépendance à une route, un hook réseau, ou une donnée
 *    du palier 2) : le construire ici ne présuppose RIEN sur ce que l'agent accès tranchera
 *    (§11 Q1/Q2 de la conception restent ouvertes — `motif` est déjà optionnel pour cette raison).
 *
 * Couleur délibérément hors palette métier normale de DFA (jamais le bleu/vert primaire) — ambre
 * soutenu, contraste AA vérifié dans les deux thèmes. Pas rouge : ce n'est pas une alerte, c'est
 * un ÉTAT qu'on signale en continu (le rouge reste réservé aux alertes réelles de la table/des
 * cartes).
 */
export function BandeauContexteConsole({
  nomGarage,
  motif,
  depuisIso,
  onQuitter,
}: ProprietesBandeauContexteConsole) {
  const { t } = useTranslation('console');
  const secondes = useSecondesEcouleesConsole(depuisIso);
  const minutes = Math.floor(secondes / 60);
  const heures = Math.floor(minutes / 60);
  const dureeVisible =
    heures > 0
      ? `${String(heures).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:${String(secondes % 60).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(secondes % 60).padStart(2, '0')}`;
  const palier = palierAccessibleDureeConsole(secondes);

  return (
    <div className="sticky top-0 z-40 flex flex-wrap items-center gap-3 border-b border-amber-700/30 bg-amber-400 px-4 py-2 text-amber-950 dark:bg-amber-600 dark:text-amber-50">
      <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm font-medium">
        {t('console:bandeauContexte.contenu', { nomGarage })}
        {motif ? ` — ${motif}` : null}
      </p>
      <span className="whitespace-nowrap text-sm font-medium tabular-nums" aria-hidden="true">
        {dureeVisible}
      </span>
      {/* Équivalent lecteur d'écran, statique — §9 : ne pas forcer une re-annonce chaque seconde. */}
      <span className="sr-only">{t(`console:bandeauContexte.duree.${palier}`)}</span>
      <Button type="button" variant="outline" size="sm" onClick={onQuitter} className="shrink-0">
        {t('console:bandeauContexte.quitter')}
      </Button>
    </div>
  );
}
