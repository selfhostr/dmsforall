import { z } from 'zod';

import { LANGUES, type Langue } from '../enums';
import { schemaConfirmations } from './avertissement';
import {
  NATURES_NOTE,
  ROLES_CONTACT,
  STATUTS_CLIENT,
  TYPES_ADRESSE,
  TYPES_CLIENT,
  TYPES_CONSENTEMENT,
  type CritereDoublonClient,
  type NatureNote,
  type RoleContact,
  type StatutClient,
  type TypeAdresse,
  type TypeClient,
  type TypeConsentement,
} from './enums';
import {
  schemaCentimesPositif,
  schemaCodePays,
  schemaDateJour,
  schemaEmail,
  schemaHorodatage,
  schemaIde,
  schemaIdentifiant,
  schemaMotif,
  schemaPourmille,
  schemaTexteCourt,
  schemaTexteLong,
} from './primitives';

/**
 * Clients (contrats-api-etape-1.md §7.3).
 *
 * Aucune ressource ne porte `tenantId` : le tenant est résolu depuis la session, JAMAIS depuis un
 * paramètre ni un corps. Un `tenantId` dans un contrat exposé est un défaut de revue.
 *
 * Il n'existe AUCUN `DELETE` : un client se DÉSACTIVE (RM-12) ou se fusionne (RM-06).
 */

/* ------------------------------------------------------------------ */
/* Ressource                                                           */
/* ------------------------------------------------------------------ */

export interface ReponseClient {
  readonly id: string;
  /** Numéro CONTINU par tenant, jamais réutilisé (RM-11) — d'où l'`Idempotency-Key` à la création. */
  readonly numeroClient: string;
  readonly type: TypeClient;
  readonly statut: StatutClient;
  readonly civilite: string | null;
  readonly nom: string | null;
  readonly prenom: string | null;
  readonly raisonSociale: string | null;
  /**
   * Rendu d'affichage calculé par le serveur (`raisonSociale`, ou `nom prenom`). Existe pour que
   * deux clients de l'API n'inventent pas deux façons différentes de composer un nom.
   */
  readonly nomAffiche: string;
  readonly ide: string | null;
  readonly langueCorrespondance: Langue;
  readonly email: string | null;
  readonly telephone: string | null;
  readonly telephoneE164: string | null;
  /** RM-14 : impose `numeroCommandeInterne` sur les OR de ce client (`OR_PO_MANQUANT`). */
  readonly poObligatoire: boolean;
  /** RM-10 : rattachement à un groupe (auto-référence vers un autre client). */
  readonly groupeId: string | null;
  /**
   * RM-06 : renseigné sur la fiche ABSORBÉE. `GET /clients/{sourceId}` continue de répondre
   * `200` — un connecteur qui détient l'ancien identifiant doit pouvoir suivre la trace, pas
   * recevoir un 404.
   */
  readonly fusionneVersClientId: string | null;
  readonly referenceExterne: string | null;
  readonly dernierPassageLe: string | null;
  /**
   * Notes de nature `alerte` UNIQUEMENT (RM-13 : « affichée en rouge à l'ouverture de la fiche,
   * au RDV et à la réception »). Embarquées ici pour un affichage sans aller-retour réseau
   * supplémentaire — même principe que `ReponseContexteAtelierVehicule.alertesClient`
   * (`atelier/vehicule.ts`). Les notes `interne` ne sortent JAMAIS ici : uniquement via
   * `GET /clients/{clientId}/notes`.
   */
  readonly notesAlerte: readonly ReponseClientNote[];
  readonly creeLe: string;
  readonly modifieLe: string;
}

/**
 * Projection minimale d'un client, embarquée dans les autres ressources — et forme de
 * `GET /clients` (liste paginée). Les quatre champs suivants (`telephone`, `localite`,
 * `nombreVehicules`, `dernierPassageLe`) existent pour la DÉSAMBIGUÏSATION au comptoir : deux
 * homonymes dans le fichier client sont ordinaires, et sans un repère au-delà du nom le
 * réceptionniste choisit au hasard — l'erreur ne se découvre alors qu'à la facturation, quand
 * elle coûte le plus cher à corriger. Ce ne sont pas des colonnes de confort.
 */
export interface ClientResume {
  readonly id: string;
  readonly numeroClient: string;
  readonly nomAffiche: string;
  readonly type: TypeClient;
  readonly statut: StatutClient;
  readonly langueCorrespondance: Langue;
  readonly poObligatoire: boolean;
  /** Colonne directe de la fiche client. */
  readonly telephone: string | null;
  /** Localité de l'adresse PRINCIPALE active du client. `null` si aucune adresse — cas normal (fiche fraîche). */
  readonly localite: string | null;
  /** Véhicules actuellement détenus par le client (détentions ouvertes, `vehicule_detention.au is null`). */
  readonly nombreVehicules: number;
  /** Même donnée que `ReponseClient.dernierPassageLe` (dérivée du dernier OR ouvert) — un seul calcul, jamais deux qui divergeraient. */
  readonly dernierPassageLe: string | null;
}

export interface ReponseClientAdresse {
  readonly id: string;
  readonly type: TypeAdresse;
  readonly rue: string;
  readonly complement: string | null;
  readonly npa: string;
  readonly localite: string;
  readonly pays: string;
  readonly actif: boolean;
}

export interface ReponseClientContact {
  readonly id: string;
  readonly nom: string;
  readonly prenom: string | null;
  readonly fonction: string | null;
  readonly telephone: string | null;
  readonly telephoneE164: string | null;
  readonly email: string | null;
  readonly langue: Langue | null;
  /** CUMULABLES (RM-04) : un même contact peut être conducteur ET signataire. */
  readonly roles: readonly RoleContact[];
  readonly actif: boolean;
}

/**
 * Conditions commerciales DATÉES (RM-07). La base garantit par contrainte d'exclusion qu'il
 * n'existe jamais deux jeux concurrents à une date donnée — c'est la condition de reproductibilité
 * de CT-03, et la raison pour laquelle un chevauchement produit `400 VALIDATION_ECHOUEE`.
 *
 * Ces valeurs sont FIGÉES sur l'OR à sa création (RM-50) : les modifier n'altère aucun OR existant.
 */
export interface ReponseClientCondition {
  readonly id: string;
  readonly rabaisMoPourmille: number;
  readonly rabaisPiecesPourmille: number;
  readonly rabaisPneusPourmille: number;
  readonly tauxHoraireCode: string | null;
  readonly delaiPaiementJours: number | null;
  readonly modePaiement: string | null;
  readonly plafondCentimes: number | null;
  readonly valideDuLe: string;
  readonly valideAuLe: string | null;
}

/**
 * Consentements APPEND-ONLY (RM-09, nLPD). Une révocation est une NOUVELLE ligne
 * `accorde: false`, jamais une mise à jour — c'est ce qui donne sa valeur de preuve.
 * D'où l'absence de `PATCH` et de `DELETE` sur cette sous-collection.
 */
export interface ReponseClientConsentement {
  readonly id: string;
  readonly type: TypeConsentement;
  readonly accorde: boolean;
  readonly recueilliLe: string;
  readonly canal: string | null;
}

export interface ReponseClientNote {
  readonly id: string;
  /** `alerte` remonte dans le contexte-atelier et à chaque ouverture de fiche (RM-13, RM-36). */
  readonly nature: NatureNote;
  readonly texte: string;
  readonly auteur: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
  readonly creeLe: string;
}

/* ------------------------------------------------------------------ */
/* Détection de doublons — AVANT création (RM-05)                      */
/* ------------------------------------------------------------------ */

export interface CandidatDoublonClient {
  readonly clientId: string;
  readonly numeroClient: string;
  readonly nom: string;
  readonly npa: string | null;
  readonly critere: CritereDoublonClient;
  /** Pertinence dans `[0,1]`, décroissante. Ordonne la liste, ne décide de rien. */
  readonly score: number;
}

/**
 * `GET /doublons-clients` — PROJECTION, consommée à la frappe, non paginée.
 *
 * Placée à la RACINE et non sous `/clients/…` : un segment littéral ne se met jamais là où un
 * identifiant est attendu. `/clients/doublons-probables` serait ambigu avec `/clients/{clientId}`
 * et se casserait le jour où un identifiant cesse d'être un uuid.
 *
 * La détection est un AVERTISSEMENT (`CLIENT_DOUBLON_PROBABLE`), jamais un blocage (CT-01) : deux
 * frères à la même adresse sont deux clients légitimes.
 */
export interface ReponseDoublonsClients {
  readonly candidats: readonly CandidatDoublonClient[];
}

/* ------------------------------------------------------------------ */
/* Filtres et tris (§6.2)                                              */
/* ------------------------------------------------------------------ */

/** Liste FERMÉE. Un tri non listé produit `400`, jamais un tri silencieusement ignoré. */
export const TRIS_CLIENTS = [
  'nom:asc',
  'nom:desc',
  'numeroClient:asc',
  'numeroClient:desc',
  'creeLe:desc',
  'dernierPassageLe:desc',
] as const;
export const TRI_DEFAUT_CLIENTS = 'nom:asc';

export const TRIS_VEHICULES_DU_CLIENT = ['plaque:asc', 'plaque:desc'] as const;
export const TRI_DEFAUT_VEHICULES_DU_CLIENT = 'plaque:asc';

export const TRIS_OR_DU_CLIENT = ['ouvertLe:desc', 'ouvertLe:asc'] as const;
export const TRI_DEFAUT_OR_DU_CLIENT = 'ouvertLe:desc';

/**
 * Un filtre multivalué se RÉPÈTE (`?statut=actif&statut=bloque`) — jamais de liste séparée par
 * virgules, qui casse dès qu'une valeur en contient une.
 *
 * Défaut de `statut` : `actif` + `bloque`. Un client bloqué reste visible au comptoir — c'est
 * précisément celui qu'il faut voir avant d'ouvrir un OR (RM-08).
 */
export const schemaFiltresClients = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  type: z.enum(TYPES_CLIENT).optional(),
  statut: z.array(z.enum(STATUTS_CLIENT)).optional(),
  groupeId: schemaIdentifiant.optional(),
  poObligatoire: z.coerce.boolean().optional(),
  /** Utile seulement si P-30 = cloisonné. Ignoré sinon. */
  siteId: schemaIdentifiant.optional(),
  tri: z.enum(TRIS_CLIENTS).default(TRI_DEFAUT_CLIENTS),
});

/** RM-20 : les détentions closes ne sont visibles que sur demande explicite. */
export const schemaFiltresVehiculesDuClient = z.object({
  inclureAnciennesDetentions: z.coerce.boolean().default(false),
  tri: z.enum(TRIS_VEHICULES_DU_CLIENT).default(TRI_DEFAUT_VEHICULES_DU_CLIENT),
});

export const schemaParametresDoublonsClients = z
  .object({
    nom: z.string().trim().min(2).max(200).optional(),
    npa: z.string().trim().max(10).optional(),
    email: schemaEmail.optional(),
    telephoneMobile: z.string().trim().max(30).optional(),
    ide: schemaIde.optional(),
    /** Exclut la fiche en cours d'édition, pour ne pas se signaler soi-même. */
    exclureClientId: schemaIdentifiant.optional(),
  })
  .refine(
    (v) => Boolean(v.nom ?? v.npa ?? v.email ?? v.telephoneMobile ?? v.ide),
    'Au moins un critère de recherche est requis.',
  );

/* ------------------------------------------------------------------ */
/* Entrées d'écriture                                                  */
/* ------------------------------------------------------------------ */

export const schemaAdresseClient = z.object({
  type: z.enum(TYPES_ADRESSE),
  rue: schemaTexteCourt,
  complement: schemaTexteCourt.nullish(),
  npa: z.string().trim().min(4).max(10),
  localite: schemaTexteCourt,
  pays: schemaCodePays.default('CH'),
});

export const schemaModificationAdresseClient = schemaAdresseClient
  .partial()
  .extend({ actif: z.boolean().optional() });

export const schemaContactClient = z.object({
  nom: schemaTexteCourt,
  prenom: schemaTexteCourt.nullish(),
  fonction: schemaTexteCourt.nullish(),
  telephone: z.string().trim().max(30).nullish(),
  email: schemaEmail.nullish(),
  langue: z.enum(LANGUES).nullish(),
  /** Non vide : un contact sans rôle n'a aucun usage métier (`cardinality(roles) > 0` en base). */
  roles: z.array(z.enum(ROLES_CONTACT)).min(1),
});

export const schemaModificationContactClient = schemaContactClient
  .partial()
  .extend({ actif: z.boolean().optional() });

export const schemaConditionClient = z.object({
  rabaisMoPourmille: schemaPourmille.default(0),
  rabaisPiecesPourmille: schemaPourmille.default(0),
  rabaisPneusPourmille: schemaPourmille.default(0),
  tauxHoraireCode: z.string().trim().max(40).nullish(),
  delaiPaiementJours: z.number().int().min(0).max(365).nullish(),
  modePaiement: z.string().trim().max(40).nullish(),
  plafondCentimes: schemaCentimesPositif.nullish(),
  valideDuLe: schemaDateJour,
  /** `null` = ouvert. Un chevauchement produit `400 VALIDATION_ECHOUEE`. */
  valideAuLe: schemaDateJour.nullish(),
});

export const schemaConsentementClient = z.object({
  type: z.enum(TYPES_CONSENTEMENT),
  accorde: z.boolean(),
  recueilliLe: schemaHorodatage,
  canal: z.string().trim().max(40).nullish(),
});

export const schemaNoteClient = z.object({
  nature: z.enum(NATURES_NOTE),
  texte: schemaTexteLong,
});

/**
 * `POST /clients` — `Idempotency-Key` OBLIGATOIRE (RM-11 : un rejeu ne doit pas brûler un numéro
 * de client). `numeroClient` et `statut` ne sont JAMAIS entrants.
 *
 * La contrainte « particulier ⇒ nom, entreprise ⇒ raisonSociale » est portée ici ET par un CHECK
 * en base : le schéma donne un message utilisable au comptoir, la base garantit l'invariant même
 * pour un import ou une migration.
 */
export const schemaCreationClient = z
  .object({
    type: z.enum(TYPES_CLIENT),
    civilite: z.string().trim().max(20).nullish(),
    nom: schemaTexteCourt.nullish(),
    prenom: schemaTexteCourt.nullish(),
    raisonSociale: schemaTexteCourt.nullish(),
    ide: schemaIde.nullish(),
    langueCorrespondance: z.enum(LANGUES),
    adressePrincipale: schemaAdresseClient.omit({ type: true }),
    telephones: z
      .array(
        z.object({
          valeur: z.string().trim().min(4).max(30),
          principal: z.boolean().default(false),
        }),
      )
      .max(5)
      .default([]),
    email: schemaEmail.nullish(),
    conditions: schemaConditionClient.omit({ valideDuLe: true, valideAuLe: true }).optional(),
    poObligatoire: z.boolean().default(false),
    groupeId: schemaIdentifiant.nullish(),
    referenceExterne: z.string().trim().max(80).nullish(),
  })
  .extend(schemaConfirmations.shape)
  .refine((v) => (v.type === 'particulier' ? Boolean(v.nom) : Boolean(v.raisonSociale)), {
    message: 'Un particulier exige `nom`, une entreprise exige `raisonSociale`.',
    path: ['nom'],
  });

/**
 * `PATCH /clients/{clientId}`. **`type` n'est PAS modifiable** (RM-01) : l'envoyer produit
 * `409 CLIENT_TYPE_IMMUABLE`, et non un `VALIDATION_ECHOUEE` — la règle est métier, le code doit
 * la nommer pour que le message traduit soit juste. Le champ est donc absent de ce schéma, et le
 * refus est levé par le service quand la propriété est présente dans le corps brut.
 *
 * `statut` est en lecture seule : la désactivation passe par son action nommée.
 */
export const schemaModificationClient = z.object({
  civilite: z.string().trim().max(20).nullish(),
  nom: schemaTexteCourt.nullish(),
  prenom: schemaTexteCourt.nullish(),
  raisonSociale: schemaTexteCourt.nullish(),
  ide: schemaIde.nullish(),
  langueCorrespondance: z.enum(LANGUES).optional(),
  email: schemaEmail.nullish(),
  telephone: z.string().trim().max(30).nullish(),
  poObligatoire: z.boolean().optional(),
  groupeId: schemaIdentifiant.nullish(),
  referenceExterne: z.string().trim().max(80).nullish(),
});

/**
 * `POST /clients/{clientId}/desactiver` — refusée s'il reste des OR, RDV ou détentions ouverts
 * (`409 CLIENT_DESACTIVATION_IMPOSSIBLE`, `blocages` nommant chacun d'eux).
 */
export const schemaDesactivationClient = z.object({ motif: schemaMotif });

/**
 * `POST /clients/{clientId}/fusionner` (RM-06, CT-02) — droit `direction` seul.
 *
 * `confirmationNom` reprend le NOM EXACT de la fiche absorbée : une garde SAISIE, pas une case à
 * cocher. La fusion est irréversible côté utilisateur et déplace véhicules, OR, RDV et documents.
 */
export const schemaFusionClient = z
  .object({
    clientSourceId: schemaIdentifiant,
    confirmationNom: schemaTexteCourt,
  })
  .extend(schemaConfirmations.shape);

export type EntreeCreationClient = z.infer<typeof schemaCreationClient>;
export type EntreeModificationClient = z.infer<typeof schemaModificationClient>;
export type EntreeDesactivationClient = z.infer<typeof schemaDesactivationClient>;
export type EntreeFusionClient = z.infer<typeof schemaFusionClient>;
export type EntreeAdresseClient = z.infer<typeof schemaAdresseClient>;
export type EntreeContactClient = z.infer<typeof schemaContactClient>;
export type EntreeConditionClient = z.infer<typeof schemaConditionClient>;
export type EntreeConsentementClient = z.infer<typeof schemaConsentementClient>;
export type EntreeNoteClient = z.infer<typeof schemaNoteClient>;
export type FiltresClients = z.infer<typeof schemaFiltresClients>;
export type ParametresDoublonsClients = z.infer<typeof schemaParametresDoublonsClients>;
