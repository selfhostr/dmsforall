import { EN_TETE_ETAG, EN_TETE_IDEMPOTENCE, EN_TETE_IDEMPOTENCE_REJEU, EN_TETE_IF_MATCH } from '@dfa/shared';

import i18n from '@/i18n';
import { obtenirEnv } from '@/config/env';

import { construireErreurApi, ErreurReseau } from './erreurs';

const DELAI_REQUETE_MS = 15_000;

export type OptionsRequeteApi = Omit<RequestInit, 'credentials'> & {
  /** Identité de la REQUÊTE (uuid v4) — en-tête `Idempotency-Key` (contrats-api-etape-1.md §5.1).
   *  Obligatoire côté serveur sur les créations qui consomment une ressource rare (numéro d'OR,
   *  de client...). Le front la produit via `useCleIdempotence()` (`./idempotence.ts`), jamais
   *  à la main. */
  readonly idempotencyKey?: string;
  /** ETag attendu — en-tête `If-Match` (§9). Obligatoire sur `PATCH /ordres-reparation/{id}`,
   *  facultatif sur les actions. À fournir depuis l'`ETag` lu sur le `GET` précédent via
   *  `surReponse`/`lireEnTetesReponse` ci-dessous. */
  readonly ifMatch?: string;
  /** Rappel synchrone reçu la réponse HTTP dès qu'elle arrive, AVANT lecture du corps — seul
   *  moyen d'observer les en-têtes de réponse (`ETag`, `Idempotency-Rejeu`) sans changer la
   *  signature de retour de `requeteApi` (qui reste `T | undefined`, compatible avec tous les
   *  appels existants du socle). Appelé pour toute réponse, y compris les 204 et les erreurs :
   *  c'est à l'appelant de décider ce qui l'intéresse. Voir `lireEnTetesReponse`. */
  readonly surReponse?: (reponse: Response) => void;
};

/** Client fetch unique de l'app. `credentials:'include'` systématique (cookie httpOnly de
 *  session), `Accept-Language` = langue i18next courante, timeout 15s, et 204/corps vide ->
 *  `undefined` (ne JAMAIS appeler `.json()` sur une réponse vide). */
export async function requeteApi<T>(chemin: string, options: OptionsRequeteApi = {}): Promise<T | undefined> {
  const url = `${obtenirEnv().VITE_API_URL}${chemin}`;

  const entetes = new Headers(options.headers);
  entetes.set('Accept-Language', i18n.language);
  if (options.body !== undefined && !entetes.has('Content-Type')) {
    entetes.set('Content-Type', 'application/json');
  }
  if (options.idempotencyKey) {
    entetes.set(EN_TETE_IDEMPOTENCE, options.idempotencyKey);
  }
  if (options.ifMatch) {
    entetes.set(EN_TETE_IF_MATCH, options.ifMatch);
  }

  let reponse: Response;
  try {
    reponse = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: entetes,
      signal: options.signal ?? AbortSignal.timeout(DELAI_REQUETE_MS),
    });
  } catch (cause) {
    throw new ErreurReseau(cause);
  }

  options.surReponse?.(reponse);

  if (reponse.status === 204) return undefined;

  const corpsTexte = await reponse.text();

  if (!reponse.ok) {
    throw construireErreurApi(reponse, corpsTexte);
  }

  if (corpsTexte.length === 0) return undefined;

  return JSON.parse(corpsTexte) as T;
}

export interface EnTetesReponseApi {
  /** `W/"<version>"` si présent, `null` sinon (`GET /ordres-reparation/{id}` et toute action qui
   *  le modifie, §9). À reporter tel quel dans `ifMatch` du prochain `PATCH`. */
  readonly etag: string | null;
  /** `true` si cette réponse est le rejeu à l'identique d'une création déjà traitée sous la même
   *  `Idempotency-Key` (§5.1) — un succès, jamais une erreur : la file d'attente au comptoir n'a
   *  pas à distinguer une première réussite d'un rejeu. */
  readonly idempotenceRejeu: boolean;
}

/** Lit les deux en-têtes de réponse contractuels de l'étape 1 depuis un objet `Response` —
 *  typiquement passé à `surReponse` ci-dessus. Isolé dans une fonction pure pour rester testable
 *  sans repasser par `fetch`. */
export function lireEnTetesReponse(reponse: Response): EnTetesReponseApi {
  return {
    etag: reponse.headers.get(EN_TETE_ETAG),
    idempotenceRejeu: reponse.headers.get(EN_TETE_IDEMPOTENCE_REJEU) === 'true',
  };
}
