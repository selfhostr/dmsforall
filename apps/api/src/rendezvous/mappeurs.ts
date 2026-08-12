import type { ReponseMotifRendezVous, ReponseRendezVous } from '@dfa/shared';
import type { ClientResume, VehiculeResume } from '@dfa/shared';

import type { LigneMotifRendezVous, LigneRendezVous } from '../db/schema';

export function versDtoMotifRendezVous(ligne: LigneMotifRendezVous): ReponseMotifRendezVous {
  return {
    id: ligne.id,
    code: ligne.code,
    libelleFr: ligne.libelleFr,
    libelleDe: ligne.libelleDe,
    libelleIt: ligne.libelleIt,
    dureeDefautMinutes: ligne.dureeDefautMinutes,
    heuresAtelierDefautCentiemes: ligne.heuresAtelierDefautCentiemes,
    actif: ligne.actif,
  };
}

export function versDtoRendezVous(
  ligne: LigneRendezVous,
  client: ClientResume,
  vehicule: VehiculeResume | null,
  motif: ReponseMotifRendezVous,
  ordreReparationId: string | null,
): ReponseRendezVous {
  return {
    id: ligne.id,
    siteId: ligne.siteId,
    client,
    vehicule,
    type: ligne.type,
    motif,
    commentaire: ligne.commentaire,
    dateLe: ligne.date,
    moment: ligne.moment,
    heureSouhaitee: ligne.heureSouhaitee,
    dureeEstimeeMinutes: ligne.dureeEstimeeMinutes,
    statut: ligne.statut,
    motifAnnulation: ligne.motifAnnulation,
    origine: ligne.origine,
    confirmeLe: ligne.confirmeLe.toISOString(),
    honoreLe: ligne.honoreLe ? ligne.honoreLe.toISOString() : null,
    absentConstateLe: ligne.absentConstateLe ? ligne.absentConstateLe.toISOString() : null,
    annuleLe: ligne.annuleLe ? ligne.annuleLe.toISOString() : null,
    ordreReparationId,
    creeParId: ligne.creeParId,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe.toISOString(),
  };
}
