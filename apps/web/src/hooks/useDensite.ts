import { useCallback, useSyncExternalStore } from 'react';

/**
 * Densité d'affichage de l'application, choisie selon l'APPAREIL (audit « interface-navigation »
 * §4 : la densité « aérée » prévue pour la tablette n'était appliquée nulle part).
 *
 * - `compacte` : souris et grand écran (>= 1280 px) — corps 14 px, libellé 13 px, lignes de 40 px.
 *   Correspond à la classe CSS `densite-dense` (index.css).
 * - `aeree` : pointeur grossier (`(pointer: coarse)`, tablette) OU largeur < 1024 px — corps 16 px,
 *   libellé 14 px, lignes de 48 px. Classe CSS `densite-aeree`.
 *
 * L'utilisateur peut forcer l'un ou l'autre (préférence `compacte` / `aeree`), ou revenir à
 * `auto`. Le choix reste dans le navigateur (`localStorage`, clé `dfa-densite`), comme le thème :
 * chaque poste garde son réglage, aucune colonne en base.
 *
 * Entre 1024 et 1279 px avec une souris : `compacte` (un bureau étroit n'est pas une tablette).
 * La densité « très aérée » du pointage reste posée localement par la borne
 * (`densite-tres-aeree`), elle n'est pas choisie ici.
 */
export type DensiteAppareil = 'compacte' | 'aeree';
export type PreferenceDensite = 'auto' | DensiteAppareil;

export const CLE_STOCKAGE_DENSITE = 'dfa-densite';
export const REQUETE_POINTEUR_GROSSIER = '(pointer: coarse)';
export const REQUETE_LARGEUR_TABLETTE = '(max-width: 1023.98px)';

export const CLASSE_DENSITE: Readonly<Record<DensiteAppareil, string>> = {
  compacte: 'densite-dense',
  aeree: 'densite-aeree',
};

const PREFERENCES: readonly PreferenceDensite[] = ['auto', 'compacte', 'aeree'];

export function estPreferenceDensite(valeur: unknown): valeur is PreferenceDensite {
  return PREFERENCES.includes(valeur as PreferenceDensite);
}

/** Règle pure : testable sans navigateur. */
export function resoudreDensite(
  preference: PreferenceDensite,
  pointeurGrossier: boolean,
  largeurTablette: boolean,
): DensiteAppareil {
  if (preference !== 'auto') return preference;
  return pointeurGrossier || largeurTablette ? 'aeree' : 'compacte';
}

function correspond(requete: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(requete).matches
    : false;
}

function lirePreference(): PreferenceDensite {
  try {
    const brute = window.localStorage.getItem(CLE_STOCKAGE_DENSITE);
    return estPreferenceDensite(brute) ? brute : 'auto';
  } catch {
    return 'auto';
  }
}

type Ecouteur = () => void;
const ecouteurs = new Set<Ecouteur>();
let preferenceCourante: PreferenceDensite | undefined;
let desabonnementMedia: (() => void) | undefined;

function notifier(): void {
  for (const ecouteur of ecouteurs) ecouteur();
}

function abonner(ecouteur: Ecouteur): () => void {
  ecouteurs.add(ecouteur);
  if (ecouteurs.size === 1 && typeof window.matchMedia === 'function') {
    const listes = [REQUETE_POINTEUR_GROSSIER, REQUETE_LARGEUR_TABLETTE].map((requete) =>
      window.matchMedia(requete),
    );
    for (const liste of listes) liste.addEventListener('change', notifier);
    desabonnementMedia = () => {
      for (const liste of listes) liste.removeEventListener('change', notifier);
    };
  }
  return () => {
    ecouteurs.delete(ecouteur);
    if (ecouteurs.size === 0) {
      desabonnementMedia?.();
      desabonnementMedia = undefined;
    }
  };
}

function instantane(): DensiteAppareil {
  preferenceCourante ??= lirePreference();
  return resoudreDensite(
    preferenceCourante,
    correspond(REQUETE_POINTEUR_GROSSIER),
    correspond(REQUETE_LARGEUR_TABLETTE),
  );
}

function instantanePreference(): PreferenceDensite {
  preferenceCourante ??= lirePreference();
  return preferenceCourante;
}

/** Réinitialise le cache module (tests uniquement). */
export function reinitialiserDensite(): void {
  preferenceCourante = undefined;
  notifier();
}

export function definirPreferenceDensite(preference: PreferenceDensite): void {
  preferenceCourante = preference;
  try {
    if (preference === 'auto') window.localStorage.removeItem(CLE_STOCKAGE_DENSITE);
    else window.localStorage.setItem(CLE_STOCKAGE_DENSITE, preference);
  } catch {
    // Stockage indisponible (navigation privée stricte) : le choix vaut pour la session.
  }
  notifier();
}

export interface UtiliserDensite {
  /** Densité effectivement appliquée. */
  readonly densite: DensiteAppareil;
  /** Choix de l'utilisateur (`auto` = suivre l'appareil). */
  readonly preference: PreferenceDensite;
  readonly definirPreference: (preference: PreferenceDensite) => void;
}

export function useDensite(): UtiliserDensite {
  const densite = useSyncExternalStore(abonner, instantane, () => 'compacte' as const);
  const preference = useSyncExternalStore(abonner, instantanePreference, () => 'auto' as const);
  const definirPreference = useCallback(definirPreferenceDensite, []);
  return { densite, preference, definirPreference };
}
