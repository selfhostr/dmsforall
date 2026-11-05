/**
 * Lignes brutes (snake_case, telles que rendues par `tx.execute()`) et projections vers les types
 * du contrat partagé (`@dfa/shared`, `contrats/reprise.ts`, gelé). Même doctrine que
 * `common/idempotence/service-idempotence.ts` : alias de type plutôt qu'`interface` (contrainte
 * `Record<string, unknown>` de Drizzle sur `execute<T>`).
 *
 * `bigint`/`bytea` : le pilote `pg` rend un `bigint` Postgres en `string` (au-delà de
 * `Number.MAX_SAFE_INTEGER`, un `number` mentirait silencieusement) — reconverti explicitement où
 * la valeur reste dans l'intervalle sûr (octets/lignes d'un import, toujours borné par
 * `TAILLE_MAX_ARCHIVE_REPRISE_OCTETS` = 60 Go, très inférieur à 2^53). `bytea` rend un `Buffer`.
 */

import type {
  AnomalieAnalyseReprise,
  AnomalieImportReprise,
  ArchiveDeposeeReprise,
  DomaineReprise,
  EcarteParDomaineReprise,
  ElementPlanReprise,
  ExclusionPlanReprise,
  FichierArchiveReprise,
  InsereParDomaineReprise,
  MoteurSourceDetecte,
  ProgressionImportReprise,
  ReconciliationAnneeReprise,
  RapportImportReprise,
  ReponseAnalyseReprise,
  ReponseDossierReprise,
  ReponseImportReprise,
  ReponsePlanReprise,
  StatutAnalyseReprise,
  StatutDossierReprise,
  StatutImportReprise,
  StatutPlanReprise,
  TableDetecteeReprise,
} from '@dfa/shared';
import { SEUIL_ANOMALIES_EMBARQUEES_IMPORT_REPRISE } from '@dfa/shared';

// ---------------------------------------------------------------------------------------------
// dossier_reprise
// ---------------------------------------------------------------------------------------------

export type LigneDossierRepriseBrute = {
  readonly id: string;
  readonly tenant_id: string;
  readonly statut: StatutDossierReprise;
  readonly taille_octets_annoncee: string;
  readonly empreinte_sha256_annoncee: Buffer;
  readonly empreinte_sha256_verifiee: Buffer | null;
  readonly integrite_validee: boolean | null;
  readonly dernier_numero_tranche_recu_contigu: number | null;
  readonly nom_archive_original: string | null;
  readonly stockage_chemin: string;
  readonly purgee_le: string | null;
  readonly annule_le: string | null;
  readonly annule_motif: string | null;
  readonly cree_par_id: string;
  readonly cree_le: string;
  readonly modifie_le: string;
  /** Présentes uniquement quand la requête les projette (jointure) — `null` sinon. */
  readonly analyse_id?: string | null;
  readonly plan_id?: string | null;
  readonly import_id?: string | null;
  /** Somme des tranches reçues — projetée par une sous-requête, jamais un compteur dénormalisé
   *  (voir le service de dépôt : une tranche rejouée ne doit compter qu'une fois). */
  readonly octets_recus?: string;
};

export function projeterDossierReprise(
  ligne: LigneDossierRepriseBrute,
  octetsRecus: number,
): ReponseDossierReprise {
  const archive: ArchiveDeposeeReprise = {
    tailleOctetsAnnoncee: Number(ligne.taille_octets_annoncee),
    octetsRecus,
    dernierNumeroTrancheRecuContigu: ligne.dernier_numero_tranche_recu_contigu,
    empreinteSha256Annoncee: ligne.empreinte_sha256_annoncee.toString('hex'),
    empreinteSha256Verifiee: ligne.empreinte_sha256_verifiee?.toString('hex') ?? null,
    integriteValidee: ligne.integrite_validee,
  };
  return {
    id: ligne.id,
    statut: ligne.statut,
    archive,
    analyseId: ligne.analyse_id ?? null,
    planId: ligne.plan_id ?? null,
    importId: ligne.import_id ?? null,
    creeLe: new Date(ligne.cree_le).toISOString(),
    modifieLe: new Date(ligne.modifie_le).toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// reprise_analyse
// ---------------------------------------------------------------------------------------------

export type LigneRepriseAnalyseBrute = {
  readonly id: string;
  readonly tenant_id: string;
  readonly dossier_reprise_id: string;
  readonly statut: StatutAnalyseReprise;
  readonly partielle: boolean;
  readonly moteur_detecte: MoteurSourceDetecte;
  readonly fichiers: readonly FichierArchiveReprise[];
  readonly tables: readonly TableDetecteeReprise[];
  readonly anomalies: readonly AnomalieAnalyseReprise[];
  readonly demarree_le: string | null;
  readonly terminee_le: string | null;
};

export function projeterAnalyseReprise(ligne: LigneRepriseAnalyseBrute): ReponseAnalyseReprise {
  return {
    id: ligne.id,
    dossierRepriseId: ligne.dossier_reprise_id,
    statut: ligne.statut,
    partielle: ligne.partielle,
    moteurDetecte: ligne.moteur_detecte,
    fichiers: ligne.fichiers,
    tables: ligne.tables,
    anomalies: ligne.anomalies,
    demarreeLe: ligne.demarree_le ? new Date(ligne.demarree_le).toISOString() : null,
    termineeLe: ligne.terminee_le ? new Date(ligne.terminee_le).toISOString() : null,
  };
}

// ---------------------------------------------------------------------------------------------
// reprise_plan
// ---------------------------------------------------------------------------------------------

export type LigneReprisePlanBrute = {
  readonly id: string;
  readonly tenant_id: string;
  readonly dossier_reprise_id: string;
  readonly analyse_id: string;
  readonly statut: StatutPlanReprise;
  readonly elements: readonly ElementPlanReprise[];
  readonly exclusions: readonly ExclusionPlanReprise[];
  readonly propose_le: string;
  readonly valide_le: string | null;
  readonly valide_par_utilisateur_id: string | null;
};

export function projeterPlanReprise(ligne: LigneReprisePlanBrute): ReponsePlanReprise {
  return {
    id: ligne.id,
    dossierRepriseId: ligne.dossier_reprise_id,
    analyseId: ligne.analyse_id,
    statut: ligne.statut,
    elements: ligne.elements,
    exclusions: ligne.exclusions,
    proposeLe: new Date(ligne.propose_le).toISOString(),
    valideLe: ligne.valide_le ? new Date(ligne.valide_le).toISOString() : null,
    valideParUtilisateurId: ligne.valide_par_utilisateur_id,
  };
}

// ---------------------------------------------------------------------------------------------
// reprise_import
// ---------------------------------------------------------------------------------------------

export type LigneRepriseImportBrute = {
  readonly id: string;
  readonly tenant_id: string;
  readonly dossier_reprise_id: string;
  readonly plan_id: string;
  readonly statut: StatutImportReprise;
  readonly domaine_courant: DomaineReprise | null;
  readonly elements_traites: string;
  readonly elements_total: string;
  readonly tentative: number;
  readonly demarre_le: string | null;
  readonly termine_le: string | null;
};

export function projeterImportReprise(ligne: LigneRepriseImportBrute): ReponseImportReprise {
  const progression: ProgressionImportReprise = {
    elementsTraites: Number(ligne.elements_traites),
    elementsTotal: Number(ligne.elements_total),
  };
  return {
    id: ligne.id,
    dossierRepriseId: ligne.dossier_reprise_id,
    planId: ligne.plan_id,
    statut: ligne.statut,
    domaineCourant: ligne.domaine_courant,
    progression,
    tentative: ligne.tentative,
    demarreLe: ligne.demarre_le ? new Date(ligne.demarre_le).toISOString() : null,
    termineLe: ligne.termine_le ? new Date(ligne.termine_le).toISOString() : null,
  };
}

// ---------------------------------------------------------------------------------------------
// reprise_rapport
// ---------------------------------------------------------------------------------------------

export type LigneRepriseRapportBrute = {
  readonly id: string;
  readonly tenant_id: string;
  readonly dossier_reprise_id: string;
  readonly import_id: string;
  readonly insere: readonly InsereParDomaineReprise[];
  readonly ecarte: readonly EcarteParDomaineReprise[];
  readonly anomalies: readonly AnomalieImportReprise[];
  readonly anomalies_total: number;
  readonly reconciliation: readonly ReconciliationAnneeReprise[];
  readonly genere_le: string;
};

export function projeterRapportReprise(ligne: LigneRepriseRapportBrute): RapportImportReprise {
  return {
    importId: ligne.import_id,
    insere: ligne.insere,
    ecarte: ligne.ecarte,
    anomalies: ligne.anomalies,
    anomaliesTronquees: ligne.anomalies_total > SEUIL_ANOMALIES_EMBARQUEES_IMPORT_REPRISE,
    reconciliation: ligne.reconciliation,
    genereLe: new Date(ligne.genere_le).toISOString(),
  };
}
