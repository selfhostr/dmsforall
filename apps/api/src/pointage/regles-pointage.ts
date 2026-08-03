import type { ArrondiPointage, EntreeDemarragePointage, StatutLigneOr, StatutOrdreReparation } from '@dfa/shared';
import type { LignePointage } from '../db/schema';

/**
 * Règles métier PURES du pointage (RM-87 → RM-99, RM-113 → RM-123,
 * `docs/specification-pointage.md`) — aucune I/O ici, exprès : c'est ce qui rend ce fichier
 * testable sans base de données (voir `regles-pointage.spec.ts`), à la différence de
 * `service-pointage.ts` qui, lui, ne peut être prouvé que par un test d'intégration (Postgres réel,
 * RLS, triggers ZDFA1).
 */

/* ------------------------------------------------------------------ */
/* RM-92 / RM-93 : cibles pointables                                   */
/* ------------------------------------------------------------------ */

/**
 * RM-92 : « Pas de pointage sur un OR terminé/facturé/restitué/clôturé/annulé. » Complément par
 * rapport au texte littéral : un OR `planifie` (véhicule pas encore réceptionné) reste pointable —
 * RM-92 ne l'exclut pas, et bloquer aurait été une invention.
 */
const STATUTS_OR_NON_POINTABLES: ReadonlySet<StatutOrdreReparation> = new Set([
  'termine',
  'facture',
  'restitue',
  'cloture',
  'annule',
]);

export function estOrPointable(statut: StatutOrdreReparation): boolean {
  return !STATUTS_OR_NON_POINTABLES.has(statut);
}

/**
 * RM-93 : « Pas de pointage sur une ligne à valider/refusée/annulée. » INTERPRÉTATION SIGNALÉE
 * (élargissement délibéré, documenté) : le texte littéral de RM-93 ne couvre que trois statuts,
 * mais la machine à états de la ligne (`transition_autorisee`, migration 0003) n'autorise
 * `ligne_or.statut -> 'en_cours'` QUE depuis `'validee'` — toute tentative de démarrer un pointage
 * depuis `'proposee'`, `'realisee'` ou `'facturee'` échouerait de toute façon en base (`ZDFA1`,
 * `LIGNE_TRANSITION_INTERDITE`), un code qui n'a pas de sens pour l'appelant du pointage (« pourquoi
 * une transition de LIGNE m'est-elle opposée, je démarre un POINTAGE »). On préfère donc un rejet
 * PROPRE et nommé (`POINTAGE_LIGNE_NON_POINTABLE`) sur exactement les mêmes cas, PLUS `'en_cours'`
 * qui, lui, reste pointable — c'est le cas RM-121/CT-54 (un second technicien rejoint la même
 * ligne, déjà `en_cours` par un premier).
 */
const STATUTS_LIGNE_POINTABLES: ReadonlySet<StatutLigneOr> = new Set(['validee', 'en_cours']);

export function estLignePointable(statut: StatutLigneOr): boolean {
  return STATUTS_LIGNE_POINTABLES.has(statut);
}

/** RM-117 : `ligne_or.statut` passe `'validee' -> 'en_cours'` au démarrage d'un pointage dessus. */
export function ligneDoitPasserEnCours(statut: StatutLigneOr): boolean {
  return statut === 'validee';
}

/** RM-117 / T-04 : `ordre_reparation.statut` passe `'ouvert' -> 'en_cours'` au démarrage d'un pointage. */
export function orDoitPasserEnCours(statut: StatutOrdreReparation): boolean {
  return statut === 'ouvert';
}

/* ------------------------------------------------------------------ */
/* RM-89 / RM-90 : chevauchement — clôture automatique du pointage ouvert du technicien           */
/* ------------------------------------------------------------------ */

/**
 * `pointage_technicien_un_seul_en_cours_uk` (migration 0030) impose, EN BASE, qu'un technicien n'a
 * jamais deux pointages `en_cours` — quel que soit `parametre_atelier.chevauchement_pointage_autorise`
 * (P-06) : le commentaire de la migration est explicite (« un MÊME technicien ne peut JAMAIS avoir
 * deux pointages en_cours simultanément »), sans exception pour P-06. RM-88 (« sauf chevauchement
 * autorisé ») ne peut donc pas signifier « deux lignes réellement ouvertes à la fois » — le schéma,
 * livré et figé avant ce fichier, a déjà tranché ce point. INTERPRÉTATION RETENUE ICI, à confirmer
 * avec expert-metier (signalée dans le rapport de livraison) :
 *
 *  - Le pointage ouvert précédent du technicien est TOUJOURS clôturé automatiquement quand un
 *    nouveau démarre (RM-89) — c'est la seule façon de respecter la contrainte de base.
 *  - `finLe` de la clôture = le plus tardif entre l'ancien `debutLe` et le nouveau `debutLe` : un
 *    enchaînement normal (nouveau après ancien) ferme proprement, sans chevauchement de durée ; un
 *    enchaînement inversé (horloge en désordre — hors ligne, deux appareils) est absorbé sans
 *    jamais produire une durée négative (`pointage_periode_coherente_chk`).
 *  - P-06 (`chevauchementPointageAutorise`) ne change donc PAS le fait que l'ancien pointage se
 *    ferme (impossible de faire autrement), mais change si l'INVERSION d'horloge ci-dessus est
 *    traitée comme une anomalie (`false`, défaut — RM-89 strict) ou tolérée sans anomalie (`true` —
 *    RM-90, « chevauchement autorisé... brut consultable »).
 */
export interface ClotureChevauchement {
  readonly finLe: Date;
  /** `true` si l'ordre chronologique attendu (ancien avant nouveau) est inversé. */
  readonly ordreInverse: boolean;
}

export function calculerClotureChevauchement(ancienDebutLe: Date, nouveauDebutLe: Date): ClotureChevauchement {
  const ordreInverse = ancienDebutLe.getTime() > nouveauDebutLe.getTime();
  const finLe = ordreInverse ? ancienDebutLe : nouveauDebutLe;
  return { finLe, ordreInverse };
}

/** RM-89 (P-06 faux) vs RM-90 (P-06 vrai) : l'inversion d'horloge doit-elle produire une anomalie ? */
export function chevauchementDoitProduireAnomalie(ordreInverse: boolean, chevauchementAutorise: boolean): boolean {
  return ordreInverse && !chevauchementAutorise;
}

/* ------------------------------------------------------------------ */
/* RM-97 : arrondi — brut conservé à la seconde, arrondi dérivé pour l'affichage/calcul            */
/* ------------------------------------------------------------------ */

const SECONDES_PAR_HEURE = 3600;
/** 1 heure = 100 centièmes (échelle déjà utilisée par `ligne_or.tempsReelCentiemes`). */
const CENTIEMES_PAR_HEURE = 100;

/** Unité d'arrondi (P-19, `parametre_atelier.arrondi_pointage`), en secondes. */
const UNITE_ARRONDI_SECONDES: Readonly<Record<ArrondiPointage, number>> = {
  minute: 60,
  dixieme: 360, // 0.1 h
  quart: 900, // 0.25 h
};

/**
 * RM-97 : la seconde brute (`duree_brute_secondes`, colonne GENERATED) n'est JAMAIS modifiée ici —
 * cette fonction ne fait que DÉRIVER `dureeArrondieCentiemes` pour l'affichage/le calcul (arrondi au
 * plus proche multiple de l'unité P-19, arrondi commercial — `Math.round`).
 */
export function calculerDureeArrondieCentiemes(dureeBruteSecondes: number, arrondi: ArrondiPointage): number {
  const unite = UNITE_ARRONDI_SECONDES[arrondi];
  const secondesArrondies = Math.round(dureeBruteSecondes / unite) * unite;
  return Math.round((secondesArrondies / SECONDES_PAR_HEURE) * CENTIEMES_PAR_HEURE);
}

/* ------------------------------------------------------------------ */
/* RM-96 : anomalie « durée trop longue »                              */
/* ------------------------------------------------------------------ */

/** RM-96 : anomalie si la durée brute dépasse le seuil paramétré (P, défaut 10 h — `pointageDureeMaxHeures`). */
export function dureeDepasseLeSeuil(dureeBruteSecondes: number, seuilHeures: number): boolean {
  return dureeBruteSecondes > seuilHeures * SECONDES_PAR_HEURE;
}

/* ------------------------------------------------------------------ */
/* Dérive d'horloge (`plan-etape-1-frontend.md` §4.3 point 6, `pointage/primitives.ts`)             */
/* ------------------------------------------------------------------ */

/**
 * Seuil de dérive d'horloge tolérée avant anomalie `derive_horloge`, en millisecondes.
 * AUCUN paramètre P-xx ne couvre ce seuil dans `parametre_atelier` (vérifié : ni dans le schéma
 * Drizzle ni dans `PARAMETRES_ATELIER_PAR_DEFAUT`) — valeur MVP en dur, à faire remonter en
 * paramètre si le terrain le réclame. Choisie à 5 minutes : une dérive de quelques secondes à
 * quelques minutes est le bruit normal d'une horloge d'appareil non synchronisée par NTP ; au-delà,
 * c'est le signe d'une horloge réellement fausse (fuseau mal réglé, batterie de CMOS morte).
 */
export const SEUIL_DERIVE_HORLOGE_MS = 5 * 60 * 1000;

export function deriveHorlogeAnormale(decalageHorlogeMs: number | null | undefined): boolean {
  if (decalageHorlogeMs === null || decalageHorlogeMs === undefined) return false;
  return Math.abs(decalageHorlogeMs) > SEUIL_DERIVE_HORLOGE_MS;
}

/* ------------------------------------------------------------------ */
/* RM-123 : anomalie différée « ligne non pointable » / « OR facturé »                             */
/* ------------------------------------------------------------------ */

/**
 * RM-123 : une ligne qui passe à `annulee`/`refusee` PENDANT qu'un pointage tourne dessus ne
 * l'interrompt pas de force — l'anomalie se pose au PROCHAIN événement concernant ce pointage
 * (`arreter`, `corriger`, ou simplement une lecture qui le traverse). Même logique, étendue par ce
 * fichier (pas dans RM-123 littéralement, mais symétrique) au niveau de l'OR : un OR qui devient
 * `facture`/`restitue`/`cloture`/`annule` pendant qu'un pointage `productif_or` tourne dessus.
 */
export function ligneDevenueNonPointable(statut: StatutLigneOr): boolean {
  return statut === 'annulee' || statut === 'refusee';
}

export function orDevenuNonPointable(statut: StatutOrdreReparation): boolean {
  return STATUTS_OR_NON_POINTABLES.has(statut);
}

/* ------------------------------------------------------------------ */
/* Idempotence de second niveau — collision sur `id` (voir pointage.ts, commentaire de           */
/* `schemaDemarragePointage`) : un `id` déjà pris rejoue si c'est LE MÊME geste, sinon 409 CONFLIT */
/* ------------------------------------------------------------------ */

/**
 * `true` si `existant` (déjà en base, même `id`) décrit exactement le MÊME geste que `entree` — un
 * rejeu hors ligne légitime (tablette qui a perdu la réponse du premier essai, reconnectée avec une
 * NOUVELLE `Idempotency-Key` faute d'avoir mémorisé l'ancienne). `false` = collision réelle sur un
 * `id` déjà pris par un événement différent (`409 CONFLIT`).
 *
 * Comparaison volontairement sur les champs qui DÉFINISSENT le geste (qui, quoi, quand, quelle
 * cible) — pas sur `source`/`appareilId`/`decalageHorlogeMs`, qui décrivent le CANAL par lequel le
 * geste a été rejoué et peuvent légitimement différer d'un essai à l'autre sans que ce soit un
 * geste différent.
 */
export function pointageCorrespondEntree(existant: LignePointage, entree: EntreeDemarragePointage): boolean {
  if (existant.technicienId !== entree.technicienId) return false;
  if (existant.siteId !== entree.siteId) return false;
  if (existant.nature !== entree.nature) return false;
  if (existant.debutLe.getTime() !== new Date(entree.debutLe).getTime()) return false;

  const ordreReparationId = 'ordreReparationId' in entree ? entree.ordreReparationId : null;
  const ligneOrId = 'ligneOrId' in entree ? entree.ligneOrId : null;
  const activiteIndirecte = 'activiteIndirecte' in entree ? entree.activiteIndirecte : null;

  return (
    existant.ordreReparationId === ordreReparationId &&
    existant.ligneOrId === ligneOrId &&
    existant.activiteIndirecte === activiteIndirecte
  );
}
