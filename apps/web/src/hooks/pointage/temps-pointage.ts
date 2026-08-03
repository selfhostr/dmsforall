import { useEffect, useState } from 'react';

/**
 * Aides temporelles propres au pointage : la date du jour (`schemaDateJour`, `YYYY-MM-DD`) au sens
 * du CALENDRIER LOCAL de l'appareil (celui du garagiste, pas UTC — un pointage démarré à 23h50
 * heure suisse reste « aujourd'hui » pour lui), et les bornes ISO de cette même journée locale
 * pour filtrer `GET /pointages?debutDu=&debutAu=`.
 *
 * Aucune bibliothèque de dates ajoutée : `Intl.DateTimeFormat` suffit pour un usage aussi borné,
 * même doctrine que `lib/formats.ts` (`Intl.NumberFormat`/`Intl.DateTimeFormat` natifs partout).
 */

const FORMATEUR_DATE_ISO = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `Date` -> `"YYYY-MM-DD"` en calendrier LOCAL (le format `en-CA` d'`Intl` produit directement
 *  cet ordre — pas de manipulation de chaîne fragile). */
export function dateJourLocale(date: Date = new Date()): string {
  return FORMATEUR_DATE_ISO.format(date);
}

export interface BornesJournee {
  readonly debutDu: string;
  readonly debutAu: string;
}

/** Bornes ISO (UTC, `schemaHorodatage`) de la journée CALENDAIRE LOCALE portant `dateJour`
 *  (`YYYY-MM-DD`) — minuit local inclus à 23:59:59.999 local inclus. Sert à borner
 *  `GET /pointages` sur « aujourd'hui » sans dépendre d'un fuseau serveur. */
export function bornesJourneeLocale(dateJour: string): BornesJournee {
  const parties = dateJour.split('-');
  if (parties.length !== 3) {
    throw new Error(`Format de date invalide, attendu YYYY-MM-DD: ${dateJour}`);
  }

  const annee = Number(parties[0]);
  const mois = Number(parties[1]);
  const jour = Number(parties[2]);

  if (!Number.isFinite(annee) || !Number.isFinite(mois) || !Number.isFinite(jour)) {
    throw new Error(`Conversion en nombre échouée pour la date: ${dateJour}`);
  }

  const debut = new Date(annee, mois - 1, jour, 0, 0, 0, 0);
  const fin = new Date(annee, mois - 1, jour, 23, 59, 59, 999);
  return { debutDu: debut.toISOString(), debutAu: fin.toISOString() };
}

/** Secondes écoulées entre `debutLe` (ISO) et maintenant — jamais négatif (une horloge cliente en
 *  retard sur `debutLe` ne doit pas afficher un chrono négatif). */
function secondesEcoulees(debutLe: string, maintenant: number): number {
  const debut = new Date(debutLe).getTime();
  return Math.max(0, Math.floor((maintenant - debut) / 1000));
}

/** `3725` -> `"01:02:05"` (toujours `HH:MM:SS`, jamais tronqué en dessous de l'heure) : le chrono
 *  d'un pointage peut courir plusieurs heures, `MM:SS` seul redeviendrait ambigu passé 59:59. */
export function formaterChrono(secondes: number): string {
  const h = Math.floor(secondes / 3600);
  const m = Math.floor((secondes % 3600) / 60);
  const s = secondes % 60;
  const deuxChiffres = (valeur: number) => String(valeur).padStart(2, '0');
  return `${deuxChiffres(h)}:${deuxChiffres(m)}:${deuxChiffres(s)}`;
}

/**
 * Chrono live d'un pointage `en_cours` — recalcule les secondes écoulées chaque seconde tant que
 * `debutLe` est fourni (`null`/`undefined` = pas de pointage en cours, aucun timer démarré).
 * Purement AFFICHAGE : la durée de VÉRITÉ (`dureeArrondieCentiemes`, arrondi P-19) n'existe
 * qu'une fois le pointage arrêté et reste calculée par le serveur — ce hook ne l'anticipe jamais.
 */
export function useChronoPointage(debutLe: string | null | undefined): { readonly secondes: number; readonly libelle: string } {
  const [maintenant, setMaintenant] = useState(() => Date.now());

  useEffect(() => {
    if (!debutLe) return;
    const identifiant = window.setInterval(() => setMaintenant(Date.now()), 1000);
    return () => window.clearInterval(identifiant);
  }, [debutLe]);

  const secondes = debutLe ? secondesEcoulees(debutLe, maintenant) : 0;
  return { secondes, libelle: formaterChrono(secondes) };
}
