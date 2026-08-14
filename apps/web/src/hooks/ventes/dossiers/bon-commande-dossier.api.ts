import type {
  EntreeCreationDocumentVente,
  ReponseAvecAvertissements,
  ReponseDocumentVente,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * `POST /documents-vente` — UNIQUEMENT les deux cas d'usage « créer un document rattaché au
 * dossier de vente » (RV-37) : le bon de commande (`PanneauActionsDossierVente`, dialogue
 * `engager`) et, depuis #124, la facture (même composant, dialogue `livrer`). Jusqu'ici la colonne
 * `document_vente.dossier_vente_id` existait sans jamais être écrite depuis le front, donc
 * `dossier.documents.filter(d => d.typeDocument === 'bon_commande' | 'facture')` restait TOUJOURS
 * vide — `engager` (qui exige un `bonCommandeDocumentId`) et `livrer` (qui exige une facture ÉMISE,
 * RV-37) étaient inatteignables. Le backend accepte `dossierVenteId` à la création
 * (`schemaCreationDocumentVente`, restreint à `bon_commande`/`facture`, refusé sur un dossier
 * clos/annulé/abandonné — `409 DOCUMENT_DOSSIER_VENTE_RATTACHEMENT_REFUSE`).
 *
 * Le reste de la surface `/documents-vente` (lignes, émission, avoirs, correction) appartient au
 * module facturation (`hooks/facturation/documents-vente.api.ts`, hors périmètre de cet agent) :
 * ces deux fonctions n'existent QUE pour ce geste précis (poser le brouillon et le rattacher), pas
 * comme un doublon générique de la couche transport facturation.
 *
 * `PATCH /documents-vente/{id}` ne permet PAS de rattacher un document existant après coup —
 * `schemaModificationDocumentVente` retire `dossierVenteId` silencieusement (strip zod, voir son
 * test dédié) : la seule porte d'entrée est la création, il n'existe donc aucun moyen de « lier un
 * document déjà existant » à un dossier, quelle que soit l'UI côté front.
 */
async function posterDocumentVenteDossier(
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

/** Créer et rattacher le bon de commande d'un dossier (dialogue `engager`). */
export async function creerBonCommandeDossierVente(
  entree: EntreeCreationDocumentVente,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
  return posterDocumentVenteDossier(entree, idempotencyKey);
}

/** Créer et rattacher la facture d'un dossier (dialogue `livrer`, #124) — même geste bouton, `lignes: []`,
 *  le contenu (véhicule, prix, TVA) se saisit ensuite sur `/factures/{id}` (`ecrans/facturation/**`,
 *  hors périmètre). Une facture ÉMISE est requise pour que `livrer` (RV-37) soit acceptée par le
 *  serveur — cette fonction ne fait que poser le brouillon, l'émission reste un geste distinct de
 *  l'écran facturation. */
export async function creerFactureDossierVente(
  entree: EntreeCreationDocumentVente,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
  return posterDocumentVenteDossier(entree, idempotencyKey);
}
