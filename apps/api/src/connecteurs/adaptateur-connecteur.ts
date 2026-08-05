import type {
  ErreurExecutionConnecteur,
  NomInterfaceConnecteur,
  OperationConnecteur,
  ResumeExecutionConnecteur,
} from '@dfa/shared';

/**
 * Port qu'un ADAPTATEUR de connecteur implémente — étape 5, socle d'exécution.
 *
 * CE QUE CE FICHIER N'EST PAS : une promesse de forme définitive pour les quatre interfaces
 * `PartsCatalogProvider` / `VehicleReferenceProvider` / `OrderProvider` / `ListingPublisher`
 * (`NOMS_INTERFACE_CONNECTEUR`, `@dfa/shared`). Ces quatre n'ont, à ce jour, AUCUNE méthode
 * métier figée dans le contrat partagé — `packages/shared/src/contrats/connecteurs/enums.ts`
 * le dit explicitement (RC-20/RC-40/RC-70 marqués `[INCONNU]` dans la spécification) : inventer
 * une méthode par partenaire ICI serait exactement l'erreur que le contrat partagé évite. Ce
 * fichier pose donc le SEUL dénominateur commun déjà entièrement spécifié : le mécanisme
 * générique d'import/export (`contrats/connecteurs/import.ts` et `export.ts`), qui vaut pour
 * les cinq interfaces (`OperationConnecteur`, `nature` en `string` libre — même doctrine que
 * `ReponseExecutionConnecteur.nature`).
 *
 * `AccountingExporter` (`contrats/facturation/export.ts`, `cible`/`capacites`) reste un contrat
 * SÉPARÉ, déjà implémenté pour de vrai par `facturation/export/winbiz/` (hors de mon périmètre
 * d'écriture) : `AdaptateurConnecteur` ne s'y substitue pas, il modélise seulement la présence
 * (ou l'absence) d'un connecteur `AccountingExporter` actif au niveau du REGISTRE générique —
 * voir `adaptateurs-factices/adaptateur-accounting-exporter.factice.ts`.
 *
 * Un futur adaptateur RÉEL implémente cette même interface : le registre (`service-registre-
 * connecteurs.ts`) et l'exécuteur résilient (`resilience/`) ne connaissent que ce port, jamais
 * une classe concrète nommée par partenaire.
 */

/** Entrée générique d'une opération de connecteur — un import ou un export, au sens du
 *  mécanisme déjà contracté (`contrats/connecteurs/import.ts`/`export.ts`). */
export interface RequeteOperationConnecteur {
  readonly operation: OperationConnecteur;
  /** `NatureImportConnecteur` | `NatureExportConnecteur` | une capacité libre (consultation,
   *  transmission) — typé `string` ici, même raison que `ReponseExecutionConnecteur.nature`. */
  readonly nature: string;
  /** L'objet métier concerné, le cas échéant (`RC-46`) — `null`/absent pour un traitement de
   *  masse qui ne porte pas sur un objet unique. */
  readonly objetId?: string | null;
  /**
   * Charge utile de l'opération. JAMAIS journalisée telle quelle (voir `resilience/` : seuls des
   * champs nommément autorisés — tenant, type de connecteur, opération, nature, tentative —
   * atteignent `ServiceJournal`). Un futur adaptateur réel ne doit jamais compter sur ce champ
   * pour transporter un secret : les identifiants du connecteur passent par une référence
   * résolue séparément (`RC-08`), jamais par cette charge utile.
   */
  readonly donnees?: Readonly<Record<string, unknown>>;
}

/** Résultat d'une opération réussie — mêmes formes que le journal d'exécution déjà contracté,
 *  pour qu'un futur `POST /connecteurs/activations/{id}/imports|exports` (hors périmètre ici)
 *  puisse les reprendre telles quelles. */
export interface ResultatOperationConnecteur {
  readonly resume: ResumeExecutionConnecteur;
  readonly erreurs: readonly ErreurExecutionConnecteur[];
}

/**
 * Port implémenté par TOUT adaptateur, factice ou réel. `executer` REJETTE (throw/reject) pour
 * signaler un échec dur (réseau, timeout, erreur du tiers) — c'est `resilience/` qui absorbe ces
 * rejets (délai, réessais, disjoncteur) ; un adaptateur individuel n'implémente lui-même aucune
 * logique de reprise.
 */
export interface AdaptateurConnecteur {
  readonly nomInterface: NomInterfaceConnecteur;
  /** Slug du TYPE de connecteur (`ReponseTypeConnecteur.code`, `schemaCodeConnecteur`) — jamais
   *  un nom de partenaire en dur (règle transversale du domaine, voir `enums.ts`). Les adaptateurs
   *  factices de ce socle utilisent le préfixe `factice_*`, qui n'est PAS un partenaire réel. */
  readonly typeConnecteurCode: string;
  executer(requete: RequeteOperationConnecteur): Promise<ResultatOperationConnecteur>;
}
