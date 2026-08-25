import i18n from '@/i18n';
import { obtenirEnv } from '@/config/env';
import { requeteApi } from '@/api/client';
import { construireErreurApi, ErreurReseau } from '@/api/erreurs';
import type {
  EntreeRejetFactureFournisseur,
  FiltresFacturesFournisseur,
  PageCurseur,
  ReponseFactureFournisseur,
} from '@dfa/shared';

/**
 * TRANSPORT TEMPORAIRE — le service serveur (`apps/api/src/pieces/factures-fournisseur/`) est
 * écrit EN PARALLÈLE par un autre agent. Correctif du 16.08 : les FORMES (`ReponseFactureFournisseur`,
 * `FiltresFacturesFournisseur`, `EntreeRejetFactureFournisseur`, `STATUTS_FACTURE_FOURNISSEUR`,
 * `ORIGINES_DONNEE_FACTURE`) sont DÉJÀ RÉELLES — importées de `@dfa/shared`
 * (`packages/shared/src/contrats/pieces/facture-fournisseur.ts` + `enums.ts`, posées entre-temps
 * par l'agent serveur, lues en tête de ce lot pour converger sans attendre un second passage).
 * Seuls les ENDPOINTS eux-mêmes (chemin, méthode, encodage) restent une HYPOTHÈSE : aucun
 * contrôleur n'existe encore (`apps/api/src/pieces/factures-fournisseur/` ne contient à ce jour
 * que `lecture/`, pas de `*.controller.ts`). DÈS QUE le contrôleur existe et que
 * `pnpm api:openapi && pnpm web:types` a tourné : remplacer les appels `requeteApi`/`fetch` de ce
 * fichier par le client généré, puis supprimer ce fichier — plus aucun type à migrer, ils sont déjà
 * les bons.
 *
 * ===========================================================================================
 * ENDPOINTS ATTENDUS (6) — hypothèse de transport uniquement, formes déjà réelles
 * ===========================================================================================
 *
 * 1. `POST /factures-fournisseur` — `multipart/form-data`, champ `fichier` (PDF). En-tête
 *    `Idempotency-Key` OBLIGATOIRE (persiste immédiatement `facture_fournisseur`, statut `deposee`
 *    au minimum). Lecture (QR → texte PDF → OCR, `lecture/orchestrateur-lecture.ts`) ET tentative
 *    de rapprochement faites SYNCHRONE (l'attente de quelques secondes du brief) : la réponse porte
 *    déjà `statut: 'rapprochee'` si un match a été trouvé, `'deposee'` sinon — jamais `'validee'`/
 *    `'rejetee'` fraîchement déposée (États GELÉS, `STATUTS_FACTURE_FOURNISSEUR`).
 *      - 201 -> `ReponseFactureFournisseur`.
 *      - 400 `VALIDATION_ECHOUEE` — champ `fichier` absent/pas un PDF.
 *      - 413 — fichier trop volumineux (garde CLIENT déjà posée, 15 Mo, voir
 *        `EcranDepotFactureFournisseur.tsx` — un PDF ne se réduit pas côté client comme une photo,
 *        la garde serveur reste la seule fiable).
 *      - 422, code PROPOSÉ `FACTURE_FOURNISSEUR_ILLISIBLE` (absent de `CODES_ERREUR`,
 *        `packages/shared/src/contrats/probleme.ts`, hors périmètre de cet agent) — aucune donnée
 *        exploitable. Repli sûr documenté tant que le code n'existe pas : `construireErreurApi`
 *        retombe sur `ERREUR_INTERNE` (`api/erreurs.ts`).
 *      - 502/503 — moteur OCR/QR indisponible, erreur serveur générique.
 *
 * 2. `GET /factures-fournisseur?statut=&fournisseurId=&commandeFournisseurId=&tri=&limite=&curseur=`
 *    — pagination par curseur (`schemaFiltresFacturesFournisseur` étend `schemaParametresPage`).
 *    AUCUNE forme allégée n'existe dans le contrat partagé (pas de « résumé » sans lignes) : la
 *    liste rend `ReponseFactureFournisseur` complète par ligne, lignes comprises — SIGNALÉ pour
 *    convergence : un résumé sans `lignes` économiserait la charge utile d'une liste, mais
 *    n'existe pas aujourd'hui, donc pas inventé ici.
 *      - 200 -> `PageCurseur<ReponseFactureFournisseur>`.
 *
 * 3. `GET /factures-fournisseur/{id}` -> `ReponseFactureFournisseur`. 404 `RESSOURCE_INTROUVABLE`.
 *
 * 4. `POST /factures-fournisseur/{id}/valider` — aucun corps documenté dans le contrat partagé
 *    (seul `schemaRejetFactureFournisseur` y figure) : autorisée depuis `'deposee'` ou `'rapprochee'`
 *    (écarts ou non — « aucune validation automatique », brief : le blocage n'est jamais
 *    automatique). Pas d'`Idempotency-Key` (transition gardée par l'état de départ, machine SIMPLE
 *    sans table `transition_autorisee` dédiée, voir `enums.ts`).
 *      - 200 -> `ReponseFactureFournisseur`, `statut: 'validee'` (TERMINAL).
 *      - 409 `CONFLIT` — déjà `validee`/`rejetee`.
 *
 * 5. `POST /factures-fournisseur/{id}/rejeter` — corps `EntreeRejetFactureFournisseur` (`motif`,
 *    `schemaMotif`, ≥ 3 caractères OBLIGATOIRE) — RÉEL, contrairement à la première version de ce
 *    lot qui n'avait pas prévu de rejet. Autorisée depuis `'deposee'`/`'rapprochee'`.
 *      - 200 -> `ReponseFactureFournisseur`, `statut: 'rejetee'` (TERMINAL, `motifRejet` porté).
 *      - 409 `CONFLIT` — déjà terminal.
 *
 * DOCUMENT D'ORIGINE — même patron que `EcranFicheFacture.tsx#urlPdf` : construit directement
 * `${obtenirEnv().VITE_API_URL}/factures-fournisseur/{id}/document`, ouvert via
 * `<a href target="_blank">`. ENDPOINT ATTENDU : `GET /factures-fournisseur/{id}/document` -> le
 * PDF original, `Content-Type` = `ReponseDocumentFactureFournisseur.typeMime`. SIGNALÉ : ce type
 * ne porte AUCUN nom de fichier d'origine (`nomFichierOriginal` absent) — l'écran affiche donc le
 * numéro de facture lu (ou l'identifiant technique en dernier repli) plutôt qu'un nom de fichier,
 * voir `EcranDepotFactureFournisseur.tsx`/`EcranFactureFournisseur.tsx`. Ajouter ce champ au
 * contrat serait un vrai gain ergonomique (retrouver visuellement le PDF déposé) — proposé pour
 * convergence, pas décidé unilatéralement ici.
 */

/** Filtres portés par l'ÉCRAN — `limite`/`curseur` sont injectés PAR `useListeFacturesFournisseur`
 *  à chaque page (voir `FiltresFacturesFournisseur`, qui les PLIE dans le même objet que les
 *  filtres métier, `@dfa/shared` — contrairement à `FiltresCommandesFournisseur`, deux paramètres
 *  séparés `filtres`/`page`) : l'écran ne les fournit jamais lui-même. */
export type FiltresEcranFacturesFournisseur = Omit<
  FiltresFacturesFournisseur,
  'limite' | 'curseur'
>;

function construireParametresListe(filtres: FiltresFacturesFournisseur): string {
  const parametres = new URLSearchParams();
  if (filtres.q && filtres.q.trim() !== '') parametres.set('q', filtres.q.trim());
  // `statut` est une LISTE (`schemaListeQuery`, `@dfa/shared`) — même patron que
  // `FiltresCommandesFournisseur.statut` (`commandes-fournisseur.api.ts`).
  for (const valeur of filtres.statut ?? []) parametres.append('statut', valeur);
  if (filtres.fournisseurId) parametres.set('fournisseurId', filtres.fournisseurId);
  if (filtres.commandeFournisseurId) {
    parametres.set('commandeFournisseurId', filtres.commandeFournisseurId);
  }
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(filtres.limite));
  if (filtres.curseur) parametres.set('curseur', filtres.curseur);
  return parametres.toString();
}

/**
 * `POST /factures-fournisseur` — appel dédié plutôt que `@/api/client.ts` (`requeteApi`) : celui-ci
 * pose systématiquement `Content-Type: application/json` dès qu'un corps est fourni, ce qui
 * casserait une requête `multipart/form-data` — même contrainte que
 * `appellerScanPermisCirculation` (`ecrans/scan/contrat-ocr.temporaire.ts`), même réplique manuelle
 * des conventions de `requeteApi` (`credentials: 'include'`, `Accept-Language`, `Idempotency-Key`,
 * mêmes classes d'erreur).
 */
export async function deposerFactureFournisseur(
  fichier: File,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<ReponseFactureFournisseur> {
  const url = `${obtenirEnv().VITE_API_URL}/factures-fournisseur`;
  const corps = new FormData();
  corps.append('fichier', fichier, fichier.name);

  let reponse: Response;
  try {
    reponse = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Accept-Language': i18n.language,
        'Idempotency-Key': idempotencyKey,
      },
      body: corps,
      signal,
    });
  } catch (cause) {
    throw new ErreurReseau(cause);
  }

  const corpsTexte = await reponse.text();
  if (!reponse.ok) throw construireErreurApi(reponse, corpsTexte);
  if (corpsTexte.length === 0) {
    throw new Error('Réponse vide inattendue : POST /factures-fournisseur.');
  }
  return JSON.parse(corpsTexte) as ReponseFactureFournisseur;
}

/** `GET /factures-fournisseur`. */
export async function listerFacturesFournisseur(
  filtres: FiltresFacturesFournisseur,
): Promise<PageCurseur<ReponseFactureFournisseur>> {
  const reponse = await requeteApi<PageCurseur<ReponseFactureFournisseur>>(
    `/factures-fournisseur?${construireParametresListe(filtres)}`,
    { method: 'GET' },
  );
  return reponse ?? { donnees: [], curseurSuivant: null, limite: filtres.limite };
}

/** `GET /factures-fournisseur/{id}`. */
export async function recupererFactureFournisseur(id: string): Promise<ReponseFactureFournisseur> {
  const facture = await requeteApi<ReponseFactureFournisseur>(`/factures-fournisseur/${id}`, {
    method: 'GET',
  });
  if (!facture) {
    throw new Error('Réponse facture fournisseur inattendue : corps vide.');
  }
  return facture;
}

/** `POST /factures-fournisseur/{id}/valider` — aucun corps. */
export async function validerRapprochementFactureFournisseur(
  id: string,
): Promise<ReponseFactureFournisseur> {
  const facture = await requeteApi<ReponseFactureFournisseur>(
    `/factures-fournisseur/${id}/valider`,
    { method: 'POST' },
  );
  if (!facture) {
    throw new Error('Réponse vide inattendue : POST /factures-fournisseur/valider.');
  }
  return facture;
}

/** `POST /factures-fournisseur/{id}/rejeter` — motif obligatoire (`EntreeRejetFactureFournisseur`). */
export async function rejeterFactureFournisseur(
  id: string,
  entree: EntreeRejetFactureFournisseur,
): Promise<ReponseFactureFournisseur> {
  const facture = await requeteApi<ReponseFactureFournisseur>(
    `/factures-fournisseur/${id}/rejeter`,
    { method: 'POST', body: JSON.stringify(entree) },
  );
  if (!facture) {
    throw new Error('Réponse vide inattendue : POST /factures-fournisseur/rejeter.');
  }
  return facture;
}
