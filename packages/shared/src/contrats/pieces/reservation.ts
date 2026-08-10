import { z } from 'zod';

import {
  STATUTS_RESERVATION_PIECE,
  type MotifLiberationReservation,
  type StatutReservationPiece,
} from './enums';
import { schemaIdentifiant, schemaMotif } from '../atelier/primitives';
import { schemaListeQuery } from '../filtres';
import { schemaParametresPage } from '../pagination';

/**
 * La réservation (`reservation_piece`, ou état dérivé — §6.3, §8 : « décision de conception hors
 * du périmètre métier », propriété d'expert-database) — `RP-19` → `RP-25`. C'EST LE CŒUR DU SUJET.
 *
 * Ce fichier fige la SÉMANTIQUE (§5.4) indépendamment du choix de stockage : que
 * `reservation_piece` soit une table à part ou une vue dérivée de `ligne_or`, l'API expose une
 * ressource ADRESSABLE avec un `id` stable — sans identifiant propre, aucune action « libérer »
 * n'est exprimable, et c'est précisément le trou que `RP-25` interdit de laisser à
 * l'implémentation.
 *
 * CRÉATION — AUCUN `POST /reservations` dans ce contrat. Une réservation naît TOUJOURS comme effet
 * de bord de `POST /ordres-reparation/{orId}/lignes` (`atelier/ligne.ts`, GELÉ, hors périmètre)
 * quand `type = 'piece'`, `articleId` renseigné et `fournieParClient = false` (`RP-19`, `RP-20`).
 * Il n'existe pas de geste de réservation manuelle indépendant d'une ligne d'OR — cohérent avec
 * `RP-25` : « ce module informe, l'atelier décide ».
 */

export interface ReponseReservationPiece {
  readonly id: string;
  readonly articleId: string;
  readonly siteId: string;
  readonly ligneOrId: string;
  readonly ordreReparationId: string;
  readonly quantiteMillieme: number;
  readonly statut: StatutReservationPiece;
  readonly creeLe: string;
  /** Renseigné uniquement pour `statut = 'satisfaite'` — horodatage du mouvement `sortie_or`
   *  généré (`RP-21`). */
  readonly satisfaiteLe: string | null;
  readonly mouvementSortieId: string | null;
  /** Renseignés uniquement pour `statut = 'liberee'` (`RP-23`). */
  readonly libereeLe: string | null;
  readonly motifLiberation: MotifLiberationReservation | null;
  /** Texte libre, obligatoire UNIQUEMENT pour `motifLiberation = 'liberation_manuelle'` (`RP-23`,
   *  troisième cas — le magasinier justifie un geste qui n'est pas anodin). */
  readonly motifLiberationTexte: string | null;
  readonly libereeParUtilisateurId: string | null;
}

/* ------------------------------------------------------------------ */
/* Lecture — collection                                                */
/* ------------------------------------------------------------------ */

export const TRIS_RESERVATIONS = ['creeLe:desc', 'creeLe:asc'] as const;
export const TRI_DEFAUT_RESERVATIONS = 'creeLe:desc';

/** `GET /reservations` — vue transverse (magasinier, chef d'atelier) : « qu'est-ce qui est
 *  réservé, pour qui, depuis quand ». `articleId` OU `ordreReparationId` attendu en pratique pour
 *  un usage raisonnable, mais non imposé par le contrat (un magasinier peut vouloir voir TOUT ce
 *  qui est `active` sur son site un matin donné). */
export const schemaFiltresReservations = schemaParametresPage.extend({
  articleId: schemaIdentifiant.optional(),
  siteId: schemaIdentifiant.optional(),
  ordreReparationId: schemaIdentifiant.optional(),
  statut: schemaListeQuery(z.enum(STATUTS_RESERVATION_PIECE)).optional(),
  tri: z.enum(TRIS_RESERVATIONS).default(TRI_DEFAUT_RESERVATIONS),
});
export type FiltresReservations = z.infer<typeof schemaFiltresReservations>;

/* ------------------------------------------------------------------ */
/* Actions — RP-21 (satisfaire), RP-23 (libérer)                       */
/* ------------------------------------------------------------------ */

/**
 * `POST /reservations/{id}/satisfaire` — le magasinier remet PHYSIQUEMENT la pièce (`RP-21`).
 * Génère le mouvement `sortie_or`, `statut → satisfaite` (TERMINAL). Refusé
 * (`409 RESERVATION_TRANSITION_INTERDITE`) si `statut !== 'active'` — même patron que
 * `LIGNE_TRANSITION_INTERDITE`. Refusé aussi (`409 RESERVATION_SITE_INCOHERENT`) si le site de
 * sortie demandé diffère du site de la réservation ET qu'aucun transfert (`RP-13`) n'a été
 * enregistré entre-temps (`RP-22`).
 *
 * AUCUN CORPS : la quantité sortie est TOUJOURS celle de la réservation déjà posée
 * (`quantiteMillieme`, fixée à la création — voir note en fin de fichier), rien à saisir. PAS
 * d'`Idempotency-Key` non plus : c'est une TRANSITION gardée par l'état de départ (`active`), pas
 * une création au sens de `RETENTION_IDEMPOTENCE_JOURS` — un rejeu sur une réservation déjà
 * `satisfaite` échoue proprement avec le même code que toute transition rejouée, même patron que
 * les actions de `ordre-reparation.ts` (`facturer` excepté, qui crée des documents).
 */

/**
 * `POST /reservations/{id}/liberer` — le geste EXPLICITE du magasinier (`RP-23`, troisième cas) ;
 * les deux premiers cas (ligne annulée, ligne refusée par décision de devis) sont des effets de
 * bord AUTOMATIQUES des actions déjà existantes de `atelier/ligne.ts`
 * (`schemaAnnulationLignes`, `schemaRefusLignes`) et de `devis.ts` — pas de second appel HTTP pour
 * ces deux cas, ce champ `motif` n'y est donc jamais rempli PAR L'UTILISATEUR (le motif de
 * `schemaAnnulationLignes`/`schemaRefusLignes` suffit et se recopie).
 *
 * `motif` OBLIGATOIRE ici (`schemaMotif`, min. 3 caractères) — le geste manuel n'est pas anodin.
 * Réponse enveloppée avec un AVERTISSEMENT `RESERVATION_LIBEREE_OR_ACTIF`
 * (`contrats/probleme.ts::CODES_AVERTISSEMENT`) quand l'OR porteur de la réservation n'est NI
 * `annule` NI dans un état où la ligne a été refusée par décision de devis — précisément le
 * « avertissement si l'OR n'est ni annulé ni refusé » de `RP-23`, troisième cas.
 */
export const schemaLiberationReservation = z.object({
  motif: schemaMotif,
});
export type EntreeLiberationReservation = z.infer<typeof schemaLiberationReservation>;

/*
 * Rappel (RP-19) : `ReponseReservationPiece.quantiteMillieme` est TOUJOURS égale à
 * `ligne_or.quantiteMillieme` de la ligne qui l'a créée, au moment de la création. Une réservation
 * ne se modifie jamais en quantité après coup — une hausse ou une baisse de besoin sur l'OR passe
 * par une nouvelle ligne (nouvelle réservation) ou par l'annulation de l'ancienne, jamais par un
 * `PATCH` sur la réservation elle-même (cohérent avec l'absence totale de `PATCH` dans ce fichier).
 */
