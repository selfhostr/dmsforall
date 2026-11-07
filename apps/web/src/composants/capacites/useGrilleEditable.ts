import { useCallback, useMemo, useState } from 'react';

import {
  grillesEgales,
  type DomaineCapacite,
  type GrilleCapacites,
  type IdPrereglage,
  type ModeleCapacites,
  type NiveauAcces,
  type OptionPersonne,
} from '@dfa/shared';

import { incoherencesAffichables } from './grille';

interface Parametres {
  readonly modele: ModeleCapacites | undefined;
  /** Préréglage de départ. */
  readonly prereglageInitial: IdPrereglage;
  /** Grille de départ quand elle s'écarte déjà du préréglage (personne personnalisée, ou saisie
   *  à restaurer). `undefined` : la grille suit le préréglage. */
  readonly grilleInitiale?: GrilleCapacites;
}

/**
 * État de l'éditeur « Qui peut quoi » : préréglage choisi + écarts saisis. La grille effective est
 * celle du préréglage tant que rien n'est touché (`saisie === null`), jamais une copie figée —
 * choisir un autre préréglage repart de sa grille, « Revenir au préréglage » efface les écarts.
 */
export function useGrilleEditable({ modele, prereglageInitial, grilleInitiale }: Parametres) {
  const [prereglageId, setPrereglageId] = useState<IdPrereglage>(prereglageInitial);
  const [saisie, setSaisie] = useState<GrilleCapacites | null>(grilleInitiale ?? null);

  const prereglage = modele?.prereglages.find((p) => p.id === prereglageId);
  const grille: GrilleCapacites | undefined = saisie ?? prereglage?.grille;
  const personnalisee =
    grille !== undefined && prereglage !== undefined && !grillesEgales(grille, prereglage.grille);
  const incoherences = useMemo(() => (grille ? incoherencesAffichables(grille) : []), [grille]);

  const choisirPrereglage = useCallback((id: IdPrereglage) => {
    setPrereglageId(id);
    setSaisie(null);
  }, []);

  const revenir = useCallback(() => setSaisie(null), []);

  const reinitialiser = useCallback((id: IdPrereglage, grilleDepart?: GrilleCapacites) => {
    setPrereglageId(id);
    setSaisie(grilleDepart ?? null);
  }, []);

  const changerNiveau = useCallback(
    (domaine: DomaineCapacite, niveau: NiveauAcces) => {
      if (!grille) return;
      setSaisie({ ...grille, niveaux: { ...grille.niveaux, [domaine]: niveau } });
    },
    [grille],
  );
  const changerEncadrer = useCallback(
    (valeur: boolean) => {
      if (grille) setSaisie({ ...grille, encadrer: valeur });
    },
    [grille],
  );
  const changerOption = useCallback(
    (option: OptionPersonne, valeur: boolean) => {
      if (grille) setSaisie({ ...grille, options: { ...grille.options, [option]: valeur } });
    },
    [grille],
  );

  return {
    prereglageId,
    prereglage,
    grille,
    personnalisee,
    incoherences,
    choisirPrereglage,
    revenir,
    reinitialiser,
    changerNiveau,
    changerEncadrer,
    changerOption,
  };
}

export type EtatGrilleEditable = ReturnType<typeof useGrilleEditable>;
