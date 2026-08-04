import type {
  EntreeActionAbandonnerDossierVente,
  EntreeActionAnnulerDossierVente,
  EntreeActionCloturerDossierVente,
  EntreeActionEngager,
  EntreeActionLivrer,
  EntreeActionMarquerPretALivrer,
  EntreeActionPreparer,
  EntreeCreationDossierVente,
  EntreeMarquerDocumentRequis,
  EntreeModificationDossierVente,
  FiltresDossiersVente,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseDossierVente,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport du dossier de vente (`ventes/dossier-vente.controller.ts`, RV-29→RV-38,
 * RV-52→RV-58) — même convention que `hooks/pieces/articles.api.ts` : types consommés depuis
 * `@dfa/shared` (`packages/shared/src/contrats/ventes/`), jamais `api/types.gen.ts`.
 *
 * ÉCART SIGNALÉ (même nature que celui documenté en tête de `hooks/pieces/articles.api.ts` et de
 * `hooks/facturation/documents-vente.api.ts`) : `apps/web/src/api/types.gen.ts` n'a pas encore été
 * régénéré depuis l'OpenAPI pour inclure le module `ventes` — les 12 routes existent et sont
 * prouvées côté API (`apps/api/src/ventes/dossier-vente.controller.ts`) ; ce fichier s'aligne sur
 * leurs DTO, qui implémentent eux-mêmes les types `@dfa/shared` importés ci-dessus. À réconcilier
 * avec `types.gen.ts` à la prochaine régénération planifiée (agent backend en vol en parallèle sur
 * `apps/api/**`, régénérer maintenant risquait de capturer un état intermédiaire).
 */

function construireParametresListe(
  filtres: FiltresDossiersVente,
  curseur: string | undefined,
): string {
  const parametres = new URLSearchParams();
  if (filtres.siteId) parametres.set('siteId', filtres.siteId);
  if (filtres.statut && filtres.statut.length > 0) {
    for (const valeur of filtres.statut) parametres.append('statut', valeur);
  }
  if (filtres.clientAcheteurId) parametres.set('clientAcheteurId', filtres.clientAcheteurId);
  if (filtres.vehiculeId) parametres.set('vehiculeId', filtres.vehiculeId);
  if (filtres.q && filtres.q.trim() !== '') parametres.set('q', filtres.q.trim());
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(filtres.limite));
  if (curseur) parametres.set('curseur', curseur);
  return parametres.toString();
}

/** `GET /dossiers-vente` — pagination par curseur. Chaque ligne est déjà le document COMPLET
 *  (`ReponseDossierVente`, y compris `documents`/`reprise`/`financement` embarqués) : le service
 *  serveur (`ServiceDossierVente.lister`) assemble la fiche entière pour chaque ligne, pas une
 *  projection distincte — la liste peut donc afficher le prix dérivé (§7.1 du design) sans requête
 *  supplémentaire par ligne. */
export async function listerDossiersVente(
  filtres: FiltresDossiersVente,
  curseur: string | undefined,
): Promise<PageCurseur<ReponseDossierVente>> {
  const reponse = await requeteApi<PageCurseur<ReponseDossierVente>>(
    `/dossiers-vente?${construireParametresListe(filtres, curseur)}`,
    { method: 'GET' },
  );
  return reponse ?? { donnees: [], curseurSuivant: null, limite: filtres.limite };
}

/** `GET /dossiers-vente/{id}` — le document complet (même doctrine que `GET /ordres-reparation/{id}`,
 *  D-10) : une seule requête bloque l'écran entier. */
export async function recupererDossierVente(id: string): Promise<ReponseDossierVente> {
  const dossier = await requeteApi<ReponseDossierVente>(`/dossiers-vente/${id}`, {
    method: 'GET',
  });
  if (!dossier) {
    throw new Error('Réponse vide inattendue : GET /dossiers-vente/{id}.');
  }
  return dossier;
}

/** `POST /dossiers-vente` — `Idempotency-Key` OBLIGATOIRE (RV-29 : un double-clic comptoir ne doit
 *  jamais ouvrir deux dossiers pour la même intention commerciale). */
export async function creerDossierVente(
  entree: EntreeCreationDossierVente,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseDossierVente>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseDossierVente>>(
    '/dossiers-vente',
    {
      method: 'POST',
      body: JSON.stringify(entree),
      idempotencyKey,
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /dossiers-vente.');
  }
  return reponse;
}

/** `PATCH /dossiers-vente/{id}` — `If-Match` OBLIGATOIRE (même discipline optimiste que
 *  `PATCH /ordres-reparation/{id}` et `PATCH /documents-vente/{id}` : `etag` construit directement
 *  depuis `dossier.version` par l'appelant, `` `W/"${version}"` ``, même patron que
 *  `EcranFicheFacture.tsx`). Réassignation du véhicule refusée par le serveur au-delà de
 *  `prospection` (`409 VENTE_DOSSIER_TRANSITION_INTERDITE`, RV-30). */
export async function modifierDossierVente(
  id: string,
  entree: EntreeModificationDossierVente,
  etag: string | null,
): Promise<ReponseAvecAvertissements<ReponseDossierVente>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseDossierVente>>(
    `/dossiers-vente/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(entree),
      ifMatch: etag ?? undefined,
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : PATCH /dossiers-vente.');
  }
  return reponse;
}

/** `POST /dossiers-vente/{id}/documents-requis/marquer` — coche/décoche un item de la check-list
 *  de livraison (RV-35). Pas d'`Idempotency-Key` (no-op idempotent par nature, voir le contrat). */
export async function marquerDocumentRequisDossierVente(
  id: string,
  entree: EntreeMarquerDocumentRequis,
): Promise<ReponseAvecAvertissements<ReponseDossierVente>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseDossierVente>>(
    `/dossiers-vente/${id}/documents-requis/marquer`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /dossiers-vente/documents-requis/marquer.');
  }
  return reponse;
}

async function executerTransition(
  chemin: string,
  entree: object,
): Promise<ReponseAvecAvertissements<ReponseDossierVente>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseDossierVente>>(chemin, {
    method: 'POST',
    body: JSON.stringify(entree),
  });
  if (!reponse) {
    throw new Error(`Réponse vide inattendue : POST ${chemin}.`);
  }
  return reponse;
}

/** `POST /dossiers-vente/{id}/engager` — `prospection -> engage` (RV-32). */
export function engagerDossierVente(id: string, entree: EntreeActionEngager) {
  return executerTransition(`/dossiers-vente/${id}/engager`, entree);
}

/** `POST /dossiers-vente/{id}/preparer` — `engage -> en_preparation`. */
export function preparerDossierVente(id: string, entree: EntreeActionPreparer) {
  return executerTransition(`/dossiers-vente/${id}/preparer`, entree);
}

/** `POST /dossiers-vente/{id}/marquer-pret-a-livrer` — `en_preparation -> pret_a_livrer` (RV-37). */
export function marquerDossierPretALivrer(id: string, entree: EntreeActionMarquerPretALivrer) {
  return executerTransition(`/dossiers-vente/${id}/marquer-pret-a-livrer`, entree);
}

/** `POST /dossiers-vente/{id}/livrer` — `pret_a_livrer -> livre` (RV-52/RV-53). */
export function livrerDossierVente(id: string, entree: EntreeActionLivrer) {
  return executerTransition(`/dossiers-vente/${id}/livrer`, entree);
}

/** `POST /dossiers-vente/{id}/cloturer` — `livre -> clos`, corps vide, purement administratif. */
export function cloturerDossierVente(id: string, entree: EntreeActionCloturerDossierVente) {
  return executerTransition(`/dossiers-vente/${id}/cloturer`, entree);
}

/** `POST /dossiers-vente/{id}/annuler` — motif obligatoire, uniquement avant `pret_a_livrer` (RV-38). */
export function annulerDossierVente(id: string, entree: EntreeActionAnnulerDossierVente) {
  return executerTransition(`/dossiers-vente/${id}/annuler`, entree);
}

/** `POST /dossiers-vente/{id}/abandonner` — même garde que `annuler`, motif obligatoire. */
export function abandonnerDossierVente(id: string, entree: EntreeActionAbandonnerDossierVente) {
  return executerTransition(`/dossiers-vente/${id}/abandonner`, entree);
}
