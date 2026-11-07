import type {
  ApercuExport,
  CibleExport,
  EntreeApercuExport,
  EntreeLancerExport,
  EntreeMettreAJourMapping,
  EtatMappingExport,
  ExportHistorique,
  PageCurseur,
} from '@dfa/shared';

import type { components } from '@/api/types.gen';
import { requeteApi } from '@/api/client';
import { construireErreurApi, ErreurReseau } from '@/api/erreurs';
import { obtenirEnv } from '@/config/env';
import i18n from '@/i18n';

/** Réponse de `POST /exports-fiduciaires` — type GÉNÉRÉ depuis l'OpenAPI (le DTO de réponse vit
 *  côté API, pas dans `@dfa/shared`). */
export type ReponseExportFiduciaire = components['schemas']['ExportComptableAvecAvertissementsDto'];
export type LotExportFiduciaire = components['schemas']['LotExportProduitDto'];

/**
 * `POST /exports-fiduciaires` — `Idempotency-Key` OBLIGATOIRE. Réponse `201` (au moins un
 * document ou paiement exporté) ou `200` avec `donnees.lots: []` (rien à exporter) : les deux
 * passent par ici, c'est à l'appelant de lire `lots`.
 */
export async function lancerExportFiduciaire(
  entree: EntreeLancerExport,
  idempotencyKey: string,
): Promise<ReponseExportFiduciaire> {
  const reponse = await requeteApi<ReponseExportFiduciaire>('/exports-fiduciaires', {
    method: 'POST',
    body: JSON.stringify(entree),
    idempotencyKey,
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /exports-fiduciaires.');
  }
  return reponse;
}

/* ------------------------------------------------------------------ */
/* Aperçu, historique, fichier conservé, mapping comptable             */
/* ------------------------------------------------------------------ */

/** Formats réellement produits par l'API : les autres cibles répondent 501, l'écran ne les propose pas. */
export const FORMATS_EXPORT = ['winbiz', 'csv'] as const satisfies readonly CibleExport[];
export type FormatExport = (typeof FORMATS_EXPORT)[number];

export const clesExportFiduciaire = {
  tout: ['facturation', 'export-fiduciaire'] as const,
  apercu: (entree: EntreeApercuExport) =>
    ['facturation', 'export-fiduciaire', 'apercu', entree] as const,
  historique: ['facturation', 'export-fiduciaire', 'historique'] as const,
  mapping: (cible: CibleExport) => ['facturation', 'export-fiduciaire', 'mapping', cible] as const,
};

function parametres(valeurs: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(valeurs)) {
    if (valeur !== undefined) p.set(cle, String(valeur));
  }
  return p.toString();
}

async function lire<T>(chemin: string, options?: Parameters<typeof requeteApi>[1]): Promise<T> {
  const reponse = await requeteApi<T>(chemin, options);
  if (reponse === undefined) throw new Error(`Réponse vide inattendue : ${chemin}.`);
  return reponse;
}

/** `GET /exports-fiduciaires/apercu` — ce que l'export emporterait, et ce qui l'empêche. */
export function lireApercuExport(entree: EntreeApercuExport): Promise<ApercuExport> {
  return lire<ApercuExport>(`/exports-fiduciaires/apercu?${parametres({ ...entree })}`);
}

/** `GET /exports-fiduciaires` — une page de l'historique, plus récent d'abord. */
export function listerExports(curseur: string | undefined): Promise<PageCurseur<ExportHistorique>> {
  return lire<PageCurseur<ExportHistorique>>(
    `/exports-fiduciaires?${parametres({ limite: 20, curseur })}`,
  );
}

/** `GET /exports-fiduciaires/mapping` */
export function lireMappingExport(cible: CibleExport): Promise<EtatMappingExport> {
  return lire<EtatMappingExport>(`/exports-fiduciaires/mapping?${parametres({ cible })}`);
}

/** `PUT /exports-fiduciaires/mapping` — renvoie l'état à jour. */
export function enregistrerMappingExport(
  entree: EntreeMettreAJourMapping,
): Promise<EtatMappingExport> {
  return lire<EtatMappingExport>('/exports-fiduciaires/mapping', {
    method: 'PUT',
    body: JSON.stringify(entree),
  });
}

/** `GET /exports-fiduciaires/{id}/fichier` — binaire (404 si le fichier n'a pas été conservé).
 *  `requeteApi` lit du JSON : on passe par `fetch` pour récupérer les octets, et on reconstruit
 *  l'erreur `problem+json` avec le même constructeur que le reste de l'application. */
export async function telechargerFichierConserve(id: string): Promise<Blob> {
  let reponse: Response;
  try {
    reponse = await fetch(`${obtenirEnv().VITE_API_URL}/exports-fiduciaires/${id}/fichier`, {
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
