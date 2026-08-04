import type {
  EntreeCreationDocumentVente,
  ReponseAvecAvertissements,
  ReponseDocumentVente,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * `POST /documents-vente` — UNIQUEMENT le cas d'usage « créer le bon de commande rattaché au
 * dossier de vente » (RV-37, `PanneauActionsDossierVente`, dialogue `engager`) : jusqu'ici la
 * colonne `document_vente.dossier_vente_id` existait sans jamais être écrite depuis le front, donc
 * `dossier.documents.filter(d => d.typeDocument === 'bon_commande')` restait TOUJOURS vide et
 * `engager` (qui exige un `bonCommandeDocumentId`) était inatteignable. Le backend accepte
 * désormais `dossierVenteId` à la création (`schemaCreationDocumentVente`, restreint à
 * `bon_commande`/`facture`, refusé sur un dossier clos/annulé/abandonné —
 * `409 DOCUMENT_DOSSIER_VENTE_RATTACHEMENT_REFUSE`).
 *
 * Le reste de la surface `/documents-vente` (lignes, émission, avoirs, correction) appartient au
 * module facturation (`hooks/facturation/documents-vente.api.ts`, hors périmètre de cet agent) :
 * cette fonction n'existe QUE pour ce geste précis, pas comme un doublon générique de la couche
 * transport facturation.
 *
 * `PATCH /documents-vente/{id}` ne permet PAS de rattacher un document existant après coup —
 * `schemaModificationDocumentVente` retire `dossierVenteId` silencieusement (strip zod, voir son
 * test dédié) : la seule porte d'entrée est la création, il n'existe donc aucun moyen de « lier un
 * document déjà existant » à un dossier, quelle que soit l'UI côté front.
 */
export async function creerBonCommandeDossierVente(
  entree: EntreeCreationDocumentVente,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseDocumentVente>>(
    '/documents-vente',
    {
      method: 'POST',
      body: JSON.stringify(entree),
      idempotencyKey,
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /documents-vente.');
  }
  return reponse;
}
