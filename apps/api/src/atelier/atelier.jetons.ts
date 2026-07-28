import type { TransactionDfa } from '../db';

/**
 * Jetons d'injection propres au module `atelier` (contrat gelé lot 1, plan-lot1-execution.md §6.2).
 *
 * Règle anti-cycle (§6.2) : le port est déclaré par le CONSOMMATEUR, jamais par le fournisseur.
 * `atelier` déclare ici tout ce dont il a besoin depuis des modules qu'il ne doit jamais importer
 * nommément — aucun `forwardRef` dans le produit.
 *
 * `JETON_COMPTEURS` (numérotation, RM-49) N'EST PAS déclaré ici : `parametrage/compteurs/` (L1-07)
 * l'a livré pendant l'écriture de ce module — `ServiceCompteurs`/`ClefCompteur`, importés
 * directement depuis `../parametrage/compteurs/compteurs.jetons` et `.../compteurs.types` par
 * `service-or.ts`. Sa forme réelle (numéro entier brut par clé `(tenant, typeDocument, annee,
 * siteId)`, formatage `OR-2026-1042` laissé à `atelier`) diffère de la signature `{typeDocument,
 * siteId, le} -> string` esquissée par `plan-lot1-execution.md` §6.3 — c'est le fichier livré qui
 * fait foi, pas le plan.
 *
 * Les réglages de `parametre_atelier` (kmEntreeObligatoire, controleQualite, …) ne passent PAS non
 * plus par un jeton `JETON_PARAMETRES_ATELIER` : `parametre_atelier` est une table de configuration
 * ordinaire du schéma Drizzle partagé (`db/schema/atelier/parametrage.ts`, une ligne par tenant),
 * lue directement par `references.ts` — même doctrine que `vehicules/vehicule-requetes.ts`, qui lit
 * `ordre_reparation`/`client` sans passer par un port applicatif. Un jeton n'a de sens que pour un
 * comportement qu'une lecture de table ne peut pas exprimer (numérotation atomique, publication
 * d'événement, idempotence, audit) — un réglage n'en fait pas partie.
 */

/* ------------------------------------------------------------------ */
/* JETON_LECTURE_POINTAGE — déclaré et fourni (impl. vide) par AtelierModule au lot 1            */
/* ------------------------------------------------------------------ */

export const JETON_LECTURE_POINTAGE = Symbol.for('DFA_LECTURE_POINTAGE');

/** I-09 : un pointage ouvert bloquant une transition. */
export interface PointageOuvert {
  readonly pointageId: string;
  readonly technicienId: string;
  readonly technicienNomAffiche: string;
  readonly debutLe: Date;
  readonly ligneOrId: string | null;
}

/**
 * Port déclaré par `atelier`, implémenté vide par `AtelierModule` lui-même au lot 1 (le module
 * `pointage` n'existe pas — Δ4 du plan d'exécution), et par `PointageModule` au lot 2.
 * `tx` en premier paramètre : les gardes I-09/RM-71 s'évaluent DANS la transaction qui fait la
 * transition, jamais sur un état périmé.
 */
export interface LecturePointage {
  pointagesOuvertsPourOr(tx: TransactionDfa, orId: string): Promise<readonly PointageOuvert[]>;
  lignesAvecTempsPointe(tx: TransactionDfa, ligneIds: readonly string[]): Promise<ReadonlySet<string>>;
}

/** Implémentation vide (lot 1) : jamais de pointage ouvert, jamais de temps pointé sur une ligne. */
export class LecturePointageVide implements LecturePointage {
  async pointagesOuvertsPourOr(): Promise<readonly PointageOuvert[]> {
    return [];
  }

  async lignesAvecTempsPointe(): Promise<ReadonlySet<string>> {
    return new Set();
  }
}

/* ------------------------------------------------------------------ */
/* JETON_CALCUL_LIGNE — déclaré par le consommateur (atelier), fourni par MontantsModule (L1-14)  */
/* ------------------------------------------------------------------ */

/**
 * `atelier/montants/**` est hors périmètre de ce module (propriété expert-facturation, L1-14,
 * livré en parallèle dans la même vague C). Signature reprise À L'IDENTIQUE de
 * `plan-lot1-execution.md` §6.3 : si `atelier/montants/montants.jetons.ts` choisit un autre nom de
 * registre `Symbol.for`, l'injection se rebranchera correctement le jour où `AtelierModule`
 * importera `MontantsModule` — seule cette constante devra alors être alignée sur celle réellement
 * exportée par `montants/`.
 */
export const JETON_CALCUL_LIGNE = Symbol.for('DFA_CALCUL_LIGNE');

export interface EntreeCalculLigne {
  readonly type: string;
  readonly quantiteMillieme: number;
  readonly prixUnitaireCentimes: number | null;
  readonly tempsBaremeCentiemes: number | null;
  readonly tauxHoraireCentimes: number | null;
  readonly rabaisPourmille: number;
  readonly tauxTvaPourmille: number;
}

export interface MontantsLigne {
  readonly montantHtCentimes: number;
  readonly montantTvaCentimes: number;
  readonly montantTtcCentimes: number;
}

export interface CalculLigne {
  /** Pure, sans I/O. Ordre gelé : brut -> rabais -> arrondi centime -> TVA -> arrondi -> agrégation. */
  calculer(e: EntreeCalculLigne): MontantsLigne;
  totaliser(l: readonly MontantsLigne[]): MontantsLigne;
}
