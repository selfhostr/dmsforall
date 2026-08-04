import type {
  EntreeActionConfirmerFinancement,
  EntreeActionRefuserFinancement,
  EntreeCreationFinancement,
  ReponseAvecAvertissements,
  ReponseFinancement,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport du financement/leasing (`RV-39` → `RV-45`) — même convention que
 * `hooks/ventes/reprises/reprise.api.ts` : types `@dfa/shared`
 * (`packages/shared/src/contrats/ventes/financement.ts`), jamais `api/types.gen.ts`.
 *
 * PAS de `GET` ici — DÉLIBÉRÉ, pas un oubli : `apps/api/src/ventes/financement.controller.ts`
 * n'expose ni fiche ni liste (commentaire d'en-tête du contrôleur : « le contrat n'expose
 * l'historique QU'embarqué dans `ReponseDossierVente.financements`/`.financement` »). L'écran
 * intégrateur (fiche dossier, hors périmètre de ce module) est la SEULE source de la collection
 * `financements`/`financement` — ce module ne fait que POSTer les trois transitions et renvoyer
 * le `ReponseFinancement` COMPLET produit par chacune, jamais une relecture.
 */

/** `POST /dossiers-vente/{id}/financements` — `Idempotency-Key` obligatoire (RV-37 : conditionne
 *  le passage en facture). `statutConfirmation` initial dérivé côté serveur, jamais saisi. */
export async function creerFinancement(
  dossierVenteId: string,
  entree: EntreeCreationFinancement,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseFinancement>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseFinancement>>(
    `/dossiers-vente/${dossierVenteId}/financements`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
      idempotencyKey,
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /dossiers-vente/financements.');
  }
  return reponse;
}

/** `POST /dossiers-vente/{id}/financements/{financementId}/confirmer` — `en_attente -> confirme`. */
export async function confirmerFinancement(
  dossierVenteId: string,
  financementId: string,
  entree: EntreeActionConfirmerFinancement,
): Promise<ReponseAvecAvertissements<ReponseFinancement>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseFinancement>>(
    `/dossiers-vente/${dossierVenteId}/financements/${financementId}/confirmer`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /dossiers-vente/financements/confirmer.');
  }
  return reponse;
}

/** `POST /dossiers-vente/{id}/financements/{financementId}/refuser` — `en_attente -> refuse`,
 *  TERMINAL (CV-03 : un organisme qui change d'avis ouvre un NOUVEAU financement). Motif
 *  obligatoire. */
export async function refuserFinancement(
  dossierVenteId: string,
  financementId: string,
  entree: EntreeActionRefuserFinancement,
): Promise<ReponseAvecAvertissements<ReponseFinancement>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseFinancement>>(
    `/dossiers-vente/${dossierVenteId}/financements/${financementId}/refuser`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /dossiers-vente/financements/refuser.');
  }
  return reponse;
}
