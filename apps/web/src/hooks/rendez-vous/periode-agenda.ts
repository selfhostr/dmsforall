/**
 * Calculs de période PURS pour l'agenda de rendez-vous — aucun état, aucun accès réseau : la
 * bascule Jour/Semaine et la navigation précédent/suivant/aujourd'hui (`docs/conception-rendez-vous-
 * ecrans.md`, Écran 1) s'appuient dessus. Semaine = lundi -> dimanche (convention suisse), jamais
 * dimanche -> samedi.
 */

/** aaaa-mm-jj en heure LOCALE (jamais `toISOString()`, qui bascule en UTC et peut faire déborder la
 *  date d'un jour selon le fuseau) — même précaution que `versDateIsoLocale` (`ecrans/accueil/semaine.ts`),
 *  reprise ici en propre plutôt qu'importée : `hooks/rendez-vous/` ne dépend pas d'`ecrans/accueil/`. */
export function versDateIsoLocale(date: Date): string {
  const annee = date.getFullYear();
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${annee}-${mois}-${jour}`;
}

/** Lundi de la semaine contenant `date` (heure locale à minuit). */
export function debutSemaine(date: Date): Date {
  const resultat = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const jourSemaine = resultat.getDay(); // 0 = dimanche
  const decalage = jourSemaine === 0 ? -6 : 1 - jourSemaine;
  resultat.setDate(resultat.getDate() + decalage);
  return resultat;
}

export function ajouterJours(date: Date, nombre: number): Date {
  const resultat = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  resultat.setDate(resultat.getDate() + nombre);
  return resultat;
}

/** Les sept jours (lundi -> dimanche) de la semaine contenant `date`. */
export function joursDeLaSemaine(date: Date): readonly Date[] {
  const lundi = debutSemaine(date);
  return Array.from({ length: 7 }, (_, index) => ajouterJours(lundi, index));
}
