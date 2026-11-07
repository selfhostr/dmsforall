import { requeteApi } from '@/api/client';
import { construireErreurApi, ErreurReseau } from '@/api/erreurs';
import { obtenirEnv } from '@/config/env';
import i18n from '@/i18n';

/** `GET /documents-vente/{id}/pdf` — lu en `Blob` pour pouvoir afficher une VRAIE erreur
 *  (`DOCUMENT_PDF_INDISPONIBLE`, 409 `problem+json`) au lieu d'ouvrir un onglet vide : un simple
 *  lien `<a href>` ne permet pas de rattraper l'échec. */
export async function recupererPdfDocument(id: string): Promise<Blob> {
  let reponse: Response;
  try {
    reponse = await fetch(`${obtenirEnv().VITE_API_URL}/documents-vente/${id}/pdf`, {
      credentials: 'include',
      headers: { 'Accept-Language': i18n.language },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (cause) {
    throw new ErreurReseau(cause);
  }
  if (!reponse.ok) throw construireErreurApi(reponse, await reponse.text());
  return reponse.blob();
}

/** Réponse de `POST /documents-vente/{id}/envoyer-courriel` (`ReponseEnvoiFactureCourrielDto`). */
export interface ReponseEnvoiCourrielDocument {
  readonly envoye: boolean;
  readonly destinataire: string;
  readonly idMessage: string;
}

/** `POST /documents-vente/{id}/envoyer-courriel` — envoie la facture (PDF joint) à l'adresse de la
 *  fiche client ; 409 `FACTURE_DESTINATAIRE_COURRIEL_ABSENT` si le client n'en a pas. */
export async function envoyerDocumentParCourriel(
  id: string,
): Promise<ReponseEnvoiCourrielDocument> {
  const reponse = await requeteApi<ReponseEnvoiCourrielDocument>(
    `/documents-vente/${id}/envoyer-courriel`,
    { method: 'POST' },
  );
  if (!reponse)
    throw new Error('Réponse vide inattendue : POST /documents-vente/envoyer-courriel.');
  return reponse;
}
