import { z } from 'zod';

import type { ClientResume } from '../atelier/client';
import { schemaIdentifiant, schemaMotif, schemaTexteCourt } from '../atelier/primitives';
import { schemaConfirmations } from '../atelier/avertissement';
import {
  TYPES_FINANCEMENT_VENTE,
  type ActionFinancement,
  type StatutConfirmationFinancement,
  type TypeFinancementVente,
} from './enums';

/**
 * Le financement (`RV-39` → `RV-45`) — sous-ressource COLLECTION d'un dossier de vente
 * (`/dossiers-vente/{dossierVenteId}/financements`), PAS singulière comme `reprise.ts` : `CV-03`
 * (refus d'un organisme) fait explicitement revenir le dossier « en attente d'un NOUVEAU mode de
 * financement » (§7.3) — l'historique des tentatives (comptant proposé, refusé, puis leasing
 * confirmé) doit rester lisible, cohérent avec l'audit trail exigé sur toute entité qui touche
 * l'argent (CONTRIBUTING.md). Remplacer un financement refusé en écrasant l'ancien enregistrement
 * effacerait exactement la trace que `CV-03` veut voir.
 *
 * `RV-39` : un leasing N'EST PAS une vente au client — c'est une vente du garage à l'organisme de
 * financement. `RV-40` : le DESTINATAIRE de la facture (`document_vente.clientId`, `contrats
 * facturation`, hors périmètre) suit cette règle, mais reste une décision de FACTURATION distincte
 * du `type` porté ici — les deux informations sont liées, jamais fusionnées (`RV-41`, littéral).
 * Ce fichier ne crée ni ne référence de document : il porte seulement le SUIVI métier de la
 * confirmation, l'accroche facturation se fait par `dossierVenteId` déjà posé côté document
 * (`MD-70`, §2 de la spécification).
 *
 * Pas de collection paginée par curseur ici (même doctrine que `ordre-reparation.ts::lignes` /
 * `devisComplementaires` embarqués) : le nombre de tentatives de financement sur un même dossier
 * reste minuscule en pratique (un garage ne réessaie pas dix organismes) — `financements` s'embarque
 * en entier dans `dossier-vente.ts::ReponseDossierVente`, borné par `SEUIL_FINANCEMENTS_EMBARQUES`
 * comme filet plutôt que par nécessité réelle.
 */

export const SEUIL_FINANCEMENTS_EMBARQUES = 20;

export interface ReponseFinancement {
  readonly id: string;
  readonly dossierVenteId: string;
  readonly type: TypeFinancementVente;
  /** Fiche client existante de l'organisme de financement (`RV-40`) — `null` UNIQUEMENT pour
   *  `type = 'comptant'`, où aucun tiers ne confirme rien (`RV-44`). Obligatoire (contrôlé serveur,
   *  pas ici) pour `credit`/`leasing`. */
  readonly organisme: ClientResume | null;
  readonly referenceContrat: string | null;
  readonly statutConfirmation: StatutConfirmationFinancement;
  /** `true` dès la création pour `type = 'comptant'` (`enums.ts`, aucune confirmation tierce n'a de
   *  sens) — ce champ documente juste la lecture, la dérivation vit dans `schemaCreationFinancement`. */
  readonly confirmeLe: string | null;
  readonly refuseLe: string | null;
  /** Obligatoire et renseigné UNIQUEMENT si `statutConfirmation = 'refuse'` (`CV-03`). */
  readonly motifRefus: string | null;
  readonly actionsDisponibles: readonly ActionFinancement[];
  readonly version: number;
  readonly creeLe: string;
  readonly modifieLe: string;
}

/** Projection minimale, embarquée dans `dossier-vente.ts` (le financement COURANT — le plus
 *  récent dont `statutConfirmation != 'refuse'`, ou le plus récent tout court si tous sont refusés,
 *  pour que l'écran ait toujours quelque chose à afficher plutôt qu'un vide qui masquerait
 *  l'historique de refus). */
export interface FinancementResume {
  readonly id: string;
  readonly type: TypeFinancementVente;
  readonly organisme: Pick<ClientResume, 'id' | 'nomAffiche'> | null;
  readonly statutConfirmation: StatutConfirmationFinancement;
}

/* ------------------------------------------------------------------ */
/* Entrées d'écriture                                                  */
/* ------------------------------------------------------------------ */

/**
 * `POST /dossiers-vente/{dossierVenteId}/financements` — `Idempotency-Key` OBLIGATOIRE (création
 * sensible : engage une confirmation tierce et conditionne le passage en facture, `RV-37`).
 *
 * `statutConfirmation` initial est DÉRIVÉ, jamais saisi : `confirme` immédiatement pour
 * `type = 'comptant'`, `en_attente` pour `credit`/`leasing` (`enums.ts`, `RV-44`).
 *
 * `organismeId` obligatoire côté serveur pour `credit`/`leasing` (`400 VALIDATION_ECHOUEE`,
 * `erreurs[0].champ = "organismeId"` sinon) — pas encodé comme `.refine()` ici pour rester
 * cohérent avec `schemaActionReceptionner` de l'atelier, qui laisse ce type de garde croisée au
 * serveur plutôt qu'à un schéma zod devenu illisible.
 */
export const schemaCreationFinancement = z.object({
  type: z.enum(TYPES_FINANCEMENT_VENTE),
  organismeId: schemaIdentifiant.nullish(),
  referenceContrat: schemaTexteCourt.nullish(),
});
export type EntreeCreationFinancement = z.infer<typeof schemaCreationFinancement>;

/** `POST /dossiers-vente/{dossierVenteId}/financements/{id}/confirmer` — `en_attente -> confirme`.
 *  Corps vide, mais l'objet existe (même doctrine que `schemaActionDemarrer` de l'atelier). */
export const schemaActionConfirmerFinancement = z.object({}).extend(schemaConfirmations.shape);
export type EntreeActionConfirmerFinancement = z.infer<typeof schemaActionConfirmerFinancement>;

/** `POST /dossiers-vente/{dossierVenteId}/financements/{id}/refuser` — `en_attente -> refuse`,
 *  TERMINAL (`CV-03`) : un organisme qui change d'avis après un refus ouvre un NOUVEAU
 *  financement, il ne rouvre pas l'ancien — cohérent avec la doctrine collection/historique de ce
 *  fichier. Motif obligatoire : c'est ce texte qui explique au vendeur pourquoi il doit proposer un
 *  autre mode de financement (§7.3). */
export const schemaActionRefuserFinancement = z.object({ motif: schemaMotif });
export type EntreeActionRefuserFinancement = z.infer<typeof schemaActionRefuserFinancement>;
