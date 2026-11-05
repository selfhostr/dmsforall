import type { EtatCapaciteRendezVous } from '@dfa/shared';

/**
 * RV-06/RV-07/RV-08 (`docs/conception-rendez-vous-metier.md` §4) : la capacité affichée informe,
 * elle ne bloque JAMAIS (choix produit #1, « surbooking : avertir, jamais bloquer »). Fonction
 * PURE — aucun accès base, pour rester testable sans DB.
 *
 * RÈGLE MAISON (brief du chantier, quatre défauts produits cette semaine par sa violation) :
 * « on ne sait pas », « aucun » et « zéro » ne partagent jamais le même rendu. Un site qui n'a
 * jamais paramétré `parametre_site.capacite_heures_jour_centiemes` (`NULL` en base) est rendu
 * `'non_definie'` — jamais `'disponible'` (mentirait par excès de confiance) ni implicitement
 * `'complete'` par un `0` de repli (mentirait par excès de blocage).
 *
 * SIMPLIFICATION SIGNALÉE (portée lot RDV-1) : `capaciteMinutes` est le budget JOURNALIER du site
 * (`parametre_site.capacite_heures_jour_centiemes`, converti en minutes), comparé ici à
 * l'occupation d'UN SEUL moment (matin/après-midi/toute_journee) — pas à la somme de la journée
 * entière. `docs/conception-rendez-vous-donnees.md` §2 signale explicitement que la base ne pose
 * aucun plafond dur et renvoie l'arbitrage fin à un lot ultérieur ; cette approximation reste
 * fidèle à l'esprit « avertir, jamais garantir » du lot 1 sans faire dépendre l'affichage d'un
 * moment de l'état des AUTRES moments du même jour (un calcul d'agrégat jour complet est un
 * raffinement, `docs/conception-rendez-vous-donnees.md` §9 : « peut attendre »).
 */
export function calculerEtatCapaciteJour(
  minutesOccupees: number,
  capaciteMinutes: number | null,
): EtatCapaciteRendezVous {
  if (capaciteMinutes === null) return 'non_definie';
  return minutesOccupees >= capaciteMinutes ? 'complete' : 'disponible';
}

/** `parametre_site.capacite_heures_jour_centiemes` (centièmes d'heure) → minutes. `null` si le
 *  site n'a jamais paramétré sa capacité (RV-08) — jamais converti en `0`. */
export function capaciteMinutesDepuisCentiemes(
  capaciteHeuresJourCentiemes: number | null,
): number | null {
  if (capaciteHeuresJourCentiemes === null) return null;
  return Math.round(capaciteHeuresJourCentiemes * 0.6);
}

/**
 * Durée (minutes) à consommer pour un rendez-vous depuis son motif catalogué — RV-01/RV-02 : un
 * motif porte `dureeDefautMinutes` (créneau réel) OU `heuresAtelierDefautCentiemes` (capacité de
 * journée, converti ici en minutes pour rester dans la MÊME unité que `rendez_vous
 * .duree_estimee_minutes`, NOT NULL en base — voir `migrations/0052` §B.2). `null` seulement si le
 * motif ne porte AUCUNE des deux grandeurs (donnée de référentiel incomplète) : dans ce cas
 * l'appelant doit exiger une valeur explicite plutôt que d'inventer un défaut.
 */
/** Plafond défensif sur `GET /rendez-vous/capacite` : au-delà, la requête est probablement une
 *  erreur de client (bornes inversées, année entière) plutôt qu'un usage normal (planning
 *  quotidien/hebdomadaire). Rejet explicite, jamais un calcul silencieusement tronqué. */
export const MAX_JOURS_CAPACITE = 62;

/**
 * Énumère les dates `AAAA-MM-JJ` inclusives entre `du` et `au` — arithmétique en UTC pur sur des
 * CHAÎNES, jamais via un `Date` local, pour ne dépendre d'aucun fuseau (même précaution que
 * `common/pagination/valeur-temporelle.ts` avec la microseconde : rester sur ce que la donnée EST
 * plutôt que sur ce qu'un type JS en ferait).
 */
export function enumererDatesInclusives(du: string, au: string): readonly string[] {
  const debut = Date.parse(`${du}T00:00:00.000Z`);
  const fin = Date.parse(`${au}T00:00:00.000Z`);
  if (Number.isNaN(debut) || Number.isNaN(fin)) {
    throw new Error(`enumererDatesInclusives : bornes invalides ("${du}" .. "${au}").`);
  }
  if (fin < debut) return [];

  const nombreJours = Math.round((fin - debut) / 86_400_000) + 1;
  if (nombreJours > MAX_JOURS_CAPACITE) {
    throw new Error(
      `enumererDatesInclusives : période de ${String(nombreJours)} jours au-delà du plafond (${String(MAX_JOURS_CAPACITE)}).`,
    );
  }

  const dates: string[] = [];
  for (let i = 0; i < nombreJours; i += 1) {
    dates.push(new Date(debut + i * 86_400_000).toISOString().slice(0, 10));
  }
  return dates;
}

export function dureeMinutesDepuisMotif(motif: {
  readonly dureeDefautMinutes: number | null;
  readonly heuresAtelierDefautCentiemes: number | null;
}): number | null {
  if (motif.dureeDefautMinutes !== null) return motif.dureeDefautMinutes;
  if (motif.heuresAtelierDefautCentiemes !== null) {
    return Math.round(motif.heuresAtelierDefautCentiemes * 0.6);
  }
  return null;
}
