import { gabaritUrl } from './gabarit';
import { nettoyerMessage, nettoyerPile } from './nettoyage';

/**
 * Tampon circulaire EN MÉMOIRE (rien n'est persisté, rien n'est envoyé) des derniers défauts
 * constatés dans cet onglet. Il ne retient que du texte déjà nettoyé : jamais de corps de requête
 * ou de réponse, jamais de query string, jamais de valeur saisie.
 */

export const MAX_ERREURS = 20;
export const MAX_APPELS = 10;

export interface ErreurCollectee {
  readonly message: string;
  readonly pile: string;
  readonly quand: string;
}

export interface AppelEchoue {
  readonly methode: string;
  readonly route: string;
  /** 0 : le serveur n'a pas répondu (réseau coupé, délai dépassé). */
  readonly statut: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly quand: string;
}

let erreurs: readonly ErreurCollectee[] = [];
let appels: readonly AppelEchoue[] = [];

function ajouter<T>(liste: readonly T[], element: T, max: number): readonly T[] {
  return [...liste, element].slice(-max);
}

/** Enregistre une erreur JavaScript (ou toute valeur levée). */
export function enregistrerErreur(erreur: unknown, maintenant: Date = new Date()): void {
  const message =
    erreur instanceof Error ? `${erreur.name}: ${erreur.message}` : String(erreur ?? '');
  const pile = erreur instanceof Error ? (erreur.stack ?? '') : '';
  erreurs = ajouter(
    erreurs,
    {
      message: nettoyerMessage(message),
      pile: nettoyerPile(pile),
      quand: maintenant.toISOString(),
    },
    MAX_ERREURS,
  );
}

interface EntreeAppel {
  readonly methode: string;
  /** URL ou chemin tel que demandé : seul son gabarit est conservé. */
  readonly url: string;
  readonly statut: number;
  readonly code?: string | null;
  readonly requestId?: string | null;
}

/** Enregistre un appel API en échec (statut >= 400 ou réseau). */
export function enregistrerAppelEchoue(entree: EntreeAppel, maintenant: Date = new Date()): void {
  const appel: AppelEchoue = {
    methode: entree.methode.toUpperCase(),
    route: gabaritUrl(entree.url),
    statut: entree.statut,
    ...(entree.code ? { code: nettoyerMessage(entree.code).slice(0, 80) } : {}),
    ...(entree.requestId ? { requestId: nettoyerMessage(entree.requestId).slice(0, 80) } : {}),
    quand: maintenant.toISOString(),
  };
  appels = ajouter(appels, appel, MAX_APPELS);
}

export function lireErreurs(): readonly ErreurCollectee[] {
  return erreurs;
}

export function lireAppelsEchoues(): readonly AppelEchoue[] {
  return appels;
}

export function viderTampon(): void {
  erreurs = [];
  appels = [];
}

let installe = false;

/** Branche `window.onerror` et `unhandledrejection`. Idempotent. */
export function installerCollecteur(cible: Window = window): void {
  if (installe) return;
  installe = true;
  cible.addEventListener('error', (evenement) => {
    // Chargement raté d'une image ou d'un script : pas d'`error` ni de message, rien à retenir.
    if (evenement.error === undefined && !evenement.message) return;
    enregistrerErreur(evenement.error ?? evenement.message);
  });
  cible.addEventListener('unhandledrejection', (evenement) => {
    enregistrerErreur(evenement.reason);
  });
}

/** Pour les tests uniquement. */
export function reinitialiserInstallation(): void {
  installe = false;
}
