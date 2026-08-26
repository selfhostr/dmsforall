import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../../db';
import type { PortLecteurArchiveReprise } from '../lecture/port-lecteur-archive-reprise';
import type { PortStockageArchiveReprise } from '../depot/stockage-archive-reprise';
import type { ServiceCycleVieDossierReprise } from '../service-cycle-vie-dossier-reprise';
import type { LigneTable } from '../lecteurs/types';
import type { ElementPlanReprise, TableDetecteeReprise } from '@dfa/shared';

import { ServiceImportReprise } from './service-import-reprise';

/**
 * Preuve STRUCTURELLE du découpage (défaut réel du 26.08.2026, § tête de
 * `service-import-reprise.ts` : une transaction Postgres tenue ouverte pendant une lecture
 * disque/sous-processus se fait tuer par `idle_in_transaction_session_timeout`, l'erreur socket
 * remonte en `uncaughtException` PROCESS-WIDE — toute l'API meurt, tous tenants confondus).
 *
 * Le défaut est une COURSE (timing Postgres réel) — difficile et fragile à reproduire fidèlement
 * en test unitaire (même doctrine que `common/concurrence/ceder-controle-event-loop.spec.ts` pour
 * la famine d'event loop : on prouve le MÉCANISME, pas la course elle-même). Ce que ce fichier
 * prouve à la place, en exécution déterministe (dépendances injectées, aucun accès disque/base
 * réel) : PENDANT tout `executer()`, aucun appel de LECTURE DE SOURCE
 * (`extraireEtInventorier`/`detecterFamille`/`lireLignes`) ne se produit alors qu'une transaction
 * (`AccesBase.enTenant`) est ouverte — le fake `acces.enTenant` ci-dessous instrumente une
 * PROFONDEUR de transaction ouverte, incrémentée à l'entrée et décrémentée à la sortie de CHAQUE
 * appel, et chaque méthode de lecture du `lecteur` factice enregistre cette profondeur au moment
 * précis où elle est invoquée.
 *
 * Scénario : les trois domaines concrets (`clients` -> `vehicules` -> `documents_vente`), pour
 * exercer TOUTES les branches d'écriture de `ecrireElementDomaine` (et donc toutes les
 * transactions courtes qu'il ouvre — une pour `clients`, deux pour `vehicules`, une pour
 * `documents_vente`, plus la progression après chacune), pas seulement le chemin le plus simple.
 */

function texteRequete(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((c) => {
      // Seuls les « morceaux » textuels du template (`StringChunk`, `{ value: string[] }`)
      // portent du texte SQL littéral — tout le reste (paramètres liés : chaînes, `null`,
      // nombres, objets `Param`...) est une VALEUR, jamais un fragment de requête.
      if (c !== null && typeof c === 'object' && Array.isArray((c as { value?: unknown }).value)) {
        return ((c as { value: unknown[] }).value as string[]).join('');
      }
      return '';
    })
    .join(' ');
}

interface AccesFactice {
  readonly acces: AccesBase;
  readonly enTransaction: () => boolean;
  readonly nombreTransactions: () => number;
}

function accesFactice(executerSql: (texte: string) => { rows: readonly unknown[] }): AccesFactice {
  let profondeur = 0;
  let compteur = 0;
  const tx: TransactionDfa = {
    execute: (async (query: unknown) =>
      executerSql(texteRequete(query))) as TransactionDfa['execute'],
  } as unknown as TransactionDfa;

  const acces: AccesBase = {
    async enTenant<T>(
      _ctx: ContexteTenant,
      travail: (tx: TransactionDfa) => Promise<T>,
    ): Promise<T> {
      profondeur += 1;
      compteur += 1;
      try {
        return await travail(tx);
      } finally {
        profondeur -= 1;
      }
    },
  } as unknown as AccesBase;

  return { acces, enTransaction: () => profondeur > 0, nombreTransactions: () => compteur };
}

function ligne(index: number, valeurs: Record<string, string | number>): LigneTable {
  return { index, valeurs };
}

describe("ServiceImportReprise.executer — aucune lecture de source à l'intérieur d'une transaction", () => {
  it('extraireEtInventorier/detecterFamille/lireLignes se produisent TOUJOURS hors transaction, sur les trois domaines concrets', async () => {
    const racine = '/app/uploads/reprise-extraction';
    const ancienRepertoire = `${racine}/extrait-ancien`;
    const nouveauRepertoire = `${racine}/extrait-frais`;

    const tableClients: TableDetecteeReprise = {
      id: 'table-clients',
      fichierChemin: `${ancienRepertoire}/KUNDEN.dbf`,
      nomTechnique: 'KUNDEN',
      roleDeduit: 'clients',
      indiceConfiance: 90,
      motifsDeduction: [],
      nombreLignes: 1,
      periodeCouverte: null,
      constatsQualite: [],
    };
    const tableVehicules: TableDetecteeReprise = {
      ...tableClients,
      id: 'table-vehicules',
      fichierChemin: `${ancienRepertoire}/FAHRZEUG.dbf`,
      nomTechnique: 'FAHRZEUG',
      roleDeduit: 'vehicules',
    };
    const tableDocuments: TableDetecteeReprise = {
      ...tableClients,
      id: 'table-documents',
      fichierChemin: `${ancienRepertoire}/RECHNUNG.dbf`,
      nomTechnique: 'RECHNUNG',
      roleDeduit: 'documents_vente',
    };

    const elementClients: ElementPlanReprise = {
      id: 'element-clients',
      domaine: 'clients',
      tableDetecteeId: 'table-clients',
      perimetre: 'entetes_totaux_tva_10_ans',
      volumeAttenduLignes: 1,
      inclus: true,
      ajustable: true,
    };
    const elementVehicules: ElementPlanReprise = {
      ...elementClients,
      id: 'element-vehicules',
      domaine: 'vehicules',
      tableDetecteeId: 'table-vehicules',
    };
    const elementDocuments: ElementPlanReprise = {
      ...elementClients,
      id: 'element-documents',
      domaine: 'documents_vente',
      tableDetecteeId: 'table-documents',
    };

    const evenementsLecture: { methode: string; enTransaction: boolean }[] = [];

    const { acces, enTransaction } = accesFactice((texte) => {
      if (texte.includes('reprise_plan')) {
        return {
          rows: [
            {
              id: 'plan-1',
              tenant_id: 't1',
              dossier_reprise_id: 'd1',
              analyse_id: 'analyse-1',
              statut: 'valide',
              elements: [elementClients, elementVehicules, elementDocuments],
              exclusions: [],
              propose_le: new Date().toISOString(),
              valide_le: new Date().toISOString(),
              valide_par_utilisateur_id: 'u1',
            },
          ],
        };
      }
      if (texte.includes('reprise_analyse')) {
        return {
          rows: [
            {
              id: 'analyse-1',
              tenant_id: 't1',
              dossier_reprise_id: 'd1',
              statut: 'terminee',
              partielle: false,
              moteur_detecte: { famille: 'foxpro_dbf', indiceConfiance: 80 },
              fichiers: [],
              tables: [tableClients, tableVehicules, tableDocuments],
              anomalies: [],
              demarree_le: new Date().toISOString(),
              terminee_le: new Date().toISOString(),
            },
          ],
        };
      }
      if (texte.includes('insert into public.client')) {
        return { rows: [{ id: 'client-1' }] };
      }
      if (texte.includes('public.vehicule_plaque') || texte.includes('public.vehicule_detention')) {
        return { rows: [] };
      }
      if (texte.includes('public.vehicule (')) {
        return { rows: [{ id: 'vehicule-1' }] };
      }
      if (texte.includes('select id from public.site')) {
        return { rows: [{ id: 'site-1' }] };
      }
      if (texte.includes('insert into public.document_vente')) {
        return { rows: [{ id: 'document-1' }] };
      }
      if (texte.includes('update public.document_vente')) {
        return { rows: [] };
      }
      if (texte.includes('elements_traites::text as total')) {
        return { rows: [{ total: '0' }] };
      }
      if (texte.includes('set elements_traites')) {
        return { rows: [] };
      }
      if (texte.includes('insert into public.reprise_rapport')) {
        return { rows: [] };
      }
      if (texte.includes("statut = 'en_cours'")) {
        return { rows: [] };
      }
      if (texte.includes('select * from public.reprise_import')) {
        return {
          rows: [
            {
              id: 'import-1',
              tenant_id: 't1',
              dossier_reprise_id: 'd1',
              plan_id: 'plan-1',
              statut: 'en_cours',
              domaine_courant: null,
              elements_traites: '0',
              elements_total: '3',
              tentative: 1,
              demarre_le: new Date().toISOString(),
              termine_le: null,
            },
          ],
        };
      }
      if (texte.includes('update public.reprise_import') && texte.includes('termine_le = now()')) {
        return { rows: [] };
      }
      throw new Error(`requête non simulée dans ce test : ${texte}`);
    });

    const stockage: PortStockageArchiveReprise = {
      cheminAbsoluArchive: vi.fn(async (chemin: string) => chemin),
    } as unknown as PortStockageArchiveReprise;

    const lignesParFichier: Record<string, LigneTable[]> = {
      [`${nouveauRepertoire}/KUNDEN.dbf`]: [ligne(0, { id: '1', nom: 'Dupont' })],
      [`${nouveauRepertoire}/FAHRZEUG.dbf`]: [
        ligne(0, { id: '10', marque: 'VW', modele: 'Golf', client_id: '1' }),
      ],
      [`${nouveauRepertoire}/RECHNUNG.dbf`]: [
        ligne(0, { id: '100', client_id: '1', total_ttc: 150, date: '2024-01-01' }),
      ],
    };

    const lecteur: PortLecteurArchiveReprise = {
      extraireEtInventorier: vi.fn(async () => {
        evenementsLecture.push({
          methode: 'extraireEtInventorier',
          enTransaction: enTransaction(),
        });
        return { repertoire: nouveauRepertoire, fichiers: [] };
      }),
      purgerRepertoireExtrait: vi.fn(async () => undefined),
      detecterFamille: vi.fn(async () => {
        evenementsLecture.push({ methode: 'detecterFamille', enTransaction: enTransaction() });
        return { famille: 'foxpro_dbf', fichiersPertinents: [], raison: 'test' };
      }),
      choisirCopieFaisantFoi: vi.fn(async () => null),
      listerTables: vi.fn(async () => []),
      evaluerRole: vi.fn(),
      profilerColonnes: vi.fn(async () => []),
      detecterLiens: vi.fn(async () => []),
      // eslint-disable-next-line @typescript-eslint/require-await
      lireLignes: async function* (cheminFichier: string) {
        evenementsLecture.push({
          methode: `lireLignes:${cheminFichier}`,
          enTransaction: enTransaction(),
        });
        for (const l of lignesParFichier[cheminFichier] ?? []) yield l;
      } as PortLecteurArchiveReprise['lireLignes'],
      compterLignes: vi.fn(async () => 0),
    } as unknown as PortLecteurArchiveReprise;

    const cycleVie = {
      ligneBrute: vi.fn(async () => ({ stockage_chemin: '/some/archive.zip' }) as never),
      transiter: vi.fn(async () => undefined),
    } as unknown as ServiceCycleVieDossierReprise;

    const file = { add: vi.fn() } as never;

    const service = new ServiceImportReprise(acces, stockage, lecteur, file, cycleVie);

    await service.executer({ tenantId: 't1', utilisateurId: null, requeteId: 'req-1' }, 'd1');

    // Les trois lectures de source ont bien eu lieu (le scénario exerce réellement le chemin, pas
    // un mock qui ne serait jamais appelé).
    expect(evenementsLecture.map((e) => e.methode)).toEqual([
      'extraireEtInventorier',
      'detecterFamille',
      `lireLignes:${nouveauRepertoire}/KUNDEN.dbf`,
      `lireLignes:${nouveauRepertoire}/FAHRZEUG.dbf`,
      `lireLignes:${nouveauRepertoire}/RECHNUNG.dbf`,
    ]);

    // LA preuve structurelle : AUCUNE de ces lectures ne s'est produite pendant qu'une transaction
    // était ouverte.
    for (const evenement of evenementsLecture) {
      expect(evenement.enTransaction, `${evenement.methode} appelée en transaction`).toBe(false);
    }

    // Chemin rebasé sur le NOUVEAU répertoire d'extraction (second défaut corrigé dans la même
    // passe) — jamais l'ancien chemin périmé persisté par l'analyse.
    expect(Object.keys(lignesParFichier).every((c) => c.startsWith(nouveauRepertoire))).toBe(true);
  });
});
