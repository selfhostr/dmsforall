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
 * Couche transport des factures fournisseur (`apps/api/src/pieces/factures-fournisseur/
 * facture-fournisseur.controller.ts`) — même patron que `fournisseurs.api.ts`/
 * `commandes-fournisseur.api.ts` : types venus tels quels de `@dfa/shared`, jamais redéfinis à la
 * main. Anciennement `factures-fournisseur.temporaire.ts` (hypothèse de transport écrite avant que
 * le contrôleur existe, aux formes déjà réelles) — le contrôleur existe désormais, ce fichier en
 * est la traduction directe, plus aucune hypothèse.
 *
 * DIVERGENCE CORRIGÉE par rapport à l'hypothèse d'origine : le POST n'exige PAS d'en-tête
 * `Idempotency-Key` (`service-facture-fournisseur.ts` ne le lit ni ne le vérifie nulle part) — la
 * déduplication d'un dépôt en double se fait côté serveur par EMPREINTE SHA-256 du fichier
 * (`409 CONFLIT` si déjà déposé), pas par clé côté client. Tranché : `deposerFactureFournisseur`
 * ne PORTE plus l'en-tête — retiré de la chaîne d'appel (`useDeposerFactureFournisseur.ts`,
 * `EcranDepotFactureFournisseur.tsx`), un en-tête surnuméraire que le serveur ignorait sans risque
 * mais qui n'avait aucune raison d'exister.
 *
 * DOCUMENT D'ORIGINE — même patron que `EcranFicheFacture.tsx#urlPdf` : construit directement
 * `${obtenirEnv().VITE_API_URL}/factures-fournisseur/{id}/document`, ouvert via
 * `<a href target="_blank">` (`EcranFactureFournisseur.tsx`) — pas de fonction dédiée ici, aucune
 * lecture de corps à typer.
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
 * des conventions de `requeteApi` (`credentials: 'include'`, `Accept-Language` — voir la réserve
 * sur `Idempotency-Key` en tête de fichier, volontairement absente ici).
 */
export async function deposerFactureFournisseur(
  fichier: File,
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
