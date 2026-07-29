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
  /** Figé (`MD-24`). `null` pour une ligne `texte` sans prix (note libre imprimée sur le document). */
  readonly prixUnitaireTtcCentimes: number | null;
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
  /** Exclusifs (`MD-41`) — au plus un des deux est non nul. */
  readonly remisePourmille: number | null;
  readonly remiseMontantCentimes: number | null;
  /** Part de la remise globale de pied de document ventilée sur cette ligne (`MD-59`, `MD-60`). */
  readonly remiseGlobaleRepartieCentimes: number;
  /** Absents pour un rôle sans droit aux montants (`ROLES_SANS_MONTANT`, aujourd'hui `technicien`
   *  et `admin` — `RF-114`, `RF-115`, `RF-116`). */
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
 * **Aucun champ HT, aucun `modeCalculTva`** : décision de @laupernoe, non rouverte — le prix saisi en
 * facturation est TOUJOURS un TTC en centimes entiers. Le serveur dérive HT et TVA
 * (`ttc − arrondiCommercial(ttc × taux, 1000 + taux) = ht`, `MD-43` mode `ttc`) et fige
 * `modeCalculTva = 'ttc'` sur la ligne créée.
 */
export const formeLigneDocument = z.object({
  type: z.enum(TYPES_LIGNE_DOCUMENT_VENTE),
  designation: schemaTexteCourt,
  referenceTexte: z.string().trim().max(80).nullish(),
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
    message: "Remise en pour mille et remise en montant sont exclusives (MD-41).",
    path: ['remiseMontantCentimes'],
  })
  .refine((v) => v.type !== 'texte' || v.prixUnitaireTtcCentimes == null, {
    message: "Une ligne de type 'texte' ne porte pas de prix.",
    path: ['prixUnitaireTtcCentimes'],
  })
  .refine((v) => v.type !== 'acompte_deduit' || v.documentAcompteId != null, {
    message: "Une ligne 'acompte_deduit' référence obligatoirement le document d'acompte (MD-55).",
    path: ['documentAcompteId'],
  });

export type EntreeCreationLigneDocument = z.infer<typeof schemaCreationLigneDocument>;

/** `PATCH /documents-vente/{id}/lignes/{ligneId}` — uniquement sur un document `brouillon`
 *  (`MD-21`) ; champs libres. */
export const schemaModificationLigneDocument = formeLigneDocument.partial();
export type EntreeModificationLigneDocument = z.infer<typeof schemaModificationLigneDocument>;
