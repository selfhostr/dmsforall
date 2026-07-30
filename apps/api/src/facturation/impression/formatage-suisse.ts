/**
 * Formats suisses imposés au produit (`CONTRIBUTING.md`) : montants `1'234.50` (apostrophe séparateur de
 * milliers, deux décimales toujours), dates `jj.mm.aaaa`. Arithmétique entière sur les centimes —
 * jamais de flottant, jamais `toLocaleString` (dépendant de l'environnement d'exécution, donc pas
 * reproductible d'un déploiement à l'autre — `Intl` n'est pas utilisé ici pour cette raison).
 */

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
    throw new RangeError(`formaterDateSuisse attend une date ISO ("YYYY-MM-DD..."), reçu "${dateIso}".`);
  }
  return `${jour}.${mois}.${annee}`;
}
