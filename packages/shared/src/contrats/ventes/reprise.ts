import { z } from 'zod';

import type { VehiculeResume } from '../atelier/vehicule';
import { schemaCentimesPositif, schemaIdentifiant, schemaMotif } from '../atelier/primitives';
import { schemaConfirmations } from '../atelier/avertissement';
import { type ActionReprise, type StatutReprise } from './enums';

/**
 * La reprise (`RV-19` → `RV-28`) — sous-ressource SINGULIÈRE d'un dossier de vente : 0 ou 1 par
 * dossier, exposée sous `/dossiers-vente/{dossierVenteId}/reprise`, même patron que
 * `vehicule-stock.ts` pour `/vehicules/{id}/stock`.
 *
 * ============================================================================================
 * LA QUESTION TVA N'EST PAS TRANCHÉE ICI — LIRE AVANT DE MODIFIER CE FICHIER
 * ============================================================================================
 * `RV-20` : la reprise gonflée (afficher une valeur de reprise supérieure à la valeur marchande
 * réelle pour faire passer une remise déguisée sur le neuf) est une pratique commerciale réelle et
 * établie, que ce contrat n'empêche ni ne cache — les deux valeurs (`valeurEstimeeCentimes`,
 * `valeurNegocieeCentimes`) sont TOUJOURS présentes et distinctes, jamais fusionnées.
 *
 * En revanche, `RV-22`/`QV-05` (base TVA de l'échange : sur la valeur négociée figurant au dossier,
 * ou sur la valeur marchande objective du véhicule repris ?) est **[À VALIDER]**, question fiscale
 * pour la fiduciaire, PAS pour ce document. CE FICHIER NE CALCULE NI N'EXPOSE AUCUNE BASE TVA — il
 * se contente d'exposer les deux valeurs sources dont facturation aura besoin pour appliquer QUEL
 * QUE SOIT le traitement que @laupernoe validera. N'ajoutez pas ici un champ du type `baseTvaCentimes` ou
 * `montantTvaReprise…` sans arbitrage : ce serait coder en dur une règle fiscale non confirmée.
 *
 * DIVERGENCE SIGNALÉE avec le schéma de facturation (étape 2, déjà livrée, hors périmètre
 * d'écriture de ce fichier) : `RV-21` affirme que « le modèle de facturation porte déjà un champ
 * dédié à cet écart au niveau du document : `ecart_reprise_centimes` » et invite ce module à s'y
 * accrocher sans le réinventer. **C'est inexact.** `ecartRepriseCentimes` / le type de ligne
 * `ecart_reprise` (`contrats/facturation/document.ts`, `contrats/facturation/enums.ts`) sont
 * réservés à la RÉCONCILIATION D'UN DOCUMENT MIGRÉ (`MD-08` : écart entre Σ lignes et total stocké
 * d'un document repris d'Auto-i/Nextlane) — contrainte EN BASE
 * (`document_vente_ecart_reprise_chk`, migration 0010) : `origine = 'reprise' OR
 * ecart_reprise_centimes = 0`. Tout document créé par ce module de vente a `origine = 'dfa'` : ce
 * champ y vaut structurellement TOUJOURS 0 et ne peut PORTER AUCUN écart de reprise véhicule. Les
 * deux sens de « reprise » (document repris d'un ancien DMS / véhicule repris au client) se sont
 * télescopés dans la spécification métier — remontée à l'orchestrateur, PAS corrigée ici (la
 * ressource `ecartRepriseVehiculeCentimes` ci-dessous EST le producteur métier voulu par `RV-21`,
 * elle vit juste sur la reprise plutôt que de squatter un champ facturation qui ne peut pas
 * l'accueillir). Faire apparaître cet écart comme une LIGNE sur le document de vente du véhicule
 * vendu (ce que `RV-21`/`CV-05` demandent : « il doit s'imputer au dossier de vente ») demande un
 * NOUVEAU `type_ligne_document` côté facturation (`ecart_reprise_vehicule` par exemple), distinct
 * de `ecart_reprise` — décision qui appartient au propriétaire de `contrats/facturation/enums.ts`.
 * ============================================================================================
 *
 * CRÉATION — pas de `POST /reprises` autonome : une reprise naît TOUJOURS rattachée à un dossier de
 * vente déjà existant (`POST /dossiers-vente/{dossierVenteId}/reprise`), au plus une par dossier
 * (`409 VENTE_REPRISE_DEJA_EXISTANTE` sinon) — cohérent avec `RV-25` : la reprise est une
 * composante OPTIONNELLE du dossier, jamais un objet qui existe seul.
 *
 * MACHINE À ÉTATS — **GELÉE** (`enums.ts::STATUTS_REPRISE`, diagramme §6.3 de la spécification) :
 *   `estimee -> negociee -> confirmee`, et `{estimee, negociee} -> refusee` (`RV-25` : le refus peut
 *   survenir dès l'estimation initiale ou en cours de négociation, jamais après confirmation — une
 *   reprise confirmée est liée à un bon de commande déjà signé). Transitions vérifiées côté serveur,
 *   pas dans ce type ; un client lit `actionsDisponibles`.
 */

export interface ReponseReprise {
  readonly id: string;
  readonly dossierVenteId: string;
  /** Le véhicule repris — DOIT déjà exister comme enregistrement `vehicule` (créé au préalable via
   *  `POST /vehicules` de l'étape 1, y compris à identification incomplète si le véhicule n'était
   *  pas encore connu de DFA, §8.3 : « référence à un véhicule existant ou nouvellement créé »).
   *  Pas de second identifiant : cohérent avec `vehicule-stock.ts::ReponseVehiculeStock.id`. */
  readonly vehiculeRepris: VehiculeResume;
  readonly statut: StatutReprise;
  /** Évaluation technique/argus au moment de l'estimation (`RV-19`). AUCUNE valeur contractuelle
   *  tant que `statut = 'estimee'` (`RV-27`) — reste modifiable jusque-là (voir
   *  `schemaModificationReprise`), la révision à la baisse après expertise physique étant le cas
   *  normal, pas l'exception. */
  readonly valeurEstimeeCentimes: number;
  /** `null` tant que `statut = 'estimee'`. C'est CETTE valeur, jamais l'estimée, qui figure en
   *  déduction sur le bon de commande/la facture (`RV-19`) et qui devient le prix d'achat d'entrée
   *  en stock du véhicule repris à la livraison (`RV-24`). */
  readonly valeurNegocieeCentimes: number | null;
  /**
   * DÉRIVÉ : `valeurNegocieeCentimes - valeurEstimeeCentimes`. `null` tant que
   * `valeurNegocieeCentimes` est `null`. Peut être POSITIF (reprise gonflée, `RV-20` — le cas
   * établi et fréquent) ou négatif (reprise revue à la baisse, `RV-27`).
   *
   * C'est le producteur métier de `RV-21` : « l'écart… doit s'imputer au dossier de vente du
   * véhicule vendu, pas gonfler le prix d'achat du véhicule repris ». Ce champ suffit à satisfaire
   * `RV-21` au niveau LECTURE (l'écart est visible, attaché au dossier via cette reprise, jamais
   * mélangé au prix d'achat de `vehicule-stock.ts`) — sa matérialisation en LIGNE facturable sur le
   * document de vente est la divergence signalée en tête de fichier, pas réglée ici.
   *
   * Nom délibérément DIFFÉRENT de `ecartRepriseCentimes` (`contrats/facturation/document.ts`) pour
   * qu'un développeur tiers ne les confonde jamais : même préfixe, sémantique disjointe.
   */
  readonly ecartRepriseVehiculeCentimes: number | null;
  /** `RV-26`/`CV-02` : solde de financement (leasing/crédit) encore dû par le client sur le
   *  véhicule repris. `null` = aucune dette connue (cas normal, majorité des reprises). Condition
   *  suspensive de la reprise (`RV-26`, littéral) — le MÉCANISME exact de règlement (qui avance,
   *  à quel moment) est `QV-05 bis`, **[À VALIDER]** : ce contrat capture le MONTANT et
   *  l'ORGANISME, il n'impose aucun séquencement de règlement non confirmé par le terrain. */
  readonly detteFinancementResiduelleCentimes: number | null;
  /** `CV-02` : « texte libre ou lien vers un tiers » — la spécification (§8.3) laisse les deux
   *  options ouvertes ; ce contrat les porte TOUTES LES DEUX plutôt que de trancher en dur.
   *  `detteFinancementOrganismeId` pointe une fiche client/tiers existante si elle existe déjà dans
   *  DFA (même patron que `financement.ts::ReponseFinancement.organisme`) ; sinon
   *  `detteFinancementOrganismeNom` porte le texte libre. Au moins l'un des deux est renseigné
   *  quand `detteFinancementResiduelleCentimes` n'est pas `null` — non vérifié par le TYPE, vérifié
   *  serveur (même doctrine que `signatureDifferee`/`motifDifferee` de `ordre-reparation.ts`). */
  readonly detteFinancementOrganismeId: string | null;
  readonly detteFinancementOrganismeNom: string | null;
  readonly estimeeLe: string;
  readonly negocieeLe: string | null;
  readonly confirmeeLe: string | null;
  readonly refuseeLe: string | null;
  /** Obligatoire et renseigné UNIQUEMENT si `statut = 'refusee'` (`RV-25`). */
  readonly motifRefus: string | null;
  /** Actions possibles MAINTENANT — même principe que `ActionOrdreReparation` : approximation
   *  utile au client, jamais la seule garde. */
  readonly actionsDisponibles: readonly ActionReprise[];
  readonly version: number;
  readonly creeLe: string;
  readonly modifieLe: string;
  readonly modifiePar: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
}

/** Projection minimale, embarquée dans `dossier-vente.ts`. */
export interface RepriseResume {
  readonly id: string;
  readonly vehiculeRepris: VehiculeResume;
  readonly statut: StatutReprise;
  readonly valeurEstimeeCentimes: number;
  readonly valeurNegocieeCentimes: number | null;
  readonly ecartRepriseVehiculeCentimes: number | null;
}

/* ------------------------------------------------------------------ */
/* Entrées d'écriture                                                  */
/* ------------------------------------------------------------------ */

/**
 * `POST /dossiers-vente/{dossierVenteId}/reprise` — `Idempotency-Key` OBLIGATOIRE (création
 * sensible : une reprise porte une valeur financière dès sa naissance, un double-clic comptoir ne
 * doit jamais produire deux estimations concurrentes pour le même dossier).
 *
 * Statut initial toujours `estimee`, jamais entrant. `valeurNegocieeCentimes` n'existe pas encore à
 * ce stade — voir `schemaActionNegocierReprise`.
 */
export const schemaCreationReprise = z.object({
  vehiculeReprisId: schemaIdentifiant,
  valeurEstimeeCentimes: schemaCentimesPositif,
  detteFinancementResiduelleCentimes: schemaCentimesPositif.nullish(),
  detteFinancementOrganismeId: schemaIdentifiant.nullish(),
  detteFinancementOrganismeNom: z.string().trim().min(1).max(200).nullish(),
});
export type EntreeCreationReprise = z.infer<typeof schemaCreationReprise>;

/** `PATCH /dossiers-vente/{dossierVenteId}/reprise` — `If-Match` OBLIGATOIRE. `valeurEstimeeCentimes`
 *  reste modifiable UNIQUEMENT tant que `statut = 'estimee'` (contrôlé serveur, pas ici) — la
 *  révision post-expertise physique de `RV-27` passe par ici ; au-delà, la correction passe par
 *  `schemaActionNegocierReprise` (rappel explicite du changement, pas une édition silencieuse). */
export const schemaModificationReprise = z.object({
  valeurEstimeeCentimes: schemaCentimesPositif.optional(),
  detteFinancementResiduelleCentimes: schemaCentimesPositif.nullish(),
  detteFinancementOrganismeId: schemaIdentifiant.nullish(),
  detteFinancementOrganismeNom: z.string().trim().min(1).max(200).nullish(),
});
export type EntreeModificationReprise = z.infer<typeof schemaModificationReprise>;

/**
 * `POST /dossiers-vente/{dossierVenteId}/reprise/negocier` — `{estimee, negociee} -> negociee`.
 * Appelable plusieurs fois tant que `statut != confirmee/refusee` (une renégociation avant
 * signature reste une négociation, pas une nouvelle reprise) — chaque appel est un événement
 * audité, jamais un `PATCH` silencieux sur une donnée aussi sensible pour la marge (`RV-06`).
 */
export const schemaActionNegocierReprise = z.object({
  valeurNegocieeCentimes: schemaCentimesPositif,
});
export type EntreeActionNegocierReprise = z.infer<typeof schemaActionNegocierReprise>;

/**
 * `POST /dossiers-vente/{dossierVenteId}/reprise/confirmer` — `negociee -> confirmee`. Refusé
 * (`409 VENTE_REPRISE_VALEUR_NEGOCIEE_REQUISE`) si `valeurNegocieeCentimes` est encore `null` :
 * `RV-27` interdit explicitement de contractualiser sur une simple estimation.
 *
 * NORMALEMENT un EFFET DE BORD de `POST /dossiers-vente/{id}/engager` (`RV-19`/`RV-27` : « confirmee
 * à la signature du bon de commande ») — même patron que
 * `vehicule-stock.ts::schemaRemettreDisponibleVehiculeStock` : cet appel direct n'existe que pour
 * la correction exceptionnelle (dossier orphelin, resynchronisation), motif obligatoire pour la
 * même raison.
 */
export const schemaActionConfirmerReprise = z.object({ motif: schemaMotif }).extend(
  schemaConfirmations.shape,
);
export type EntreeActionConfirmerReprise = z.infer<typeof schemaActionConfirmerReprise>;

/** `POST /dossiers-vente/{dossierVenteId}/reprise/refuser` — `{estimee, negociee} -> refusee`
 *  (`RV-25` : le client garde son véhicule, le reste du dossier continue — n'annule PAS le
 *  dossier de vente). Motif OBLIGATOIRE, même doctrine que `ordre-reparation.ts::schemaActionAnnuler`. */
export const schemaActionRefuserReprise = z.object({ motif: schemaMotif });
export type EntreeActionRefuserReprise = z.infer<typeof schemaActionRefuserReprise>;

/* Rappel (RV-24) : à la livraison du véhicule vendu, c'est `valeurNegocieeCentimes` — jamais
 * `valeurEstimeeCentimes` — qui devient `vehicule-stock.ts::EntreeMiseEnStock.prixAchatCentimes`
 * du véhicule repris, avec `provenance = 'reprise'` et `origineRepriseDossierVenteId` pointant ce
 * dossier. Ce fichier ne déclenche pas cette mise en stock — c'est un effet de bord documenté sur
 * `dossier-vente.ts::schemaActionLivrer`, pas ici. */
