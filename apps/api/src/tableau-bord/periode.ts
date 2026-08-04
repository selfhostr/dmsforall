import type { FiltreTableauBord, PeriodeResolueTableauBord } from '@dfa/shared';

import { ErreurMetier } from '../common/erreurs';

/**
 * Résolution de la période effective (voir la doc de `schemaFiltreTableauBord`,
 * `@dfa/shared/contrats/tableau-bord/query.ts`, pour le choix du mois civil UTC par défaut).
 *
 * `duDebutUtc`/`auFinExclusiveUtc` : bornes UTC calculées UNE FOIS ici, jamais recalculées en SQL —
 * elles servent les colonnes `timestamptz` (`ordre_reparation.ouvert_le`/`restitue_le`), comparées
 * en `[duDebutUtc, auFinExclusiveUtc)` (borne haute EXCLUSIVE, un jour après `au`) pour inclure
 * TOUTE la journée `au`, quelle que soit l'heure exacte de l'évènement ce jour-là — sans dépendre
 * du fuseau horaire de la session Postgres (voir CONTRIBUTING.md, piège vérifié sur `timestamptz`→`Date`).
 * Les colonnes `date` pures (`document_vente.date_document`, `paiement.date_valeur`) n'ont pas
 * besoin de ces bornes UTC : `du`/`au` (chaînes `aaaa-mm-jj`) leur sont comparées directement,
 * bornes INCLUSES des deux côtés — voir les services financier/activité.
 */
export interface BornesPeriodeTableauBord extends PeriodeResolueTableauBord {
  readonly duDebutUtc: Date;
  readonly auFinExclusiveUtc: Date;
}

function formatDateJourUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function premierJourDuMoisUtc(date: Date): string {
  return `${formatDateJourUtc(date).slice(0, 7)}-01`;
}

/**
 * `maintenant` injectable (par défaut `new Date()`) — seul point de non-déterminisme de ce module,
 * isolé pour que les tests unitaires figent une date de référence sans mock global de l'horloge.
 */
export function resoudrePeriodeTableauBord(
  filtre: FiltreTableauBord,
  maintenant: Date = new Date(),
): BornesPeriodeTableauBord {
  const au = filtre.au ?? formatDateJourUtc(maintenant);
  const du = filtre.du ?? premierJourDuMoisUtc(maintenant);

  // `schemaFiltreTableauBord` (zod) vérifie `du <= au` UNIQUEMENT quand les DEUX sont fournis par
  // l'appelant — un seul des deux fourni contourne ce refine. Exemple réel : `au=2026-01-15` seul,
  // appelé le `2026-08-20`, donnerait `du` par défaut = `2026-08-01` (mois CIVIL COURANT) > `au` =
  // `2026-01-15` — une période inversée renvoyée SANS ERREUR si on ne revérifiait pas ici, APRÈS
  // résolution des défauts. Un `du` explicite dans le futur par rapport à `au` par défaut
  // (aujourd'hui) tombe dans le même cas. D'où cette garde, après coup, sur les valeurs RÉSOLUES —
  // pas seulement sur les valeurs fournies.
  if (du > au) {
    throw new ErreurMetier(
      'VALIDATION_ECHOUEE',
      `Période invalide après résolution des valeurs par défaut : du (${du}) postérieur à au (${au}).`,
    );
  }

  const duDebutUtc = new Date(`${du}T00:00:00.000Z`);
  const auFinExclusiveUtc = new Date(`${au}T00:00:00.000Z`);
  auFinExclusiveUtc.setUTCDate(auFinExclusiveUtc.getUTCDate() + 1);

  return { du, au, duDebutUtc, auFinExclusiveUtc };
}
