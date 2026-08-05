/**
 * Urgence d'une échéance (`LigneSuiviVente.prochaineEcheanceLe`, une date `aaaa-mm-jj`, jamais un
 * horodatage) — pur calcul d'affichage, aucune règle métier ici (le serveur a déjà décidé CE QUI
 * est visible et CE QUI est calculable, voir `contrats/ventes/suivi.ts`). Comparaison au jour
 * calendaire, jamais à la milliseconde près : une échéance « aujourd'hui » ne doit pas basculer
 * en « échue » selon l'heure de consultation.
 */

export type NiveauUrgence = 'echue' | 'imminente' | 'proche' | 'lointaine';

const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

/** Nombre de jours (signé, peut être négatif) entre `aujourdHui` et la date ISO `aaaa-mm-jj`
 *  donnée — `0` pour aujourd'hui même, négatif pour une échéance déjà dépassée. */
export function calculerJoursRestants(dateIso: string, aujourdHui: Date): number {
  const debutJourCible = new Date(`${dateIso}T00:00:00`);
  const debutJourReference = new Date(
    aujourdHui.getFullYear(),
    aujourdHui.getMonth(),
    aujourdHui.getDate(),
  );
  return Math.round((debutJourCible.getTime() - debutJourReference.getTime()) / MS_PAR_JOUR);
}

/** Seuils d'urgence — ce qui saute aux yeux (échue/imminente, ≤ 7 jours), ce qui reste visible
 *  mais discret (proche, ≤ 30 jours) et le reste (lointaine). Pas de règle métier : un pur
 *  regroupement d'affichage, ajustable sans toucher au contrat serveur. */
export function determinerNiveauUrgence(joursRestants: number): NiveauUrgence {
  if (joursRestants < 0) return 'echue';
  if (joursRestants <= 7) return 'imminente';
  if (joursRestants <= 30) return 'proche';
  return 'lointaine';
}
