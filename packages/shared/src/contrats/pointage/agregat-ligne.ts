import { z } from 'zod';

import { schemaIdentifiant } from '../atelier/primitives';

/**
 * `GET /pointages/agregats-ligne` — consultation dédiée : « pour cet OR, chaque ligne pointable a
 * combien de temps RÉELLEMENT PASSÉ (somme des pointages) face à son temps FACTURÉ/vendu (barème
 * de la ligne) ? ». Absent des contrats existants avant ce fichier — `pointage.ts` expose des
 * ÉVÉNEMENTS individuels (`GET /pointages?ligneOrId=`, une collection de pointages), `indicateurs.ts`
 * agrège par TECHNICIEN sur une période ; aucun des deux ne répond « où en est CETTE ligne
 * précisément », la question que se pose un chef d'atelier qui regarde un OR en cours (RM-99 :
 * « c'est précisément l'écart [pointé vs vendu] qui a de la valeur »).
 *
 * ROUTE, PAS UN FILTRE DE `GET /pointages` : la FORME de la réponse diffère structurellement (un
 * agrégat par ligne, pas une page de pointages individuels) — même arbitrage que celui déjà posé
 * pour `indicateurs.ts` vis-à-vis de la même collection.
 *
 * PARAMÈTRE UNIQUE `ordreReparationId` (pas un `ligneOrId` répété) : le cas d'usage identifié est
 * « j'ouvre un OR, je veux la vue d'ensemble de toutes ses lignes d'un coup » — un chef d'atelier ne
 * connaît pas forcément déjà l'identifiant précis de chaque ligne qui l'intéresse. Étendre à un
 * second paramètre `ligneOrId` répété resterait un ajout ADDITIF si le besoin apparaît (un nouveau
 * champ de requête optionnel), pas une rupture.
 *
 * DROIT : `atelier.pointage.lire` seul, PAS de restriction `ROLES_AVEC_VUE_EQUIPE_POINTAGE` (voir
 * `ServicePointage.obtenir`/`lister`) — cet agrégat ne nomme AUCUN technicien, seulement des totaux
 * par ligne ; il ne révèle rien de plus que ce que `lignesAvecTempsPointe` (`atelier/atelier.jetons.ts`,
 * port `LecturePointage`) expose déjà à `atelier` sans restriction de rôle.
 *
 * PORTÉE DÉLIBÉRÉE, SIGNALÉE : `ligne_or.tempsReelCentiemes` (`contrats/atelier/ligne.ts`) existe
 * déjà comme champ de LECTURE dans le contrat `atelier`, mais reste câblé à `null` en permanence
 * (`atelier/mappeurs.ts`) — le port `LecturePointage` qu'`atelier` consomme n'expose qu'un
 * ENSEMBLE BOOLÉEN (`lignesAvecTempsPointe` : « cette ligne a-t-elle du temps pointé, oui/non »),
 * jamais la DURÉE. Combler ce champ demanderait d'élargir `LecturePointage` (déclaré et possédé par
 * `atelier/atelier.jetons.ts`, hors périmètre d'écriture de ce fichier) pour y ajouter une méthode
 * qui renverrait les mêmes sommes que celles calculées ici — décision qui appartient à qui possède
 * ce port, pas à ce module. Cette route HTTP est donc un chemin PARALLÈLE, immédiatement utilisable
 * par un écran sans attendre cette décision de câblage interne.
 */
export const schemaParametresAgregatTempsLigne = z.object({
  ordreReparationId: schemaIdentifiant,
});
export type ParametresAgregatTempsLigne = z.infer<typeof schemaParametresAgregatTempsLigne>;

/**
 * Agrégat d'UNE ligne d'OR. `dureePointeeCentiemes` ne compte QUE les pointages fermés/validés/
 * verrouillés (`termine`, `valide`, `verrouille`) — jamais un pointage encore `en_cours` (sa durée
 * n'est pas encore figée, RM-97 : le brut n'existe qu'une fois `finLe` posé) ; `pointageEnCours`
 * signale séparément qu'un chrono tourne encore dessus, pour qu'un écran l'affiche sans le confondre
 * avec le total déjà acquis.
 */
export interface AgregatTempsLigneOr {
  readonly ligneOrId: string;
  readonly ordreReparationId: string;
  /** Somme des `dureeArrondieCentiemes` des pointages fermés de cette ligne — même échelle que
   *  `tempsBaremeCentiemes` (centièmes d'heure), comparaison directe possible. */
  readonly dureePointeeCentiemes: number;
  /** Nombre de pointages (tout statut confondu, y compris `en_cours`) ayant touché cette ligne —
   *  RM-121 : plusieurs techniciens peuvent s'être succédé ou superposés dessus. */
  readonly nombrePointages: number;
  /** `true` si au moins un pointage `en_cours` porte actuellement sur cette ligne. */
  readonly pointageEnCours: boolean;
  /** Miroir de `ligne_or.temps_bareme_centiemes` — `null` si la ligne n'a aucun temps barémé
   *  chiffré (ex. une ligne qui n'est pas de la main-d'œuvre facturée au forfait). */
  readonly tempsBaremeCentiemes: number | null;
  /** `dureePointeeCentiemes - tempsBaremeCentiemes` — POSITIF = dépassement du temps vendu, NÉGATIF
   *  = marge de temps restante. `null` si `tempsBaremeCentiemes` est `null` (rien à comparer). */
  readonly ecartCentiemes: number | null;
}

/** Une entrée par ligne de l'OR qui a soit un temps barémé chiffré, soit au moins un pointage —
 *  une ligne de pièces jamais pointée et sans temps barémé n'a rien à agréger, elle est omise
 *  plutôt que listée avec des zéros muets. Ordre : `ligne_or.numero_ordre` croissant. */
export interface ReponseAgregatTempsLigne {
  readonly ordreReparationId: string;
  readonly lignes: readonly AgregatTempsLigneOr[];
}
