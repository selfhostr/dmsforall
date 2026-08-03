import type { AnomaliePointage, DerniereCorrectionPointage, ReponsePointage } from '@dfa/shared';
import type { LignePointage } from '../db/schema';

/**
 * `dureeBruteSecondes` n'est PAS une colonne de `LignePointage` (GENERATED, non modélisé par
 * Drizzle — voir l'en-tête de `db/schema/pointage/pointage.ts`). Un appelant qui l'a sélectionnée
 * explicitement (`select … duree_brute_secondes` en SQL brut, ou calculée en mémoire depuis
 * `debutLe`/`finLe`) la fournit ici ; sinon `null`, cohérent avec `finLe === null`.
 */
export function mapperPointage(
  ligne: LignePointage,
  dureeBruteSecondes: number | null,
): ReponsePointage {
  const anomalie: AnomaliePointage | null =
    ligne.anomalieMotif !== null && ligne.anomalieDetecteeLe !== null
      ? {
          motif: ligne.anomalieMotif,
          detecteeLe: ligne.anomalieDetecteeLe.toISOString(),
          traiteeLe: ligne.anomalieTraiteeLe?.toISOString() ?? null,
        }
      : null;

  const derniereCorrection: DerniereCorrectionPointage | null =
    ligne.derniereCorrectionMotif !== null &&
    ligne.derniereCorrectionParUtilisateurId !== null &&
    ligne.derniereCorrectionLe !== null &&
    ligne.debutLeOrigine !== null
      ? {
          motif: ligne.derniereCorrectionMotif,
          parUtilisateurId: ligne.derniereCorrectionParUtilisateurId,
          corrigeeLe: ligne.derniereCorrectionLe.toISOString(),
          debutLeOrigine: ligne.debutLeOrigine.toISOString(),
          finLeOrigine: ligne.finLeOrigine?.toISOString() ?? null,
        }
      : null;

  return {
    id: ligne.id,
    siteId: ligne.siteId,
    technicienId: ligne.technicienId,
    statut: ligne.statut,
    nature: ligne.nature,
    ordreReparationId: ligne.ordreReparationId,
    ligneOrId: ligne.ligneOrId,
    activiteIndirecte: ligne.activiteIndirecte,
    source: ligne.source,
    appareilId: ligne.appareilId,
    debutLe: ligne.debutLe.toISOString(),
    finLe: ligne.finLe?.toISOString() ?? null,
    dureeBruteSecondes,
    dureeArrondieCentiemes: ligne.dureeArrondieCentiemes,
    clotureAutomatique: ligne.clotureAutomatique,
    anomalie,
    derniereCorrection,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe.toISOString(),
  };
}

/** Calcule `dureeBruteSecondes` EN MÉMOIRE depuis `debutLe`/`finLe` — identique à la formule de la
 *  colonne GENERATED (`extract(epoch from (fin_le - debut_le))::integer`), pour les lectures qui
 *  n'ont pas sélectionné la colonne en SQL brut. `null` tant que le pointage est ouvert. */
export function dureeBruteDepuisPeriode(debutLe: Date, finLe: Date | null): number | null {
  if (finLe === null) return null;
  return Math.floor((finLe.getTime() - debutLe.getTime()) / 1000);
}
