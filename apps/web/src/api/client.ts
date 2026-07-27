import i18n from '@/i18n';
import { obtenirEnv } from '@/config/env';

import { construireErreurApi, ErreurReseau } from './erreurs';

const DELAI_REQUETE_MS = 15_000;

export type OptionsRequeteApi = Omit<RequestInit, 'credentials'>;

/** Client fetch unique de l'app. `credentials:'include'` systématique (cookie httpOnly de
 *  session), `Accept-Language` = langue i18next courante, timeout 15s, et 204/corps vide ->
 *  `undefined` (ne JAMAIS appeler `.json()` sur une réponse vide). */
export async function requeteApi<T>(chemin: string, options: OptionsRequeteApi = {}): Promise<T | undefined> {
  const url = `${obtenirEnv().VITE_API_URL}${chemin}`;

  const entetes = new Headers(options.headers);
  entetes.set('Accept-Language', i18n.language);
  if (options.body !== undefined && !entetes.has('Content-Type')) {
    entetes.set('Content-Type', 'application/json');
  }

  let reponse: Response;
  try {
    reponse = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: entetes,
      signal: options.signal ?? AbortSignal.timeout(DELAI_REQUETE_MS),
    });
  } catch (cause) {
    throw new ErreurReseau(cause);
  }

  if (reponse.status === 204) return undefined;

  const corpsTexte = await reponse.text();

  if (!reponse.ok) {
    throw construireErreurApi(reponse, corpsTexte);
  }

  if (corpsTexte.length === 0) return undefined;

  return JSON.parse(corpsTexte) as T;
}
