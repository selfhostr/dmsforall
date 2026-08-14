import type {
  AgregatTempsLigneOr,
  ArrondiPointage,
  CibleReprisePointage,
  EntreeDemarragePointage,
  StatutLigneOr,
  StatutOrdreReparation,
  StatutPointage,
} from '@dfa/shared';
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
 *    nouveau démarre (RM-89) — c'est la seule façon de respecter la contrainte de base. CE N'EST
 *    PAS un point ouvert à revisiter par ce correctif : `contrats/pointage/pointage.ts`, commentaire
 *    de tête de `schemaDemarragePointage`, tranche EXPLICITEMENT que RM-88/89/90 est « délibérément
 *    un SUCCÈS avec avertissement, jamais un refus à confirmer » — un `409` qui bloquerait le
 *    démarrage tant qu'un pointage tourne casserait l'optimisme hors ligne (R4). Refuser n'est donc
 *    pas une option compatible avec le contrat déjà figé, quelle que soit la tentation face au bug
 *    ci-dessous.
 *  - `finLe` de la clôture = le plus tardif entre l'ancien `debutLe` et le nouveau `debutLe` : un
 *    enchaînement normal (nouveau après ancien) ferme proprement, sans chevauchement de durée.
 *  - **BUG CORRIGÉ ICI** (constaté en exécution réelle, deux appareils/onglets, même technicien,
 *    deux pointages sur deux cibles distinctes) : un enchaînement INVERSÉ (le nouveau `debutLe`
 *    déclaré précède l'ancien — horloge en désordre entre deux appareils, ou second onglet resté
 *    ouvert avec un horodatage périmé) fermait l'ancien pointage sur `finLe := ancienDebutLe`,
 *    c'est-à-dire SA PROPRE valeur de départ : la durée retombait à EXACTEMENT ZÉRO, quelle qu'ait
 *    été la durée RÉELLEMENT travaillée avant l'inversion (une heure, une journée — aucune
 *    importance, le résultat était toujours 0). Vérifié par répétition en environnement réel
 *    (`POST /pointages` × 2, mêmes conditions) : un pointage ouvert à 08:00, encore `en_cours`, se
 *    voit fermé à `finLe = 08:00` dès qu'un second pointage déclare `debutLe = 07:00` (horloge en
 *    retard) — `dureeBruteSecondes: 0`, sans qu'aucune des deux minutes... heures... réellement
 *    passées ne soit récupérable ensuite (RM-94 permet de CORRIGER une valeur existante, pas d'en
 *    reconstituer une qui n'a jamais été écrite).
 *  - **CORRECTIF** : quand l'ordre est inversé, ancrer `finLe` sur l'horloge SERVEUR (`maintenant`,
 *    résolue une seule fois par la transaction appelante, `ServicePointage.demarrer`) plutôt que sur
 *    `ancienDebutLe` — le serveur sait, lui, qu'un certain temps s'est réellement écoulé entre
 *    l'ouverture de l'ancien pointage et l'instant présent, même quand aucun des deux horodatages
 *    déclarés par les clients n'est fiable. `Math.max(ancienDebutLe, maintenant)` reste la garde qui
 *    empêche toute durée négative (`pointage_periode_coherente_chk`) dans le cas pathologique,
 *    encore plus rare, où l'horloge serveur elle-même retomberait avant `ancienDebutLe` (ancien
 *    horodatage lui-même dans le futur du serveur, dérive extrême d'un premier appareil) — SEUL ce
 *    cas résiduel referme encore sur une durée nulle, et seulement lui.
 *  - P-06 (`chevauchementPointageAutorise`) ne change pas ce mécanisme de fermeture, mais change si
 *    l'inversion ci-dessus est traitée comme une anomalie (`false`, défaut — RM-89 strict) ou
 *    tolérée sans anomalie (`true` — RM-90, « chevauchement autorisé... brut consultable »). Dans
 *    les deux cas, la durée n'est plus jetée : l'anomalie (si posée) reste la voie normale pour
 *    qu'un chef d'atelier revoie et corrige (RM-94/RM-123) une fermeture dont l'instant exact reste,
 *    par construction, une estimation.
 */
export interface ClotureChevauchement {
  readonly finLe: Date;
  /** `true` si l'ordre chronologique attendu (ancien avant nouveau) est inversé. */
  readonly ordreInverse: boolean;
}

export function calculerClotureChevauchement(
  ancienDebutLe: Date,
  nouveauDebutLe: Date,
  maintenant: Date,
): ClotureChevauchement {
  const ordreInverse = ancienDebutLe.getTime() > nouveauDebutLe.getTime();
  const finLe = ordreInverse
    ? maintenant.getTime() > ancienDebutLe.getTime()
      ? maintenant
      : ancienDebutLe
    : nouveauDebutLe;
  return { finLe, ordreInverse };
}

/** RM-89 (P-06 faux) vs RM-90 (P-06 vrai) : l'inversion d'horloge doit-elle produire une anomalie ? */
export function chevauchementDoitProduireAnomalie(
  ordreInverse: boolean,
  chevauchementAutorise: boolean,
): boolean {
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
 * cette fonction ne fait que DÉRIVER `dureeArrondieCentiemes` pour l'affichage/le calcul, en DEUX
 * étapes, chacune documentée ici pour que la règle soit UNIQUE (un seul endroit qui décide) plutôt
 * qu'un effet de bord — ces durées servent à FACTURER de la main-d'œuvre, RM-97 est une règle
 * d'argent :
 *
 *  1. **Arrondi métier (P-19)** : la seconde brute est arrondie au plus proche multiple de l'unité
 *     choisie (`minute` = 60 s, `dixieme` = 360 s, `quart` = 900 s) — arrondi commercial, la moitié
 *     s'arrondit vers le haut (`Math.round`, qui pour des valeurs positives arrondit toujours vers
 *     `+Infinity`, donc à l'écart de zéro). C'est cette étape qui explique qu'une durée COURTE
 *     (quelques dizaines de secondes) rende `0` avec l'arrondi par défaut du tenant (`quart`,
 *     `parametre_atelier.arrondi_pointage`, migration 0005) : 60 secondes sont plus proches de 0
 *     quart d'heure (0 s) que d'un quart d'heure entier (900 s) — **RÉSULTAT INTENTIONNEL de la
 *     règle P-19**, pas un bug, et désormais verrouillé par des tests aux valeurs limites
 *     ci-dessous plutôt que laissé à l'intuition d'un lecteur pressé.
 *  2. **Conversion en centièmes d'heure (stockage)** : la durée arrondie à l'étape 1, exprimée en
 *     secondes, est reconvertie en centièmes d'heure (`duree_arrondie_centiemes`, colonne entière —
 *     RM-97 exige l'arithmétique financière exacte, jamais de flottant stocké). `dixieme` (360 s =
 *     10 centièmes) et `quart` (900 s = 25 centièmes) tombent TOUJOURS sur un centième entier :
 *     cette seconde conversion n'y arrondit jamais rien de plus, elle ne fait qu'exprimer une valeur
 *     déjà exacte dans une autre unité. `minute` (60 s ≈ 1,667 centième) NE tombe PAS sur un entier
 *     — une minute exacte n'a, par construction, aucune représentation exacte en centièmes d'heure.
 *     Cette étape y applique donc, délibérément, un second `Math.round` (même règle commerciale
 *     qu'à l'étape 1) : c'est un arrondi de CONVERSION D'UNITÉ (imposé par le type de la colonne),
 *     pas un second choix métier — mais il reste réel, documenté ici, et testé aux valeurs limites
 *     (`regles-pointage.spec.ts`) pour qu'aucune lecture ultérieure du code n'ait à le redécouvrir en
 *     production. Conséquence visible : avec `arrondi = 'minute'`, une minute pleine (60 s) rend 2
 *     centièmes (1,2 min affichée), jamais 1,667 — c'est la valeur la plus proche représentable, pas
 *     une perte silencieuse.
 */
export function calculerDureeArrondieCentiemes(
  dureeBruteSecondes: number,
  arrondi: ArrondiPointage,
): number {
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
export function pointageCorrespondEntree(
  existant: LignePointage,
  entree: EntreeDemarragePointage,
): boolean {
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

/* ------------------------------------------------------------------ */
/* GET /pointages/agregats-ligne : temps réellement passé vs temps facturé, par ligne d'OR         */
/* ------------------------------------------------------------------ */

/** Entrée minimale, DB-agnostique, tirée de `ligne_or` — voir `references.ts::chargerLignesOrPourAgregat`. */
export interface LigneOrPourAgregat {
  readonly id: string;
  readonly ordreReparationId: string;
  readonly numeroOrdre: number;
  readonly tempsBaremeCentiemes: number | null;
}

/** Entrée minimale, DB-agnostique, tirée de `pointage` — voir `pointage-requetes.ts::chargerPointagesPourAgregatLigne`. */
export interface PointagePourAgregat {
  readonly ligneOrId: string | null;
  readonly statut: StatutPointage;
  readonly dureeArrondieCentiemes: number | null;
}

/** RM-97 : seuls ces trois statuts portent une `dureeArrondieCentiemes` FIGÉE — `en_cours` n'a pas
 *  encore de fin, sa durée n'existe pas tant qu'il n'est pas arrêté (voir `pointageEnCours` pour le
 *  signaler séparément, sans jamais l'additionner à un total qui doit rester exact). */
const STATUTS_POINTAGE_DUREE_ACQUISE: ReadonlySet<StatutPointage> = new Set([
  'termine',
  'valide',
  'verrouille',
]);

/**
 * Agrège, EN MÉMOIRE (aucune I/O ici, même doctrine que le reste de ce fichier), le temps
 * réellement pointé de chaque ligne face à son temps barémé — `contrats/pointage/agregat-ligne.ts`
 * pour le contrat exposé par `GET /pointages/agregats-ligne`. Une ligne est OMISE du résultat si
 * elle n'a ni temps barémé chiffré ni le moindre pointage (rien à raconter) ; sinon INCLUSE même à
 * zéro (une ligne barémée jamais encore pointée doit apparaître, à `dureePointeeCentiemes: 0` — «
 * pas commencée » est une information, pas une absence de ligne).
 */
export function calculerAgregatsTempsLigne(
  lignes: readonly LigneOrPourAgregat[],
  pointages: readonly PointagePourAgregat[],
): readonly AgregatTempsLigneOr[] {
  const parLigne = new Map<
    string,
    { dureePointeeCentiemes: number; nombrePointages: number; pointageEnCours: boolean }
  >();

  for (const p of pointages) {
    if (!p.ligneOrId) continue;
    const courant = parLigne.get(p.ligneOrId) ?? {
      dureePointeeCentiemes: 0,
      nombrePointages: 0,
      pointageEnCours: false,
    };
    const dureeAcquise = STATUTS_POINTAGE_DUREE_ACQUISE.has(p.statut)
      ? (p.dureeArrondieCentiemes ?? 0)
      : 0;
    parLigne.set(p.ligneOrId, {
      dureePointeeCentiemes: courant.dureePointeeCentiemes + dureeAcquise,
      nombrePointages: courant.nombrePointages + 1,
      pointageEnCours: courant.pointageEnCours || p.statut === 'en_cours',
    });
  }

  return lignes
    .filter((ligne) => ligne.tempsBaremeCentiemes !== null || parLigne.has(ligne.id))
    .slice()
    .sort((a, b) => a.numeroOrdre - b.numeroOrdre)
    .map((ligne): AgregatTempsLigneOr => {
      const agrege = parLigne.get(ligne.id) ?? {
        dureePointeeCentiemes: 0,
        nombrePointages: 0,
        pointageEnCours: false,
      };
      return {
        ligneOrId: ligne.id,
        ordreReparationId: ligne.ordreReparationId,
        dureePointeeCentiemes: agrege.dureePointeeCentiemes,
        nombrePointages: agrege.nombrePointages,
        pointageEnCours: agrege.pointageEnCours,
        tempsBaremeCentiemes: ligne.tempsBaremeCentiemes,
        ecartCentiemes:
          ligne.tempsBaremeCentiemes !== null
            ? agrege.dureePointeeCentiemes - ligne.tempsBaremeCentiemes
            : null,
      };
    });
}

/* ------------------------------------------------------------------ */
/* GET /pointages/dernier-du-jour : cible mémorisée pour « Reprendre » (contrat CibleReprisePointage) */
/* ------------------------------------------------------------------ */

/**
 * `[dateJour]T00:00:00.000Z` → `[dateJour]T23:59:59.999Z` — MÊME CONVENTION que
 * `service-verrouillage-periode.ts::finDeJournee` (RM-95) : bornes calendaires en UTC PUR, pas en
 * fuseau local. LIMITATION CONNUE, DÉJÀ SIGNALÉE LÀ-BAS, PAS RÉINVENTÉE ICI : `parametre_atelier`/
 * `site` ne portent aujourd'hui aucune colonne de fuseau horaire — un pointage démarré entre 22h00
 * et minuit (heure de Zurich, hiver) peut donc tomber côté UTC sur le jour calendaire SUIVANT.
 * Écart d'implémentation assumé, à corriger le jour où un fuseau par site existe ; NE PAS lui
 * substituer localement un calcul en fuseau Europe/Zurich, qui romprait la cohérence avec RM-95 et
 * avec la (future) clôture automatique de fin de journée RM-91/RM-119, qui devra suivre la même
 * convention pour que « journée verrouillée » et « journée encore proposée en reprise » coïncident.
 *
 * PRÉCISION SUR CE QUI EST RÉELLEMENT RÉUTILISÉ : `finDeJournee` (service-verrouillage-periode.ts)
 * n'est PAS exportée (fonction de module privée à son fichier) et prend en entrée un jour DÉJÀ
 * CONNU (`jusquauLe` du corps de requête RM-95), jamais « aujourd'hui ». Cette fonction-ci ne peut
 * donc pas l'importer telle quelle — elle réplique volontairement sa même formule de bornage
 * (`slice(0, 10)` + gabarit ISO) plutôt que d'en inventer une différente, ce qui est la meilleure
 * réutilisation possible sans changer la visibilité d'un fichier hors du périmètre de cette tâche.
 * AUCUN job de clôture automatique de fin de journée (RM-91/RM-119) n'existe à ce jour dans ce
 * dépôt (vérifié : aucun `@Cron`/`@Processor`/BullMQ dans `apps/api/src/pointage/`) — cette
 * fonction est donc la première pièce de code à formaliser « la journée de travail courante » côté
 * serveur, sur la base de la SEULE convention de bornage de jour déjà écrite dans ce module.
 */
export function journeeTravailCourante(maintenant: Date): {
  readonly debutLe: Date;
  readonly finLe: Date;
} {
  const jour = maintenant.toISOString().slice(0, 10);
  return {
    debutLe: new Date(`${jour}T00:00:00.000Z`),
    finLe: new Date(`${jour}T23:59:59.999Z`),
  };
}

/** Entrée minimale, DB-agnostique, tirée de `pointage` + `ordre_reparation` + `ligne_or` — voir
 *  `pointage-requetes.ts::chargerPointagesProductifsDuJour`. Un seul technicien, une seule journée,
 *  jamais plus qu'une poignée de lignes : borné par construction de la requête, pas ici. */
export interface PointageProductifDuJour {
  readonly id: string;
  /** Toujours non nul en pratique (la requête ne charge que `nature IN ('productif_ligne',
   *  'productif_or')`) — type nullable conservé tel quel (miroir de `LignePointage.ordreReparationId`)
   *  plutôt que forcé par un cast : une ligne dont ce serait `null` malgré le filtre SQL est ignorée
   *  défensivement par `resoudreCibleReprise`, jamais supposée impossible. */
  readonly ordreReparationId: string | null;
  readonly ligneOrId: string | null;
  readonly siteId: string;
  readonly debutLe: Date;
  readonly finLe: Date | null;
  readonly statutOr: StatutOrdreReparation;
  /** `null` quand `ligneOrId` est nul (`nature = 'productif_or'`, pas de jointure à faire) — voir
   *  aussi le commentaire de `resoudreCibleReprise` sur le traitement fail-closed d'un `null`
   *  alors que `ligneOrId` EST renseigné (jointure qui n'aurait pas dû échouer). */
  readonly statutLigne: StatutLigneOr | null;
  readonly numeroOr: string;
  readonly designationLigne: string | null;
}

/**
 * `GET /pointages/dernier-du-jour` — résout `CibleReprisePointage | null` à partir de TOUS les
 * pointages productifs du technicien démarrés dans la journée de travail courante (déjà filtrés par
 * la requête appelante, voir `pointage-requetes.ts`), PURE (aucune I/O, testable seule).
 *
 * Règles, DANS CET ORDRE (contrat de la tâche, ne pas réordonner) :
 *  1. Seuls des pointages PRODUCTIFS entrent dans `pointagesDuJour` — une activité indirecte ne
 *     devient jamais la cible ; c'est déjà garanti par la requête SQL appelante, pas re-vérifié ici.
 *  2. Le PLUS RÉCENT (`debutLe` maximal) de la liste, qu'il soit `termine` ou encore `en_cours` —
 *     PAS de repli sur un pointage plus ancien si celui-ci s'avère non pointable (règle 3) : si la
 *     DERNIÈRE chose sur laquelle le technicien a travaillé aujourd'hui n'est plus pointable, la
 *     réponse est `null`, jamais une proposition de reprendre quelque chose de plus ancien que le
 *     technicien a déjà quitté délibérément pour cette raison précise. INTERPRÉTATION RETENUE de
 *     l'énoncé numéroté de la tâche (« dans cet ordre »), signalée : c'est la lecture la plus
 *     littérale, pas un choix arbitraire parmi plusieurs égales.
 *  3. Cible ENCORE pointable au moment de la requête (`estOrPointable`/`estLignePointable`, les
 *     MÊMES prédicats que `demarrer` en écriture — RM-92/RM-93) ; sinon `null`.
 *  4. Hors journée de travail courante → déjà exclu par la requête SQL, jamais vu ici.
 *  5. `cumulSecondesDuJour` = somme des durées BRUTES (secondes, `Math.floor`, RM-97) de TOUS les
 *     segments productifs d'aujourd'hui sur la MÊME cible (même `ligneOrId` si `type === 'ligne'` ;
 *     même `ordreReparationId` ET `ligneOrId === null` si `type === 'or'` — un segment
 *     `productif_ligne` sur une AUTRE ligne du même OR ne compte jamais dans un cumul `type: 'or'`).
 *     Segment encore ouvert inclus, borné à `maintenant`.
 *  6. `ligneOrId` de la réponse est `null` si et seulement si `type === 'or'`.
 *  7. `libelle` = désignation de la ligne, sinon (ligne sans désignation, ou `type === 'or'`) le
 *     numéro de l'OR — `ordre_reparation` ne porte aucune colonne de désignation courte propre
 *     (vérifié : seules `numero`/`clientDesignationFigee` existent), le numéro est donc la seule
 *     valeur candidate.
 */
export function resoudreCibleReprise(
  pointagesDuJour: readonly PointageProductifDuJour[],
  maintenant: Date,
): CibleReprisePointage | null {
  if (pointagesDuJour.length === 0) return null;

  // Tri défensif — la requête appelante trie déjà `debutLe desc`, mais cette fonction pure ne doit
  // pas dépendre silencieusement de l'ordre d'un appelant qu'elle ne contrôle pas.
  const plusRecent = [...pointagesDuJour].sort(
    (a, b) => b.debutLe.getTime() - a.debutLe.getTime(),
  )[0];

  if (!plusRecent || plusRecent.ordreReparationId === null) return null;

  const cibleEncorePointable =
    estOrPointable(plusRecent.statutOr) &&
    (plusRecent.ligneOrId === null ||
      (plusRecent.statutLigne !== null && estLignePointable(plusRecent.statutLigne)));
  if (!cibleEncorePointable) return null;

  const type: CibleReprisePointage['type'] = plusRecent.ligneOrId !== null ? 'ligne' : 'or';
  const ordreReparationId = plusRecent.ordreReparationId;

  const memeCible = pointagesDuJour.filter((p) =>
    type === 'ligne'
      ? p.ligneOrId === plusRecent.ligneOrId
      : p.ordreReparationId === ordreReparationId && p.ligneOrId === null,
  );
  const cumulSecondesDuJour = memeCible.reduce(
    (total, p) => total + dureeBruteSegmentPointage(p.debutLe, p.finLe, maintenant),
    0,
  );

  return {
    type,
    ordreReparationId,
    numeroOr: plusRecent.numeroOr,
    ligneOrId: type === 'ligne' ? plusRecent.ligneOrId : null,
    libelle:
      type === 'ligne' ? (plusRecent.designationLigne ?? plusRecent.numeroOr) : plusRecent.numeroOr,
    siteId: plusRecent.siteId,
    // INTERPRÉTATION RETENUE (voir le commentaire du champ, `contrats/pointage/pointage.ts`) : un
    // dernier segment ENCORE ouvert n'a pas de vraie interruption — `maintenant` comble l'absence de
    // `null` possible sur ce champ du contrat, plutôt que d'inventer une valeur arbitraire.
    interrompuLe: (plusRecent.finLe ?? maintenant).toISOString(),
    cumulSecondesDuJour,
  };
}

/** `Math.floor((fin - debut) / 1000)` — MÊME FORMULE que `mappeurs.ts::dureeBruteDepuisPeriode`,
 *  reprise ici plutôt qu'importée : cette fonction-là retourne `null` pour un segment ouvert (pas de
 *  fin connue), alors qu'un cumul de reprise doit au contraire compter un segment ouvert jusqu'à
 *  `maintenant` (RM-97, « segment en cours inclus » — règle 5 ci-dessus). Deux besoins différents,
 *  même arithmétique brute. */
function dureeBruteSegmentPointage(debutLe: Date, finLe: Date | null, maintenant: Date): number {
  const fin = finLe ?? maintenant;
  return Math.floor((fin.getTime() - debutLe.getTime()) / 1000);
}
