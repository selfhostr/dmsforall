import { genererUuid } from '@/lib/uuid';

/**
 * Retour de SUCCÈS d'une action (« OR terminé », « Facture émise »), avec « Annuler » quand
 * l'action est réversible. Pendant du filet d'ERREUR (`filet-erreur-mutation.ts`) : même patron
 * de store externe lu par `useSyncExternalStore`, mais ici le minuteur de fermeture vit dans le
 * composant (`ToastsSucces.tsx`), pour pouvoir se mettre en pause au survol et au focus
 * (WCAG 2.2.1 : un délai doit pouvoir être prolongé).
 */
export const DUREE_TOAST_SUCCES_MS = 8000;

export interface ToastSucces {
  readonly id: string;
  readonly message: string;
  /** Défini => bouton « Annuler » pendant `DUREE_TOAST_SUCCES_MS`. Peut rejeter : l'échec
   *  d'annulation est signalé par le filet d'erreur. */
  readonly annuler?: () => unknown;
}

type Ecouteur = () => void;

// Plus de trois toasts empilés masqueraient le contenu : le plus ancien part.
const MAX_TOASTS = 3;

let toasts: readonly ToastSucces[] = [];
const ecouteurs = new Set<Ecouteur>();

function notifier(): void {
  for (const ecouteur of ecouteurs) ecouteur();
}

export function ecouterToastsSucces(ecouteur: Ecouteur): () => void {
  ecouteurs.add(ecouteur);
  return () => ecouteurs.delete(ecouteur);
}

export function obtenirToastsSucces(): readonly ToastSucces[] {
  return toasts;
}

export function afficherToastSucces(toast: Omit<ToastSucces, 'id'>): string {
  const id = genererUuid();
  toasts = [...toasts, { ...toast, id }].slice(-MAX_TOASTS);
  notifier();
  return id;
}

export function fermerToastSucces(id: string): void {
  if (!toasts.some((toast) => toast.id === id)) return;
  toasts = toasts.filter((toast) => toast.id !== id);
  notifier();
}

export function reinitialiserToastsSucces(): void {
  toasts = [];
  notifier();
}
