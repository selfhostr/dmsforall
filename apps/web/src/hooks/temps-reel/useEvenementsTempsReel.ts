import { useEffect, useRef, useState } from 'react';

import type { EvenementTempsReel } from '@dfa/shared';

import { obtenirEnv } from '@/config/env';

/**
 * Souscription au canal SSE générique (`GET /evenements-temps-reel/flux`, voir
 * `apps/api/src/temps-reel/`). AUCUN écran ici — ce hook expose la connexion, l'écran qui
 * consomme un type d'événement précis (ex. correspondance de scan de permis) filtre lui-même sur
 * `evenement.type` dans son callback.
 *
 * Reconnexion : `EventSource` natif pour le PARSING du flux (gère nativement les lignes `data:`
 * et la reconnexion de base), mais la temporisation de reconnexion est reprise EN MAIN ici plutôt
 * que laissée au comportement natif — le `retry:` d'`EventSource` est un délai FIXE, pas un
 * retrait progressif. Sur `error`, la connexion est explicitement fermée puis une nouvelle est
 * ouverte après un délai croissant (1s, 2s, 4s… plafonné à 30s, avec une gigue aléatoire pour
 * éviter que plusieurs postes reconnectés en même temps ne martèlent le serveur ensemble après une
 * coupure réseau générale). Le délai est réinitialisé à la prochaine connexion réussie (`onopen`).
 *
 * Interface pour l'écran consommateur (ex. l'écran de scan de permis) :
 * ```ts
 * const etat = useEvenementsTempsReel((evenement) => {
 *   if (evenement.type === 'vehicule.correspondance_scan_permis') {
 *     // evenement.donnees.clientId — aller chercher la fiche via l'endpoint existant
 *   }
 * });
 * ```
 * `etat` vaut `'connexion'` (première tentative), `'connecte'`, `'reconnexion'` (coupure détectée,
 * nouvelle tentative programmée) ou `'ferme'` (composant démonté). Ne PAS bloquer l'écran sur
 * `'reconnexion'` — c'est une dégradation silencieuse, pas une erreur à afficher à l'utilisateur au
 * comptoir pour une simple notification best-effort.
 */

export type EtatFluxTempsReel = 'connexion' | 'connecte' | 'reconnexion' | 'ferme';

const DELAI_INITIAL_MS = 1_000;
const DELAI_MAXIMAL_MS = 30_000;
const FACTEUR_BACKOFF = 2;
const GIGUE_MAXIMALE_MS = 250;

export function useEvenementsTempsReel(
  surEvenement: (evenement: EvenementTempsReel) => void,
): EtatFluxTempsReel {
  const [etat, setEtat] = useState<EtatFluxTempsReel>('connexion');
  // Ref pour toujours appeler la DERNIÈRE version du callback fourni, sans reconnecter le flux à
  // chaque rendu (l'effet ci-dessous n'a aucune dépendance sur `surEvenement`).
  const surEvenementRef = useRef(surEvenement);
  surEvenementRef.current = surEvenement;

  useEffect(() => {
    let source: EventSource | null = null;
    let minuteurReconnexion: ReturnType<typeof setTimeout> | null = null;
    let delaiCourantMs = DELAI_INITIAL_MS;
    let demonte = false;

    const connecter = (): void => {
      if (demonte) return;

      const url = `${obtenirEnv().VITE_API_URL}/evenements-temps-reel/flux`;
      source = new EventSource(url, { withCredentials: true });

      source.onopen = () => {
        delaiCourantMs = DELAI_INITIAL_MS;
        setEtat('connecte');
      };

      source.onmessage = (message: MessageEvent<string>) => {
        try {
          const evenement = JSON.parse(message.data) as EvenementTempsReel;
          surEvenementRef.current(evenement);
        } catch {
          // Message malformé : ignoré, ne justifie pas de casser une connexion par ailleurs saine.
        }
      };

      source.onerror = () => {
        source?.close();
        if (demonte) return;
        setEtat('reconnexion');
        const gigue = Math.floor(Math.random() * GIGUE_MAXIMALE_MS);
        minuteurReconnexion = setTimeout(connecter, delaiCourantMs + gigue);
        delaiCourantMs = Math.min(delaiCourantMs * FACTEUR_BACKOFF, DELAI_MAXIMAL_MS);
      };
    };

    connecter();

    return () => {
      demonte = true;
      if (minuteurReconnexion) clearTimeout(minuteurReconnexion);
      source?.close();
      setEtat('ferme');
    };
  }, []);

  return etat;
}
