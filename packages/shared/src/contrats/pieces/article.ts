import { z } from 'zod';

import {
  CATEGORIES_ARTICLE,
  STATUTS_ARTICLE,
  TYPES_REFERENCE_ARTICLE,
  type CategorieArticle,
  type StatutArticle,
  type TypeReferenceArticle,
} from './enums';
import { schemaCentimesPositif, schemaCodeBarres, schemaReferenceArticle } from './primitives';
import {
  schemaIdentifiant,
  schemaMotif,
  schemaPourmille,
  schemaTexteCourt,
} from '../atelier/primitives';

/**
 * Le référentiel article (`article`, `article_reference`) — `RP-01` → `RP-08`.
 *
 * Un article existe indépendamment de tout stock (`RP-01`) : le stock par site vit dans
 * `stock.ts`, jamais embarqué en écriture ici — seulement en LECTURE, à titre de résumé
 * (`ReponseArticle.stocksResume`), pour éviter un aller-retour sur l'écran de fiche article.
 */

/* ------------------------------------------------------------------ */
/* Ressource                                                           */
/* ------------------------------------------------------------------ */

export interface ReponseArticleReference {
  readonly id: string;
  readonly articleId: string;
  readonly type: TypeReferenceArticle;
  readonly reference: string;
  /** Obligatoire et UNIQUEMENT pour `type = 'fournisseur'` (`RP-02`, voir la note d'inférence de
   *  `TYPES_REFERENCE_ARTICLE` dans `enums.ts`). `null` pour `equivalente` et `remplace_par`. */
  readonly fournisseurId: string | null;
  readonly creeLe: string;
}

/**
 * Résumé de stock EMBARQUÉ sur `ReponseArticle`, un par site où l'article a un mouvement ou un
 * seuil défini — PAS la ressource complète (`stock.ts::ReponseStockArticle`), qui porte en plus le
 * détail des réservations actives. Évite un `GET /articles/{id}` qui coûterait N requêtes de
 * disponibilité pour afficher une fiche article simple.
 */
export interface StockResumeArticle {
  readonly siteId: string;
  readonly quantitePhysiqueMillieme: number;
  readonly quantiteDisponibleMillieme: number;
}

export interface ReponseArticle {
  readonly id: string;
  /** Généré par le serveur, unique par tenant (`RP-08`). Jamais fourni en entrée. */
  readonly numeroArticle: string;
  readonly designation: string;
  readonly marque: string | null;
  readonly categorie: CategorieArticle;
  readonly statut: StatutArticle;
  readonly referencePrincipale: string;
  readonly codeBarres: string | null;
  /**
   * Dernier prix d'achat connu, en CENTIMES. `null` tant qu'aucune réception n'a eu lieu.
   * MÉTHODE DE VALORISATION NON TRANCHÉE (`RP-33`, `QP-04`) : ce champ documente la valeur
   * actuellement retenue, quelle que soit la méthode choisie en aval (dernier prix ou moyenne
   * pondérée) — le contrat ne préjuge pas laquelle produit ce nombre.
   */
  readonly prixAchatCentimes: number | null;
  /** TVA comprise, jamais HT + TVA ajoutée à l'écran (`RP-33`, cohérent avec `RF-6`/A1 étape 2). */
  readonly prixVenteTtcCentimes: number;
  /** Taux courant appliqué par défaut à une nouvelle ligne référençant cet article — figé sur
   *  chaque ligne à sa création (`RP-36`), donc un changement ici n'affecte jamais l'historique. */
  readonly tauxTvaPourmille: number;
  /** `true` pour un article d'échange standard (alternateur, démarreur…) — active la saisie d'une
   *  consigne à la pose (`RP-37`). */
  readonly estEchangeStandard: boolean;
  /** Obligatoire et UNIQUEMENT si `estEchangeStandard = true`. TTC, `RP-38`. */
  readonly montantConsigneTtcCentimes: number | null;
  /** Renseigné UNIQUEMENT si `statut = 'obsolete'` et qu'un remplaçant est connu (`RP-04`). */
  readonly referenceRemplacementId: string | null;
  /** 0..n, tronqué au-delà de 50 (fiche article, rarement volumineuse) ; `GET
   *  /articles/{id}/references` pagine le cas échéant. */
  readonly references: readonly ReponseArticleReference[];
  readonly referencesTronquees: boolean;
  readonly stocksResume: readonly StockResumeArticle[];
  readonly creeLe: string;
  readonly modifieLe: string;
}

export const SEUIL_REFERENCES_EMBARQUEES_ARTICLE = 50;

/* ------------------------------------------------------------------ */
/* Filtres, tri et recherche (RP-03)                                   */
/* ------------------------------------------------------------------ */

export const TRIS_ARTICLES = [
  'creeLe:desc',
  'creeLe:asc',
  'designation:asc',
  'designation:desc',
  'numeroArticle:asc',
] as const;
export const TRI_DEFAUT_ARTICLES = 'designation:asc';

/**
 * `q` cherche dans `designation`, `referencePrincipale` ET **toutes les références alternatives**
 * (`RP-03` : « quelle que soit la référence saisie ») — recherche déjà couverte par le module
 * `recherche/` transverse de l'étape 1 pour l'écran global ; ce paramètre reste nécessaire pour un
 * filtrage LOCAL à l'écran pièces (comptoir, ligne d'OR), sans dépendre du service de recherche
 * transverse dont l'objet `TYPES_RESULTAT_RECHERCHE` n'inclut pas encore `'article'` (extension
 * à discuter avec l'agent propriétaire de `recherche/`, hors périmètre de ce fichier).
 */
export const schemaFiltresArticles = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  categorie: z.array(z.enum(CATEGORIES_ARTICLE)).optional(),
  statut: z.array(z.enum(STATUTS_ARTICLE)).optional(),
  estEchangeStandard: z.coerce.boolean().optional(),
  tri: z.enum(TRIS_ARTICLES).default(TRI_DEFAUT_ARTICLES),
});
export type FiltresArticles = z.infer<typeof schemaFiltresArticles>;

/**
 * `GET /articles/recherche-comptoir?q=&siteId=` — forme COMPACTE optimisée pour l'écran de vente
 * comptoir et la saisie de ligne pièce à l'atelier : un seul appel donne prix, référence ET
 * disponibilité au site courant, plutôt que `GET /articles` puis N × `GET /articles/{id}/stock`.
 * Résultat borné, non paginé par curseur (repli volontaire — usage de saisie assistée, pas de
 * consultation exhaustive ; `limite` fixe, pas de `curseur`).
 */
export const schemaRechercheComptoir = z.object({
  q: z.string().trim().min(1).max(120),
  siteId: schemaIdentifiant,
  limite: z.coerce.number().int().min(1).max(20).default(10),
});
export type EntreeRechercheComptoir = z.infer<typeof schemaRechercheComptoir>;

export interface ResultatRechercheComptoirArticle {
  readonly articleId: string;
  readonly numeroArticle: string;
  readonly designation: string;
  readonly referencePrincipale: string;
  readonly prixVenteTtcCentimes: number;
  readonly quantiteDisponibleMillieme: number;
  readonly emplacement: string | null;
  readonly estEchangeStandard: boolean;
  readonly montantConsigneTtcCentimes: number | null;
}

/* ------------------------------------------------------------------ */
/* Entrées d'écriture                                                  */
/* ------------------------------------------------------------------ */

/**
 * Objet nu, réutilisé par `schemaCreationArticle` (via `.refine()`) et par
 * `schemaModificationArticle` (via `.partial()`) — même patron que
 * `atelier/ligne.ts::schemaCreationLigneOr` / `schemaModificationLigneOr` : un `.refine()` change
 * le schéma en `ZodEffects`, qui n'expose plus `.partial()`. `prixAchatCentimes` est ABSENT de cet
 * objet et donc de tout schéma d'entrée : il ne se met à jour QUE par un mouvement d'entrée
 * (`RP-29`), jamais par une saisie manuelle qui désynchroniserait le prix affiché de l'historique
 * des réceptions. `statut` reste hors de ce schéma : voir les actions nommées ci-dessous, même
 * patron que `ligne_or.statut`.
 */
const schemaArticleObjet = z.object({
  designation: schemaTexteCourt,
  marque: z.string().trim().max(80).nullish(),
  categorie: z.enum(CATEGORIES_ARTICLE),
  referencePrincipale: schemaReferenceArticle,
  codeBarres: schemaCodeBarres.nullish(),
  prixVenteTtcCentimes: schemaCentimesPositif,
  tauxTvaPourmille: schemaPourmille,
  estEchangeStandard: z.boolean().default(false),
  montantConsigneTtcCentimes: schemaCentimesPositif.nullish(),
});

/**
 * `POST /articles` — `Idempotency-Key` OBLIGATOIRE : même raison que `POST /ordres-reparation`
 * (RM-49) et `POST /clients` (RM-11) — `numeroArticle` (`RP-08`) est une ressource RARE générée
 * par le serveur, un rejeu ne doit jamais en brûler un second pour la même saisie.
 */
export const schemaCreationArticle = schemaArticleObjet.refine(
  (v) => v.estEchangeStandard === (v.montantConsigneTtcCentimes != null),
  {
    message:
      '`montantConsigneTtcCentimes` est obligatoire quand `estEchangeStandard = true`, et doit être absent sinon (RP-37).',
    path: ['montantConsigneTtcCentimes'],
  },
);
export type EntreeCreationArticle = z.infer<typeof schemaCreationArticle>;

/** `PATCH /articles/{id}` — tous les champs facultatifs (mise à jour partielle). */
export const schemaModificationArticle = schemaArticleObjet.partial();
export type EntreeModificationArticle = z.infer<typeof schemaModificationArticle>;

/**
 * `POST /articles/{id}/references` — ajoute ou met à jour une référence alternative. Pas
 * d'`Idempotency-Key` : upsert sur `(tenantId, reference)` — **pas** `(articleId, type,
 * reference)` comme une première version de ce contrat le prévoyait. Corrigé pour suivre le
 * schéma (base de référence) : `reference` est unique PAR TENANT, tous types et tous articles
 * confondus (`RP-03` — une référence n'appartient qu'à un seul article ; c'est ce qui permet à un
 * magasinier de scanner un code-barres et de tomber sur un article, jamais sur un choix). Trois cas :
 *  - la référence n'existe pas encore pour ce tenant → création ;
 *  - elle existe déjà et porte sur CE MÊME article → mise à jour de `type`/`fournisseurId` (upsert
 *    réel : reposer la même référence avec un type différent — ex. une référence d'abord notée
 *    `equivalente` puis reconnue comme la référence `fournisseur` d'un partenaire précis — écrase
 *    l'ancienne ligne plutôt que d'en créer une seconde, impossible sous la contrainte
 *    d'unicité) ;
 *  - elle existe déjà et porte sur un AUTRE article → refusée, `409 ARTICLE_REFERENCE_COLLISION`.
 */
export const schemaCreationReferenceArticle = z
  .object({
    type: z.enum(TYPES_REFERENCE_ARTICLE),
    reference: schemaReferenceArticle,
    fournisseurId: schemaIdentifiant.nullish(),
  })
  .refine((v) => (v.type === 'fournisseur') === (v.fournisseurId != null), {
    message:
      "`fournisseurId` est obligatoire pour `type = 'fournisseur'`, et doit être absent sinon (RP-02).",
    path: ['fournisseurId'],
  });
export type EntreeCreationReferenceArticle = z.infer<typeof schemaCreationReferenceArticle>;

/** `POST /articles/{id}/marquer-obsolete` — `referenceRemplacementId` obligatoire SI une référence
 *  `remplace_par` existe déjà pour cet article, refusé sinon (`RP-04` →
 *  `409 ARTICLE_REMPLACANT_REQUIS`, contrôle SERVEUR car il dépend de l'état des références). */
export const schemaMarquageObsolete = z.object({
  referenceRemplacementId: schemaIdentifiant.optional(),
});
export type EntreeMarquageObsolete = z.infer<typeof schemaMarquageObsolete>;

/** `POST /articles/{id}/desactiver` — refusé (`409 ARTICLE_DESACTIVATION_IMPOSSIBLE`) si une
 *  réservation `active` porte sur cet article (§6.1) — le motif reste facultatif : désactiver un
 *  article dormant n'est pas un geste destructeur au sens de `schemaMotif` (RM-71 ne s'applique
 *  qu'aux lignes d'OR). */
export const schemaDesactivationArticle = z.object({
  motif: schemaMotif.optional(),
});
export type EntreeDesactivationArticle = z.infer<typeof schemaDesactivationArticle>;

/** `POST /articles/{id}/reactiver` — retour à `actif` depuis `obsolete` ou `desactive`, aucun
 *  corps requis (réversibilité, §6.1). */
