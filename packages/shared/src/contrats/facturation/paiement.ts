import { z } from 'zod';

import {
  MOYENS_PAIEMENT,
  NATURES_IMPUTATION,
  type DeviseFacturation,
  type IssueAvanceClient,
  type MoyenPaiement,
  type NatureImputation,
  type SourcePaiement,
} from './enums';
import { schemaCentimesTtc, schemaCentimesTtcPositif, schemaDeviseFacturation } from './primitives';
import { schemaDateJour, schemaIdentifiant, schemaTexteCourt } from '../atelier/primitives';
import { schemaBooleenQuery, schemaListeQuery } from '../filtres';

/**
 * Paiements et imputations (§4.1 → §4.3, §6.5 du modèle documentaire ; `RF-65` → `RF-80`).
 *
 * **Un encaissement et son affectation sont deux objets distincts** (`MD-50`), et c'est la
 * décision structurante de tout ce fichier. Elle résout en une seule fois les quatre cas que le
 * terrain impose (paiement partiel, un paiement pour plusieurs factures, trop-perçu, acompte avant
 * tout document — `RF-65`) : aucun n'a besoin d'un mécanisme séparé.
 */

/* ------------------------------------------------------------------ */
/* Ressource                                                           */
/* ------------------------------------------------------------------ */

export interface ReponseImputationPaiement {
  readonly id: string;
  readonly paiementId: string;
  readonly documentId: string;
  readonly montantCentimes: number;
  readonly nature: NatureImputation;
  readonly imputeLe: string;
  readonly imputePar: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
}

/**
 * `paiement` est IMMUABLE (`MD-52`) : aucune correction en place. `contrePasseId` pointe le
 * paiement de sens opposé qui corrige celui-ci — jamais un `UPDATE`. La saisie fausse reste
 * visible, ce qui est exactement ce que la fiduciaire et l'audit cherchent en premier.
 */
export interface ReponsePaiement {
  readonly id: string;
  readonly siteId: string;
  readonly dateValeur: string;
  readonly moyen: MoyenPaiement;
  /** Signé : négatif = remboursement ou contre-passation (`MD-50`). */
  readonly montantCentimes: number;
  readonly devise: DeviseFacturation;
  /** L'assurance, le leaser, le client… Distinct du `clientId` du document réglé quand un tiers
   *  paie (`RF-73`, `MD-67`). */
  readonly payeurClientId: string | null;
  /** Figé — « Mobilière, sinistre 2026-4471 » (`MD-50`). */
  readonly payeurLibelle: string;
  readonly referenceQr: string | null;
  readonly identifiantTransactionBanque: string | null;
  readonly source: SourcePaiement;
  readonly contrePasseId: string | null;
  readonly imputations: readonly ReponseImputationPaiement[];
  /** `montant − Σ imputations de nature 'reglement'` (`MD-51` b). Une valeur strictement positive
   *  est une AVANCE CLIENT non imputée (`RF-79`), jamais un « avoir » — vocabulaire figé par
   *  `RF-4`. */
  readonly montantNonImputeCentimes: number;
  /** Actions possibles MAINTENANT sur le non-imputé (`RF-79`) : `remboursement`, `imputation
   *  future`, `abandon`. Vide si `montantNonImputeCentimes = 0`. */
  readonly issuesDisponibles: readonly IssueAvanceClient[];
  readonly creeLe: string;
  readonly creePar: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
}

/* ------------------------------------------------------------------ */
/* Filtres, tris                                                       */
/* ------------------------------------------------------------------ */

export const TRIS_PAIEMENTS = [
  'dateValeur:desc',
  'dateValeur:asc',
  'montantNonImputeCentimes:desc',
] as const;
export const TRI_DEFAUT_PAIEMENTS = 'dateValeur:desc';

export const schemaFiltresPaiements = z.object({
  siteId: schemaIdentifiant.optional(),
  moyen: schemaListeQuery(z.enum(MOYENS_PAIEMENT)).optional(),
  payeurClientId: schemaIdentifiant.optional(),
  documentId: schemaIdentifiant.optional(),
  /** Ne montre que les paiements avec un reliquat non imputé — l'écran « encaissements à
   *  affecter » de `RF-72`, qui doit être vide en fin de journée. */
  nonImputeUniquement: schemaBooleenQuery().optional(),
  dateValeurDu: schemaDateJour.optional(),
  dateValeurAu: schemaDateJour.optional(),
  tri: z.enum(TRIS_PAIEMENTS).default(TRI_DEFAUT_PAIEMENTS),
});
export type FiltresPaiements = z.infer<typeof schemaFiltresPaiements>;

/* ------------------------------------------------------------------ */
/* Entrées d'écriture                                                  */
/* ------------------------------------------------------------------ */

const formeImputationInline = z
  .object({
    documentId: schemaIdentifiant,
    montantCentimes: schemaCentimesTtcPositif,
    nature: z.enum(NATURES_IMPUTATION).default('reglement'),
  })
  .strict();

/**
 * `POST /paiements` — `Idempotency-Key` OBLIGATOIRE (consigne produit explicite : « idempotencyKey
 * sur toutes les créations sensibles — factures, paiements »), portée par l'en-tête
 * `EN_TETE_IDEMPOTENCE` déjà défini par l'étape 1, pas par un second champ dans le corps — un
 * réseau instable au comptoir ne doit jamais faire encaisser deux fois le même geste.
 *
 * `imputations` est OPTIONNEL et embarqué : l'écran de saisie propose déjà les factures ouvertes
 * du client au moment de l'encaissement (`RF-69`) et peut les confirmer dans le même geste. Un
 * paiement créé sans imputation reste valide — c'est le cas de l'acompte avant tout document
 * (`RF-65`) — et apparaît dans `GET /paiements?nonImputeUniquement=true` jusqu'à affectation
 * explicite via `POST /paiements/{id}/imputations`.
 */
export const schemaCreationPaiement = z
  .object({
    siteId: schemaIdentifiant,
    dateValeur: schemaDateJour,
    moyen: z.enum(MOYENS_PAIEMENT),
    /** STRICTEMENT POSITIF pour cette création : `POST /paiements` est le geste d'ENCAISSEMENT, et
     *  `service-paiement.ts::creer()` rejette tout montant `<= 0` (issue #9 GitHub, commit `49a89d9`,
     *  « un paiement négatif ne crédite plus une facture »). Un remboursement ne se saisit JAMAIS ici
     *  avec un montant négatif : il se crée via `POST /paiements/{id}/rembourser` (RF-79,
     *  `schemaRembourserAvance` plus bas dans ce fichier), qui insère directement un paiement de sens
     *  opposé, plafonné au solde remboursable et tracé par `contrePasseId` — jamais via ce champ. */
    montantCentimes: schemaCentimesTtc,
    devise: schemaDeviseFacturation,
    payeurClientId: schemaIdentifiant.nullish(),
    payeurLibelle: schemaTexteCourt,
    identifiantTransactionBanque: z.string().trim().max(140).nullish(),
    imputations: z.array(formeImputationInline).max(50).default([]),
  })
  .strict();
export type EntreeCreationPaiement = z.infer<typeof schemaCreationPaiement>;

/**
 * `POST /paiements/{paiementId}/imputations` — affecte un paiement déjà enregistré (encaissement
 * d'acompte non imputé, trop-perçu qu'on impute sur la facture suivante, `RF-57` c). Invariants
 * vérifiés côté serveur, PAS dans ce schéma (ils portent sur l'état de la base au moment de
 * l'écriture, pas sur la forme de la requête) :
 * `Σ imputations 'reglement' du paiement ≤ |montantCentimes|` (`MD-51` b) et
 * `Σ imputations du document ≤ |totalTtcCentimes| du document` (`MD-51` a).
 */
export const schemaCreationImputation = formeImputationInline;
export type EntreeCreationImputation = z.infer<typeof schemaCreationImputation>;

/**
 * `POST /paiements/{paiementId}/rembourser` — une des trois issues de l'avance client (`RF-79`).
 * Produit un `paiement` de sens opposé lié par `contrePasseId` (`MD-57`), jamais une correction en
 * place. `Idempotency-Key` OBLIGATOIRE : c'est une création de paiement.
 */
export const schemaRembourserAvance = z
  .object({
    montantCentimes: schemaCentimesTtcPositif,
    referenceVirement: z.string().trim().max(140).nullish(),
  })
  .strict();
export type EntreeRembourserAvance = z.infer<typeof schemaRembourserAvance>;

/** `POST /paiements/{paiementId}/abandonner` — troisième issue de `RF-79` : compensation en
 *  faveur du garage, imputation de nature `compensation` sur un document de régularisation
 *  désigné. Motif obligatoire — c'est un geste qui renonce à rendre de l'argent au client. */
export const schemaAbandonnerAvance = z
  .object({
    documentRegularisationId: schemaIdentifiant,
    montantCentimes: schemaCentimesTtcPositif,
    motif: schemaTexteCourt,
  })
  .strict();
export type EntreeAbandonnerAvance = z.infer<typeof schemaAbandonnerAvance>;

/**
 * `POST /documents-vente/{documentId}/escompte` — `RF-46` → `RF-48` : l'escompte n'est JAMAIS
 * appliqué automatiquement, dans un sens comme dans l'autre (accordé ou refusé). Ce schéma EST le
 * geste humain : un comptable qui l'appelle vient de cliquer « accorder ». Le montant est saisi en
 * TTC (cohérence avec la règle « prix toujours TVA comprise ») ; le serveur calcule la correction
 * de TVA proportionnelle (`MD-71`, arithmétique démontrée par `CF-14` et `CF-26`) et crée
 * l'imputation `escompte` correspondante.
 */
export const schemaAccorderEscompte = z
  .object({
    montantEscompteTtcCentimes: schemaCentimesTtcPositif,
  })
  .strict();
export type EntreeAccorderEscompte = z.infer<typeof schemaAccorderEscompte>;

/** `POST /documents-vente/{documentId}/marquer-irrecouvrable` — `MD-72` : la créance est
 *  abandonnée, imputation de nature `perte` avec correction de TVA proportionnelle. Le document
 *  n'est pas modifié : seul `statutReglement` passe à `irrecouvrable`. */
export const schemaMarquerIrrecouvrable = z.object({ motif: schemaTexteCourt }).strict();
export type EntreeMarquerIrrecouvrable = z.infer<typeof schemaMarquerIrrecouvrable>;
