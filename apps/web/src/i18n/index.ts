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
import deRecherche from './locales/de/recherche.json';
import deClients from './locales/de/clients.json';
import deVehicules from './locales/de/vehicules.json';
import dePlanning from './locales/de/planning.json';
import deReception from './locales/de/reception.json';
import dePointage from './locales/de/pointage.json';
import deOr from './locales/de/or.json';
import deFacturation from './locales/de/facturation.json';
import deParametrage from './locales/de/parametrage.json';
import frAccueil from './locales/fr/accueil.json';
import frAuth from './locales/fr/auth.json';
import frCommun from './locales/fr/commun.json';
import frErreurs from './locales/fr/erreurs.json';
import frNavigation from './locales/fr/navigation.json';
import frValidation from './locales/fr/validation.json';
import frRecherche from './locales/fr/recherche.json';
import frClients from './locales/fr/clients.json';
import frVehicules from './locales/fr/vehicules.json';
import frPlanning from './locales/fr/planning.json';
import frReception from './locales/fr/reception.json';
import frPointage from './locales/fr/pointage.json';
import frOr from './locales/fr/or.json';
import frFacturation from './locales/fr/facturation.json';
import frParametrage from './locales/fr/parametrage.json';
import itAccueil from './locales/it/accueil.json';
import itAuth from './locales/it/auth.json';
import itCommun from './locales/it/commun.json';
import itErreurs from './locales/it/erreurs.json';
import itNavigation from './locales/it/navigation.json';
import itValidation from './locales/it/validation.json';
import itRecherche from './locales/it/recherche.json';
import itClients from './locales/it/clients.json';
import itVehicules from './locales/it/vehicules.json';
import itPlanning from './locales/it/planning.json';
import itReception from './locales/it/reception.json';
import itPointage from './locales/it/pointage.json';
import itOr from './locales/it/or.json';
import itFacturation from './locales/it/facturation.json';
import itParametrage from './locales/it/parametrage.json';

/** 15 namespaces par domaine (propriété expert-i18n) : jamais modifiés ici, seulement importés.
 *  Les 6 premiers sont le socle (étape 0) ; les 7 suivants (`recherche` à `or`) sont le lot 1 —
 *  voir docs/plan-lot1-frontend-execution.md §2.3 (verrou V3). `facturation` et `parametrage`
 *  sont l'étape 2. `scripts/verifier-i18n.mjs` échoue désormais si un namespace présent sur
 *  disque (`src/i18n/locales/fr/*.json`) n'apparaît pas ici : ne jamais ajouter un fichier de
 *  traduction sans l'enregistrer à la fois dans ce tableau et dans `ressources` ci-dessous, pour
 *  les trois langues — un oubli ici rend un namespace parfaitement traduit totalement
 *  inutilisable à l'exécution, sans qu'aucun test ni lint ne le voie. */
export const NAMESPACES = [
  'commun',
  'auth',
  'navigation',
  'accueil',
  'erreurs',
  'validation',
  'recherche',
  'clients',
  'vehicules',
  'planning',
  'reception',
  'pointage',
  'or',
  'facturation',
  'parametrage',
] as const;

const ressources = {
  fr: {
    commun: frCommun,
    auth: frAuth,
    navigation: frNavigation,
    accueil: frAccueil,
    erreurs: frErreurs,
    validation: frValidation,
    recherche: frRecherche,
    clients: frClients,
    vehicules: frVehicules,
    planning: frPlanning,
    reception: frReception,
    pointage: frPointage,
    or: frOr,
    facturation: frFacturation,
    parametrage: frParametrage,
  },
  de: {
    commun: deCommun,
    auth: deAuth,
    navigation: deNavigation,
    accueil: deAccueil,
    erreurs: deErreurs,
    validation: deValidation,
    recherche: deRecherche,
    clients: deClients,
    vehicules: deVehicules,
    planning: dePlanning,
    reception: deReception,
    pointage: dePointage,
    or: deOr,
    facturation: deFacturation,
    parametrage: deParametrage,
  },
  it: {
    commun: itCommun,
    auth: itAuth,
    navigation: itNavigation,
    accueil: itAccueil,
    erreurs: itErreurs,
    validation: itValidation,
    recherche: itRecherche,
    clients: itClients,
    vehicules: itVehicules,
    planning: itPlanning,
    reception: itReception,
    pointage: itPointage,
    or: itOr,
    facturation: itFacturation,
    parametrage: itParametrage,
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
