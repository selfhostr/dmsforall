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
   * mouvement issu d'une reprise de données ou d'un import (`expert-migration-donnees`), jamais
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
 * article/site, SAUF `forcer: true` par un rôle habilité (`RP-15`, `PP-02`) — voir la note sur le
 * forçage en fin de fichier : ce contrat expose le drapeau, l'AUTORISATION de l'utiliser reste à
 * arbitrer côté droits (non figée ici, voir le rapport d'accompagnement).
 */
export const schemaCreationMouvementCasse = z.object({
  siteId: schemaIdentifiant,
  quantiteMillieme: schemaQuantiteMillieme,
  motif: schemaMotif,
  ligneOrId: schemaIdentifiant.nullish(),
  forcer: z.boolean().default(false),
});
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
export const schemaCreationAjustementInventaire = z.object({
  siteId: schemaIdentifiant,
  quantiteCompteeMillieme: z.number().int().min(0),
  motif: schemaMotif,
});
export type EntreeCreationAjustementInventaire = z.infer<typeof schemaCreationAjustementInventaire>;

/**
 * `POST /articles/{id}/mouvements/retour-fournisseur` — `Idempotency-Key` OBLIGATOIRE. Lié à une
 * commande si elle existe (`commandeFournisseurLigneId` facultatif, `RP-30`) — un retour SANS
 * commande d'origine reste possible (pièce jamais commandée, rendue quand même).
 */
export const schemaCreationRetourFournisseur = z.object({
  siteId: schemaIdentifiant,
  quantiteMillieme: schemaQuantiteMillieme,
  motif: schemaMotif,
  commandeFournisseurLigneId: schemaIdentifiant.nullish(),
});
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
export const schemaCreationMouvementSortieComptoir = z.object({
  siteId: schemaIdentifiant,
  quantiteMillieme: schemaQuantiteMillieme,
  motif: schemaMotif.optional(),
});
export type EntreeCreationMouvementSortieComptoir = z.infer<
  typeof schemaCreationMouvementSortieComptoir
>;

/**
 * `POST /articles/{id}/mouvements/retour-client` — `Idempotency-Key` OBLIGATOIRE. Le client
 * rapporte une pièce : remet la quantité en stock PHYSIQUE du site (mouvement `+`). `motif`
 * OBLIGATOIRE (`mouvement_stock_motif_requis_chk`). Aucune vérification de disponibilité — une
 * entrée n'est jamais refusée pour stock insuffisant, seule une sortie l'est.
 */
export const schemaCreationMouvementRetourClient = z.object({
  siteId: schemaIdentifiant,
  quantiteMillieme: schemaQuantiteMillieme,
  motif: schemaMotif,
});
export type EntreeCreationMouvementRetourClient = z.infer<
  typeof schemaCreationMouvementRetourClient
>;

/**
 * NOTE D'INTÉGRATION, périmètre RESTANT de ce fichier — `sortie_comptoir`/`retour_client` ont
 * maintenant une action DIRECTE (ci-dessus), pour que la vente comptoir fonctionne aujourd'hui
 * sans dépendre de la facturation. Ce que cette action DIRECTE ne couvre PAS : le lien vers un
 * document de vente (`documentVenteLigneId` reste toujours `null` par ce chemin — aucun champ
 * n'est exposé pour le renseigner, volontairement, pour ne pas fabriquer une référence orpheline
 * vers une ligne qui n'existe pas). Quand `facturation` ajoutera une ligne de type `piece` SANS
 * `ordreReparationId` à un document de vente (`RP-43`) ou un avoir sur une telle ligne (`RP-46`),
 * le mouvement de stock correspondant devra naître dans la MÊME TRANSACTION que l'écriture
 * facturation (appel de service à service, jamais un second `POST` HTTP indépendant depuis le
 * front — une facture émise sans le mouvement de stock correspondant, ou l'inverse, sont deux
 * anomalies réelles) et devra alors renseigner `documentVenteLigneId`. Ce futur chemin est
 * DISTINCT des deux `POST` ci-dessus (qui resteront la voie manuelle : vente comptoir sans facture
 * immédiate, retour physique sans avoir) — signalé à l'orchestrateur pour arbitrage avec
 * expert-nestjs/expert-facturation, pas figé ici.
 */
