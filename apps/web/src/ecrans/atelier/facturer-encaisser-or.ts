import type { ReponseOrdreReparation, RoleUtilisateur } from '@dfa/shared';

import type { DemandeFacturerEtEncaisser } from '@/ecrans/facturation/DialogueFacturerEtEncaisser';
import { peutEmettreFacture, peutEncaisser } from '@/ecrans/facturation/droits';
import {
  calculerGroupesFacturables,
  STATUTS_INDECIS,
} from '@/ecrans/facturation/groupes-facturables';

/**
 * Raccourci « Facturer et encaisser » depuis la fiche d'un OR terminé : uniquement le cas simple
 * d'un client qui paie tout (un seul groupe payeur `client`, aucune ligne en attente de décision,
 * pas de démontage à arbitrer). Tout le reste passe par l'écran « Facturer » détaillé — `null`.
 */
export function demandeFacturerEtEncaisserDepuisOr(
  or: ReponseOrdreReparation,
  role: RoleUtilisateur | undefined,
): DemandeFacturerEtEncaisser | null {
  if (!or.actionsDisponibles.includes('facturer')) return null;
  if (!peutEmettreFacture(role) || !peutEncaisser(role)) return null;
  if (or.demontageFacturablePropose) return null;
  if (or.lignes.some((ligne) => STATUTS_INDECIS.has(ligne.statut))) return null;
  const groupes = calculerGroupesFacturables(or);
  const groupe = groupes.length === 1 ? groupes[0] : undefined;
  if (!groupe || groupe.payeur !== 'client' || groupe.totalTtcCentimes === undefined) return null;
  return {
    orId: or.id,
    entree: { groupes: [{ payeur: 'client', payeurClientId: null }], motifsReport: [] },
    totalEstimeCentimes: groupe.totalTtcCentimes,
    destinataireNom: groupe.destinataire?.nomAffiche ?? or.client.nomAffiche,
  };
}
