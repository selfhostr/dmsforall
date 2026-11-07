import { useSyncExternalStore } from 'react';

/**
 * Ouverture du panneau « Signaler un problème », demandée depuis le menu du profil (un menu
 * déroulant se referme dès qu'on choisit une entrée : le panneau vit donc ailleurs, monté une
 * fois dans la coquille). Volontairement hors React Query : pas d'état serveur ici.
 */
let ouvert = false;
const ecouteurs = new Set<() => void>();

function changer(valeur: boolean): void {
  if (ouvert === valeur) return;
  ouvert = valeur;
  ecouteurs.forEach((ecouteur) => ecouteur());
}

export function ouvrirSignalement(): void {
  changer(true);
}

export function fermerSignalement(): void {
  changer(false);
}

function abonner(ecouteur: () => void): () => void {
  ecouteurs.add(ecouteur);
  return () => ecouteurs.delete(ecouteur);
}

export function useSignalementOuvert(): boolean {
  return useSyncExternalStore(
    abonner,
    () => ouvert,
    () => false,
  );
}
