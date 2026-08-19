/**
 * Bornage de journée civile et conversions heure-locale ↔ UTC pour le fuseau UNIQUE du produit —
 * `Europe/Zurich` (décision de @laupernoe, 14.08.2026 : un seul fuseau pour tout dmsforall, pas de colonne
 * réglable par site — le produit vise les garages suisses, une configuration supplémentaire pour un
 * besoin qui n'existe pas serait une source d'erreur, pas un progrès). L'heure d'été (CEST, UTC+2)
 * et l'heure d'hiver (CET, UTC+1) sont dérivées à l'exécution via `Intl.DateTimeFormat` — c'est-à-dire
 * la base tzdata (IANA) fournie par le moteur Node lui-même — JAMAIS un décalage fixe codé en dur,
 * qui se romprait deux fois par an (bascules de fin mars / fin octobre).
 *
 * REMPLACE la doctrine « borne de journée en UTC pur » mesurée le 14.08.2026, jusqu'ici dupliquée à
 * TROIS endroits, tous affectés du même écart d'une heure (hiver) à deux heures (été) autour de
 * minuit local :
 *  - `pointage/service-verrouillage-periode.ts::finDeJournee` (RM-95) — RECÂBLÉ sur ce fichier ;
 *  - `pointage/regles-pointage.ts::journeeTravailCourante` — RECÂBLÉ sur ce fichier ;
 *  - `atelier/service-or.ts::debutDeJourneeUtc`/`finDeJourneeUtc` — HORS PÉRIMÈTRE de ce chantier
 *    (propriété d'un autre agent, `atelier/` n'est pas dans le périmètre d'écriture de celui-ci) :
 *    PAS recâblé ici, signalé dans le rapport de livraison pour que son propriétaire le fasse.
 *
 * Posé dans `common/` plutôt que dans `pointage/` : un seul propriétaire pour une seule vérité, alors
 * que le bornage de journée sert déjà DEUX domaines (pointage, atelier) et sert désormais aussi la
 * clôture automatique de fin de journée (RM-91/RM-119, `pointage/service-cloture-automatique-
 * pointage.ts`), qui doit combiner une date civile avec l'heure de fermeture d'un site
 * (`parametre_site.heure_cloture_pointage`, colonne `time`, format `HH:MM[:SS]`).
 */

const FUSEAU_SUISSE = 'Europe/Zurich';

/** `AAAA-MM-JJ` — locale `en-CA` choisie UNIQUEMENT parce qu'elle formate nativement dans cet
 *  ordre (`Intl` n'a pas de format ISO dédié) ; aucun rapport avec le Canada. */
const FORMATEUR_JOUR_CIVIL = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSEAU_SUISSE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const FORMATEUR_HORLOGE = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSEAU_SUISSE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/**
 * `AAAA-MM-JJ` du jour civil SUISSE qui contient `instant` — JAMAIS
 * `instant.toISOString().slice(0, 10)`, qui donne le jour civil UTC : faux entre minuit UTC et
 * minuit Europe/Zurich, DEUX FOIS PAR JOUR toute l'année (jusqu'à 2h d'écart en hiver, 1h en été,
 * jamais 0). C'est exactement le bug mesuré le 14.08.2026 : un pointage saisi à 00h30 heure suisse
 * en été correspond à 22h30 UTC LA VEILLE — `toISOString().slice(0, 10)` lui attribuait le jour
 * civil suisse d'HIER, jamais celui d'aujourd'hui (voir `fuseau-suisse.spec.ts`, cas « 00h30 été »,
 * qui verrouille précisément ce défaut).
 */
export function jourCivilSuisse(instant: Date): string {
  return FORMATEUR_JOUR_CIVIL.format(instant);
}

/** Décalage Europe/Zurich (en minutes, à l'EST de UTC — +60 CET l'hiver, +120 CEST l'été) EN
 *  VIGUEUR à l'instant UTC donné (`heure locale = UTC + décalage`). */
function decalageMinutesZurich(instantUtc: Date): number {
  const parties = Object.fromEntries(
    FORMATEUR_HORLOGE.formatToParts(instantUtc).map((p) => [p.type, p.value]),
  );
  const relu = Date.UTC(
    Number(parties.year),
    Number(parties.month) - 1,
    Number(parties.day),
    Number(parties.hour),
    Number(parties.minute),
    Number(parties.second),
  );
  return Math.round((relu - instantUtc.getTime()) / 60000);
}

/**
 * Instant UTC correspondant à l'heure locale `heureHHmm` (`'HH:MM'`, `'HH:MM:SS'` ou
 * `'HH:MM:SS.mmm'` — accepte aussi ce que rend la colonne `time` de Postgres via le pilote `pg`)
 * du jour civil SUISSE `dateJour` (`'AAAA-MM-JJ'`). Point de conversion UNIQUE de ce fichier —
 * `debutJourneeSuisse`/`finJourneeSuisse` ne sont que des appels à heure fixe (voir plus bas).
 *
 * MÉTHODE — point fixe par itération (même patron qu'utilisent en interne des bibliothèques comme
 * `date-fns-tz`/`luxon`, sans dépendance ajoutée à ce dépôt) : le décalage CET/CEST ne prend que
 * DEUX valeurs (60 ou 120 minutes), qui ne changent qu'à 2h/3h du matin heure locale — DEUX
 * itérations suffisent TOUJOURS à converger, y compris pour une heure locale tombant le jour même
 * d'une bascule (voir les tests aux deux bascules de 2026, `fuseau-suisse.spec.ts`) : la première
 * itération part d'une estimation au pire à 2h de la vraie réponse (l'écart maximal entre CET et
 * CEST, interprétant l'heure locale comme si elle était déjà de l'UTC), la seconde affine sur le
 * décalage lu à cette estimation — un troisième tour ne changerait plus rien, le décalage lu au
 * premier relevé étant déjà stable pour toute heure locale réellement en vigueur ce jour-là (la
 * fenêtre d'ambiguïté d'une bascule elle-même dure moins d'une heure, largement dans la marge de
 * cette convergence à deux tours).
 */
export function instantLocalSuisse(dateJour: string, heureHHmm: string): Date {
  const partiesDate = dateJour.split('-').map(Number);
  const annee = partiesDate[0] ?? 1970;
  const mois = partiesDate[1] ?? 1;
  const jour = partiesDate[2] ?? 1;

  const segments = heureHHmm.split(':').map(Number);
  const heure = segments[0] ?? 0;
  const minute = segments[1] ?? 0;
  const secondeEtMs = segments[2] ?? 0;
  const seconde = Math.trunc(secondeEtMs);
  const ms = Math.round((secondeEtMs - seconde) * 1000);

  const cible = (): number => Date.UTC(annee, mois - 1, jour, heure, minute, seconde, ms);

  let estimationUtc = cible();
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const decalage = decalageMinutesZurich(new Date(estimationUtc));
    estimationUtc = cible() - decalage * 60000;
  }
  return new Date(estimationUtc);
}

/** Début (00:00:00.000 heure suisse) du jour civil `dateJour` — borne inférieure INCLUSE. */
export function debutJourneeSuisse(dateJour: string): Date {
  return instantLocalSuisse(dateJour, '00:00:00.000');
}

/** Fin (23:59:59.999 heure suisse) du jour civil `dateJour` — borne supérieure INCLUSE. */
export function finJourneeSuisse(dateJour: string): Date {
  return instantLocalSuisse(dateJour, '23:59:59.999');
}
