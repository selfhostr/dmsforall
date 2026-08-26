/**
 * Génération du plan proposé à partir de l'analyse — fonction PURE, testée sans base ni port de
 * lecture. Un seul levier client existe (`ElementPlanReprise.inclus`, PATCH .../plan) : cette
 * fonction ne fait que PROPOSER un premier état, jamais le dernier mot.
 *
 * AMBIGUÏTÉ SIGNALÉE (pas tranchée ici, faute de spécification) : `PerimetreReprise`
 * (`contrats/reprise.ts`) est une liste GELÉE de QUATRE valeurs, chacune tenant explicitement à
 * une décision D-29→D-34 (OR détail 24 mois, en-têtes documents 10 ans, soldes comptables ouverts,
 * scans rattachés) — aucune des quatre ne décrit un périmètre temporel pour les données de
 * RÉFÉRENCE (clients, véhicules, articles, fournisseurs, paiements), qui n'ont normalement AUCUNE
 * borne temporelle propre. Faute d'une cinquième valeur de périmètre pour ces domaines (le champ
 * n'est pas nullable côté contrat), ce module leur attribue PAR DÉFAUT `entetes_totaux_tva_10_ans`
 * — la valeur la plus proche d'« aucune restriction temporelle » parmi les quatre disponibles —
 * SANS AFFIRMER que c'est la bonne réponse métier : à confirmer avec `expert-metier`/le contrat.
 */

import type {
  DomaineReprise,
  ElementPlanReprise,
  ExclusionPlanReprise,
  MotifExclusionPlanReprise,
  PerimetreReprise,
  RoleTableReprise,
  TableDetecteeReprise,
} from '@dfa/shared';
import { randomUUID } from 'node:crypto';

const DOMAINE_PAR_ROLE: Readonly<Partial<Record<RoleTableReprise, DomaineReprise>>> = {
  clients: 'clients',
  vehicules: 'vehicules',
  ordres_reparation: 'ordres_reparation',
  lignes_ordre_reparation: 'ordres_reparation',
  documents_vente: 'documents_vente',
  lignes_document_vente: 'documents_vente',
  paiements: 'paiements',
  articles_stock: 'articles_stock',
  fournisseurs: 'fournisseurs',
  index_documents_scannes: 'documents_scannes',
};

const PERIMETRE_PAR_ROLE: Readonly<Partial<Record<RoleTableReprise, PerimetreReprise>>> = {
  ordres_reparation: 'detail_24_mois_glissants_et_ouverts',
  lignes_ordre_reparation: 'detail_24_mois_glissants_et_ouverts',
  documents_vente: 'entetes_totaux_tva_10_ans',
  lignes_document_vente: 'entetes_totaux_tva_10_ans',
  index_documents_scannes: 'documents_scannes_rattaches',
};
const PERIMETRE_DEFAUT: PerimetreReprise = 'entetes_totaux_tva_10_ans';

const SEUIL_CONFIANCE_MINIMUM = 40;

export interface ResultatGenerationPlanReprise {
  readonly elements: readonly ElementPlanReprise[];
  readonly exclusions: readonly ExclusionPlanReprise[];
}

export function genererPlanDepuisTables(
  tables: readonly TableDetecteeReprise[],
  tablesRattacheesParIndex: ReadonlySet<string> = new Set(),
): ResultatGenerationPlanReprise {
  const elements: ElementPlanReprise[] = [];
  const exclusions: ExclusionPlanReprise[] = [];

  const meilleureParRole = new Map<RoleTableReprise, TableDetecteeReprise>();
  for (const table of tables) {
    const actuelle = meilleureParRole.get(table.roleDeduit);
    if (!actuelle || table.indiceConfiance > actuelle.indiceConfiance) {
      meilleureParRole.set(table.roleDeduit, table);
    }
  }

  for (const table of tables) {
    const exclusionFixe = motifExclusionFixe(table);
    if (exclusionFixe) {
      exclusions.push({ tableDetecteeId: table.id, motif: exclusionFixe });
      continue;
    }

    if (table.nombreLignes === 0) {
      exclusions.push({ tableDetecteeId: table.id, motif: 'table_vide' });
      continue;
    }

    if (table.roleDeduit === 'index_documents_scannes' && !tablesRattacheesParIndex.has(table.id)) {
      exclusions.push({ tableDetecteeId: table.id, motif: 'document_non_rattachable' });
      continue;
    }

    if (table.indiceConfiance < SEUIL_CONFIANCE_MINIMUM) {
      exclusions.push({
        tableDetecteeId: table.id,
        motif: 'role_indetermine',
        donnees: { indiceConfiance: table.indiceConfiance },
      });
      continue;
    }

    const meilleure = meilleureParRole.get(table.roleDeduit);
    if (meilleure && meilleure.id !== table.id) {
      exclusions.push({
        tableDetecteeId: table.id,
        motif: 'doublon_table_meme_role',
        donnees: { tableRetenueId: meilleure.id },
      });
      continue;
    }

    const domaine = DOMAINE_PAR_ROLE[table.roleDeduit];
    if (!domaine) {
      exclusions.push({ tableDetecteeId: table.id, motif: 'role_indetermine' });
      continue;
    }

    elements.push({
      id: randomUUID(),
      domaine,
      tableDetecteeId: table.id,
      perimetre: PERIMETRE_PAR_ROLE[table.roleDeduit] ?? PERIMETRE_DEFAUT,
      volumeAttenduLignes: table.nombreLignes,
      inclus: true,
      ajustable: true,
    });
  }

  return { elements, exclusions };
}

/**
 * Garde-fou de bon sens (défaut réel du 25.08.2026) : un plan sans AUCUN élément inclus ne doit
 * jamais être validé silencieusement — `ServicePlanReprise.valider()` transitionne dans le MÊME
 * GESTE vers `import_en_cours` (§ tête de `contrats/reprise.ts`), et un import qui ne traite aucun
 * élément inclus se termine « avec succès » sans avoir rien écrit : le pire des retours pour un
 * garagiste qui vient de confier son archive. Couvre les DEUX origines possibles d'un plan vide :
 * aucun élément généré par l'analyse (0 table exploitable, ou — précisément le défaut du
 * 25.08.2026 — un bug d'échelle qui exclut tout), ET un plan dont le garagiste a manuellement
 * décoché tous les éléments via `PATCH .../plan` avant de valider.
 */
export function planSansElementInclus(elements: readonly ElementPlanReprise[]): boolean {
  return !elements.some((e) => e.inclus);
}

function motifExclusionFixe(table: TableDetecteeReprise): MotifExclusionPlanReprise | null {
  if (table.roleDeduit === 'referentiel_constructeur')
    return 'referentiel_constructeur_jamais_repris';
  if (table.roleDeduit === 'comptabilite_generale') return 'comptabilite_non_reprise';
  if (table.roleDeduit === 'inconnu') return 'role_indetermine';
  return null;
}
