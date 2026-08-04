import type { StatutOrdreReparation } from '../atelier/enums';
import type { PeriodeResolueTableauBord } from './query';

/**
 * `GET /tableau-bord/activite` — indicateurs D'ACTIVITÉ (atelier + stock), **sans aucun montant**.
 * Ouvert à tout rôle de personne (voir `apps/api/src/tableau-bord/droits-provisoires.ts` pour le
 * détail des rôles et la note sur l'action de droit encore à ajouter à la matrice).
 *
 * Six statuts seulement — les statuts d'un OR encore « au garage » : un OR `restitue`, `cloture`
 * ou `annule` est sorti du flux actif, il n'a plus sa place dans un indicateur de charge courante
 * (il reste consultable via `GET /ordres-reparation`, ce n'est pas une donnée manquante, juste
 * hors du périmètre de CE widget).
 */
export const STATUTS_OR_TABLEAU_BORD = [
  'planifie',
  'ouvert',
  'en_cours',
  'controle',
  'termine',
  'facture',
] as const satisfies readonly StatutOrdreReparation[];
export type StatutOrTableauBord = (typeof STATUTS_OR_TABLEAU_BORD)[number];

export interface RepartitionStatutOrdreReparationTableauBord {
  readonly statut: StatutOrTableauBord;
  /** Compte SNAPSHOT (maintenant), pas borné par la période — voir la doc du champ parent. */
  readonly nombre: number;
}

/**
 * `null` (jamais `0`) quand le dénominateur est vide (aucun OR restitué sur la période) — même
 * convention que `IndicateursPointageTechnicien` (`contrats/pointage/indicateurs.ts`) : un délai à
 * zéro affirmerait une performance qu'aucune donnée ne soutient.
 */
export interface ReponseActiviteTableauBord {
  readonly periode: PeriodeResolueTableauBord;
  readonly siteId: string | null;

  /** SNAPSHOT (maintenant) : répartition des OR encore actifs par statut. Toujours les 6 entrées
   *  de `STATUTS_OR_TABLEAU_BORD`, dans cet ordre, y compris à `nombre: 0`. */
  readonly ordresReparationParStatut: readonly RepartitionStatutOrdreReparationTableauBord[];

  /** PÉRIODE : nombre d'OR ouverts (`ouvertLe` dans la période). Volume d'affaires entrant. */
  readonly ordresReparationOuvertsPeriode: number;

  /** PÉRIODE : nombre d'OR restitués (`restitueLe` dans la période). Débit de sortie. */
  readonly ordresReparationRestituesPeriode: number;

  /** PÉRIODE : délai moyen `restitueLe - ouvertLe`, en minutes, pour les OR restitués sur la
   *  période. `null` si aucun OR restitué sur la période (voir la doctrine ci-dessus). */
  readonly delaiMoyenRestitutionMinutes: number | null;

  /** SNAPSHOT (maintenant) : lignes d'OR au statut `a_valider` (en attente d'une décision),
   *  hors OR déjà `annule`/`cloture`. File d'attente à traiter, pas un indicateur de période. */
  readonly lignesEnAttenteValidation: number;

  /** SNAPSHOT (maintenant) : nombre d'articles dont la quantité disponible (physique − réservée)
   *  est strictement sous `stockMinimumMillieme` — mêmes règles que `GET /stock/reapprovisionnement`
   *  (`pieces/reapprovisionnement.controller.ts`), en QUANTITÉ seulement, jamais de montant ici. */
  readonly articlesSousSeuilReapprovisionnement: number;
}
