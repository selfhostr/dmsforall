import type {
  CategorieArticle,
  EntreeCreationArticle,
  EntreeCreationReferenceArticle,
  EntreeDesactivationArticle,
  EntreeMarquageObsolete,
  EntreeModificationArticle,
  EntreeRechercheComptoir,
  PageCurseur,
  ReponseArticle,
  ReponseAvecAvertissements,
  ResultatRechercheComptoirArticle,
  StatutArticle,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport du référentiel article — même convention que `hooks/vehicules/vehicules.api.ts`
 * et `hooks/facturation/documents-vente.api.ts` : les types consommés sont ceux de `@dfa/shared`
 * (`packages/shared/src/contrats/pieces/`), jamais `api/types.gen.ts`.
 *
 * ÉCART SIGNALÉ (même nature que celui documenté en tête de `documents-vente.api.ts`) :
 * `apps/web/src/api/types.gen.ts` n'a pas encore été régénéré depuis l'OpenAPI pour inclure le
 * module `pieces` (`pnpm api:openapi && pnpm web:types`, non exécuté ici — le dépôt a des agents
 * en vol en parallèle sur `apps/api/**`, régénérer maintenant risquait de capturer un état
 * intermédiaire d'un autre agent). Les 18 routes elles-mêmes existent et sont prouvées côté API
 * (`apps/api/src/pieces/*.controller.ts`) ; ce fichier s'aligne sur leurs DTO, qui implémentent
 * eux-mêmes les types `@dfa/shared` importés ci-dessus (voir `apps/api/src/pieces/dto/article.dto.ts`).
 * À réconcilier avec `types.gen.ts` à la prochaine régénération planifiée.
 */

/** Sous-ensemble de `FiltresArticles` (@dfa/shared) réellement exposé par l'écran — un seul
 *  `categorie`/`statut` à la fois (pas de multi-sélection en v1), sérialisé en tableau à un
 *  élément pour rester conforme à `schemaFiltresArticles` côté serveur. */
export interface FiltresListeArticles {
  readonly q?: string;
  readonly categorie?: CategorieArticle;
  readonly statut?: StatutArticle;
  readonly estEchangeStandard?: boolean;
  readonly tri: string;
  readonly [cle: string]: string | number | boolean | undefined;
}

export interface PageArticles {
  readonly limite: number;
  readonly curseur?: string;
}

function construireParametresListe(filtres: FiltresListeArticles, page: PageArticles): string {
  const parametres = new URLSearchParams();
  if (filtres.q && filtres.q.trim() !== '') parametres.set('q', filtres.q.trim());
  if (filtres.categorie) parametres.append('categorie', filtres.categorie);
  if (filtres.statut) parametres.append('statut', filtres.statut);
  if (filtres.estEchangeStandard !== undefined)
    parametres.set('estEchangeStandard', String(filtres.estEchangeStandard));
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(page.limite));
  if (page.curseur) parametres.set('curseur', page.curseur);
  return parametres.toString();
}

/** `GET /articles` (RP-03), pagination par curseur. */
export async function listerArticles(
  filtres: FiltresListeArticles,
  page: PageArticles,
): Promise<PageCurseur<ReponseArticle>> {
  const reponse = await requeteApi<PageCurseur<ReponseArticle>>(
    `/articles?${construireParametresListe(filtres, page)}`,
    {
      method: 'GET',
    },
  );
  return reponse ?? { donnees: [], curseurSuivant: null, limite: page.limite };
}

/** `GET /articles/recherche-comptoir?q=&siteId=&limite=` — LE geste n°1 du magasinier (F1-R2 du
 *  domaine pièces) : un seul appel donne prix, référence et disponibilité au site. Résultat
 *  borné, non paginé (voir `schemaRechercheComptoir`, @dfa/shared). */
export async function rechercheComptoirArticles(
  entree: EntreeRechercheComptoir,
): Promise<readonly ResultatRechercheComptoirArticle[]> {
  const parametres = new URLSearchParams({
    q: entree.q,
    siteId: entree.siteId,
    limite: String(entree.limite),
  });
  const reponse = await requeteApi<readonly ResultatRechercheComptoirArticle[]>(
    `/articles/recherche-comptoir?${parametres.toString()}`,
    {
      method: 'GET',
    },
  );
  return reponse ?? [];
}

/** `GET /articles/{id}` — fiche complète (références + résumé de stock par site). */
export async function recupererArticle(articleId: string): Promise<ReponseArticle> {
  const article = await requeteApi<ReponseArticle>(`/articles/${articleId}`, { method: 'GET' });
  if (!article) {
    throw new Error('Réponse article inattendue : corps vide.');
  }
  return article;
}

/** `POST /articles` — `Idempotency-Key` OBLIGATOIRE (RP-08 : `numeroArticle` est une ressource
 *  rare générée par le serveur, un rejeu ne doit jamais en brûler un second). */
export async function creerArticle(
  entree: EntreeCreationArticle,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseArticle>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseArticle>>('/articles', {
    method: 'POST',
    body: JSON.stringify(entree),
    idempotencyKey,
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /articles.');
  }
  return reponse;
}

/** `PATCH /articles/{id}` — mise à jour partielle. */
export async function modifierArticle(
  articleId: string,
  entree: EntreeModificationArticle,
): Promise<ReponseAvecAvertissements<ReponseArticle>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseArticle>>(
    `/articles/${articleId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : PATCH /articles.');
  }
  return reponse;
}

/** `POST /articles/{id}/references` — upsert sur `(tenant, reference)` (RP-02/RP-03). Pas
 *  d'`Idempotency-Key` (upsert, pas une création au sens strict — voir le contrat). */
export async function ajouterReferenceArticle(
  articleId: string,
  entree: EntreeCreationReferenceArticle,
): Promise<ReponseAvecAvertissements<ReponseArticle>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseArticle>>(
    `/articles/${articleId}/references`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /articles/references.');
  }
  return reponse;
}

/** `POST /articles/{id}/marquer-obsolete` (RP-04). */
export async function marquerObsoleteArticle(
  articleId: string,
  entree: EntreeMarquageObsolete,
): Promise<ReponseAvecAvertissements<ReponseArticle>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseArticle>>(
    `/articles/${articleId}/marquer-obsolete`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /articles/marquer-obsolete.');
  }
  return reponse;
}

/** `POST /articles/{id}/desactiver` — refusé (`409 ARTICLE_DESACTIVATION_IMPOSSIBLE`) si une
 *  réservation active porte sur l'article (§6.1). */
export async function desactiverArticle(
  articleId: string,
  entree: EntreeDesactivationArticle,
): Promise<ReponseAvecAvertissements<ReponseArticle>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseArticle>>(
    `/articles/${articleId}/desactiver`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /articles/desactiver.');
  }
  return reponse;
}

/** `POST /articles/{id}/reactiver` — retour à `actif`, aucun corps requis (§6.1). */
export async function reactiverArticle(
  articleId: string,
): Promise<ReponseAvecAvertissements<ReponseArticle>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseArticle>>(
    `/articles/${articleId}/reactiver`,
    {
      method: 'POST',
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /articles/reactiver.');
  }
  return reponse;
}
