/**
 * Présélections de la prise de rendez-vous — pures, pour que la réceptionniste n'ait jamais à
 * deviner ce que l'application sait déjà.
 */

/** Site affiché : celui de l'URL (`?site=`), sinon la préférence du poste, sinon l'unique site du
 *  garage. `undefined` seulement s'il y a vraiment un choix à faire. Un identifiant inconnu de la
 *  session (URL périmée) n'est jamais retenu par la préférence/l'unique site. */
export function resoudreSiteId(
  siteUrl: string | null,
  preferenceSiteId: string | undefined,
  sites: readonly { readonly id: string }[],
): string | undefined {
  if (siteUrl) return siteUrl;
  if (preferenceSiteId && sites.some((s) => s.id === preferenceSiteId)) return preferenceSiteId;
  return sites.length === 1 ? sites[0]?.id : undefined;
}

/** Véhicule du rendez-vous : le choix explicite, sinon l'unique véhicule du client, sinon rien
 *  (liste à choisir). `ignore` = « continuer sans véhicule connu » : jamais de présélection. */
export function vehiculeParDefaut<T>(
  choisi: T | null,
  vehiculesClient: readonly T[],
  ignore: boolean,
): T | null {
  if (choisi) return choisi;
  if (ignore) return null;
  return vehiculesClient.length === 1 ? (vehiculesClient[0] ?? null) : null;
}
