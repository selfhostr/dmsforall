import type { FiltreTableauBord, PeriodeResolueTableauBord } from '@dfa/shared';

import { debutJourneeSuisse, finJourneeSuisse, jourCivilSuisse } from '../common/temps';
import { ErreurMetier } from '../common/erreurs';

/**
 * Résolution de la période effective (voir la doc de `schemaFiltreTableauBord`,
 * `@dfa/shared/contrats/tableau-bord/query.ts`, pour le choix du mois civil SUISSE par défaut).
 *
 * `duDebutUtc`/`auFinExclusiveUtc` : bornes UTC calculées UNE FOIS ici, jamais recalculées en SQL —
 * elles servent les colonnes `timestamptz` (`ordre_reparation.ouvert_le`/`restitue_le`), comparées
 * en `[duDebutUtc, auFinExclusiveUtc)` (borne haute EXCLUSIVE) pour inclure TOUTE la journée `au`,
 * heure locale SUISSE (`Europe/Zurich`), quelle que soit l'heure exacte de l'évènement ce jour-là.
 *
 * RECÂBLÉ sur `common/temps/fuseau-suisse.ts` (14.08.2026) — CORRIGE un défaut mesuré le même jour
 * en test manuel (compte direction, période « Aujourd'hui ») : l'ancienne implémentation bornait la
 * journée en UTC PUR (`` `${du}T00:00:00.000Z` ``), pas en heure suisse — le même bug que celui déjà
 * corrigé dans `pointage/service-verrouillage-periode.ts`/`pointage/regles-pointage.ts` (voir
 * l'en-tête de `fuseau-suisse.ts`), jamais recâblé ICI jusqu'à ce lot. En été (CEST, UTC+2), la
 * fenêtre UTC `[00:00, 24:00)` manque les deux premières heures locales du jour (`00:00`-`02:00`
 * heure suisse, encore comptées dans la veille) et déborde de deux heures sur le jour suivant —
 * `periode.spec.ts` verrouille désormais les bornes correctes, une par une, sur des dates d'été et
 * d'hiver (mêmes dates de bascule que `fuseau-suisse.spec.ts`).
 *
 * `debutJourneeSuisse(du)` donne directement la borne basse INCLUSE ; `finJourneeSuisse(au)` donne
 * la fin INCLUSE du jour `au` (`23:59:59.999` heure suisse) — `+ 1ms` la rend EXCLUSIVE sans
 * arithmétique de date propre (traverse mois/année sans risque de bug de report, `Date` gère le
 * dépassement de milliseconde nativement).
 *
 * Les colonnes `date` pures (`document_vente.date_document`, `paiement.date_valeur`) n'ont pas
 * besoin de ces bornes UTC : `du`/`au` (chaînes `aaaa-mm-jj`) leur sont comparées directement,
 * bornes INCLUSES des deux côtés — voir les services financier/activité.
 */
export interface BornesPeriodeTableauBord extends PeriodeResolueTableauBord {
  readonly duDebutUtc: Date;
  readonly auFinExclusiveUtc: Date;
}

function premierJourDuMoisSuisse(date: Date): string {
  return `${jourCivilSuisse(date).slice(0, 7)}-01`;
}

/**
 * `maintenant` injectable (par défaut `new Date()`) — seul point de non-déterminisme de ce module,
 * isolé pour que les tests unitaires figent une date de référence sans mock global de l'horloge.
 */
export function resoudrePeriodeTableauBord(
  filtre: FiltreTableauBord,
  maintenant: Date = new Date(),
): BornesPeriodeTableauBord {
  const au = filtre.au ?? jourCivilSuisse(maintenant);
  const du = filtre.du ?? premierJourDuMoisSuisse(maintenant);

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

  const duDebutUtc = debutJourneeSuisse(du);
  const auFinExclusiveUtc = new Date(finJourneeSuisse(au).getTime() + 1);

  return { du, au, duDebutUtc, auFinExclusiveUtc };
}
