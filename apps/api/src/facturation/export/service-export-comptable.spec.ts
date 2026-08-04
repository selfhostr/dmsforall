import { describe, expect, it, vi } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import type { EntreeLancerExport } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../db';
import {
  documentVente,
  ligneDocument,
  documentVenteTva,
  site,
  paiement,
  imputationPaiement,
} from '../../db/schema';
import type { LigneDocumentVente } from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs';
import { FiltreProbleme } from '../../common/erreurs/filtre-probleme';
import type { ServiceIdempotence } from '../../common/idempotence';

/**
 * Preuve ciblée du correctif : les 14 `throw new ErreurMetier(...)` de ce service portaient leur
 * message précis dans l'argument positionnel `message` (→ `Error.message`, jamais relu par
 * `FiltreProbleme`) au lieu de l'option `detail` (→ `ProblemeDetail.detail`, exposée au client —
 * voir `filtre-probleme.ts:106-112`). Ce fichier prouve le cas EXPORT_MAPPING_INCOMPLET, celui
 * signalé (le comptable ne savait pas quel compte configurer), en exerçant le VRAI `FiltreProbleme`
 * (pas un mock du filtre) — même doctrine que le reste de la suite `facturation/` : n'affirmer que
 * ce qui est mesuré en exécution.
 *
 * Toute la chaîne base de données est simulée (même patron que `paiements/imputations.spec.ts` et
 * `documents/service-emission.spec.ts` : fonctions/transaction MOQUÉES, cœur métier réel) — ce
 * service n'a pas de test colocalisé avant ce correctif.
 */

vi.mock('./continuite/verification-continuite', () => ({
  verifierContinuiteNumerotation: vi.fn(async () => undefined),
}));

vi.mock('./ecritures/construction-ecriture', () => ({
  construireEcritureDocument: vi.fn(() => ({
    succes: false,
    manquants: [{ type: 'compte', usage: 'tva_due', categorie: '8.1', documentNumero: 'F-000123' }],
  })),
}));

vi.mock('./mapping/chargement-mapping', () => ({
  chargerCodesTva: vi.fn(async () => new Map()),
  chargerComptesResolusADate: vi.fn(async () => ({})),
}));

import { ServiceExportComptable } from './service-export-comptable';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const CLE_IDEMPOTENCE = '22222222-2222-4222-8222-222222222222';

function candidatFixture(): LigneDocumentVente {
  return {
    id: 'doc-1',
    tenantId: 'tenant-a',
    siteId: 'site-1',
    typeDocument: 'facture',
    statut: 'emis',
    numero: 'F-000123',
    numeroSequence: 123,
    exercice: 2026,
    dateDocument: '2026-08-01',
    clientId: 'client-1',
    devise: 'CHF',
  } as unknown as LigneDocumentVente;
}

/** Fausse transaction : chaque `select().from(table).where(...)` sert les lignes enregistrées pour
 *  `table` (identité d'objet — mêmes singletons `db/schema` que ceux importés par le service),
 *  `.orderBy(...)` étant un no-op supplémentaire sur la même promesse. */
function txFactice(candidats: readonly LigneDocumentVente[]): TransactionDfa {
  const rowsParTable = new Map<unknown, readonly unknown[]>([
    [documentVente, candidats],
    [ligneDocument, []],
    [documentVenteTva, []],
    [site, []],
    [paiement, []],
    [imputationPaiement, []],
  ]);
  const select = () => ({
    from: (table: unknown) => ({
      where: (..._conditions: unknown[]) => {
        const rows = rowsParTable.get(table) ?? [];
        const promesse = Promise.resolve(rows) as Promise<readonly unknown[]> & {
          orderBy: (...args: unknown[]) => Promise<readonly unknown[]>;
        };
        promesse.orderBy = () => Promise.resolve(rows);
        return promesse;
      },
    }),
  });
  return { select } as unknown as TransactionDfa;
}

function idempotenceFactice(tx: TransactionDfa): ServiceIdempotence {
  return {
    executer: async (
      _ctx: ContexteTenant,
      _requete: unknown,
      travail: (tx: TransactionDfa) => Promise<unknown>,
    ) => {
      const corps = await travail(tx);
      return { rejoue: false as const, corps };
    },
  } as unknown as ServiceIdempotence;
}

/** Capture la réponse produite par le VRAI `FiltreProbleme` pour une exception donnée — même
 *  patron minimal de `ArgumentsHost`/`Response` que `filtre-probleme.spec.ts`. */
function corpsProduitParLeFiltre(exception: unknown): { statut: number; corps: unknown } {
  let statut = 0;
  let corps: unknown;
  const reponse = {
    status(s: number) {
      statut = s;
      return this;
    },
    contentType() {
      return this;
    },
    setHeader() {
      return this;
    },
    json(c: unknown) {
      corps = c;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => reponse,
      getRequest: () => ({ route: undefined, method: 'POST' }),
    }),
  } as unknown as ArgumentsHost;

  const contexteFactice = { actuelOuNull: () => null };
  const journalFactice = { error: () => undefined, warn: () => undefined };
  const filtre = new FiltreProbleme(contexteFactice as never, journalFactice as never);
  filtre.catch(exception, host);
  return { statut, corps };
}

describe('ServiceExportComptable.lancer — EXPORT_MAPPING_INCOMPLET expose son detail', () => {
  const entree: EntreeLancerExport = {
    cible: 'winbiz',
    periodeDu: '2026-08-01',
    periodeAu: '2026-08-31',
  };

  it("l'exception ErreurMetier levée porte le message précis dans `detail`, pas seulement dans `.message`", async () => {
    const tx = txFactice([candidatFixture()]);
    const service = new ServiceExportComptable(idempotenceFactice(tx), {} as never, {} as never);

    let capturee: ErreurMetier | undefined;
    try {
      await service.lancer(CTX, entree, CLE_IDEMPOTENCE);
    } catch (e) {
      capturee = e as ErreurMetier;
    }

    expect(capturee).toBeInstanceOf(ErreurMetier);
    expect(capturee?.code).toBe('EXPORT_MAPPING_INCOMPLET');
    // Le cœur du correctif : `detail` n'est plus `undefined`, et porte le texte précis
    // (nomme le mapping manquant, MD-86 : « à remplir avec la fiduciaire »).
    expect(capturee?.detail).toBeDefined();
    expect(capturee?.detail).toContain('mapping_compte manquant');
    expect(capturee?.detail).toContain('tva_due');
    expect(capturee?.detail).toContain('F-000123');
    // Le message positionnel reste porteur du même contenu (log technique interne) — inchangé par
    // le correctif, seul le ROUTAGE vers `detail` était manquant.
    expect(capturee?.message).toContain('mapping_compte manquant');
  });

  it('le VRAI FiltreProbleme (celui qui construit la réponse HTTP problem+json) expose ce detail au client — pas seulement `.message`', async () => {
    const tx = txFactice([candidatFixture()]);
    const service = new ServiceExportComptable(idempotenceFactice(tx), {} as never, {} as never);

    let capturee: unknown;
    try {
      await service.lancer(CTX, entree, CLE_IDEMPOTENCE);
    } catch (e) {
      capturee = e;
    }
    expect(capturee).toBeInstanceOf(ErreurMetier);

    const { statut, corps } = corpsProduitParLeFiltre(capturee);
    expect(statut).toBe(409);
    expect(corps).toMatchObject({ code: 'EXPORT_MAPPING_INCOMPLET' });
    const corpsType = corps as { detail?: string };
    expect(corpsType.detail).toBeDefined();
    expect(corpsType.detail).toContain('mapping_compte manquant');
    expect(corpsType.detail).toContain('F-000123');
  });
});
