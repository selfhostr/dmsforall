import { useCallback, useState } from 'react';

const PREFIXE = 'dfa.demarrage.masque';

function cle(utilisateurId: string): string {
  return `${PREFIXE}.${utilisateurId}`;
}

function lire(utilisateurId: string | undefined): boolean {
  if (!utilisateurId || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(cle(utilisateurId)) === '1';
  } catch {
    return false;
  }
}

/**
 * « Ne plus afficher » de la liste de démarrage : préférence locale PAR UTILISATEUR (clé
 * `dfa.demarrage.masque.<id>`), jamais partagée entre deux comptes du même poste. Un stockage
 * indisponible (navigation privée) dégrade en masquage pour la session seulement.
 */
export function useMasquageDemarrage(utilisateurId: string | undefined): {
  readonly masque: boolean;
  readonly masquer: () => void;
} {
  const [masqueSession, setMasqueSession] = useState<string | undefined>(undefined);
  const masque =
    lire(utilisateurId) || (utilisateurId !== undefined && masqueSession === utilisateurId);

  const masquer = useCallback(() => {
    if (!utilisateurId) return;
    setMasqueSession(utilisateurId);
    try {
      window.localStorage.setItem(cle(utilisateurId), '1');
    } catch {
      // Stockage refusé : le masquage tient le temps de la session.
    }
  }, [utilisateurId]);

  return { masque, masquer };
}
