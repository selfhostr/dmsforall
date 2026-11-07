import { useCallback, useState } from 'react';

const PREFIXE = 'dfa.assistant-demarrage.ferme';

function cle(tenantId: string, utilisateurId: string): string {
  return `${PREFIXE}.${tenantId}.${utilisateurId}`;
}

function lire(tenantId: string | undefined, utilisateurId: string | undefined): boolean {
  if (!tenantId || !utilisateurId || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(cle(tenantId, utilisateurId)) === '1';
  } catch {
    return false;
  }
}

/**
 * « Déjà vu » de l'assistant de démarrage : préférence locale PAR UTILISATEUR ET PAR GARAGE
 * (`dfa.assistant-demarrage.ferme.<garage>.<utilisateur>`), jamais partagée entre deux comptes du
 * même poste. Stockage indisponible : la fermeture tient le temps de la session seulement.
 */
export function useFermetureAssistant(
  tenantId: string | undefined,
  utilisateurId: string | undefined,
): { readonly ferme: boolean; readonly memoriserFermeture: () => void } {
  const [fermeSession, setFermeSession] = useState<string | undefined>(undefined);
  const identite = tenantId && utilisateurId ? cle(tenantId, utilisateurId) : undefined;
  const ferme =
    lire(tenantId, utilisateurId) || (identite !== undefined && fermeSession === identite);

  const memoriserFermeture = useCallback(() => {
    if (!tenantId || !utilisateurId) return;
    setFermeSession(cle(tenantId, utilisateurId));
    try {
      window.localStorage.setItem(cle(tenantId, utilisateurId), '1');
    } catch {
      // Stockage refusé : la fermeture tient le temps de la session.
    }
  }, [tenantId, utilisateurId]);

  return { ferme, memoriserFermeture };
}
