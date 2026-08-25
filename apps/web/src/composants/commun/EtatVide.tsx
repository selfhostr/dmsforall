import type { ReactNode } from 'react';

interface Props {
  readonly titre: string;
  readonly description: string;
  readonly note?: string;
  readonly action?: ReactNode;
}

/**
 * État vide générique : message + action optionnelle. Un écran sans action pertinente
 * (ex. EcranAccueil à l'étape 0) omet simplement `action`.
 *
 * REMBOURRAGE RELIÉ À LA DENSITÉ (19.08.2026, signalé par l'agent tableau de bord) — `p-10`
 * (40 px fixe) ne suivait AUCUN jeu de densité (`.densite-dense`/`aeree`/`tres-aeree`,
 * `index.css`) : sous `densite-dense`, un état vide restait un pavé de 40 px alors que tout le
 * reste de l'écran s'était resserré. `p-carte` (`--spacing-carte` -> `--espace-carte`, 16/24/24 px
 * selon la densité de l'ancêtre) et `gap-groupe` (`--spacing-groupe`, 12/16/20 px) remplacent les
 * valeurs en dur — même mécanisme que les cartes du produit (`components/ui/card.tsx`). Le jeu de
 * données de démonstration étant pauvre, cet état est FRÉQUENT en écran réel : c'était un
 * contributeur mesurable de hauteur perdue.
 *
 * `EtatVideFiltre`/`EtatVidePremierUsage`/`EtatVideRecherche` délèguent tous les trois à ce
 * composant sans reposer de padding local : ce correctif les couvre automatiquement.
 *
 * LISIBILITÉ PRÉSERVÉE — densifier ne doit jamais effacer la distinction « aucune donnée » /
 * « zéro » (doctrine maison) : le remplissage se resserre, mais le contenu reste centré, le titre
 * garde `texte-titre-section` (jamais réduit au rôle du corps) et la bordure en pointillé (le
 * signal visuel « rien à voir ici ») reste posée dans les trois densités.
 */
export function EtatVide({ titre, description, note, action }: Props) {
  return (
    <div className="flex flex-col items-center gap-groupe rounded-lg border border-dashed p-carte text-center">
      <h2 className="texte-titre-section">{titre}</h2>
      <p className="max-w-md text-muted-foreground">{description}</p>
      {note ? <p className="texte-corps text-muted-foreground">{note}</p> : null}
      {action}
    </div>
  );
}
