import type { TFunction } from 'i18next';

import { ErreurApi, ErreurReseau, messageErreur } from '@/api/erreurs';
import { genererUuid } from '@/lib/uuid';

/**
 * Filet de sécurité générique sur l'échec d'une mutation (issue #63) — magasin externe à React
 * (le déclencheur, `MutationCache.onError` dans `App.tsx`, vit HORS de l'arbre React) plus le
 * composant `FiletErreurMutation` qui l'affiche. Voir `@/api/gestion-echecs-mutation` pour la
 * décision « personne n'a rien affiché, donc le filet parle », qui pousse ici via
 * `afficherToastFiletErreurMutation`.
 *
 * Catégories distinguées (exigence n°2 de l'issue) : un refus de droit (403 / DROIT_INSUFFISANT),
 * un conflit métier (409, toute transition/état interdit), une panne réseau (`ErreurReseau`,
 * jamais atteint le serveur) et une erreur serveur (5xx / ERREUR_INTERNE) — le corps du toast
 * reste `messageErreur(erreur, t)`, donc aussi précis que l'encart inline qu'un écran afficherait
 * lui-même pour la même erreur (même fonction, même texte par `code`).
 */
export type GraviteFiletErreur = 'droit' | 'conflit' | 'reseau' | 'serveur' | 'generique';

export interface ToastFiletErreurMutation {
  readonly id: string;
  readonly titre: string;
  readonly message: string;
  readonly gravite: GraviteFiletErreur;
}

type Ecouteur = () => void;

let toasts: readonly ToastFiletErreurMutation[] = [];
const ecouteurs = new Set<Ecouteur>();

function notifierEcouteurs(): void {
  for (const ecouteur of ecouteurs) ecouteur();
}

/** Abonnement compatible `useSyncExternalStore` (voir `FiletErreurMutation.tsx`). */
export function ecouterFiletErreurMutation(ecouteur: Ecouteur): () => void {
  ecouteurs.add(ecouteur);
  return () => ecouteurs.delete(ecouteur);
}

export function obtenirToastsFiletErreurMutation(): readonly ToastFiletErreurMutation[] {
  return toasts;
}

export function fermerToastFiletErreurMutation(id: string): void {
  if (!toasts.some((toast) => toast.id === id)) return;
  toasts = toasts.filter((toast) => toast.id !== id);
  notifierEcouteurs();
}

/** Remise à zéro complète — réservé aux tests (fuite d'état entre cas sinon, le magasin étant un
 *  module-level singleton partagé par toute la suite). */
export function reinitialiserFiletErreurMutation(): void {
  toasts = [];
  notifierEcouteurs();
}

function classifierGraviteFiletErreur(erreur: unknown): GraviteFiletErreur {
  if (erreur instanceof ErreurReseau) return 'reseau';
  if (erreur instanceof ErreurApi) {
    const { status, code } = erreur.probleme;
    if (status === 403 || code === 'DROIT_INSUFFISANT') return 'droit';
    if (status >= 500 || code === 'ERREUR_INTERNE') return 'serveur';
    if (status === 409) return 'conflit';
  }
  return 'generique';
}

/** Clé i18n du TITRE par catégorie — le CORPS du toast reste `messageErreur(erreur, t)`, déjà
 *  spécifique par `code` (§3.5 du contrat erreurs). `reseau`/`serveur`/`generique` réutilisent des
 *  titres existants (`erreurs:reseau.titre`, `erreurs:serveur.titre`, `erreurs:inattendue.titre`)
 *  plutôt que d'en dupliquer de nouveaux. */
const CLE_TITRE_PAR_GRAVITE: Readonly<Record<GraviteFiletErreur, string>> = {
  droit: 'erreurs:filet.titreDroit',
  conflit: 'erreurs:filet.titreConflit',
  reseau: 'erreurs:reseau.titre',
  serveur: 'erreurs:serveur.titre',
  generique: 'erreurs:inattendue.titre',
};

export function construireToastFiletErreurMutation(
  erreur: unknown,
  t: TFunction,
): ToastFiletErreurMutation {
  const gravite = classifierGraviteFiletErreur(erreur);
  return {
    id: genererUuid(),
    gravite,
    titre: t(CLE_TITRE_PAR_GRAVITE[gravite]),
    message: messageErreur(erreur, t),
  };
}

/** Un garagiste doit avoir le temps de lire un message d'erreur qu'il n'attendait pas (contexte
 *  tablette d'atelier, pas un poste de bureau) — plus long qu'un toast de succès habituel, mais
 *  fermable à tout moment (bouton fermer, voir `FiletErreurMutation.tsx`). */
const DUREE_AFFICHAGE_TOAST_MS = 8000;

export function afficherToastFiletErreurMutation(erreur: unknown, t: TFunction): void {
  const toast = construireToastFiletErreurMutation(erreur, t);
  toasts = [...toasts, toast];
  notifierEcouteurs();
  setTimeout(() => fermerToastFiletErreurMutation(toast.id), DUREE_AFFICHAGE_TOAST_MS);
}
