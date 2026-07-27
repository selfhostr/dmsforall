import type { EntreeConnexion, SessionCourante } from '@dfa/shared';

import { requeteApi } from './client';
import { ErreurApi } from './erreurs';

/** `GET /auth/moi` — 401 = donnée (pas de session), pas une erreur : traduit en `null`.
 *  Toute autre erreur (réseau, 500, 502…) est repropagée telle quelle pour que
 *  `useSession` distingue "non connecté" de "service indisponible". */
export async function recupererSessionCourante(): Promise<SessionCourante | null> {
  try {
    const session = await requeteApi<SessionCourante>('/auth/moi', { method: 'GET' });
    return session ?? null;
  } catch (erreur) {
    if (erreur instanceof ErreurApi && erreur.probleme.status === 401) {
      return null;
    }
    throw erreur;
  }
}

export async function connecter(entree: EntreeConnexion): Promise<SessionCourante> {
  const session = await requeteApi<SessionCourante>('/auth/connexion', {
    method: 'POST',
    body: JSON.stringify(entree),
  });
  if (!session) {
    throw new Error('Réponse de connexion inattendue : corps vide.');
  }
  return session;
}

/** Idempotente côté serveur (204 même sans session active) : aucune branche d'erreur
 *  "session déjà absente" à gérer côté front. */
export async function deconnecter(): Promise<void> {
  await requeteApi<undefined>('/auth/deconnexion', { method: 'POST' });
}
