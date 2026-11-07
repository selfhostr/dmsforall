/**
 * Vues-modèles de l'écran de prise de rendez-vous (`docs/conception-rendez-vous-ecrans.md`).
 *
 * Le contrat existe désormais (`packages/shared/src/contrats/rendezvous/`, `@dfa/shared`) :
 * `ReponseRendezVous`, `ReponseMotifRendezVous`, `StatutRdv`, `MomentRendezVous`,
 * `EtatCapaciteRendezVous` en sont importés ci-dessous, jamais redéfinis à la main. Les
 * interfaces qui restent déclarées ICI (`RendezVousCarte`, `JourAgenda`, `RendezVousDetail`,
 * `EntreeHistoriqueRendezVous`) sont des VUES-MODÈLES d'écran ordinaires — déjà dénormalisées pour
 * l'affichage (labels résolus, regroupement par jour) — pas des DTO serveur : chaque composant
 * React définit les siennes, ce n'est pas ce que la règle « types générés jamais à la main » vise.
 *
 * `StatutRdv` (`@dfa/shared`) ne porte que QUATRE valeurs : `confirme`/`honore`/`absent`/`annule`
 * — pas de `reporte` (RV-16 : un déplacement de date n'est jamais un changement de statut, `PATCH
 * /rendez-vous/{id}` garde `confirme`). La conception d'écran envisageait un cinquième statut
 * « Reporté » comme extension future — non implémenté côté serveur à ce jour, donc absent d'ici.
 */
import type {
  EtatCapaciteRendezVous,
  Langue,
  MomentRendezVous,
  ReponseMotifRendezVous,
  StatutRdv,
} from '@dfa/shared';

export type { EtatCapaciteRendezVous, MomentRendezVous, StatutRdv };

/** Les QUATRE états d'AFFICHAGE de la capacité d'un jour — voir `docs/conception-rendez-vous-
 *  ecrans.md`, « Le point le plus délicat ». Calculé côté front à partir de deux nombres (minutes
 *  occupées / capacité configurée ou `null`, `composants/rendez-vous/capacite.ts`) : DISTINCT de
 *  `EtatCapaciteRendezVous` (serveur, trois valeurs `non_definie`/`disponible`/`complete`) — le
 *  serveur ne calcule pas la nuance « presque complet », c'est un raffinement d'écran. */
export type EtatCapaciteJour = 'disponible' | 'presque_complet' | 'complet' | 'non_definie';

/** Résout le libellé d'un motif dans la langue d'interface courante — `libelleDe`/`libelleIt`
 *  peuvent être `null` (référentiel garage, pas de traduction saisie) : repli sur `libelleFr`,
 *  jamais une chaîne vide (le motif reste identifiable même si le garage n'a traduit qu'en
 *  français). */
export function libelleMotif(motif: ReponseMotifRendezVous, langue: Langue): string {
  if (langue === 'de') return motif.libelleDe ?? motif.libelleFr;
  if (langue === 'it') return motif.libelleIt ?? motif.libelleFr;
  return motif.libelleFr;
}

/** Vue-modèle d'une carte de rendez-vous affichée dans l'agenda (semaine/jour) ou la vue liste —
 *  déjà dénormalisée pour l'affichage (motif déjà résolu dans la langue courante), construite
 *  depuis `ReponseRendezVous` par l'écran conteneur (`ecrans/rendez-vous/`). Pas de champ `debut`
 *  ISO combiné : le contrat porte `dateLe` (jour) + `moment` (matin/après-midi/toute la journée) +
 *  `heureSouhaitee` (optionnel) séparément — jamais une heure arbitraire inventée par le front. */
export interface RendezVousCarte {
  readonly id: string;
  readonly dateLe: string;
  readonly moment: MomentRendezVous;
  readonly heureSouhaitee: string | null;
  readonly dureeEstimeeMinutes: number;
  readonly clientNom: string;
  /** Téléphone de la fiche client (`ClientResume.telephone`) — `null` = non renseigné, jamais une
   *  chaîne vide : l'écran affiche alors « pas de téléphone », pas un blanc. */
  readonly clientTelephone?: string | null;
  readonly vehiculePlaque: string | null;
  readonly vehiculeCanton: string | null;
  readonly vehiculeDesignation: string | null;
  readonly motifLibelle: string;
  readonly statut: StatutRdv;
}

/** Entrée d'historique — même doctrine d'audit que le reste du produit (qui/quoi/quand). */
export interface EntreeHistoriqueRendezVous {
  readonly action: 'cree' | 'modifie' | 'annule' | 'honore' | 'absent';
  readonly auteurNom: string;
  readonly date: string;
}

/** Détail complet d'un rendez-vous (Écran 3) — étend la carte d'agenda avec ce qui n'a de sens que
 *  dans le panneau détaillé. */
export interface RendezVousDetail extends RendezVousCarte {
  readonly siteNom: string;
  /** E-mail du client, embarqué dans `ClientResume.email` du rendez-vous. `null` = non renseigné ;
   *  `undefined` = absent de la réponse. */
  readonly clientEmail?: string | null;
  readonly remarque: string | null;
  readonly motifAnnulation: string | null;
  readonly historique: readonly EntreeHistoriqueRendezVous[];
  /** Renseigné une fois le statut `honore` — lien direct vers l'OR créé (§ « Le lien avec l'ordre
   *  de réparation »). */
  readonly ordreReparationId: string | null;
}

/** Vue-modèle d'un jour de l'agenda (colonne de la vue Semaine, ou jour unique de la vue Jour).
 *
 *  PAS de champ `ferme` (site fermé ce jour) : `CapaciteJourRendezVous` (contrat serveur) ne porte
 *  aucun signal d'ouverture/fermeture — l'inventer depuis `capaciteMinutes === 0` confondrait
 *  « fermé » et « capacité paramétrée à zéro », exactement la confusion que la doctrine « absence
 *  de donnée ≠ valeur » interdit. Simplification assumée du lot 1, signalée dans le rapport de
 *  livraison plutôt que devinée en silence. */
export interface JourAgenda {
  /** aaaa-mm-jj, clé stable pour React et pour le regroupement — comparée en CHAÎNE, jamais via un
   *  `Date` reconstruit (le lot 1 traite les dates en UTC direct, faute de fuseau par site en
   *  base : reconstruire un `Date` localement risquerait de faire déborder le jour). */
  readonly dateIso: string;
  readonly date: Date;
  readonly nombreRendezVous: number;
  readonly minutesOccupees: number;
  /** `null` = site sans capacité configurée — jamais `0` en repli. */
  readonly capaciteMinutes: number | null;
  readonly rendezVous: readonly RendezVousCarte[];
}
