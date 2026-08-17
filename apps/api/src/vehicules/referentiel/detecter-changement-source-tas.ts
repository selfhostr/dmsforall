/**
 * Détection de changement de la source ASTRA (TAS, `SOURCES_TAS` — voir
 * `db/seed/import-referentiel-vehicules-ch.ts`), SANS retélécharger les trois fichiers pour rien
 * chaque jour.
 *
 * STRATÉGIE, dans l'ordre : une requête `HEAD` par fichier source ; `ETag` (validateur fort) si
 * présent, sinon `Last-Modified` + `Content-Length` — vérifiés PRÉSENTS EN EXÉCUTION sur les
 * trois fichiers réels le 17.08.2026 (`curl -I`, voir rapport de livraison), donc le chemin
 * attendu au quotidien. EN REPLI SEULEMENT, si un serveur ne rend NI l'un NI l'autre pour un
 * fichier donné (jamais observé sur cette source, mais pas exclu pour l'avenir) : une empreinte
 * SHA-256 du contenu réellement téléchargé (`calculerEmpreinteContenu`) — ce chemin retélécharge
 * le fichier, exactement ce que la stratégie principale évite ; c'est le prix du repli, pas le
 * cas courant.
 *
 * La signature globale concatène les trois signatures par fichier, DANS L'ORDRE de `sources` —
 * un seul fichier changé (l'ASTRA republie rarement les trois en même temps) suffit à faire
 * différer la signature globale et déclencher un réimport complet (l'import existant réimporte
 * toujours les trois sources ensemble, jamais une seule — voir son en-tête, § IDEMPOTENT).
 */

import { createHash } from 'node:crypto';

export interface SourceAControler {
  readonly fichier: string;
  readonly url: string;
}

/** Fonction `fetch` injectable — signature structurelle minimale (pas le type DOM complet), pour
 *  qu'un test puisse fournir un faux `fetch` sans dépendre du DOM ni du réseau réel. */
export type FetchInjectable = (
  url: string,
  init?: { readonly method?: string },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { readonly get: (nom: string) => string | null };
  readonly body?: unknown;
}>;

/**
 * Levée quand le contrôle d'UNE source échoue (HEAD non-2xx, erreur réseau) — le job appelant
 * traduit ceci en issue `echec`, jamais en `succes`/`inchange` partiel : soit les TROIS sources
 * sont contrôlées avec succès, soit le passage entier échoue (voir en-tête § signature globale).
 */
export class ErreurControleSourceTas extends Error {
  constructor(
    readonly fichier: string,
    message: string,
  ) {
    super(`Contrôle de ${fichier} en échec : ${message}`);
    this.name = 'ErreurControleSourceTas';
  }
}

/** Signature d'UN fichier source, à partir de ses en-têtes HEAD. `null` si ni `ETag` ni
 *  `Last-Modified`/`Content-Length` ne sont exploitables — force l'appelant vers le repli par
 *  empreinte de contenu (voir `detecterSignatureSourcesTas`). */
export function construireSignatureDepuisEntetes(entetes: {
  readonly get: (nom: string) => string | null;
}): string | null {
  const etag = entetes.get('etag');
  if (etag) return `etag:${etag}`;

  const derniereModification = entetes.get('last-modified');
  const longueur = entetes.get('content-length');
  if (derniereModification || longueur) {
    return `lm:${derniereModification ?? ''}|len:${longueur ?? ''}`;
  }
  return null;
}

/** Empreinte de repli — SHA-256 du contenu réellement téléchargé. N'est appelée que si
 *  `construireSignatureDepuisEntetes` a rendu `null` pour ce fichier (voir en-tête). */
export async function calculerEmpreinteContenu(
  url: string,
  fetchImpl: FetchInjectable,
): Promise<string> {
  const reponse = await fetchImpl(url);
  if (!reponse.ok || !reponse.body) {
    throw new Error(`HTTP ${reponse.status}`);
  }
  const hachage = createHash('sha256');
  // `Readable.fromWeb` — même conversion que `db/seed/import-referentiel-vehicules-ch.ts` pour
  // consommer un corps de réponse `fetch` en flux Node.
  const { Readable } = await import('node:stream');
  const flux = Readable.fromWeb(reponse.body as never);
  for await (const morceau of flux as AsyncIterable<Buffer>) {
    hachage.update(morceau);
  }
  return `sha256:${hachage.digest('hex')}`;
}

/**
 * Signature d'UNE source : `HEAD` d'abord, repli par empreinte de contenu si les en-têtes ne
 * suffisent pas. Lève `ErreurControleSourceTas` si le `HEAD` lui-même échoue (réseau, HTTP non
 * 2xx) — le repli ne s'applique qu'à un `HEAD` RÉUSSI mais sans en-tête exploitable, jamais à un
 * `HEAD` en échec (retélécharger tout le fichier ne sauverait rien si le serveur est injoignable).
 */
async function signatureSource(
  source: SourceAControler,
  fetchImpl: FetchInjectable,
): Promise<string> {
  let reponse;
  try {
    reponse = await fetchImpl(source.url, { method: 'HEAD' });
  } catch (erreur) {
    throw new ErreurControleSourceTas(
      source.fichier,
      erreur instanceof Error ? erreur.message : String(erreur),
    );
  }
  if (!reponse.ok) {
    throw new ErreurControleSourceTas(source.fichier, `HTTP ${reponse.status}`);
  }

  const depuisEntetes = construireSignatureDepuisEntetes(reponse.headers);
  if (depuisEntetes) return depuisEntetes;

  try {
    return await calculerEmpreinteContenu(source.url, fetchImpl);
  } catch (erreur) {
    throw new ErreurControleSourceTas(
      source.fichier,
      `repli par empreinte de contenu en échec : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
    );
  }
}

/**
 * Signature GLOBALE des sources ASTRA (concaténation ordonnée) — comparée par l'appelant à
 * `referentiel_vehicules_ch_etat_import.signature_source` pour décider `inchange` vs `succes`.
 * Lève `ErreurControleSourceTas` dès la PREMIÈRE source en échec (pas de contrôle partiel — voir
 * en-tête de fichier).
 */
export async function detecterSignatureSourcesTas(
  sources: readonly SourceAControler[],
  fetchImpl: FetchInjectable,
): Promise<string> {
  const signatures: string[] = [];
  for (const source of sources) {
    signatures.push(await signatureSource(source, fetchImpl));
  }
  return signatures.join('||');
}
