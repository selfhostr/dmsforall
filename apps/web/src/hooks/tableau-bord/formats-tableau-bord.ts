/**
 * Formateur du délai moyen de restitution (`delaiMoyenRestitutionMinutes`,
 * `ReponseActiviteTableauBord`) — en MINUTES, peut dépasser 24 h (un OR qui traîne plusieurs
 * jours n'est pas un cas d'erreur, c'est une donnée réelle d'atelier). `hooks/pointage/
 * temps-pointage.ts` (`formaterDureeLisible`) NE CONVIENT PAS ici : il ne connaît que h/min, pas
 * les jours — et il est de toute façon hors du périmètre d'écriture de cet écran.
 *
 * `null` (jamais `0`) signifie « aucun OR restitué sur la période » (voir la doc du champ côté
 * contrat, `packages/shared/src/contrats/tableau-bord/activite.ts`) : cette fonction renvoie
 * `null` tel quel plutôt que d'inventer un texte de repli, pour laisser l'appelant afficher un
 * libellé TRADUIT (« sans donnée », `tableauBord:activite.delaiRestitution.sansDonnee`) plutôt
 * qu'une chaîne en dur ici (ce module n'a pas accès à `t()`).
 */
export function formaterDureeMoyenneTableauBord(minutes: number | null): string | null {
  if (minutes === null) return null;

  const deuxChiffres = (valeur: number) => String(valeur).padStart(2, '0');

  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }

  if (minutes < 24 * 60) {
    const heures = Math.floor(minutes / 60);
    const minutesRestantes = Math.round(minutes % 60);
    return `${heures} h ${deuxChiffres(minutesRestantes)}`;
  }

  const jours = Math.floor(minutes / (24 * 60));
  const heuresRestantes = Math.floor((minutes % (24 * 60)) / 60);
  return heuresRestantes > 0 ? `${jours} j ${heuresRestantes} h` : `${jours} j`;
}
