import { useSyncExternalStore } from 'react';

import type { IdEtapeAssistant } from '@/ecrans/assistant-demarrage/etapes';

/**
 * Mémoire de session de l'assistant de démarrage, partagée entre la barre latérale (qui peut le
 * rouvrir depuis n'importe quel écran) et l'accueil (qui le monte) : l'étape où la personne s'est
 * arrêtée, et une demande de réouverture en attente. Volontairement hors React Query : pas d'état
 * serveur ici.
 */
interface Etat {
  readonly etape: IdEtapeAssistant;
  readonly ouvertureDemandee: boolean;
}

const ETAT_INITIAL: Etat = { etape: 'garage', ouvertureDemandee: false };
let etat: Etat = ETAT_INITIAL;
const ecouteurs = new Set<() => void>();

function changer(patch: Partial<Etat>): void {
  etat = { ...etat, ...patch };
  ecouteurs.forEach((ecouteur) => ecouteur());
}

function abonner(ecouteur: () => void): () => void {
  ecouteurs.add(ecouteur);
  return () => ecouteurs.delete(ecouteur);
}

export function demanderOuvertureAssistant(): void {
  changer({ ouvertureDemandee: true });
}

export function consommerDemandeOuverture(): void {
  changer({ ouvertureDemandee: false });
}

export function memoriserEtapeAssistant(etape: IdEtapeAssistant): void {
  changer({ etape });
}

export function reinitialiserEtatAssistant(): void {
  changer(ETAT_INITIAL);
}

export function useEtatAssistant(): Etat {
  return useSyncExternalStore(
    abonner,
    () => etat,
    () => etat,
  );
}
