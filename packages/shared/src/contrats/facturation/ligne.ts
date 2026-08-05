import { z } from 'zod';

import {
  REGIMES_TVA,
  TYPES_LIGNE_DOCUMENT_VENTE,
  type ModeCalculTva,
  type RegimeTva,
  type TypeLigneDocumentVente,
} from './enums';
import { schemaCentimesTtc, schemaQuantiteLigneDocument } from './primitives';
import {
  schemaDateJour,
  schemaIdentifiant,
  schemaPourmille,
  schemaTexteCourt,
} from '../atelier/primitives';

/**
 * Lignes de document de vente (`ligne_document`, §3.3 → §3.6 et §7 du modèle documentaire).
 *
 * **Aucun `DELETE`, comme `ligne_or`** (`MD-21`) : sur un brouillon la ligne se retire librement
 * (le document entier n'a pas encore d'existence légale) ; sur un document émis, `MD-21` rejette
 * toute écriture — la seule correction est un avoir (`RF-11`).
 */

/**
 * Montants figés d'une ligne, stockés (`MD-42`), jamais recalculés à l'affichage.
 * `montantTtcCentimes = montantHtCentimes + montantTvaCentimes`, invariant garanti en base.
 */
export interface MontantsLigneDocument {
  readonly montantHtCentimes: number;
  readonly montantTvaCentimes: number;
  readonly montantTtcCentimes: number;
  /**
   * Distincts des montants ci-dessus UNIQUEMENT pour une ligne à charge du garage
   * (`MD-66`, `AC-07`) : `montantFacturableCentimes` vaut alors `0` sur les trois axes du côté
   * facturé, tandis que `montantValoriseCentimes` porte le coût interne réel. Pour toute ligne
   * normale, `montantFacturableCentimes === montantTtcCentimes`.
   */
  readonly montantFacturableCentimes: number;
  readonly montantValoriseCentimes: number;
}

export interface ReponseLigneDocumentVente {
  readonly id: string;
  readonly documentId: string;
  /** Rang d'affichage, stable — tri par défaut de la sous-collection. */
  readonly numeroOrdre: number;
  readonly type: TypeLigneDocumentVente;
  /** `MD-15` : relie la ligne à la ligne d'OR dont elle provient. `null` pour une ligne saisie
   *  directement en facturation (vente comptoir, débours, correction) ou reprise. */
  readonly ligneOrId: string | null;
  /** Obligatoire et UNIQUEMENT pour `type = 'acompte_deduit'` (`MD-55`) : référence le document
   *  d'acompte dont cette ligne déduit le montant, au même taux et au même mode de calcul. */
  readonly documentAcompteId: string | null;
  readonly designation: string;
  readonly referenceTexte: string | null;
  /** Accroche étape 3 (stock pièces) : `null` tant que le module n'existe pas. */
  readonly articleId: string | null;
  readonly quantiteMillieme: number;
  /** Figé (`MD-24`). `null` pour une ligne `texte` sans prix (note libre imprimée sur le document).
   *  ABSENT pour un rôle sans droit aux montants (`RF-115`/`RF-116`) : exposé, ce prix multiplié par
   *  `quantiteMillieme` reconstituerait le montant de ligne que `montants` masque déjà. */
  readonly prixUnitaireTtcCentimes?: number | null;
  /**
   * LECTURE SEULE (`MD-43`) — voir la note de `ModeCalculTva` dans `enums.ts`. Aucune ligne créée
   * directement en facturation ne porte plus jamais `'ht'` : seules les lignes recopiées depuis
   * une ligne d'OR ou reprises d'un ancien système peuvent encore le porter.
   */
  readonly modeCalculTva: ModeCalculTva;
  readonly regimeTva: RegimeTva;
  readonly tauxTvaPourmille: number;
  /** `MD-39` : le taux applicable dépend de CETTE date, jamais de la date du document. */
  readonly datePrestation: string;
  /** Exclusifs (`MD-41`) — au plus un des deux est non nul. `remisePourmille` est un TAUX (aucun
   *  montant), toujours visible ; `remiseMontantCentimes` est un montant en clair, donc ABSENT pour
   *  un rôle sans droit aux montants (`RF-115`/`RF-116`). */
  readonly remisePourmille: number | null;
  readonly remiseMontantCentimes?: number | null;
  /** Part de la remise globale de pied de document ventilée sur cette ligne (`MD-59`, `MD-60`).
   *  Montant en clair : ABSENT pour un rôle sans droit aux montants (`RF-115`/`RF-116`). */
  readonly remiseGlobaleRepartieCentimes?: number;
  /** Tous les champs monétaires de ligne (`prixUnitaireTtcCentimes`, `remiseMontantCentimes`,
   *  `remiseGlobaleRepartieCentimes`, `montants`) sont ABSENTS — pas mis à `null` — pour un rôle sans
   *  droit aux montants (`ROLES_SANS_MONTANT`, aujourd'hui `technicien` ; `admin` en plus côté
   *  facturation — `RF-114`, `RF-115`, `RF-116`). Traitement identique et cohérent entre eux. */
  readonly montants?: MontantsLigneDocument;
  readonly creeLe: string;
  readonly modifieLe: string;
}

/* ------------------------------------------------------------------ */
/* Entrées d'écriture                                                  */
/* ------------------------------------------------------------------ */

/**
 * `POST /documents-vente/{id}/lignes` (et lignes embarquées à la création d'un brouillon,
 * `document.ts`) — UNIQUEMENT pour une ligne saisie directement en facturation : vente comptoir
 * sans OR, débours, ligne de répartition, consigne. Une ligne issue d'un OR n'est JAMAIS saisie
 * ici, elle est RECOPIÉE par l'action serveur `POST /ordres-reparation/{id}/facturer` (`RF-81`),
 * qui ne prend aucune ligne en entrée.
 *
 * `Idempotency-Key` OBLIGATOIRE (en-tête `EN_TETE_IDEMPOTENCE`, `atelier/avertissement.ts` —
 * même mécanisme que `POST /documents-vente`, pas de second champ dans le corps) : une ligne
 * `type = 'piece'` avec `articleId`+`siteId` (voir le paragraphe dédié ci-dessous) déclenche un
 * mouvement de stock `sortie_comptoir` DANS LA MÊME TRANSACTION que l'insertion (`RP-43`,
 * `service-documents.ts::inserterLigne`) — sans idempotence, un rejeu réseau, un double-clic ou un
 * rejeu de requête sortirait la pièce du stock une seconde fois EN PLUS de dupliquer la ligne. Même
 * doctrine que tout le reste du module `facturation/` (`POST /documents-vente`,
 * `POST /documents-vente/{id}/emettre`, `POST /documents-vente/{factureId}/avoirs`,
 * `POST /paiements` et ses sous-routes) : aucune création sensible n'y est facultative.
 *
 * **Aucun champ HT, aucun `modeCalculTva`** : décision de @laupernoe, non rouverte — le prix saisi en
 * facturation est TOUJOURS un TTC en centimes entiers. Le serveur dérive HT et TVA
 * (`ttc − arrondiCommercial(ttc × taux, 1000 + taux) = ht`, `MD-43` mode `ttc`) et fige
 * `modeCalculTva = 'ttc'` sur la ligne créée.
 *
 * `articleId`/`siteId` — LE PONT vers le stock pièces (`RP-43`, note d'intégration de
 * `contrats/pieces/mouvement.ts`), fermé par cette paire de champs. Facultatifs ENSEMBLE : une
 * ligne `piece` ordinaire (correction, reprise de données, prestation valorisée sans article de
 * référentiel) reste possible SANS eux, exactement comme avant ce lot — aucune régression sur les
 * documents existants qui portent déjà des lignes `piece` sans article. Quand les DEUX sont
 * fournis, le serveur les consomme pour appeler `ServiceMouvement.sortieComptoirPourLigneTx` DANS
 * LA MÊME TRANSACTION que l'insertion de cette ligne (`apps/api/src/facturation/documents/
 * service-documents.ts::inserterLigne`) — un mouvement `sortie_comptoir` naît, référence CETTE
 * ligne via `mouvement_stock.document_vente_ligne_id`, et la vente échoue tout entière
 * (`409 STOCK_INSUFFISANT`) si le stock disponible ne couvre pas `quantiteMillieme`.
 *
 * **NI L'UN NI L'AUTRE N'EST PERSISTÉ SUR `ligne_document`** : la table n'a AUCUNE colonne
 * `article_id`/`site_id` (`0010_facturation.sql` — vérifié, aucune migration ultérieure n'en
 * ajoute), et ce lot n'a pas le mandat d'en poser une (migrations 0043/0044 prises par un autre
 * chantier au moment où ce pont a été construit). Ces deux champs sont donc PUREMENT transitoires
 * côté serveur : consommés pour fabriquer le mouvement, jamais relus depuis `ligne_document`
 * ensuite. Le lien DURABLE vit exclusivement côté stock (`mouvement_stock.document_vente_ligne_id`,
 * FK `on delete restrict` — une ligne qui a déclenché un mouvement ne peut plus être supprimée,
 * la base l'empêche). Conséquence assumée : `ReponseLigneDocumentVente.articleId` (déjà défini
 * dans le contrat, `null` documenté « tant que le module n'existe pas ») reste `null` en LECTURE
 * même pour une ligne qui a bien déclenché un mouvement — le mapper ne le retro-déduit pas depuis
 * `mouvement_stock` dans ce lot (lecture non câblée, signalé au rapport de livraison).
 *
 * Réservés à `type = 'piece'` (refine ci-dessous) : une ligne `forfait`/`main_oeuvre_*`/`texte`…
 * avec `articleId` renseigné n'a pas de sens, le stock ne se décrémente jamais pour ces types.
 */
export const formeLigneDocument = z.object({
  type: z.enum(TYPES_LIGNE_DOCUMENT_VENTE),
  designation: schemaTexteCourt,
  referenceTexte: z.string().trim().max(80).nullish(),
  /** Voir le paragraphe dédié ci-dessus — facultatifs ENSEMBLE, réservés à `type = 'piece'`. */
  articleId: schemaIdentifiant.nullish(),
  siteId: schemaIdentifiant.nullish(),
  quantiteMillieme: schemaQuantiteLigneDocument.default(1000),
  /** `null` UNIQUEMENT pour `type = 'texte'` (note libre sans prix). */
  prixUnitaireTtcCentimes: schemaCentimesTtc.nullish(),
  regimeTva: z.enum(REGIMES_TVA).default('normal'),
  tauxTvaPourmille: schemaPourmille,
  /** `MD-39`. Défaut proposé par le client = date du jour ; le serveur ne le déduit jamais tout
   *  seul, une prestation exécutée un autre jour doit porter SA date. */
  datePrestation: schemaDateJour,
  remisePourmille: schemaPourmille.optional(),
  remiseMontantCentimes: schemaCentimesTtc.optional(),
  /** `MD-55`, obligatoire et uniquement pour `type = 'acompte_deduit'`. */
  documentAcompteId: schemaIdentifiant.nullish(),
});

export const schemaCreationLigneDocument = formeLigneDocument
  .refine((v) => !(v.remisePourmille != null && v.remiseMontantCentimes != null), {
    message: 'Remise en pour mille et remise en montant sont exclusives (MD-41).',
    path: ['remiseMontantCentimes'],
  })
  .refine((v) => v.type !== 'texte' || v.prixUnitaireTtcCentimes == null, {
    message: "Une ligne de type 'texte' ne porte pas de prix.",
    path: ['prixUnitaireTtcCentimes'],
  })
  .refine((v) => v.type !== 'acompte_deduit' || v.documentAcompteId != null, {
    message: "Une ligne 'acompte_deduit' référence obligatoirement le document d'acompte (MD-55).",
    path: ['documentAcompteId'],
  })
  .refine((v) => (v.articleId == null) === (v.siteId == null), {
    message: 'articleId et siteId (pont stock, RP-43) se fournissent ensemble, ou pas du tout.',
    path: ['siteId'],
  })
  .refine((v) => v.type === 'piece' || v.articleId == null, {
    message: "articleId/siteId (pont stock, RP-43) ne sont acceptés que pour type = 'piece'.",
    path: ['articleId'],
  });

export type EntreeCreationLigneDocument = z.infer<typeof schemaCreationLigneDocument>;

/**
 * `PATCH /documents-vente/{id}/lignes/{ligneId}` — uniquement sur un document `brouillon`
 * (`MD-21`) ; champs libres.
 *
 * `articleId`/`siteId` HÉRITÉS de `formeLigneDocument` mais volontairement SANS effet différé sur
 * le stock : le serveur (`ServiceDocumentsVente.modifierLigne`) refuse TOUTE modification —
 * qu'elle touche ou non ces deux champs — d'une ligne qui a déjà déclenché un mouvement de stock
 * (`409 LIGNE_DOCUMENT_STOCK_LIEE`). Une correction de quantité/article après coup n'a pas de
 * traduction stock sûre (le mouvement déjà écrit est IMMUABLE, RP-18) ; la seule voie de correction
 * reste, sur brouillon, une suppression suivie d'un ajout — bloquée elle aussi par la même garde
 * tant qu'un mouvement existe (voir `service-documents.ts::supprimerLigne`) — donc en pratique :
 * abandonner le brouillon si l'erreur porte sur une ligne déjà sortie physiquement.
 */
export const schemaModificationLigneDocument = formeLigneDocument.partial();
export type EntreeModificationLigneDocument = z.infer<typeof schemaModificationLigneDocument>;
