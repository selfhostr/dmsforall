import { z } from 'zod';

import {
  STATUTS_ABONNEMENT_WEBHOOK,
  STATUTS_LIVRAISON_WEBHOOK,
  type StatutAbonnementWebhook,
  type StatutLivraisonWebhook,
} from './enums';
import { schemaUrlWebhookHttps } from './primitives';
import { schemaIdentifiant, schemaMotif } from '../atelier/primitives';
import { schemaListeQuery } from '../filtres';
import { schemaParametresPage } from '../pagination';
import { TYPES_EVENEMENT_METIER, type TypeEvenementMetier } from '../atelier/evenement';

/**
 * Abonnements webhook sortants — la pièce manquante de `contrats/atelier/evenement.ts`.
 *
 * CE FICHIER NE REDÉFINIT RIEN de ce qui est déjà posé là-bas (hors de mon périmètre d'écriture) :
 * le catalogue `TYPES_EVENEMENT_METIER`, l'enveloppe `EnveloppeEvenementMetier`, l'en-tête de
 * signature `EN_TETE_SIGNATURE_WEBHOOK` (HMAC-SHA256), la tolérance de dérive
 * `TOLERANCE_SIGNATURE_WEBHOOK_SECONDES` et les garanties de livraison
 * (`MAX_TENTATIVES_LIVRAISON_WEBHOOK`, backoff 1 min → 2 h) sont RÉUTILISÉS tels quels. Ce fichier
 * modélise UNIQUEMENT ce qui manquait encore : la RESSOURCE abonnement (une URL, quels
 * événements, quel secret) et le JOURNAL DE LIVRAISON — ce qu'un tiers doit pouvoir gérer par API
 * pour recevoir `EnveloppeEvenementMetier` sans sonder DFA en boucle.
 *
 * JUGEMENT EXPLICITE, à confirmer par @laupernoe (détaillé dans le rapport d'accompagnement) : ni le
 * brief de cet agent ni `docs/specification-etape-5-connecteurs.md` (`RC-xx`) ne consacrent de
 * section aux abonnements webhook — c'est la persona qui porte la règle générale (« webhooks
 * signés HMAC, conçus dès le départ ») et `atelier/evenement.ts` prouve qu'un précédent agent
 * l'a déjà anticipée côté catalogue, en écrivant noir sur blanc que la LIVRAISON restait à
 * brancher. Je complète le socle plutôt que de laisser un mécanisme à moitié posé, mais ceci
 * n'est PAS un `RC-xx` sourcé — à traiter comme une proposition, pas un fait acquis.
 */

export interface ReponseAbonnementWebhook {
  readonly id: string;
  readonly url: string;
  readonly evenements: readonly TypeEvenementMetier[];
  readonly statut: StatutAbonnementWebhook;
  /** Référence UNIQUEMENT (même doctrine que `connecteur.ts::schemaConfigurationSecretConnecteur`,
   *  `RC-08`) — jamais le secret HMAC en clair dans ce contrat. */
  readonly secretReferenceId: string;
  /** Rotation à DEUX secrets actifs simultanément (`contrats/atelier/evenement.ts`, commentaire de
   *  `EN_TETE_SIGNATURE_WEBHOOK` : « sans quoi toute rotation est une coupure ») — le consommateur
   *  peut vérifier une signature avec l'un OU l'autre pendant la fenêtre de transition. */
  readonly secretReferenceIdPrecedent: string | null;
  readonly secretPrecedentExpireLe: string | null;
  readonly dernierSuccesLe: string | null;
  readonly dernierEchecLe: string | null;
  /** Remis à zéro au premier succès — alimente le passage automatique en `quarantaine` au-delà de
   *  `MAX_TENTATIVES_LIVRAISON_WEBHOOK`. */
  readonly tentativesConsecutivesEnEchec: number;
  readonly creeLe: string;
  readonly modifieLe: string;
}

/**
 * `POST /webhooks` — `Idempotency-Key` OBLIGATOIRE (création sensible : un rejeu ne doit jamais
 * enregistrer deux abonnements sur la même URL, ce qui doublerait chaque événement livré).
 * `secretReferenceId` DOIT déjà exister — même mécanisme de dépôt hors périmètre que celui noté
 * dans `connecteur.ts` (`RC-08`).
 */
export const schemaCreationAbonnementWebhook = z.object({
  url: schemaUrlWebhookHttps,
  evenements: z.array(z.enum(TYPES_EVENEMENT_METIER)).min(1).max(50),
  secretReferenceId: schemaIdentifiant,
});
export type EntreeCreationAbonnementWebhook = z.infer<typeof schemaCreationAbonnementWebhook>;

/** `PATCH /webhooks/{id}` — `url`/`evenements` uniquement ; le secret se change par l'action
 *  dédiée ci-dessous (séparation délibérée : changer la liste d'événements n'a pas besoin de
 *  passer par un flux de rotation à deux secrets). */
export const schemaModificationAbonnementWebhook = z.object({
  url: schemaUrlWebhookHttps.optional(),
  evenements: z.array(z.enum(TYPES_EVENEMENT_METIER)).min(1).max(50).optional(),
});
export type EntreeModificationAbonnementWebhook = z.infer<
  typeof schemaModificationAbonnementWebhook
>;

/**
 * `PUT /webhooks/{id}/secret` — bascule la référence courante en `secretReferenceIdPrecedent`
 * (fenêtre de rotation) plutôt que de la remplacer sèchement. Remplacement idempotent par
 * construction, pas d'`Idempotency-Key`.
 */
export const schemaRotationSecretAbonnementWebhook = z.object({
  secretReferenceId: schemaIdentifiant,
});
export type EntreeRotationSecretAbonnementWebhook = z.infer<
  typeof schemaRotationSecretAbonnementWebhook
>;

export const TRIS_ABONNEMENTS_WEBHOOK = ['creeLe:desc', 'creeLe:asc'] as const;
export const TRI_DEFAUT_ABONNEMENTS_WEBHOOK = 'creeLe:desc';

export const schemaFiltresAbonnementsWebhook = schemaParametresPage.extend({
  statut: schemaListeQuery(z.enum(STATUTS_ABONNEMENT_WEBHOOK)).optional(),
  tri: z.enum(TRIS_ABONNEMENTS_WEBHOOK).default(TRI_DEFAUT_ABONNEMENTS_WEBHOOK),
});
export type FiltresAbonnementsWebhook = z.infer<typeof schemaFiltresAbonnementsWebhook>;

/**
 * `POST /webhooks/{id}/activer` / `.../suspendre` — pas d'`Idempotency-Key`, transition gardée par
 * l'état de départ. `suspendre` est le geste VOLONTAIRE du tenant (jamais bloquant, `RC-01`
 * appliqué par analogie) ; `quarantaine` n'est JAMAIS atteint par ces deux actions — uniquement par
 * la machine de livraison elle-même (voir `enums.ts`). Réactiver depuis `quarantaine` remet
 * `tentativesConsecutivesEnEchec` à zéro : un motif est exigé pour laisser une trace de la
 * correction apportée côté tiers (URL corrigée, service revenu en ligne…).
 */
export const schemaReactivationAbonnementWebhook = z.object({
  motif: schemaMotif,
});
export type EntreeReactivationAbonnementWebhook = z.infer<
  typeof schemaReactivationAbonnementWebhook
>;

/* ------------------------------------------------------------------ */
/* Journal de livraison                                                */
/* ------------------------------------------------------------------ */

export interface ReponseLivraisonWebhook {
  readonly id: string;
  readonly abonnementId: string;
  /** = `EnveloppeEvenementMetier.id` (`contrats/atelier/evenement.ts`) — le consommateur
   *  déduplique déjà dessus ; ce champ permet de retrouver la ligne de journal correspondante côté
   *  DFA depuis un ticket de support qui cite cet identifiant. */
  readonly evenementId: string;
  readonly typeEvenement: TypeEvenementMetier;
  readonly statut: StatutLivraisonWebhook;
  /** Commence à `1`, jusqu'à `MAX_TENTATIVES_LIVRAISON_WEBHOOK` (`atelier/evenement.ts`). */
  readonly tentative: number;
  /** Code HTTP reçu du consommateur, `null` tant qu'aucune tentative n'a abouti à une réponse
   *  (timeout, refus de connexion). */
  readonly codeHttpRecu: number | null;
  readonly prochaineTentativeLe: string | null;
  readonly envoyeeLe: string | null;
  readonly creeLe: string;
}

export const TRIS_LIVRAISONS_WEBHOOK = ['creeLe:desc', 'creeLe:asc'] as const;
export const TRI_DEFAUT_LIVRAISONS_WEBHOOK = 'creeLe:desc';

export const schemaFiltresLivraisonsWebhook = schemaParametresPage.extend({
  statut: schemaListeQuery(z.enum(STATUTS_LIVRAISON_WEBHOOK)).optional(),
  tri: z.enum(TRIS_LIVRAISONS_WEBHOOK).default(TRI_DEFAUT_LIVRAISONS_WEBHOOK),
});
export type FiltresLivraisonsWebhook = z.infer<typeof schemaFiltresLivraisonsWebhook>;

/**
 * `POST /webhooks/{id}/livraisons/{livraisonId}/rejouer` — reprise MANUELLE après `echouee` ou
 * `abandonnee`, même doctrine que `execution.ts::schemaRejouerExecutionConnecteur` (RC-04 appliqué
 * par analogie à la livraison). Pas d'`Idempotency-Key` : transition gardée par l'état de départ.
 * `409 ABONNEMENT_WEBHOOK_TRANSITION_INTERDITE` si la livraison est déjà `reussie` ou `en_attente`.
 */
