/**
 * Formats suisses imposés au produit (`CONTRIBUTING.md`) : montants `1'234.50` (apostrophe séparateur de
 * milliers, deux décimales toujours), dates `jj.mm.aaaa`. Arithmétique entière sur les centimes —
 * jamais de flottant, jamais `toLocaleString` (dépendant de l'environnement d'exécution, donc pas
 * reproductible d'un déploiement à l'autre — `Intl` n'est pas utilisé ici pour cette raison).
 */

import type { DeviseFacturation } from '@dfa/shared';

/** `centimes` : entier signé. `100050` → `"1'000.50"`, `-500` → `"-5.00"`, `0` → `"0.00"`. */
export function formaterMontantCentimes(centimes: number): string {
  if (!Number.isInteger(centimes)) {
    throw new RangeError(`formaterMontantCentimes attend un entier de centimes, reçu ${centimes}.`);
  }
  const signe = centimes < 0 ? '-' : '';
  const abs = Math.abs(centimes);
  const francsEntiers = Math.trunc(abs / 100);
  const centimesRestants = abs % 100;

  const francsStr = String(francsEntiers);
  const groupes: string[] = [];
  for (let i = francsStr.length; i > 0; i -= 3) {
    groupes.unshift(francsStr.slice(Math.max(0, i - 3), i));
  }
  const francsFormates = groupes.join("'");

  return `${signe}${francsFormates}.${String(centimesRestants).padStart(2, '0')}`;
}

/**
 * `centimes` + devise du document (`ReponseDocumentVente.devise`, `CHF`/`EUR`) -> `"CHF 1'234.50"`
 * / `"EUR 1'234.50"` — même convention que `apps/web/src/lib/formats.ts::formaterMontantAvecDevise`
 * (front), reproduite ici plutôt que partagée : ce module PDF (`apps/api/src/facturation/
 * impression/`) n'a pas de dépendance vers `apps/web/`, et l'inverse n'a pas de sens non plus (le
 * front ne génère aucun PDF côté navigateur) — deux applications séparées, une même règle
 * d'affichage suisse, dupliquée une fois plutôt que d'inventer un couplage inter-app pour ça.
 *
 * Bug #126 (PDF facture) : `formaterMontantCentimes` seule ne porte JAMAIS la devise — c'était déjà
 * son contrat (montant nu, réutilisé partout, y compris hors contexte facturation) — et
 * `generation-pdf-facture.ts` l'appelait directement sur chaque montant du CORPS du document (lignes,
 * ventilation TVA, totaux), sans jamais composer de préfixe monétaire : seul le bulletin QR
 * (`swissqrbill`, à qui `currency` est bien transmis) affichait `CHF`. Un document peut porter
 * `devise = 'EUR'` (`DEVISES_FACTURATION`, `MD-58`) : un montant nu dans le corps du PDF, à côté
 * d'un bulletin QR qui affiche `EUR`, se lirait par défaut comme des francs suisses — silencieusement
 * faux. `formaterMontantCentimes` reste PURE et inchangée (déjà testée, réutilisée sans devise
 * ailleurs) ; c'est cette fonction, appelée au site d'affichage, qui compose le préfixe — jamais
 * l'inverse. */
export function formaterMontantAvecDevise(centimes: number, devise: DeviseFacturation): string {
  return `${devise} ${formaterMontantCentimes(centimes)}`;
}

/** `dateIso` : `"YYYY-MM-DD"` ou horodatage ISO complet (`"YYYY-MM-DDTHH:mm:ss.sssZ"`) — seuls les
 *  10 premiers caractères comptent. `"2026-07-29"` → `"29.07.2026"`. */
export function formaterDateSuisse(dateIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso);
  // `noUncheckedIndexedAccess` : les groupes capturants sont typés `string | undefined` même après
  // le contrôle `!m` — structurellement toujours présents ici (regex ancrée, 3 groupes fixes), mais
  // l'absence est traitée explicitement plutôt qu'écartée par une assertion.
  const annee = m?.[1];
  const mois = m?.[2];
  const jour = m?.[3];
  if (!annee || !mois || !jour) {
    throw new RangeError(
      `formaterDateSuisse attend une date ISO ("YYYY-MM-DD..."), reçu "${dateIso}".`,
    );
  }
  return `${jour}.${mois}.${annee}`;
}

/** `"2026-07-29"` + 30 → `"2026-08-28"`. Calcul en UTC pur (aucun fuseau local, aucun décalage
 *  d'heure d'été) ; seuls les 10 premiers caractères de `dateIso` comptent. */
export function ajouterJoursIso(dateIso: string, jours: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso);
  if (!m) {
    throw new RangeError(
      `ajouterJoursIso attend une date ISO ("YYYY-MM-DD..."), reçu "${dateIso}".`,
    );
  }
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + jours));
  return date.toISOString().slice(0, 10);
}
