import type { ReponseLogoEntreprise } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { construireErreurApi, ErreurApi, ErreurReseau } from '@/api/erreurs';
import { obtenirEnv } from '@/config/env';
import i18n from '@/i18n';

const CHEMIN = '/parametres-entreprise/logo';
const DELAI_ENVOI_MS = 30_000;

/** `GET /parametres-entreprise/logo` — les octets de l'image ; `null` = aucun logo déposé (404). */
export async function recupererLogoEntreprise(): Promise<Blob | null> {
  let reponse: Response;
  try {
    reponse = await fetch(`${obtenirEnv().VITE_API_URL}${CHEMIN}`, {
      credentials: 'include',
      headers: { 'Accept-Language': i18n.language },
      signal: AbortSignal.timeout(DELAI_ENVOI_MS),
    });
  } catch (cause) {
    throw new ErreurReseau(cause);
  }
  if (reponse.status === 404) return null;
  if (!reponse.ok) throw construireErreurApi(reponse, await reponse.text());
  return reponse.blob();
}

/** `PUT /parametres-entreprise/logo` — multipart, champ `logo` (PNG/JPEG/SVG, 1 Mo maximum). */
export async function deposerLogoEntreprise(fichier: File): Promise<ReponseLogoEntreprise> {
  const corps = new FormData();
  corps.append('logo', fichier, fichier.name);
  let reponse: Response;
  try {
    reponse = await fetch(`${obtenirEnv().VITE_API_URL}${CHEMIN}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Accept-Language': i18n.language },
      body: corps,
      signal: AbortSignal.timeout(DELAI_ENVOI_MS),
    });
  } catch (cause) {
    throw new ErreurReseau(cause);
  }
  const texte = await reponse.text();
  if (!reponse.ok) throw construireErreurApi(reponse, texte);
  return JSON.parse(texte) as ReponseLogoEntreprise;
}

/** `DELETE /parametres-entreprise/logo` — idempotent. */
export async function supprimerLogoEntreprise(): Promise<void> {
  await requeteApi<undefined>(CHEMIN, { method: 'DELETE' });
}

/** Le logo n'est pas lisible pour ce rôle (droit de lecture du bloc créancier). */
export function estRefusDroitLogo(erreur: unknown): boolean {
  return erreur instanceof ErreurApi && erreur.probleme.status === 403;
}
