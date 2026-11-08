import { useTranslation } from 'react-i18next';

import { LANGUES, type Langue } from '@dfa/shared';

import { CLE_STOCKAGE_LANGUE, estLangueValide } from '@/i18n';

export interface UtiliserLangue {
  readonly langue: Langue;
  readonly languesDisponibles: readonly Langue[];
  readonly changerLangue: (langue: Langue) => void;
}

/** Bascule de langue sans rechargement : met à jour i18next, la langue de l'ÉCRAN DE CONNEXION
 *  gardée sur le poste (localStorage) et `document.documentElement.lang` (via le listener
 *  `languageChanged` de src/i18n/index.ts). Une fois connecté, la langue appartient au profil et
 *  les sélecteurs passent par `useLangueProfil` (issue #62) ; `utilisateur.langue` gagne toujours
 *  sur la valeur du poste (`SynchronisationLangue`). */
export function useLangue(): UtiliserLangue {
  const { i18n } = useTranslation();
  const langue = estLangueValide(i18n.language) ? i18n.language : 'fr';

  const changerLangue = (nouvelleLangue: Langue): void => {
    window.localStorage.setItem(CLE_STOCKAGE_LANGUE, nouvelleLangue);
    void i18n.changeLanguage(nouvelleLangue);
  };

  return { langue, languesDisponibles: LANGUES, changerLangue };
}
