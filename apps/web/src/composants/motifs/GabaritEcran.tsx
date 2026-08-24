import type { ReactNode } from 'react';

import { useLibellesNavigationAffiches } from '@/composants/layout/useNavigationActive';
import { cn } from '@/lib/utils';

interface Props {
  /**
   * Titre de la tâche principale de l'écran — TOUJOURS fourni, même quand le h1 finit `sr-only` :
   * un lecteur d'écran doit toujours pouvoir nommer la page.
   */
  readonly titre: string;
  /**
   * Sous-titre optionnel — une phrase courte qui qualifie le titre, JAMAIS une consigne d'usage.
   * Rendu SOUS le h1, jamais à côté. L'espacement (`space-y-champ`) est imposé par le gabarit, un
   * écran ne pose aucune marge locale dessus.
   */
  readonly sousTitre?: ReactNode;
  /**
   * Forçage EXPLICITE de la visibilité du h1. `undefined` (défaut, et de très loin le cas normal) =
   * détection automatique du doublon avec la navigation (voir plus bas). Un écran ne pose cette
   * prop que pour CONTREDIRE la détection — cas réel, mesuré, et qui doit alors s'expliquer en
   * commentaire à l'appel : la détection couvre déjà toute la table de correspondance du produit,
   * poser `titreVisible` « pour être sûr » n'a plus de raison d'être depuis ce composant.
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
 * Normalise un libellé pour la comparaison de doublon : minuscules, accents retirés, `&` unifié
 * avec « et », ponctuation et espaces multiples réduits à un espace simple. Volontairement PAS
 * d'unification singulier/pluriel ni de retrait des mots vides — la table figée du contrat
 * (§3, « titres doublés & espacements ») compte sur l'inclusion brute pour distinguer
 * « Commandes fournisseur » (doublon de « Commandes ») de « Nouvelle commande fournisseur »
 * (visible : « commande » singulier n'est pas « commandes »).
 */
function normaliserLibelle(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' et ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Doublon si le titre normalisé contient un libellé de navigation normalisé, ou l'inverse —
 * inclusion dans les deux sens, exactement la règle figée du contrat. Exportée pour un test unitaire
 * direct de la table, en plus des tests de rendu route par route.
 */
export function estTitreDoublonNavigation(
  titre: string,
  libellesAffiches: readonly string[],
): boolean {
  const titreNormalise = normaliserLibelle(titre);
  if (titreNormalise === '') return false;
  return libellesAffiches.some((libelle) => {
    const libelleNormalise = normaliserLibelle(libelle);
    if (libelleNormalise === '') return false;
    return titreNormalise.includes(libelleNormalise) || libelleNormalise.includes(titreNormalise);
  });
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
 * VERSION 2 (chantier « titres doublés & espacements », 17.08.2026) — DEUX changements de fond,
 * qui SUPERSÈDENT la doctrine « titre toujours visible par défaut » de la version 1, elle-même
 * fondée sur un retour @laupernoe du 12.08.2026 citant `EcranListeClients` (« il y a écrit Clients, c'est
 * mieux »). @laupernoe a repassé les écrans en revue et RE-ARBITRÉ le 17.08.2026 dans l'autre sens : le
 * défaut répété qu'il relève cette fois, ce sont des titres qui RÉPÈTENT un libellé de navigation
 * déjà affiché (onglet actif, vue active, ou entrée de barre latérale — cas Facturation : « on sait
 * qu'on est dans les factures, c'est écrit à gauche »).
 *
 *  1. `titreVisible` n'est plus un booléen à défaut `true` mais un FORÇAGE optionnel
 *     (`boolean | undefined`, défaut `undefined`) : en son absence, le h1 devient `sr-only` dès que
 *     `titre` fait doublon — normalisation puis inclusion dans les deux sens, voir
 *     `estTitreDoublonNavigation` — avec un libellé de navigation EFFECTIVEMENT rendu à l'écran
 *     pour la route courante (`useLibellesNavigationAffiches`, `composants/layout/
 *     useNavigationActive.ts`, la même source que consomme `OngletsDomaine` : les deux ne peuvent
 *     pas diverger sur « qu'est-ce qui est affiché »). Le h1 reste TOUJOURS dans le DOM, jamais
 *     retiré : structure de document et lecteur d'écran d'abord. Les appels existants qui posaient
 *     `titreVisible={false}` restent valides et gardent la priorité sur la détection.
 *  2. `sousTitre` (nouveau) — une phrase courte rendue sous le h1, dans la même colonne
 *     (`space-y-champ`), jamais à côté.
 *  3. RÈGLE ANTI-TROU — la plainte n°1 de @laupernoe (« ça fait un espace horrible », « tu peux enlever
 *     l'espace aussi qui n'est pas très beau ») : quand le h1 finit `sr-only` ET qu'il n'y a NI
 *     sous-titre NI actions, la ligne d'en-tête n'est PAS rendue du tout — seul le h1 `sr-only`
 *     subsiste, HORS de la ligne (`flex flex-wrap items-start justify-between gap-groupe`) qui
 *     autrement resterait un item vide de la colonne externe et continuerait à consommer un
 *     `gap-section`. `sr-only` sort déjà l'élément du flux normal (`position: absolute`) : un h1
 *     `sr-only` posé en enfant direct du conteneur `gap-section` ne compte pour aucun `gap`,
 *     contrairement à une ligne d'en-tête vide qui l'engloberait.
 *
 * Ce que ce composant NE fait PAS : la barre de filtres (`composants/comptoir/BarreFiltres.tsx`),
 * le tri (`composants/comptoir/SelecteurTri.tsx`) et le tableau (`composants/comptoir/
 * TableComptoir.tsx`) restent des composants séparés, déjà partagés et déjà corrects — ce gabarit
 * les encadre, il ne les remplace pas. Un écran les passe simplement en `children`, après le titre.
 */
export function GabaritEcran({
  titre,
  sousTitre,
  titreVisible,
  actions,
  children,
  className,
}: Props) {
  const libellesAffiches = useLibellesNavigationAffiches();
  const visible = titreVisible ?? !estTitreDoublonNavigation(titre, libellesAffiches);
  const classeH1 = cn('texte-titre-page', !visible && 'sr-only');

  // Règle anti-trou (§4 du contrat) : rien d'autre que le h1 sr-only ne doit occuper de rangée.
  if (!visible && !sousTitre && !actions) {
    return (
      <div className={cn('flex w-full flex-col gap-section', className)}>
        <h1 className={classeH1}>{titre}</h1>
        {children}
      </div>
    );
  }

  return (
    <div className={cn('flex w-full flex-col gap-section', className)}>
      <div className="flex flex-wrap items-start justify-between gap-groupe">
        <div className="space-y-champ">
          <h1 className={classeH1}>{titre}</h1>
          {sousTitre ? <p className="texte-corps text-muted-foreground">{sousTitre}</p> : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-controles">{actions}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
