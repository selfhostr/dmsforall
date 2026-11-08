import type {
  EntreeModificationEnvoiCourriel,
  EntreeTestEnvoiCourriel,
  ReponseEnvoiCourriel,
  ReponseTestEnvoiCourriel,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

import { exigerCorps } from './support';

export type {
  EntreeModificationEnvoiCourriel,
  EntreeTestEnvoiCourriel,
  ReponseEnvoiCourriel,
  ReponseTestEnvoiCourriel,
};

const CHEMIN = '/parametres-entreprise/envoi-courriel';

/** `GET /parametres-entreprise/envoi-courriel` — réglage du garage et état d'envoi. */
export async function recupererEnvoiCourriel(): Promise<ReponseEnvoiCourriel> {
  const reponse = await requeteApi<ReponseEnvoiCourriel>(CHEMIN, { method: 'GET' });
  return exigerCorps(reponse, `GET ${CHEMIN}`);
}

/** `PATCH` — seuls les champs envoyés changent ; `motDePasse` absent = inchangé. */
export async function modifierEnvoiCourriel(
  entree: EntreeModificationEnvoiCourriel,
): Promise<ReponseEnvoiCourriel> {
  const reponse = await requeteApi<ReponseEnvoiCourriel>(CHEMIN, {
    method: 'PATCH',
    body: JSON.stringify(entree),
  });
  return exigerCorps(reponse, `PATCH ${CHEMIN}`);
}

/** `POST …/test` — e-mail d'essai avec le réglage ENREGISTRÉ. */
export async function testerEnvoiCourriel(
  entree: EntreeTestEnvoiCourriel,
): Promise<ReponseTestEnvoiCourriel> {
  const reponse = await requeteApi<ReponseTestEnvoiCourriel>(`${CHEMIN}/test`, {
    method: 'POST',
    body: JSON.stringify(entree),
  });
  return exigerCorps(reponse, `POST ${CHEMIN}/test`);
}
