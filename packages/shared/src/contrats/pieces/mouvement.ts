import { z } from 'zod';

import { TYPES_MOUVEMENT_STOCK, type TypeMouvementStock } from './enums';
import {
  schemaDateJour,
  schemaIdentifiant,
  schemaMotif,
  schemaQuantiteMillieme,
} from '../atelier/primitives';
import { schemaListeQuery } from '../filtres';
import { schemaParametresPage } from '../pagination';

/**
 * Les mouvements de stock (`mouvement_stock`) — `RP-16` → `RP-18`.
 *
 * **IMMUABLE** (`RP-18`) : aucun `PATCH`, aucun `DELETE` dans ce contrat. Une correction se fait
 * par un mouvement INVERSE, tracé — même doctrine que la chaîne documentaire de facturation
 * (devis→facture→avoir).
 *
 * La plupart des types de mouvement (`entree_livraison`, `sortie_or`) sont des EFFETS DE BORD
 * d'une autre action (réception de commande, sortie de réservation) — voir
 * `commande-fournisseur.ts`, `reservation.ts`. Six types se créent par une action DIRECTE et
 * publique de ce module : `casse`, `perte`, `transfert`, `ajustement_inventaire`,
 * `retour_fournisseur`, et — depuis ce lot — `sortie_comptoir`/`retour_client` (vente directe au
 * comptoir SANS document de vente ni OR ; voir la note d'intégration en fin de fichier pour ce que
 * cela couvre et ne couvre PAS encore).
 */

export interface ReponseMouvementStock {
  readonly id: string;
  readonly articleId: string;
  readonly type: TypeMouvementStock;
  /**
   * Signée : positive à l'entrée, négative à la sortie (`RP-17`) — SAUF `type = 'transfert'`, où
   * elle est TOUJOURS positive (c'est la quantité déplacée, portée une seule fois ; le sens est
   * donné par `siteSourceId` → `siteDestinationId`, pas par le signe).
   */
  readonly quantiteMillieme: number;
  /** Renseigné pour tout type SAUF `transfert`. */
  readonly siteId: string | null;
  /** Renseignés UNIQUEMENT pour `type = 'transfert'` — un mouvement UNIQUE qui porte les deux
   *  sites, pas deux mouvements indépendants qui perdraient le lien (`RP-13`). */
  readonly siteSourceId: string | null;
  readonly siteDestinationId: string | null;
  /** Prix d'achat réel du mouvement, UNIQUEMENT pour `entree_livraison` — peut différer du prix
   *  attendu à la commande (`RP-29`). `null` pour tout autre type. */
  readonly prixAchatReelCentimes: number | null;
  /**
   * Auteur humain du mouvement — `string` dans une première version de ce contrat, corrigé en
   * `string | null` pour suivre le schéma (base de référence) : une reprise de données ou un
   * import n'a pas d'auteur humain.
   *
   * DÉCISION DE CONTRAT sur ce que `null` signifie pour un consommateur : ce n'est PAS un `null`
   * générique « auteur inconnu ». Dans ce contrat, `null` a EXACTEMENT une seule cause — un
   * mouvement issu d'une reprise de données ou d'un import (l'équipe reprise de données), jamais
   * une saisie humaine dont l'auteur se serait perdu. Un `null` brut est exposé plutôt qu'un
   * marqueur structuré séparé (ex. `{ origine: 'import' } | { origine: 'utilisateur'; id }`) : ce
   * marqueur ajouterait un niveau d'indirection pour encoder une information qui n'a aujourd'hui
   * qu'UNE seule valeur possible — mais l'écran ne doit JAMAIS improviser un texte pour ce cas.
   * `null` se traduit TOUJOURS par le même libellé fixe (clé i18n dédiée, ex.
   * `pieces.mouvement.auteur.repriseDonnees`), jamais par un champ vide ou un « auteur inconnu »
   * qui laisserait croire à une donnée manquante plutôt qu'à une origine connue et volontaire. Si
   * une DEUXIÈME cause de `null` apparaît un jour (ex. compte utilisateur supprimé après coup),
   * elle devra passer par un champ discriminant explicite plutôt que de réutiliser silencieusement
   * ce `null` pour une autre sémantique — la valeur actuelle de `null` resterait alors réservée à
   * la reprise/import, faute de quoi ce commentaire mentirait rétroactivement.
   */
  readonly auteurId: string | null;
  /** Obligatoire (contrôle SERVEUR) pour `casse`, `perte`, `ajustement_inventaire`,
   *  `retour_fournisseur`, `retour_client` ; facultatif ailleurs (`RP-17`). */
  readonly motif: string | null;
  /** Au plus UNE de ces références est non nulle, selon `type` (§8 du modèle conceptuel). */
  readonly ligneOrId: string | null;
  readonly documentVenteLigneId: string | null;
  readonly commandeFournisseurLigneId: string | null;
  readonly inventaireReferenceId: string | null;
  readonly reservationId: string | null;
  readonly creeLe: string;
}

/* ------------------------------------------------------------------ */
/* Historique — GET /articles/{id}/mouvements                          */
/* ------------------------------------------------------------------ */

export const TRIS_MOUVEMENTS_STOCK = ['creeLe:desc', 'creeLe:asc'] as const;
export const TRI_DEFAUT_MOUVEMENTS_STOCK = 'creeLe:desc';

export const schemaFiltresMouvementsStock = schemaParametresPage.extend({
  type: schemaListeQuery(z.enum(TYPES_MOUVEMENT_STOCK)).optional(),
  siteId: schemaIdentifiant.optional(),
  dateDe: schemaDateJour.optional(),
  dateA: schemaDateJour.optional(),
  tri: z.enum(TRIS_MOUVEMENTS_STOCK).default(TRI_DEFAUT_MOUVEMENTS_STOCK),
});
export type FiltresMouvementsStock = z.infer<typeof schemaFiltresMouvementsStock>;

/* ------------------------------------------------------------------ */
/* Entrées d'écriture — les QUATRE mouvements à déclenchement direct   */
/* ------------------------------------------------------------------ */

/**
 * `POST /articles/{id}/mouvements/casse` — `Idempotency-Key` OBLIGATOIRE (création sensible de
 * mouvement, même règle que toute écriture de stock listée dans le brief). Refusé
 * (`409 STOCK_INSUFFISANT`) si `quantiteMillieme` dépasse le stock physique disponible pour cet
 * article/site, SAUF `forcer: true` par un rôle habilité (`RP-15`, `PP-02`).
 *
 * AUTORISATION DE `forcer: true` — RÉSOLUE (audit sécurité) : le seul droit `pieces.mouvement.creer`
 * (qui gouverne la CRÉATION du mouvement, forçage ou non) ne suffit plus. `forcer: true` exige EN
 * PLUS `pieces.mouvement.forcer` (`auth/matrice-droits.ts`, vérifié par
 * `ServiceMouvement.creerMouvementSortie` avant tout accès base, `403 DROIT_INSUFFISANT` sinon) —
 * réservé à `magasinier` : c'est le rôle qui détient déjà `pieces.mouvement.creer` seul, et le
 * seul qui constate physiquement une casse/perte au-delà de ce que le système croit disponible.
 * Avant cette résolution, quiconque possédait `pieces.mouvement.creer` héritait SILENCIEUSEMENT du
 * pouvoir de forcer un stock négatif — un rôle futur qui recevrait `pieces.mouvement.creer` sans
 * décision délibérée sur le forçage n'hériterait plus de cette capacité désormais.
 */
export const schemaCreationMouvementCasse = z
  .object({
    siteId: schemaIdentifiant,
    quantiteMillieme: schemaQuantiteMillieme,
    motif: schemaMotif,
    ligneOrId: schemaIdentifiant.nullish(),
    forcer: z.boolean().default(false),
  })
  .strict();
export type EntreeCreationMouvementCasse = z.infer<typeof schemaCreationMouvementCasse>;

/** `POST /articles/{id}/mouvements/perte` — même forme et mêmes règles que `casse` (`RP-17`), type
 *  distinct pour la traçabilité (vol/erreur inventaire vs pièce cassée à l'atelier). */
export const schemaCreationMouvementPerte = schemaCreationMouvementCasse;
export type EntreeCreationMouvementPerte = z.infer<typeof schemaCreationMouvementPerte>;

/**
 * `POST /articles/{id}/mouvements/transfert` — `Idempotency-Key` OBLIGATOIRE. Un mouvement UNIQUE,
 * jamais deux (`RP-13`, `CP-09`). Refusé (`409 STOCK_INSUFFISANT`) si le site source n'a pas la
 * quantité disponible demandée.
 */
export const schemaCreationMouvementTransfert = z
  .object({
    siteSourceId: schemaIdentifiant,
    siteDestinationId: schemaIdentifiant,
    quantiteMillieme: schemaQuantiteMillieme,
    motif: schemaMotif.optional(),
  })
  .strict()
  .refine((v) => v.siteSourceId !== v.siteDestinationId, {
    message: 'Le site source et le site destination doivent être différents.',
    path: ['siteDestinationId'],
  });
export type EntreeCreationMouvementTransfert = z.infer<typeof schemaCreationMouvementTransfert>;

/**
 * `POST /articles/{id}/mouvements/ajustement-inventaire` — `Idempotency-Key` OBLIGATOIRE. Le
 * CLIENT envoie la quantité COMPTÉE, pas un delta : le serveur calcule
 * `quantiteMillieme = quantiteCompteeMillieme - quantitePhysiqueActuelleMillieme` au moment de la
 * validation, dans la MÊME transaction que la lecture du stock courant — évite qu'un delta
 * pré-calculé côté client devienne faux entre la saisie et l'envoi (comptage qui prend du temps,
 * mouvement concurrent entre-temps).
 *
 * Réponse enveloppée avec l'avertissement `INVENTAIRE_ECART_SIGNIFICATIF`
 * (`contrats/probleme.ts::CODES_AVERTISSEMENT`) quand la valeur de l'écart
 * (`|delta| × article.prixAchatCentimes`) dépasse `PP-05` (`parametrage.ts`,
 * `seuilValeurAjustementSignificatifCentimes`) — JAMAIS bloquant (§7.6 : la saisie du magasinier
 * n'est jamais refusée pour ce motif, seule la visibilité change).
 */
export const schemaCreationAjustementInventaire = z
  .object({
    siteId: schemaIdentifiant,
    quantiteCompteeMillieme: z.number().int().min(0),
    motif: schemaMotif,
  })
  .strict();
export type EntreeCreationAjustementInventaire = z.infer<typeof schemaCreationAjustementInventaire>;

/**
 * `POST /articles/{id}/mouvements/retour-fournisseur` — `Idempotency-Key` OBLIGATOIRE. Lié à une
 * commande si elle existe (`commandeFournisseurLigneId` facultatif, `RP-30`) — un retour SANS
 * commande d'origine reste possible (pièce jamais commandée, rendue quand même).
 */
export const schemaCreationRetourFournisseur = z
  .object({
    siteId: schemaIdentifiant,
    quantiteMillieme: schemaQuantiteMillieme,
    motif: schemaMotif,
    commandeFournisseurLigneId: schemaIdentifiant.nullish(),
  })
  .strict();
export type EntreeCreationRetourFournisseur = z.infer<typeof schemaCreationRetourFournisseur>;

/**
 * `POST /articles/{id}/mouvements/sortie-comptoir` — `Idempotency-Key` OBLIGATOIRE. Vente
 * DIRECTE au comptoir, SANS ligne OR ni document de vente (`documentVenteLigneId` reste `null` sur
 * le mouvement créé). Refusé (`409 STOCK_INSUFFISANT`) si `quantiteMillieme` dépasse le disponible
 * du site — PAS de `forcer` ici, à la différence de `casse`/`perte` (RP-15/PP-02) : forcer une
 * vente sous stock négatif rouvrirait exactement le trou qu'ouvrir ce mouvement doit fermer ;
 * DÉCISION DE CONTRAT, à confirmer si un magasinier a un besoin réel de vendre en négatif assumé.
 * `motif` FACULTATIF (`mouvement_stock_motif_requis_chk`, 0025, ne le rend obligatoire que pour
 * `casse`/`perte`/`ajustement_inventaire`/`retour_fournisseur`/`retour_client` — une vente n'a pas
 * de « motif » au sens de ces types-là).
 */
export const schemaCreationMouvementSortieComptoir = z
  .object({
    siteId: schemaIdentifiant,
    quantiteMillieme: schemaQuantiteMillieme,
    motif: schemaMotif.optional(),
  })
  .strict();
export type EntreeCreationMouvementSortieComptoir = z.infer<
  typeof schemaCreationMouvementSortieComptoir
>;

/**
 * `POST /articles/{id}/mouvements/retour-client` — `Idempotency-Key` OBLIGATOIRE. Le client
 * rapporte une pièce : remet la quantité en stock PHYSIQUE du site (mouvement `+`). `motif`
 * OBLIGATOIRE (`mouvement_stock_motif_requis_chk`). Aucune vérification de disponibilité — une
 * entrée n'est jamais refusée pour stock insuffisant, seule une sortie l'est.
 */
export const schemaCreationMouvementRetourClient = z
  .object({
    siteId: schemaIdentifiant,
    quantiteMillieme: schemaQuantiteMillieme,
    motif: schemaMotif,
  })
  .strict();
export type EntreeCreationMouvementRetourClient = z.infer<
  typeof schemaCreationMouvementRetourClient
>;

/* ------------------------------------------------------------------ */
/* Aperçu d'un forçage — GET /articles/{id}/mouvements/apercu-forcage  */
/* ------------------------------------------------------------------ */

/**
 * `GET /articles/{id}/mouvements/apercu-forcage?siteId=&quantiteMillieme=` — DÉFAUT CORRIGÉ (test
 * manuel du 14.08.2026, défaut n°2) : un forçage (`casse`/`perte`, `forcer: true`) peut libérer en
 * cascade des réservations `active` sans que le magasinier en soit prévenu AVANT de cocher
 * « Forcer » — le journal (`ServiceMouvement.libererCascadeSiNecessaire`) trace l'événement APRÈS
 * coup, ce qui ne suffit pas à un avertissement qui doit être « spécifique et chiffré » avant
 * l'action. Cette route rend, EN LECTURE SEULE, l'aperçu de ce que le MÊME forçage libérerait s'il
 * était soumis maintenant : simule le même calcul et le même ordre de sélection que
 * `ServiceReservation.libererPourCascadeForcageTx` (RP-15), SANS écrire ni verrouiller quoi que ce
 * soit — indicatif uniquement, l'action réelle reste la seule source de vérité (sous verrou).
 *
 * `siteId`/`quantiteMillieme` reprennent EXACTEMENT les champs que l'utilisateur s'apprête à
 * soumettre à `POST .../casse` ou `.../perte` — l'écran interroge cet aperçu à chaque changement
 * de site/quantité pendant que « Forcer » est coché, avant d'autoriser la soumission.
 */
export const schemaApercuForcageMouvement = z
  .object({
    siteId: schemaIdentifiant,
    // `z.coerce.number()`, PAS `schemaQuantiteMillieme` nu : paramètre de QUERY STRING, jamais de
    // corps JSON — une valeur numérique y arrive TOUJOURS en texte (même doctrine que
    // `pagination.ts::limite`), `schemaQuantiteMillieme` refuserait systématiquement une chaîne.
    quantiteMillieme: z.coerce.number().int().min(1),
  })
  .strict();
export type EntreeApercuForcageMouvement = z.infer<typeof schemaApercuForcageMouvement>;

/** Une réservation `active` que le forçage simulé libérerait — assez d'information pour l'afficher
 *  SANS second appel (`RP-15` : avertissement spécifique et chiffré, jamais une phrase générale). */
export interface ReservationMenaceeParForcage {
  readonly id: string;
  readonly ligneOrId: string;
  readonly ordreReparationId: string;
  readonly ordreReparationNumero: string;
  readonly quantiteMillieme: number;
}

export interface ReponseApercuForcageMouvement {
  /** `[]` : ce forçage ne libérerait aucune réservation (stock déjà suffisant pour la quantité
   *  demandée, ou aucune réservation active sur cet article/site). */
  readonly reservations: readonly ReservationMenaceeParForcage[];
}

/**
 * NOTE D'INTÉGRATION — pont vers la facturation (`RP-43`/`RP-46`), RÉSOLU EN PARTIE.
 *
 * `sortie_comptoir`/`retour_client` gardent leur action DIRECTE ci-dessus (voie manuelle : vente
 * comptoir sans facture immédiate, retour physique sans avoir) — ce paragraphe documente le
 * SECOND chemin, désormais câblé : `facturation/documents/ligne.ts::formeLigneDocument` porte
 * `articleId`/`siteId` (facultatifs ensemble, réservés à `type = 'piece'`). Quand une ligne de
 * document de vente est créée AVEC ces deux champs (`POST /documents-vente/{id}/lignes`, ou une
 * ligne embarquée à `POST /documents-vente`), `ServiceDocumentsVente.inserterLigne`
 * (`apps/api/src/facturation/documents/service-documents.ts`) appelle
 * `ServiceMouvement.sortieComptoirPourLigneTx` (`apps/api/src/pieces/service-mouvement.ts`) DANS
 * LA MÊME TRANSACTION SQL que l'`INSERT` de la ligne — appel de service à service, jamais un
 * second `POST` HTTP indépendant depuis le front, exactement comme anticipé ici. Le mouvement créé
 * renseigne `documentVenteLigneId` avec l'identifiant de CETTE ligne. Symétriquement,
 * `ServiceAvoir.creer` (`apps/api/src/facturation/documents/service-avoir.ts`) appelle
 * `ServiceMouvement.retourClientPourLigneTx` quand un avoir crédite INTÉGRALEMENT une ligne qui
 * portait elle-même un mouvement `sortie_comptoir` — un crédit PARTIEL (montant inférieur au TTC
 * original de la ligne) NE déclenche PAS de mouvement automatique (un montant partiel n'a pas de
 * traduction fiable en quantité physique retournée) : avertissement
 * `AVOIR_RETOUR_STOCK_NON_DECLENCHE` à la place, le geste physique restant manuel
 * (`POST /articles/{id}/mouvements/retour-client`).
 *
 * CE QUI RESTE OUVERT, honnêtement, plutôt que de fabriquer un lien inventé :
 *  - `documentVenteLigneId` n'est jamais renseignable ni lisible EN LECTURE depuis
 *    `ligne_document` elle-même (aucune colonne `article_id`/`site_id` sur cette table — voir la
 *    docstring de `articleId`/`siteId` dans `contrats/facturation/ligne.ts`) : le lien durable vit
 *    UNIQUEMENT côté `mouvement_stock`, jamais retro-exposé sur `ReponseLigneDocumentVente` par ce
 *    lot.
 *  - Le pont ne s'exerce QU'À LA CRÉATION de la ligne (`ajouterLigne`/lignes embarquées de
 *    `creer()`) et À LA CRÉATION de l'avoir — jamais à l'ÉMISSION du document. Décision délibérée :
 *    un brouillon qui n'est jamais émis existe déjà (`RF-9`), et lier le mouvement à l'ÉMISSION
 *    aurait exigé de faire survivre `articleId`/`siteId` du brouillon jusque-là, ce qu'aucune
 *    colonne ne permet — voir le point précédent. Une ligne `piece` qui a déjà déclenché un
 *    mouvement ne peut donc plus être ni modifiée ni supprimée tant qu'elle existe
 *    (`409 LIGNE_DOCUMENT_STOCK_LIEE`, `service-documents.ts::modifierLigne`/`supprimerLigne`) —
 *    la seule correction, sur un brouillon, est d'abandonner ce document et d'en recommencer un.
 *  - Le paiement/encaissement de la vente comptoir n'est PAS traité ici (RP-45 : suit le circuit
 *    normal de `paiements/`, aucune distinction).
 */
