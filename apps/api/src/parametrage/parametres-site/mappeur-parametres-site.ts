import type { EntreeModificationParametresSite } from '@dfa/shared';
import { schema } from '../../db';

export interface DtoParametresSite {
  readonly siteId: string;
  readonly heureOuverture: string | null;
  readonly heureFermeture: string | null;
  readonly heureCloturePointage: string | null;
  readonly capaciteHeuresJourCentiemes: number | null;
  readonly joursFermeture: readonly string[];
  readonly version: number;
}

/**
 * Le driver `pg` rend une colonne `time` en `HH:MM:SS` (ou `HH:MM:SS.ffffff`) ; le contrat
 * n'admet que `HH:MM` (même forme que l'entrée, régie par `schemaModificationParametresSite`,
 * `packages/shared`). Tronqué ici plutôt que reconfiguré au niveau du driver — une conversion de
 * portée globale toucherait potentiellement d'autres colonnes `time` hors de ce module.
 */
function versHeureCourte(valeur: string | null): string | null {
  return valeur === null ? null : valeur.slice(0, 5);
}

export function versDtoParametresSite(ligne: schema.LigneParametreSite): DtoParametresSite {
  return {
    siteId: ligne.siteId,
    heureOuverture: versHeureCourte(ligne.heureOuverture),
    heureFermeture: versHeureCourte(ligne.heureFermeture),
    heureCloturePointage: versHeureCourte(ligne.heureCloturePointage),
    capaciteHeuresJourCentiemes: ligne.capaciteHeuresJourCentiemes,
    joursFermeture: (ligne.joursFermeture ?? []) as readonly string[],
    version: ligne.modifieLe.getTime(),
  };
}

export function versColonnesMiseAJourSite(
  entree: EntreeModificationParametresSite,
): Partial<typeof schema.parametreSite.$inferInsert> {
  const colonnes: Partial<typeof schema.parametreSite.$inferInsert> = {};

  if (entree.heureOuverture !== undefined) colonnes.heureOuverture = entree.heureOuverture;
  if (entree.heureFermeture !== undefined) colonnes.heureFermeture = entree.heureFermeture;
  if (entree.heureCloturePointage !== undefined) colonnes.heureCloturePointage = entree.heureCloturePointage;
  if (entree.capaciteHeuresJourCentiemes !== undefined) {
    colonnes.capaciteHeuresJourCentiemes = entree.capaciteHeuresJourCentiemes;
  }
  if (entree.joursFermeture !== undefined) colonnes.joursFermeture = entree.joursFermeture;

  return colonnes;
}
