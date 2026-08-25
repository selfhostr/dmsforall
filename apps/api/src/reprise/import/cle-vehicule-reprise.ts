/**
 * Clé de déduplication véhicule — pur, sans accès base.
 *
 * PIÈGE VÉRIFIÉ (brief) : un VIN de 17 caractères est contrôlé ailleurs dans le produit, mais un
 * VIN d'une autre longueur passe SANS AUCUN CONTRÔLE dès qu'on l'utilise comme clé de
 * rapprochement — des valeurs comme `"0"`, `"N/A"`, `"-"`, ou un numéro de châssis tronqué à 6
 * caractères (courant sur les archives pré-2010) deviendraient alors une clé qui rapprocherait à
 * tort des dizaines de véhicules distincts entre eux. Ce module refuse explicitement tout VIN qui
 * n'a pas EXACTEMENT 17 caractères alphanumériques (norme ISO 3779) comme clé fiable — sous cette
 * forme, la clé de repli est `numeroOrigine` (l'identifiant SOURCE, toujours fiable puisque
 * garanti unique par la table d'origine) plutôt qu'un VIN suspect.
 */

const REGEX_VIN_VALIDE = /^[A-HJ-NPR-Z0-9]{17}$/i;

export interface CleDeduplicationVehicule {
  readonly cle: string;
  /** `true` = clé fondée sur un VIN valide (17 caractères) — priorité de rapprochement la plus
   *  haute. `false` = repli sur `numeroOrigine`, jamais sur un VIN non fiable. */
  readonly fondeeSurVin: boolean;
}

export function normaliserVin(vinBrut: string | null | undefined): string | null {
  if (!vinBrut) return null;
  const normalise = vinBrut.trim().toUpperCase().replace(/\s+/g, '');
  return REGEX_VIN_VALIDE.test(normalise) ? normalise : null;
}

export function calculerCleVehicule(
  vinBrut: string | null | undefined,
  numeroOrigine: string,
): CleDeduplicationVehicule {
  const vin = normaliserVin(vinBrut);
  if (vin) return { cle: `vin:${vin}`, fondeeSurVin: true };
  return { cle: `origine:${numeroOrigine}`, fondeeSurVin: false };
}
