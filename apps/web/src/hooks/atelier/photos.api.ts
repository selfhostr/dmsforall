import type { ReponseListePhotosLigne, ReponsePhotoLigne } from '@dfa/shared';

import { construireErreurApi, ErreurReseau } from '@/api/erreurs';
import { requeteApi } from '@/api/client';
import { obtenirEnv } from '@/config/env';
import i18n from '@/i18n';

/** Délai d'un envoi : une photo de 1-2 Mo sur un réseau d'atelier moyen, bien au-delà des 15 s
 *  de `requeteApi`. */
const DELAI_ENVOI_MS = 60_000;

/** Chemin (relatif à `VITE_API_URL`) de l'image — pour `<img src>`, cookie de session inclus. */
export function urlPhoto(photoId: string): string {
  return `${obtenirEnv().VITE_API_URL}/photos/${photoId}`;
}

export function urlVignettePhoto(photoId: string): string {
  return `${obtenirEnv().VITE_API_URL}/photos/${photoId}/vignette`;
}

export async function listerPhotosOr(orId: string): Promise<readonly ReponsePhotoLigne[]> {
  const reponse = await requeteApi<ReponseListePhotosLigne>(`/ordres-reparation/${orId}/photos`);
  return reponse?.donnees ?? [];
}

export interface EnvoiPhoto {
  readonly photo: Blob;
  readonly vignette: Blob | null;
  readonly legende?: string;
}

/** `multipart/form-data` : pas de `Content-Type` posé à la main (le navigateur y met la frontière),
 *  donc ni `requeteApi` ni son en-tête JSON — même contrainte et même réplique manuelle des
 *  conventions que `deposerFactureFournisseur`. */
export async function envoyerPhotoLigne(
  orId: string,
  ligneId: string,
  envoi: EnvoiPhoto,
): Promise<ReponsePhotoLigne> {
  const corps = new FormData();
  corps.append('photo', envoi.photo, 'photo.jpg');
  if (envoi.vignette) corps.append('vignette', envoi.vignette, 'vignette.jpg');
  if (envoi.legende && envoi.legende.trim() !== '') corps.append('legende', envoi.legende.trim());

  let reponse: Response;
  try {
    reponse = await fetch(
      `${obtenirEnv().VITE_API_URL}/ordres-reparation/${orId}/lignes/${ligneId}/photos`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Accept-Language': i18n.language },
        body: corps,
        signal: AbortSignal.timeout(DELAI_ENVOI_MS),
      },
    );
  } catch (cause) {
    throw new ErreurReseau(cause);
  }
  const texte = await reponse.text();
  if (!reponse.ok) throw construireErreurApi(reponse, texte);
  return JSON.parse(texte) as ReponsePhotoLigne;
}

export async function supprimerPhoto(photoId: string): Promise<void> {
  await requeteApi<undefined>(`/photos/${photoId}`, { method: 'DELETE' });
}
