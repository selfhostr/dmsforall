import { z } from 'zod';

import {
  STATUTS_FACTURE_FOURNISSEUR,
  type OrigineDonneeFacture,
  type StatutFactureFournisseur,
} from './enums';
import { schemaIdentifiant, schemaMotif } from '../atelier/primitives';
import { schemaListeQuery } from '../filtres';
import { schemaParametresPage } from '../pagination';

/**
 * Lecture automatique des factures fournisseurs — dépôt de fichier, chaîne QR → texte PDF → OCR,
 * rapprochement à la commande fournisseur, écarts prix/quantité ligne à ligne.
 *
 * Décisions @laupernoe (ne pas rouvrir) : dépôt depuis le poste fixe uniquement (pas de courriel entrant,
 * pas de photo mobile) ; rattachement à la commande SANS mise à jour automatique du stock ni des
 * prix d'achat ; le document est CONSERVÉ en base (obligation de conservation dix ans, art. 958f
 * CO — l'inverse de la carte grise, qui n'est jamais conservée). Correspondance EXACTE
 * uniquement : un rapprochement approximatif qui se révèle faux est pire qu'aucun rapprochement.
 *
 * `ChampFactureFournisseur` : les seuls champs d'EN-TÊTE dont la PROVENANCE (`OrigineDonneeFacture`)
 * est individuellement tracée — une valeur issue du QR est certaine, une valeur issue du texte du
 * PDF l'est presque, une valeur issue de l'OCR ne l'est jamais. `champsOrigine` ne porte QUE les
 * champs effectivement renseignés (`Partial` — un champ absent de la carte est un champ non trouvé,
 * jamais confondu avec « trouvé par un moyen inconnu »). Les lignes portent leur origine chacune la
 * leur (`ReponseLigneFactureFournisseur.origine`) : une ligne entière vient d'UN SEUL passage de la
 * chaîne, contrairement à l'en-tête où QR et texte PDF cohabitent.
 */
export const CHAMPS_FACTURE_FOURNISSEUR = [
  'ibanCreancier',
  'nomCreancier',
  'montantTotalCentimes',
  'devise',
  'referencePaiement',
  'numeroFacture',
  'dateFacture',
] as const;
export type ChampFactureFournisseur = (typeof CHAMPS_FACTURE_FOURNISSEUR)[number];

export type ChampsOrigineFactureFournisseur = Partial<
  Record<ChampFactureFournisseur, OrigineDonneeFacture>
>;

/* ------------------------------------------------------------------ */
/* Document — métadonnées seules, JAMAIS le binaire dans ce contrat    */
/* ------------------------------------------------------------------ */

/**
 * Métadonnées du document déposé. Le binaire lui-même ne transite JAMAIS par ce contrat — il vit
 * dans `facture_fournisseur_document`, une table séparée exprès pour qu'une LISTE de factures ne
 * charge jamais l'octet du PDF (voir le rapport de livraison, §schéma). Récupération du fichier :
 * `GET /factures-fournisseur/{id}/document`, hors de ce type (réponse binaire brute).
 */
export interface ReponseDocumentFactureFournisseur {
  readonly typeMime: string;
  readonly tailleOctets: number;
  /** SHA-256 du contenu, hexadécimal — sert à repérer un dépôt en double (contrainte base). */
  readonly empreinteSha256: string;
  readonly deposeParId: string;
  readonly deposeLe: string;
}

/* ------------------------------------------------------------------ */
/* Ligne — écart calculé, jamais corrigé automatiquement                */
/* ------------------------------------------------------------------ */

/**
 * Écart ligne à ligne contre la commande fournisseur rapprochée — EN CENTIMES ENTIERS, jamais un
 * flottant. `null` : aucune ligne de commande n'a été rapprochée pour cette ligne de facture (pas
 * de commande rapprochée du tout, ou aucune correspondance EXACTE de référence d'article trouvée),
 * donc rien à comparer — distinct d'un écart de zéro (« comparé, et conforme »).
 *
 * `quantiteMillieme` compare à la quantité en RELIQUAT de la ligne de commande (ce qui restait à
 * livrer), pas à la quantité totale commandée : une facture partielle sur une commande déjà
 * partiellement reçue est le cas normal, pas une anomalie.
 */
export interface EcartLigneFactureFournisseur {
  readonly prixUnitaireCentimes: number;
  readonly quantiteMillieme: number;
  /** = `totalLigneCentimes` facturé − (prix attendu × quantité facturée, arrondi). */
  readonly totalCentimes: number;
}

export interface ReponseLigneFactureFournisseur {
  readonly id: string;
  readonly numeroOrdre: number;
  /** Référence telle qu'imprimée sur la facture — peut différer en forme de `article.reference`
   *  même quand `articleId` a été rapproché (espaces, casse normalisés avant comparaison). */
  readonly referenceArticle: string | null;
  readonly designation: string | null;
  readonly quantiteMillieme: number;
  readonly prixUnitaireCentimes: number | null;
  readonly totalLigneCentimes: number | null;
  readonly origine: OrigineDonneeFacture;
  /** Article du référentiel dont la référence correspond EXACTEMENT (normalisation espaces/casse
   *  seulement) à `referenceArticle`. `null` = aucune correspondance exacte. */
  readonly articleId: string | null;
  /** Ligne de la commande fournisseur rapprochée dont `articleId` correspond. `null` = pas de
   *  commande rapprochée, ou l'article de cette ligne n'y figure pas. */
  readonly commandeFournisseurLigneId: string | null;
  readonly ecart: EcartLigneFactureFournisseur | null;
}

/* ------------------------------------------------------------------ */
/* Facture — en-tête                                                    */
/* ------------------------------------------------------------------ */

export interface ReponseFactureFournisseur {
  readonly id: string;
  readonly statut: StatutFactureFournisseur;
  readonly document: ReponseDocumentFactureFournisseur;
  /** `null` : aucun fournisseur du tenant ne correspond EXACTEMENT au nom du créancier lu. */
  readonly fournisseurId: string | null;
  /** `null` : aucune commande fournisseur ne correspond (voir `service-rapprochement.ts` pour les
   *  critères exacts essayés — numéro de commande retrouvé dans le texte, fournisseur + référence
   *  de commande). Un rapprochement AMBIGU (plusieurs commandes candidates) reste `null` aussi :
   *  mieux vaut aucun rapprochement qu'un rapprochement faux. */
  readonly commandeFournisseurId: string | null;
  readonly ibanCreancier: string | null;
  readonly nomCreancier: string | null;
  readonly numeroFacture: string | null;
  readonly dateFacture: string | null;
  readonly montantTotalCentimes: number | null;
  readonly devise: string;
  readonly referencePaiement: string | null;
  readonly champsOrigine: ChampsOrigineFactureFournisseur;
  readonly lignes: readonly ReponseLigneFactureFournisseur[];
  readonly valideParId: string | null;
  readonly valideLe: string | null;
  readonly motifRejet: string | null;
  readonly creeLe: string;
  readonly modifieLe: string;
}

/* ------------------------------------------------------------------ */
/* Lecture — collection                                                 */
/* ------------------------------------------------------------------ */

export const TRIS_FACTURES_FOURNISSEUR = ['creeLe:desc', 'creeLe:asc'] as const;
export const TRI_DEFAUT_FACTURES_FOURNISSEUR = 'creeLe:desc';

export const schemaFiltresFacturesFournisseur = schemaParametresPage.extend({
  statut: schemaListeQuery(z.enum(STATUTS_FACTURE_FOURNISSEUR)).optional(),
  fournisseurId: schemaIdentifiant.optional(),
  commandeFournisseurId: schemaIdentifiant.optional(),
  tri: z.enum(TRIS_FACTURES_FOURNISSEUR).default(TRI_DEFAUT_FACTURES_FOURNISSEUR),
});
export type FiltresFacturesFournisseur = z.infer<typeof schemaFiltresFacturesFournisseur>;

/* ------------------------------------------------------------------ */
/* Écriture                                                             */
/* ------------------------------------------------------------------ */

/**
 * `POST /factures-fournisseur/{id}/rejeter` — motif de refus, exigé (`schemaMotif`, ≥ 3
 * caractères) : « ce n'est pas une facture », « double dépôt manuel », etc. — même exigence que
 * `commande_fournisseur_annulation_coherente_chk` (motif obligatoire dès qu'un geste ferme un
 * document sans qu'il ait produit son effet normal).
 */
export const schemaRejetFactureFournisseur = z.object({ motif: schemaMotif }).strict();
export type EntreeRejetFactureFournisseur = z.infer<typeof schemaRejetFactureFournisseur>;
