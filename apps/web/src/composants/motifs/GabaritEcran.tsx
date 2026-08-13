import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface Props {
  /**
   * Titre de la tâche principale de l'écran — TOUJOURS fourni, même quand `titreVisible` vaut
   * `false` : un lecteur d'écran doit toujours pouvoir nommer la page, y compris quand la barre
   * d'onglets (`composants/layout/OngletsDomaine.tsx`) porte déjà ce même libellé à l'écran.
   */
  readonly titre: string;
  /**
   * Faux quand `titre` RÉPÈTE À LA LETTRE l'onglet actif déjà affiché par `OngletsDomaine` (même
   * doctrine que `EcranListeVehiculesStock`/`EcranListeArticles`/`EcranSuiviVentes`, déjà en place
   * avant ce composant — capturée ici, pas réinventée). Le h1 reste alors dans le DOM (`sr-only`),
   * jamais retiré : structure de document et lecteur d'écran d'abord.
   *
   * Vrai par défaut : la présence d'un titre VISIBLE est la norme du produit, pas l'exception —
   * retour @laupernoe du 12.08.2026, citant `EcranListeClients` (« il y a écrit Clients, c'est mieux »).
   * L'exception se déclare, elle ne se devine pas.
   */
  readonly titreVisible?: boolean;
  /**
   * Actions principales de l'écran, alignées à droite du titre — jamais plus d'un bouton PRIMAIRE
   * parmi elles (repère UX du dépôt : une tâche, une action évidente par écran). Un contrôle qui
   * n'est pas une action de CET écran (une navigation déjà offerte par un onglet d'`OngletsDomaine`,
   * par exemple) n'a pas sa place ici — deux commandes vers la même destination sur le même écran
   * ont déjà coûté une revue complète (retour @laupernoe du 12.08.2026 sur les dossiers de vente et le
   * suivi financement/garantie : « c'est doublé »).
   */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * GABARIT D'ÉCRAN — structure haute commune à tout écran de consultation/liste du produit.
 *
 * Chantier d'unification (retour @laupernoe du 12.08.2026, sept observations distinctes faites écran par
 * écran, qui décrivaient toutes le même manque : aucun gabarit d'écran partagé, donc chaque écran
 * réinventait son titre, ses actions et son espacement). Ce composant a été MESURÉ sur l'existant
 * avant d'être écrit, pas inventé : `EcranListeClients` (titre visible, action à droite),
 * `EcranListeVehiculesStock`/`EcranReapprovisionnement`/`EcranListeDossiersVente` (silhouette
 * générale, déjà correcte) sont les écrans que @laupernoe cite ou dont la structure a servi de référence.
 * Un écran qui monte ce composant obtient SANS y penser, plutôt que de le reproduire à la main :
 *
 *  - PLEINE LARGEUR — aucun `max-w-*`/`mx-auto` posé ici. Défaut mesuré et corrigé par ce chantier :
 *    `EcranRechercheComptoirPieces` (comptoir pièces) était borné à `max-w-2xl`, condamnant la
 *    moitié droite de l'écran à rester vide (« le module comptoir ne prend pas du tout la largeur
 *    de la page »).
 *  - UN SEUL espacement sous l'en-tête global — `composants/layout/AppShell.tsx` pose déjà
 *    `p-4 sm:p-6` sur le `<main>` qui enveloppe tout écran routé : ne JAMAIS ajouter de padding
 *    local ici, ce serait le DOUBLER (48px au lieu de 24px, défaut déjà mesuré et corrigé une
 *    première fois, à la main, sur `EcranListeDossiersVente`/`EcranSuiviVentes` avant ce composant —
 *    voir leur historique). Le composant rend cette règle mécanique au lieu de dépendre de la
 *    mémoire de chaque écran.
 *  - TITRE ET ACTIONS sur une seule ligne, actions systématiquement à droite (`justify-between`) —
 *    le patron déjà suivi par la majorité des écrans corrects du dépôt.
 *  - UN h1 TOUJOURS présent (visible ou `sr-only`, jamais absent) — hiérarchie de titres cohérente,
 *    un seul niveau 1 par écran (accessibilité, WCAG AA).
 *
 * Ce que ce composant NE fait PAS : la barre de filtres (`composants/comptoir/BarreFiltres.tsx`),
 * le tri (`composants/comptoir/SelecteurTri.tsx`) et le tableau (`composants/comptoir/
 * TableComptoir.tsx`) restent des composants séparés, déjà partagés et déjà corrects — ce gabarit
 * les encadre, il ne les remplace pas. Un écran les passe simplement en `children`, après le titre.
 */
export function GabaritEcran({ titre, titreVisible = true, actions, children, className }: Props) {
  return (
    <div className={cn('flex w-full flex-col gap-6', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={cn('texte-titre-page', !titreVisible && 'sr-only')}>{titre}</h1>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
