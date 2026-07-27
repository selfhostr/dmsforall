import ICU from 'i18next-icu';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { LANGUES, type Langue } from '@dfa/shared';

import { CLE_STOCKAGE_LANGUE } from './langues';

export { CLE_STOCKAGE_LANGUE } from './langues';

import deAccueil from './locales/de/accueil.json';
import deAuth from './locales/de/auth.json';
import deCommun from './locales/de/commun.json';
import deErreurs from './locales/de/erreurs.json';
import deNavigation from './locales/de/navigation.json';
import deValidation from './locales/de/validation.json';
import frAccueil from './locales/fr/accueil.json';
import frAuth from './locales/fr/auth.json';
import frCommun from './locales/fr/commun.json';
import frErreurs from './locales/fr/erreurs.json';
import frNavigation from './locales/fr/navigation.json';
import frValidation from './locales/fr/validation.json';
import itAccueil from './locales/it/accueil.json';
import itAuth from './locales/it/auth.json';
import itCommun from './locales/it/commun.json';
import itErreurs from './locales/it/erreurs.json';
import itNavigation from './locales/it/navigation.json';
import itValidation from './locales/it/validation.json';

/** 6 namespaces par domaine (propriété expert-i18n) : jamais modifiés ici, seulement importés. */
export const NAMESPACES = [
  'commun',
  'auth',
  'navigation',
  'accueil',
  'erreurs',
  'validation',
] as const;

const ressources = {
  fr: {
    commun: frCommun,
    auth: frAuth,
    navigation: frNavigation,
    accueil: frAccueil,
    erreurs: frErreurs,
    validation: frValidation,
  },
  de: {
    commun: deCommun,
    auth: deAuth,
    navigation: deNavigation,
    accueil: deAccueil,
    erreurs: deErreurs,
    validation: deValidation,
  },
  it: {
    commun: itCommun,
    auth: itAuth,
    navigation: itNavigation,
    accueil: itAccueil,
    erreurs: itErreurs,
    validation: itValidation,
  },
} as const;

export function estLangueValide(valeur: string | null | undefined): valeur is Langue {
  return valeur != null && (LANGUES as readonly string[]).includes(valeur);
}

/** Priorité : localStorage > navigator.language > 'fr'. `utilisateur.langue` n'entre en jeu
 *  qu'après résolution de la session (voir composants/commun/SynchronisationLangue.tsx),
 *  puisqu'elle n'est pas connue à ce stade du bootstrap. */
export function detecterLangueInitiale(
  storage: Pick<Storage, 'getItem'> = window.localStorage,
  langueNavigateur: string = window.navigator.language,
): Langue {
  const depuisStockage = storage.getItem(CLE_STOCKAGE_LANGUE);
  if (estLangueValide(depuisStockage)) return depuisStockage;

  const prefixeNavigateur = langueNavigateur.slice(0, 2).toLowerCase();
  if (estLangueValide(prefixeNavigateur)) return prefixeNavigateur;

  return 'fr';
}

void i18next
  .use(ICU)
  .use(initReactI18next)
  .init({
    resources: ressources,
    lng: detecterLangueInitiale(),
    fallbackLng: 'fr',
    supportedLngs: LANGUES as unknown as string[],
    ns: NAMESPACES as unknown as string[],
    defaultNS: 'commun',
    interpolation: { escapeValue: false },
    returnNull: false,
  });

i18next.on('languageChanged', (langue) => {
  document.documentElement.lang = langue;
});

export default i18next;
