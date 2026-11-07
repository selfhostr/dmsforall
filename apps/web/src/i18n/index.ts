import ICU from 'i18next-icu';
import i18next, { type BackendModule } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { LANGUES, type Langue } from '@dfa/shared';

import { CLE_STOCKAGE_LANGUE } from './langues';

export { CLE_STOCKAGE_LANGUE } from './langues';

/** 25 namespaces par domaine (propriété l'équipe i18n) : jamais modifiés ici, seulement importés.
 *  Les 6 premiers sont le socle (étape 0) ; les 7 suivants (`recherche` à `or`) sont le lot 1 —
 *  voir docs/plan-lot1-frontend-execution.md §2.3 (verrou V3). `facturation` et `parametrage`
 *  sont l'étape 2, `pieces` l'étape 3, `ventes` l'étape 4, `tableauBord` le tableau de bord.
 *  `scripts/verifier-i18n.mjs` échoue désormais si un namespace présent sur disque
 *  (`src/i18n/locales/fr/*.json`) n'apparaît pas ici : ne jamais ajouter un fichier de traduction
 *  sans l'enregistrer à la fois dans ce tableau et dans `ressources` ci-dessous, pour les trois
 *  langues — un oubli ici rend un namespace parfaitement traduit totalement inutilisable à
 *  l'exécution, sans qu'aucun test ni lint ne le voie.
 *
 *  `console` (palier 1 de la console d'exploitation, `docs/conception-console-exploitation-ecrans.md`
 *  §10) est un CAS PARTICULIER assumé : la conception conclut que le français seul suffit pour la
 *  V1 (public interne restreint, @laupernoe et son équipe support) — `de/console.json` et `it/console.json`
 *  sont donc des COPIES LITTÉRALES du texte français, pas des traductions, en attendant un besoin
 *  réel. La STRUCTURE (clés, parité stricte FR/DE/IT) existe dès le départ comme partout ailleurs :
 *  `i18n:check` continue de s'appliquer sans exception à ce namespace. */
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
  'courtoisie',
  'planning',
  'reception',
  'pointage',
  'or',
  'facturation',
  'parametrage',
  'pieces',
  'ventes',
  'pneus',
  'tableauBord',
  'relances',
  'console',
  'scan',
  'reprise',
  'export',
  'capacites',
  'aide',
] as const;

/** Chargeurs paresseux : un `import()` par fichier, donc un chunk par langue et namespace.
 *  Seule la langue active (et le repli FR) est téléchargée ; voir `fournisseurRessources`. */
const ressources = {
  fr: {
    commun: () => import('./locales/fr/commun.json'),
    auth: () => import('./locales/fr/auth.json'),
    navigation: () => import('./locales/fr/navigation.json'),
    accueil: () => import('./locales/fr/accueil.json'),
    erreurs: () => import('./locales/fr/erreurs.json'),
    validation: () => import('./locales/fr/validation.json'),
    recherche: () => import('./locales/fr/recherche.json'),
    clients: () => import('./locales/fr/clients.json'),
    vehicules: () => import('./locales/fr/vehicules.json'),
    courtoisie: () => import('./locales/fr/courtoisie.json'),
    planning: () => import('./locales/fr/planning.json'),
    reception: () => import('./locales/fr/reception.json'),
    pointage: () => import('./locales/fr/pointage.json'),
    or: () => import('./locales/fr/or.json'),
    facturation: () => import('./locales/fr/facturation.json'),
    parametrage: () => import('./locales/fr/parametrage.json'),
    pieces: () => import('./locales/fr/pieces.json'),
    ventes: () => import('./locales/fr/ventes.json'),
    pneus: () => import('./locales/fr/pneus.json'),
    tableauBord: () => import('./locales/fr/tableauBord.json'),
    relances: () => import('./locales/fr/relances.json'),
    console: () => import('./locales/fr/console.json'),
    scan: () => import('./locales/fr/scan.json'),
    reprise: () => import('./locales/fr/reprise.json'),
    export: () => import('./locales/fr/export.json'),
    capacites: () => import('./locales/fr/capacites.json'),
    aide: () => import('./locales/fr/aide.json'),
  },
  de: {
    commun: () => import('./locales/de/commun.json'),
    auth: () => import('./locales/de/auth.json'),
    navigation: () => import('./locales/de/navigation.json'),
    accueil: () => import('./locales/de/accueil.json'),
    erreurs: () => import('./locales/de/erreurs.json'),
    validation: () => import('./locales/de/validation.json'),
    recherche: () => import('./locales/de/recherche.json'),
    clients: () => import('./locales/de/clients.json'),
    vehicules: () => import('./locales/de/vehicules.json'),
    courtoisie: () => import('./locales/de/courtoisie.json'),
    planning: () => import('./locales/de/planning.json'),
    reception: () => import('./locales/de/reception.json'),
    pointage: () => import('./locales/de/pointage.json'),
    or: () => import('./locales/de/or.json'),
    facturation: () => import('./locales/de/facturation.json'),
    parametrage: () => import('./locales/de/parametrage.json'),
    pieces: () => import('./locales/de/pieces.json'),
    ventes: () => import('./locales/de/ventes.json'),
    pneus: () => import('./locales/de/pneus.json'),
    tableauBord: () => import('./locales/de/tableauBord.json'),
    relances: () => import('./locales/de/relances.json'),
    console: () => import('./locales/de/console.json'),
    scan: () => import('./locales/de/scan.json'),
    reprise: () => import('./locales/de/reprise.json'),
    export: () => import('./locales/de/export.json'),
    capacites: () => import('./locales/de/capacites.json'),
    aide: () => import('./locales/de/aide.json'),
  },
  it: {
    commun: () => import('./locales/it/commun.json'),
    auth: () => import('./locales/it/auth.json'),
    navigation: () => import('./locales/it/navigation.json'),
    accueil: () => import('./locales/it/accueil.json'),
    erreurs: () => import('./locales/it/erreurs.json'),
    validation: () => import('./locales/it/validation.json'),
    recherche: () => import('./locales/it/recherche.json'),
    clients: () => import('./locales/it/clients.json'),
    vehicules: () => import('./locales/it/vehicules.json'),
    courtoisie: () => import('./locales/it/courtoisie.json'),
    planning: () => import('./locales/it/planning.json'),
    reception: () => import('./locales/it/reception.json'),
    pointage: () => import('./locales/it/pointage.json'),
    or: () => import('./locales/it/or.json'),
    facturation: () => import('./locales/it/facturation.json'),
    parametrage: () => import('./locales/it/parametrage.json'),
    pieces: () => import('./locales/it/pieces.json'),
    ventes: () => import('./locales/it/ventes.json'),
    pneus: () => import('./locales/it/pneus.json'),
    tableauBord: () => import('./locales/it/tableauBord.json'),
    relances: () => import('./locales/it/relances.json'),
    console: () => import('./locales/it/console.json'),
    scan: () => import('./locales/it/scan.json'),
    reprise: () => import('./locales/it/reprise.json'),
    export: () => import('./locales/it/export.json'),
    capacites: () => import('./locales/it/capacites.json'),
    aide: () => import('./locales/it/aide.json'),
  },
} as const;

type Chargeur = () => Promise<{ default: Record<string, unknown> }>;

/** Backend i18next minimal : résout `langue`/`namespace` vers le chargeur de `ressources`. */
const fournisseurRessources: BackendModule = {
  type: 'backend',
  init: () => undefined,
  read(langue, namespace, rappel) {
    const chargeur = (ressources as Record<string, Record<string, Chargeur> | undefined>)[langue]?.[
      namespace
    ];
    if (!chargeur) {
      rappel(new Error(`Namespace i18n inconnu : ${langue}/${namespace}`), null);
      return;
    }
    chargeur().then(
      (module) => rappel(null, module.default),
      (erreur: unknown) =>
        rappel(erreur instanceof Error ? erreur : new Error(String(erreur)), null),
    );
  },
};

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

/** `<html lang>` suit toujours la langue active (rendu, lecteurs d'écran, césure du navigateur).
 *  Appelé par le listener `languageChanged` ET après l'init : l'init peut émettre avant qu'un
 *  listener ne soit posé (init synchrone quand les ressources sont en mémoire), d'où le second
 *  appel explicite — sans lui, `<html lang>` reste sur la valeur statique de `index.html`. */
export function appliquerLangueDocument(langue: string): void {
  if (estLangueValide(langue)) document.documentElement.lang = langue;
}

i18next.on('languageChanged', appliquerLangueDocument);

/** Résolue quand la langue initiale (et le repli FR) est en mémoire : `main.tsx` l'attend avant
 *  le premier rendu, donc aucun écran ne voit une clé brute. */
export const i18nPret: Promise<void> = i18next
  .use(ICU)
  .use(fournisseurRessources)
  .use(initReactI18next)
  .init({
    lng: detecterLangueInitiale(),
    fallbackLng: 'fr',
    supportedLngs: LANGUES as unknown as string[],
    ns: NAMESPACES as unknown as string[],
    defaultNS: 'commun',
    interpolation: { escapeValue: false },
    returnNull: false,
  })
  .then(() => {
    appliquerLangueDocument(i18next.resolvedLanguage ?? i18next.language);
  });

/** Charge les autres langues (tests, ou préchargement explicite) — `changeLanguage` charge de
 *  toute façon à la demande. */
export async function chargerLangues(langues: readonly Langue[] = LANGUES): Promise<void> {
  await i18nPret;
  await i18next.loadLanguages([...langues]);
}

export default i18next;
