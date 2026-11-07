import { useLayoutEffect } from 'react';

import { CLASSE_DENSITE, useDensite } from '@/hooks/useDensite';

/** Pose la classe de densité (`densite-dense` / `densite-aeree`) sur `<html>` : tous les jetons
 *  `--texte-*`, `--densite-*` et `--espace-*` (index.css) sont alors hérités par toute
 *  l'application, sans qu'un écran ait à choisir. Une classe `densite-*` posée localement plus
 *  bas (borne de pointage, `Table densite=…`) l'emporte pour sa sous-arborescence. Composant sans
 *  rendu, monté une fois près de la racine (App.tsx). */
export function SynchronisationDensite() {
  const { densite } = useDensite();

  useLayoutEffect(() => {
    const racine = document.documentElement;
    const classes = Object.values(CLASSE_DENSITE);
    racine.classList.remove(...classes);
    racine.classList.add(CLASSE_DENSITE[densite]);
    racine.dataset['densite'] = densite;
  }, [densite]);

  return null;
}
