/**
 * Décomposeur du délai moyen de restitution (`delaiMoyenRestitutionMinutes`,
 * `ReponseActiviteTableauBord`) — en MINUTES, peut dépasser 24 h (un OR qui traîne plusieurs
 * jours n'est pas un cas d'erreur, c'est une donnée réelle d'atelier). `hooks/pointage/
 * temps-pointage.ts` (`formaterDureeLisible`) NE CONVIENT PAS ici : il ne connaît que h/min, pas
 * les jours — et il est de toute façon hors du périmètre d'écriture de cet écran.
 *
 * `null` (jamais `0`) signifie « aucun OR restitué sur la période » (voir la doc du champ côté
 * contrat, `packages/shared/src/contrats/tableau-bord/activite.ts`) : cette fonction renvoie
 * `null` tel quel, l'appelant affiche alors le libellé TRADUIT `tableauBord:activite.
 * delaiRestitution.sansDonnee`.
 *
 * Renvoie une valeur DÉCOMPOSÉE (jours/heures/minutes + granularité), jamais une chaîne déjà
 * assemblée : ce module n'a pas accès à `t()` (ce n'est pas un composant), donc composer ici
 * « min »/« h »/« j » en dur produirait un texte figé en français pour toutes les langues — un
 * garagiste alémanique lirait « 3 j 4 h » au lieu de « 3 T 4 Std ». C'est à l'appelant
 * (`BlocActiviteTableauBord`, qui a `t()`) de choisir la clé i18n correspondant à `granularite` et
 * d'y interpoler les nombres ci-dessous.
 */

export type GranulariteDureeTableauBord = 'minutes' | 'heuresMinutes' | 'joursHeures' | 'jours';

export interface DureeMoyenneTableauBord {
  /** Quelle clé i18n composer côté appelant (`tableauBord:activite.delaiRestitution.<granularite>`). */
  readonly granularite: GranulariteDureeTableauBord;
  readonly jours: number;
  readonly heures: number;
  readonly minutes: number;
}

export function formaterDureeMoyenneTableauBord(
  minutes: number | null,
): DureeMoyenneTableauBord | null {
  if (minutes === null) return null;

  if (minutes < 60) {
    return { granularite: 'minutes', jours: 0, heures: 0, minutes: Math.round(minutes) };
  }

  if (minutes < 24 * 60) {
    const heures = Math.floor(minutes / 60);
    const minutesRestantes = Math.round(minutes % 60);
    return { granularite: 'heuresMinutes', jours: 0, heures, minutes: minutesRestantes };
  }

  const jours = Math.floor(minutes / (24 * 60));
  const heuresRestantes = Math.floor((minutes % (24 * 60)) / 60);
  return {
    granularite: heuresRestantes > 0 ? 'joursHeures' : 'jours',
    jours,
    heures: heuresRestantes,
    minutes: 0,
  };
}
