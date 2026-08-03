import { z } from 'zod';

import {
  FAMILLES_CONNECTEUR,
  STATUTS_ACTIVATION_CONNECTEUR,
  type CapaciteConnecteur,
  type FamilleConnecteur,
  type NomInterfaceConnecteur,
  type StatutActivationConnecteur,
} from './enums';
import { schemaCodeConnecteur } from './primitives';
import type { SanteConnecteurActivation } from './sante';
import type { NatureExportConnecteur, NatureImportConnecteur } from './enums';
import { schemaIdentifiant } from '../atelier/primitives';
import { schemaParametresPage } from '../pagination';

/* ------------------------------------------------------------------ */
/* Catalogue des types de connecteur (item 1 du socle : « déclaration  */
/* d'un connecteur »)                                                  */
/* ------------------------------------------------------------------ */

/**
 * `GET /connecteurs/types` — catalogue en LECTURE SEULE.
 *
 * DÉCISION DE PÉRIMÈTRE EXPLICITE (voir le rapport d'accompagnement) : ce catalogue est SEEDÉ
 * côté serveur (déploiement/migration), **pas créé via cette API**. Un tenant ne doit jamais
 * pouvoir déclarer son propre type de connecteur — ce serait une porte dérobée pour contourner
 * `RC-08` (secrets/identifiants par tenant, formats vérifiés par DFA). Un futur
 * `POST /connecteurs/types` administratif reste additif quand un rôle « exploitation DFA »
 * existera (`ROLES_UTILISATEUR`, `contrats/enums.ts`, n'en porte aucun aujourd'hui) — question
 * ouverte, pas un défaut de ce contrat.
 */
export interface ReponseTypeConnecteur {
  /** Slug stable, JAMAIS un nom de partenaire codé dans ce dépôt (`schemaCodeConnecteur`). */
  readonly code: string;
  readonly famille: FamilleConnecteur;
  /** Libellé humain générique (« Plateforme d'annonces », « Fournisseur de pièces ») — jamais une
   *  marque, cohérent avec `famille`. */
  readonly nom: string;
  readonly interfaces: readonly NomInterfaceConnecteur[];
  readonly capacites: readonly CapaciteConnecteur[];
  readonly naturesImportSupportees: readonly NatureImportConnecteur[];
  readonly naturesExportSupportees: readonly NatureExportConnecteur[];
  /**
   * `false` : type déclaré PAR ANTICIPATION (nom réservé dans le catalogue), aucun adaptateur
   * livré derrière (`RC-20`, dernier paragraphe : « au rythme des agréments obtenus »,
   * `ARCHITECTURE.md` §5 phase 3). Un tenant peut VOIR le type dans le catalogue mais
   * `POST /connecteurs/activations` le refuse avec `409 CONNECTEUR_TYPE_INDISPONIBLE`.
   */
  readonly disponible: boolean;
}

export const TRIS_TYPES_CONNECTEUR = ['nom:asc', 'famille:asc'] as const;
export const TRI_DEFAUT_TYPES_CONNECTEUR = 'nom:asc';

export const schemaFiltresTypesConnecteur = schemaParametresPage.extend({
  famille: z.array(z.enum(FAMILLES_CONNECTEUR)).optional(),
  disponible: z.coerce.boolean().optional(),
  tri: z.enum(TRIS_TYPES_CONNECTEUR).default(TRI_DEFAUT_TYPES_CONNECTEUR),
});
export type FiltresTypesConnecteur = z.infer<typeof schemaFiltresTypesConnecteur>;

/* ------------------------------------------------------------------ */
/* Activation par tenant (item 1 du socle)                             */
/* ------------------------------------------------------------------ */

/**
 * `RC-04`/`PC-01` : nombre de tentatives et espacement avant bascule en `necessite_action` —
 * **paramétrable par connecteur**, jamais codé en dur (« aucune valeur avancée » côté
 * spécification : `null` reste la valeur honnête tant qu'aucune pratique n'est mesurée, la
 * plateforme applique alors un défaut d'exploitation qui n'est PAS un choix métier documenté ici).
 */
export interface PolitiqueNouvellesTentativesConnecteur {
  readonly nombreMaxTentatives: number;
  readonly espacementInitialSecondes: number;
  /** Multiplicateur appliqué à l'espacement à chaque échec (`2` = doublement). */
  readonly facteurCroissance: number;
}

export const schemaPolitiqueNouvellesTentativesConnecteur = z.object({
  nombreMaxTentatives: z.number().int().min(1).max(20),
  espacementInitialSecondes: z.number().int().min(1).max(86_400),
  facteurCroissance: z.number().min(1).max(10),
});

/**
 * L'activation — une ligne par `(tenant, type de connecteur[, site])`. Le TENANT n'apparaît
 * JAMAIS dans ce contrat : résolu depuis la session, jamais un paramètre (règle n°1 du projet).
 */
export interface ReponseConnecteurActivation {
  readonly id: string;
  readonly typeConnecteurCode: string;
  /** Dénormalisé depuis le type pour l'affichage en liste sans jointure côté client. */
  readonly famille: FamilleConnecteur;
  /**
   * `null` = portée TENANT ENTIER (défaut). Renseigné pour les familles où plusieurs sites du même
   * tenant peuvent avoir des comptes distincts chez le même partenaire (ex. deux sites, deux
   * comptes séparés sur une même plateforme d'annonces). **INFÉRENCE**, non sourcée par un
   * `RC-xx` — `PC-02` ne parle que du tenant. Voir le rapport d'accompagnement.
   */
  readonly siteId: string | null;
  readonly statut: StatutActivationConnecteur;
  readonly identifiantsConfigures: boolean;
  readonly identifiantsConfiguresLe: string | null;
  /**
   * Paramètres NON SECRETS propres au type de connecteur (ex. `PC-05` fréquence de synchronisation
   * catalogue si `declenchement.ts` ne suffit pas, seuils spécifiques à un adaptateur). Sac
   * générique, validé côté serveur selon `typeConnecteurCode` — jamais un champ dédié par
   * partenaire dans CE contrat, exactement la même doctrine que
   * `facturation/export.ts::CapacitesExport` : le cœur ne connaît pas la forme exacte de la
   * configuration d'un adaptateur particulier.
   */
  readonly parametres: Readonly<Record<string, unknown>>;
  /** `PC-01`/`RC-04`. `null` = valeur par défaut de la plateforme, non documentée comme choix
   *  métier (voir le commentaire du type ci-dessus). */
  readonly politiqueNouvellesTentatives: PolitiqueNouvellesTentativesConnecteur | null;
  readonly sante: SanteConnecteurActivation;
  readonly activeLe: string | null;
  readonly desactiveLe: string | null;
  readonly creeLe: string;
  readonly modifieLe: string;
}

export const TRIS_CONNECTEUR_ACTIVATIONS = ['creeLe:desc', 'creeLe:asc'] as const;
export const TRI_DEFAUT_CONNECTEUR_ACTIVATIONS = 'creeLe:desc';

export const schemaFiltresConnecteurActivations = schemaParametresPage.extend({
  famille: z.array(z.enum(FAMILLES_CONNECTEUR)).optional(),
  statut: z.array(z.enum(STATUTS_ACTIVATION_CONNECTEUR)).optional(),
  siteId: schemaIdentifiant.optional(),
  tri: z.enum(TRIS_CONNECTEUR_ACTIVATIONS).default(TRI_DEFAUT_CONNECTEUR_ACTIVATIONS),
});
export type FiltresConnecteurActivations = z.infer<typeof schemaFiltresConnecteurActivations>;

/* ------------------------------------------------------------------ */
/* Entrées d'écriture                                                  */
/* ------------------------------------------------------------------ */

/**
 * `POST /connecteurs/activations` — `Idempotency-Key` OBLIGATOIRE (création sensible, `RC-06`
 * appliqué au socle transversal). `statut` n'est jamais entrant : toute activation naît `inactif`
 * — `PC-02`, activation explicite requise même après création.
 */
export const schemaCreationConnecteurActivation = z.object({
  typeConnecteurCode: schemaCodeConnecteur,
  siteId: schemaIdentifiant.nullish(),
  parametres: z.record(z.string(), z.unknown()).optional(),
  politiqueNouvellesTentatives: schemaPolitiqueNouvellesTentativesConnecteur.nullish(),
});
export type EntreeCreationConnecteurActivation = z.infer<typeof schemaCreationConnecteurActivation>;

/** `PATCH /connecteurs/activations/{id}` — tous facultatifs. N'INCLUT PAS `statut` : transitions
 *  par actions nommées ci-dessous, même patron que `commande-fournisseur.ts`/`document.ts`. */
export const schemaModificationConnecteurActivation = z.object({
  siteId: schemaIdentifiant.nullish(),
  parametres: z.record(z.string(), z.unknown()).optional(),
  politiqueNouvellesTentatives: schemaPolitiqueNouvellesTentativesConnecteur.nullish(),
});
export type EntreeModificationConnecteurActivation = z.infer<
  typeof schemaModificationConnecteurActivation
>;

/**
 * `POST /connecteurs/activations/{id}/activer` — `inactif → actif`. Refuse `409
 * CONNECTEUR_IDENTIFIANTS_MANQUANTS` si `identifiantsConfigures = false` (`RC-08` : un connecteur
 * sans secret configuré ne peut rien échanger) et `409 CONNECTEUR_TYPE_INDISPONIBLE` si le type
 * n'est plus `disponible`. Pas d'`Idempotency-Key` : transition gardée par l'état de départ.
 *
 * `POST /connecteurs/activations/{id}/desactiver` — `actif → inactif`, sans condition (`RC-01` :
 * désactiver un connecteur ne doit jamais être bloqué, c'est le geste de repli). Aucun des deux
 * n'exige de corps ; rejouer une transition déjà faite produit `409
 * CONNECTEUR_ACTIVATION_TRANSITION_INTERDITE`.
 */

/**
 * `PUT /connecteurs/activations/{id}/secret` — référence UNIQUEMENT (`RC-08`). Ce contrat
 * n'accepte JAMAIS de matière secrète en clair (clé API, mot de passe, certificat EBICS) :
 * `secretReferenceId` pointe un secret DÉJÀ déposé par un mécanisme dédié (coffre applicatif,
 * chiffrement au repos) — **hors périmètre de ce fichier**, à porter par
 * expert-devops/expert-auth (`RC-08`, dernière phrase). Voir le rapport d'accompagnement : ce
 * mécanisme de dépôt lui-même n'existe pas encore dans ce dépôt.
 *
 * Remplace la référence courante — idempotent par construction, pas d'`Idempotency-Key`.
 */
export const schemaConfigurationSecretConnecteur = z.object({
  secretReferenceId: schemaIdentifiant,
});
export type EntreeConfigurationSecretConnecteur = z.infer<
  typeof schemaConfigurationSecretConnecteur
>;
