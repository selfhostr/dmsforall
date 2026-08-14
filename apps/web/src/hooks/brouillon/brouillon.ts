/**
 * Brouillon local d'un formulaire de CRÉATION (issue #77 — un réceptionnaire a perdu la demande
 * client et le kilométrage saisis dans un nouvel OR quand `RouteProtegee` a démonté l'écran sur une
 * panne réseau passagère, voir `routes/RouteProtegee.tsx`). Aucun mécanisme réutilisable n'existait
 * dans le dépôt avant ce module : `composants/motifs/BandeauBrouillon.tsx` (bannière « Brouillon
 * repris de HH:MM ») était déjà écrit et testé mais jamais câblé à une source de données — ce
 * fichier lui donne enfin une source.
 *
 * Portée volontairement étroite : un brouillon n'a de sens que pour une saisie qui n'a ENCORE RIEN
 * d'enregistré côté serveur (un formulaire de CRÉATION). Éditer une ressource déjà persistée ne
 * doit jamais lire un brouillon local — la réponse serveur fait foi, un brouillon périmé écraserait
 * silencieusement une donnée à jour.
 *
 * `sessionStorage`, pas `localStorage` : un brouillon est volontairement ÉPHÉMÈRE — il survit à un
 * rechargement de page (`EcranErreurFatale`, bouton « Recharger l'application ») dans le MÊME onglet,
 * mais ne doit jamais ressurgir des jours plus tard ni sur un autre poste (contrairement à une
 * préférence explicite comme la langue, `dfa.langue` en localStorage).
 */

const PREFIXE_CLE_BROUILLON = 'dfa.brouillon';

export interface BrouillonStocke<T> {
  readonly valeurs: T;
  /** ISO 8601 — horodatage de la dernière écriture, affiché par `BandeauBrouillon` (`repriseLe`). */
  readonly enregistreLe: string;
}

function cleStockage(cle: string): string {
  return `${PREFIXE_CLE_BROUILLON}.${cle}`;
}

function estBrouillonValide<T>(valeur: unknown): valeur is BrouillonStocke<T> {
  return (
    typeof valeur === 'object' &&
    valeur !== null &&
    'valeurs' in valeur &&
    typeof (valeur as { enregistreLe?: unknown }).enregistreLe === 'string'
  );
}

/**
 * Lit le brouillon `cle`, ou `undefined` s'il n'existe pas / est illisible (stockage corrompu,
 * quota dépassé lors d'une écriture précédente, forme inattendue après un changement de schéma
 * du formulaire) — un brouillon cassé est traité comme une ABSENCE, jamais comme une erreur
 * bloquante : perdre un brouillon est regrettable, empêcher l'écran de s'ouvrir serait pire.
 */
export function lireBrouillon<T>(cle: string): BrouillonStocke<T> | undefined {
  if (typeof window === 'undefined') return undefined;
  const brut = window.sessionStorage.getItem(cleStockage(cle));
  if (!brut) return undefined;
  try {
    const analyse: unknown = JSON.parse(brut);
    return estBrouillonValide<T>(analyse) ? analyse : undefined;
  } catch {
    return undefined;
  }
}

/** Écrit `valeurs` comme brouillon courant de `cle`, horodaté à l'instant de l'appel. */
export function ecrireBrouillon<T>(cle: string, valeurs: T): void {
  if (typeof window === 'undefined') return;
  const brouillon: BrouillonStocke<T> = { valeurs, enregistreLe: new Date().toISOString() };
  try {
    window.sessionStorage.setItem(cleStockage(cle), JSON.stringify(brouillon));
  } catch {
    // Quota `sessionStorage` dépassé ou mode privé restrictif : la saisie continue à vivre dans le
    // formulaire lui-même (React), on perd seulement le filet de secours. Jamais une exception qui
    // remonterait jusqu'à interrompre la frappe de l'utilisateur.
  }
}

/** Efface le brouillon `cle` — à appeler après un ENREGISTREMENT RÉUSSI (le serveur fait foi
 *  désormais) ou une annulation explicite, jamais après un simple échec de soumission (l'utilisateur
 *  doit pouvoir corriger et renvoyer sans retaper). */
export function effacerBrouillon(cle: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(cleStockage(cle));
}
