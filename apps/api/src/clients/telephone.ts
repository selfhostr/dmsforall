/**
 * Normalisation minimale d'un numéro de téléphone suisse vers E.164.
 *
 * Aucune dépendance externe (`libphonenumber` et consorts) : ce module reste dans le périmètre
 * `apps/api/src/clients/**` et n'a pas vocation à modifier `package.json`. La règle couvre les
 * formats suisses usuels (0791234567, 079 123 45 67, +41791234567, 0041791234567) — un numéro
 * étranger déjà au format `+<pays><reste>` passe tel quel après nettoyage des séparateurs.
 *
 * `null` en sortie : le numéro n'a pas pu être normalisé (forme trop courte, trop longue, ou ne
 * respectant pas la contrainte base `client_telephone_e164_chk` / `client_contact` équivalente,
 * `^\+[1-9][0-9]{6,14}$`). Le champ `telephone` brut est conservé tel quel dans tous les cas —
 * seule la version E.164 (utile à la recherche et à la détection de doublon, RM-05) peut être
 * absente.
 */

const REGEX_E164 = /^\+[1-9][0-9]{6,14}$/;

export function normaliserTelephoneCh(brut: string | null | undefined): string | null {
  if (!brut) return null;

  const nettoye = brut.trim().replace(/[\s().-]/g, '');
  if (nettoye.length === 0) return null;

  let candidat: string;
  if (nettoye.startsWith('+')) {
    candidat = nettoye;
  } else if (nettoye.startsWith('00')) {
    candidat = `+${nettoye.slice(2)}`;
  } else if (nettoye.startsWith('0')) {
    // Convention CH : un numéro national commençant par 0 perd ce zéro au profit de l'indicatif.
    candidat = `+41${nettoye.slice(1)}`;
  } else {
    // Ni `+`, ni `00`, ni `0` : forme non reconnue, on refuse plutôt que de deviner.
    return null;
  }

  return REGEX_E164.test(candidat) ? candidat : null;
}
