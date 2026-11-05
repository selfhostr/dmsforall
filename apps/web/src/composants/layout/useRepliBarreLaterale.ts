import { useState } from 'react';

/** Namespace `dfa.` et casse identiques à `CLE_STOCKAGE_LANGUE` (`i18n/langues.ts`, `dfa.langue`)
 *  — même mécanisme de préférence locale, pas un second système. */
const CLE_STOCKAGE_REPLI_BARRE_LATERALE = 'dfa.barre-laterale.repliee';

export interface UtiliserRepliBarreLaterale {
  readonly replie: boolean;
  readonly basculer: () => void;
}

/**
 * Préférence de repli de la barre latérale DESKTOP (demande produit, revue webui du 10.08.2026) —
 * mémorisée en localStorage comme la langue explicite (`hooks/useLangue.ts`) plutôt qu'un
 * deuxième mécanisme de persistance. Lue une seule fois au montage : deux onglets ouverts peuvent
 * diverger jusqu'au prochain chargement de chacun, exactement comme la langue.
 *
 * N'appeler ce hook QUE pour l'instance desktop de `BarreLaterale` (l'`aside` d'`AppShell.tsx`) —
 * jamais pour le tiroir mobile (`Sheet`) : celui-ci est déjà en surimpression et se ferme
 * entièrement, un repli y serait un second geste pour rien.
 */
export function useRepliBarreLaterale(): UtiliserRepliBarreLaterale {
  const [replie, setReplie] = useState<boolean>(
    () => window.localStorage.getItem(CLE_STOCKAGE_REPLI_BARRE_LATERALE) === '1',
  );

  function basculer(): void {
    setReplie((valeurPrecedente) => {
      const nouvelleValeur = !valeurPrecedente;
      window.localStorage.setItem(CLE_STOCKAGE_REPLI_BARRE_LATERALE, nouvelleValeur ? '1' : '0');
      return nouvelleValeur;
    });
  }

  return { replie, basculer };
}
