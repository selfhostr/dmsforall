import { z } from 'zod';

import type { ClientResume } from '../atelier/client';
import { schemaIdentifiant } from '../atelier/primitives';
import { schemaParametresPage } from '../pagination';
import type {
  StatutConfirmationFinancement,
  StatutDossierVente,
  TypeFinancementVente,
} from './enums';

/**
 * Suivi financement/garantie — `GET /ventes/suivi`.
 *
 * Ce fichier N'EST PAS une extension du socle gelé (`financement.ts`/`dossier-vente.ts`,
 * `RV-39` → `RV-58`) : c'est une VUE dérivée, calculée à la lecture, sur des données déjà portées
 * ailleurs (`financement_vente`, `vehicule.garantie_debut`/`garantie_mois`/`garantie_km`) —
 * aucune nouvelle colonne, aucune nouvelle machine à états, aucun nouveau droit d'écriture.
 * Répond au besoin métier « quelles échéances arrivent, une couverture est-elle encore valable,
 * quels dossiers demandent une action » — le SUIVI du financement/garantie déjà modélisés, jamais
 * mentionné avant ce fichier dans `contrats/ventes/**`.
 *
 * ÉCHÉANCE — CE QUI EST HONNÊTEMENT CALCULABLE AUJOURD'HUI, ET CE QUI NE L'EST PAS :
 *
 *  - **Financement** (`credit`/`leasing` uniquement — un `comptant` n'est pas un financement,
 *    `RV-44`, rien à suivre) : `financement_vente` porte `dureeMois` (migration 0042) mais AUCUNE
 *    date de départ de contrat DÉDIÉE. `confirmeLe` (horodatage de la confirmation par l'organisme,
 *    posé par `ServiceFinancement.confirmer`) est l'unique repère temporel disponible.
 *    `echeanceLe` = `confirmeLe + dureeMois`, calculée UNIQUEMENT quand
 *    `statutConfirmation = 'confirme'` ET que les deux valeurs sont connues — `null`/absente
 *    sinon, JAMAIS estimée. AMBIGUÏTÉ SIGNALÉE, non tranchée ici : `confirmeLe` est la date de
 *    confirmation par l'organisme, pas nécessairement la date de signature/départ EFFECTIVE du
 *    contrat (qui peut différer de quelques jours en pratique) — c'est l'approximation la plus
 *    proche que le schéma actuel permette, pas une garantie d'exactitude au jour près. Si une date
 *    de départ de contrat distincte s'avère nécessaire, elle appartient à une future colonne
 *    (`financement_vente.date_debut_contrat`, par exemple), pas à ce fichier.
 *  - **Garantie** (véhicule) : `vehicule.garantieDebut`/`garantieMois`/`garantieKm` (posées dès
 *    l'étape 1, `migrations/0007_vehicules.sql`, RM-33) portent les trois informations
 *    nécessaires. `finLe` = `garantieDebut + garantieMois`, calculée quand les deux sont connues.
 *    `active` reprend EXACTEMENT la sémantique de `contrats/atelier/vehicule.ts::GarantieVehicule.active`
 *    (même fonction serveur, `vehicules/vehicule.mappers.ts::calculerGarantie`, réutilisée telle
 *    quelle) : `true` tant qu'aucune limite CONNUE (date ou kilométrage) n'est dépassée, sans
 *    décider à la place du réceptionnaire. RAPPEL DE CONTEXTE (non résolu par ce fichier, hors
 *    périmètre) : `vehicules/vehicule.mappers.ts` signale déjà que `vehicule` ne porte qu'UN SEUL
 *    jeu de colonnes de garantie (exposé côté atelier comme `garantieConstructeur`) — ce fichier
 *    hérite de la même limite, aucune garantie « garage » distincte n'existe à suivre.
 *  - Un dossier n'apparaît dans cette liste QUE s'il porte au moins un financement `credit`/
 *    `leasing` (quel que soit son état — `en_attente`/`confirme`/`refuse`) OU un véhicule associé
 *    dont `garantieDebut` est renseigné. Un dossier sans aucun des deux n'a rien à suivre ici.
 *
 * VISIBILITÉ FINANCIÈRE (RF-116, doctrine déjà appliquée à `ReponseFinancement.dureeMois`,
 * `contrats/ventes/financement.ts`) : `dureeMois` ET `echeanceLe` du financement sont **omis**
 * (pas `null` — absents de la charge utile) pour un rôle dont `roleVoitLesMontants(role)` est
 * faux — `echeanceLe` est ARITHMÉTIQUEMENT dérivée de `dureeMois`, l'omettre est nécessaire pour
 * que l'omission de `dureeMois` ait un sens (sinon `echeanceLe - confirmeLe` la reconstituerait
 * trivialement). `LigneSuiviVente.prochaineEcheanceLe` (le champ de tri/filtre par défaut) suit la
 * MÊME doctrine de façon transitive : pour un rôle sans droit financier, elle ne peut JAMAIS
 * dériver d'une échéance de financement masquée — y compris à travers le curseur de pagination
 * opaque (qui encode la valeur de tri en clair, base64url, jamais chiffré) — voir le commentaire
 * de tête de `apps/api/src/ventes/service-suivi-vente.ts` pour le détail de cette garde côté
 * serveur. La garantie, elle, n'est PAS une donnée financière (même doctrine que
 * `GarantieVehicule`, jamais gatée) : `garantie.finLe`/`active` restent toujours visibles à qui a
 * le droit de lire ce dossier.
 */

/** Projection minimale d'un client dans ce fichier — même doctrine que
 *  `FinancementResume.organisme` (`Pick<ClientResume, 'id' | 'nomAffiche'>`), pas un
 *  `ClientResume` complet (`versClientResume` coûte trois requêtes supplémentaires, jamais dans
 *  une boucle de liste — voir `atelier/references.ts`). */
export type ClientSuiviVente = Pick<ClientResume, 'id' | 'nomAffiche'>;

export interface SuiviFinancement {
  readonly id: string;
  readonly type: TypeFinancementVente;
  readonly statutConfirmation: StatutConfirmationFinancement;
  /** `null` uniquement pour un financement sans organisme enregistré (ne devrait pas arriver pour
   *  `credit`/`leasing`, RV-40/RV-44, mais ce fichier ne re-vérifie pas une garde déjà posée à la
   *  création — défensif). */
  readonly organisme: ClientSuiviVente | null;
  readonly confirmeLe: string | null;
  /** Omis (pas `null`) pour un rôle sans `roleVoitLesMontants` — RF-116, voir l'en-tête. */
  readonly dureeMois?: number | null;
  /** `confirmeLe + dureeMois`, UNIQUEMENT si `statutConfirmation = 'confirme'` et les deux
   *  connues — jamais estimée. Omis (pas `null`) pour un rôle sans `roleVoitLesMontants`, même
   *  doctrine que `dureeMois` (voir l'en-tête du fichier). */
  readonly echeanceLe?: string | null;
}

export interface SuiviGarantie {
  /** Toujours renseignée : un `garantie` `null` au niveau de `LigneSuiviVente` signifie « pas de
   *  garantie à suivre pour ce dossier », pas une garantie partiellement connue. */
  readonly debutLe: string;
  readonly mois: number | null;
  readonly plafondKm: number | null;
  /** `null` si `mois` est inconnu — aucune date de fin n'est calculable sans durée (voir l'en-tête
   *  du fichier, même doctrine que `GarantieVehicule.finLe`). */
  readonly finLe: string | null;
  readonly active: boolean;
}

/** Projection minimale du véhicule associé — même esprit que `VehiculeResume`
 *  (`contrats/atelier/vehicule.ts`) mais réduite aux trois champs utiles à l'identification dans
 *  une liste de suivi (pas de plaque : coûterait une requête supplémentaire par ligne, voir
 *  `apps/api/src/ventes/service-suivi-vente.ts`). */
export interface VehiculeSuiviVente {
  readonly id: string;
  readonly designation: string;
  readonly vin: string | null;
}

export interface LigneSuiviVente {
  readonly dossierVenteId: string;
  readonly siteId: string;
  readonly dossierStatut: StatutDossierVente;
  readonly clientAcheteur: ClientSuiviVente;
  /** `null` tant qu'aucun véhicule n'est associé (`RV-30`, dossier encore en `prospection`) — un
   *  dossier peut apparaître ici via un financement pré-approuvé avant le choix du véhicule. */
  readonly vehicule: VehiculeSuiviVente | null;
  /** Le financement COURANT du dossier — même dérivation que `ReponseDossierVente.financement`
   *  (`selectionnerFinancementCourant`), restreinte aux types `credit`/`leasing` (un `comptant`
   *  n'a rien à suivre, RV-44). `null` si le dossier n'a aucun financement `credit`/`leasing`. */
  readonly financement: SuiviFinancement | null;
  /** `null` si le véhicule associé n'a pas de `garantieDebut` renseigné (ou aucun véhicule
   *  associé). */
  readonly garantie: SuiviGarantie | null;
  /** La plus proche des deux échéances VISIBLES par l'appelant (`financement.echeanceLe` si non
   *  omise, `garantie.finLe`) — `null` si aucune des deux n'est calculable ou visible. Toujours
   *  présente (jamais omise par rôle) : elle ne révèle jamais plus que ce que les deux champs
   *  sources exposent déjà séparément dans la MÊME réponse — voir l'en-tête du fichier. */
  readonly prochaineEcheanceLe: string | null;
}

/** Un seul tri exposé pour l'instant (la plus proche échéance d'abord) — forme extensible même
 *  patron que `TRIS_DOSSIERS_VENTE` (`dossier-vente.ts`) : ajouter un tri est additif, jamais une
 *  rupture. */
export const TRIS_SUIVI_VENTE = ['prochaineEcheance:asc'] as const;
export type TriSuiviVente = (typeof TRIS_SUIVI_VENTE)[number];
export const TRI_DEFAUT_SUIVI_VENTE: TriSuiviVente = 'prochaineEcheance:asc';

/**
 * `GET /ventes/suivi` — filtres.
 *
 * `dansJours` : ne renvoie que les dossiers dont AU MOINS une échéance VISIBLE par l'appelant
 * (voir la doctrine RF-116 ci-dessus) tombe dans les `dansJours` prochains jours, bornes incluses
 * (`[aujourd'hui, aujourd'hui + dansJours]`, comparaison au jour calendaire). Sans ce paramètre :
 * tout dossier suivi est renvoyé, y compris les échéances déjà dépassées — triées en premier
 * (tri par défaut ascendant), ce qui met naturellement en évidence les dossiers en retard.
 */
export const schemaFiltresSuiviVente = schemaParametresPage.extend({
  siteId: schemaIdentifiant.optional(),
  dansJours: z.coerce.number().int().min(0).max(3650).optional(),
  tri: z.enum(TRIS_SUIVI_VENTE).default(TRI_DEFAUT_SUIVI_VENTE),
});
export type FiltresSuiviVente = z.infer<typeof schemaFiltresSuiviVente>;
