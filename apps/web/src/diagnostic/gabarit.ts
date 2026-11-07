/**
 * Gabarits de route : jamais l'identifiant réel d'une ressource dans un diagnostic.
 * UUID, nombres et tout segment contenant un chiffre (n° d'OR, plaque, VIN…) deviennent `:id`.
 * La query string et le fragment sont retirés. Seul `v1`, `v2`… (version d'API) est conservé.
 */

const RE_VERSION_API = /^v\d+$/i;

function segmentVersGabarit(segment: string): string {
  if (segment === '') return segment;
  if (RE_VERSION_API.test(segment)) return segment;
  return /\d/.test(segment) ? ':id' : segment;
}

/** `/atelier/or/3f2a…?onglet=2#haut` -> `/atelier/or/:id`. */
export function gabaritRoute(chemin: string): string {
  const sansQuery = chemin.split('#')[0]?.split('?')[0] ?? '';
  const brut = sansQuery.startsWith('/') ? sansQuery : `/${sansQuery}`;
  const gabarit = brut.split('/').map(segmentVersGabarit).join('/');
  return gabarit === '' ? '/' : gabarit;
}

/** Gabarit du chemin d'une URL (absolue ou relative à `base`). URL illisible -> `/`. */
export function gabaritUrl(url: string, base: string = 'http://localhost'): string {
  try {
    return gabaritRoute(new URL(url, base).pathname);
  } catch {
    return '/';
  }
}
