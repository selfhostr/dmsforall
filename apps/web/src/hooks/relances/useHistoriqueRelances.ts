import type { ReponseRelanceEnvoi } from '@dfa/shared';

import { useDoitReessayer, useListeCurseur, type ListeCurseur } from '@/hooks/pagination-curseur';

import { clesRelances } from './cles';
import { listerHistoriqueRelances } from './relances.api';

/**
 * `GET /relances/facturation/historique` (issue #136) — historique d'envoi des relances de
 * facture, pièce de dossier pour le comptable. `factureId` omis (défaut) : historique complet du
 * tenant — usage du bloc « Historique d'envoi » de `EcranRelances.tsx`. Fourni : filtré sur une
 * seule facture, pour un futur écran de détail de facture (hors périmètre de cette issue).
 */
export function useHistoriqueRelances(factureId?: string): ListeCurseur<ReponseRelanceEnvoi> {
  const reessayer = useDoitReessayer();
  return useListeCurseur<ReponseRelanceEnvoi>({
    cle: clesRelances.historique(factureId),
    charger: (curseur) => listerHistoriqueRelances(factureId, curseur),
    reessayer,
  });
}
