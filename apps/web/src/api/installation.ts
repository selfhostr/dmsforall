import type { EntreePremierGarage, EtatInstallation, SessionCourante } from '@dfa/shared';

import { requeteApi } from './client';

/** `GET /installation/etat` — public : l'instance attend-elle son premier garage ? */
export async function recupererEtatInstallation(): Promise<EtatInstallation> {
  const etat = await requeteApi<EtatInstallation>('/installation/etat', { method: 'GET' });
  if (!etat) {
    throw new Error("Réponse d'état d'installation inattendue : corps vide.");
  }
  return etat;
}

/** `POST /installation/premier-garage` — crée le garage et ouvre la session (cookie, 201). */
export async function creerPremierGarage(entree: EntreePremierGarage): Promise<SessionCourante> {
  const session = await requeteApi<SessionCourante>('/installation/premier-garage', {
    method: 'POST',
    body: JSON.stringify(entree),
  });
  if (!session) {
    throw new Error('Réponse de création inattendue : corps vide.');
  }
  return session;
}
