/**
 * Types d'événements du canal temps réel (notification serveur → poste fixe, voir
 * `apps/api/src/temps-reel/`). Canal GÉNÉRIQUE : ce type est le SEUL défini pour l'instant, posé
 * en union extensible (comme `TYPES_RELANCE`, `contrats/relances/enums.ts`) — un futur usage
 * (clôture de pointage, facture émise, relance envoyée) ajoute une valeur ICI et une entrée dans
 * `DonneesEvenementTempsReel` (`evenement.ts`), jamais une refonte du transport.
 *
 * Premier usage : un réceptionniste scanne un permis de circulation depuis son téléphone (agent
 * OCR, `apps/api/src/vehicules/`, HORS PÉRIMÈTRE de ce module) — si le client/véhicule existe déjà,
 * le poste fixe reçoit ce type pour ouvrir la fiche. AUCUNE donnée personnelle au-delà de
 * l'identifiant : voir `evenement.ts` pour la charge exacte et sa justification.
 */
export const TYPES_EVENEMENT_TEMPS_REEL = ['vehicule.correspondance_scan_permis'] as const;
export type TypeEvenementTempsReel = (typeof TYPES_EVENEMENT_TEMPS_REEL)[number];
