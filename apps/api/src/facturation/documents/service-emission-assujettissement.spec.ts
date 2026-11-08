import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContexteTenant, TransactionDfa } from '../../db';
import { documentVente, type LigneDocumentVente } from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';

/**
 * Assujettissement à la TVA à l'ÉMISSION (migration 0090) : un garage non assujetti n'émet aucune
 * TVA (art. 27 LTVA), un assujetti sans n° TVA n'émet pas de facture (art. 26 LTVA). Mocks purs,
 * sans base — même doctrine que `service-emission-sans-ligne.spec.ts` ; la preuve sur vraie base
 * est `test/integration/assujetti-tva.integration.spec.ts`.
 */
vi.mock('./document-requetes', () => ({
  chargerDocumentPourEcriture: vi.fn(),
  listerLignesDocumentPourEcriture: vi.fn(),
  chargerPlafondAvoirReceptionnaire: vi.fn(),
  sommerAvoirsEmisPourFacture: vi.fn(),
}));

// `chargerSituationTva` pilotable par test : c'est le sujet de ce fichier.
vi.mock('./assujettissement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./assujettissement')>()),
  chargerSituationTva: vi.fn(),
}));

import * as assujettissement from './assujettissement';
import { ServiceEmissionDocument } from './service-emission';
import * as documentRequetes from './document-requetes';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const DOCUMENT_ID = 'doc-1';
const CLE_IDEMPOTENCE = '22222222-2222-4222-8222-222222222222';

function principal(role: PrincipalAuthentifie['role']): PrincipalAuthentifie {
  return {
    sessionId: 'session-1',
    tenantId: 'tenant-a',
    utilisateurId: 'user-1',
    role,
    langue: 'fr',
  };
}

function documentFixture(
  typeDocument: LigneDocumentVente['typeDocument'],
  overrides: Partial<LigneDocumentVente> = {},
): LigneDocumentVente {
  return {
    id: DOCUMENT_ID,
    tenantId: 'tenant-a',
    siteId: 'site-1',
    typeDocument,
    statut: 'brouillon',
    numero: null,
    numeroSequence: null,
    exercice: null,
    dateDocument: '2026-08-13',
    clientId: 'client-1',
    clientDesignationFigee: 'Jean Dupont',
    langueFigee: 'fr',
    adresseFacturationFigee: {},
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
    factureAnnuleeId: null,
    porteeAvoir: 'partiel',
    conditionsPaiementFigees: null,
    devise: 'CHF',
    ...overrides,
  } as unknown as LigneDocumentVente;
}

function txFactice() {
  const whereUpdate = vi.fn(async () => undefined);
  const setUpdate = vi.fn(() => ({ where: whereUpdate }));
  const update = vi.fn((_table: unknown) => ({ set: setUpdate }));
  const valuesInsert = vi.fn(async () => undefined);
  const insert = vi.fn((_table: unknown) => ({ values: valuesInsert }));
  return {
    tx: { update, insert } as unknown as TransactionDfa,
    update,
    setUpdate,
    whereUpdate,
    insert,
    valuesInsert,
  };
}

function serviceFactice(tx: TransactionDfa) {
  const idempotence = {
    executer: vi.fn(
      async (
        _ctx: ContexteTenant,
        _requete: unknown,
        travail: (tx: TransactionDfa) => Promise<unknown>,
      ) => ({
        reponse: await travail(tx),
        rejoue: false,
      }),
    ),
  };
  const evenements = { publier: vi.fn(async () => undefined) };
  const compteurs = { prochainNumero: vi.fn(async () => 7) };
  const horloge = { maintenant: () => new Date('2026-08-13T10:00:00.000Z') };
  const documents = { assemblerDocument: vi.fn(async () => ({ id: DOCUMENT_ID })) };
  const vehiculeStock = { marquerVendu: vi.fn() };
  const service = new ServiceEmissionDocument(
    {} as never,
    idempotence as never,
    evenements as never,
    compteurs as never,
    horloge as never,
    documents as never,
    vehiculeStock as never,
  );
  return { service, idempotence, evenements, compteurs, horloge, documents, vehiculeStock };
}

const NUMERO_TVA = 'CHE-116.281.710 TVA';

function ligneFixture(taux: number, ttcCentimes: number, regimeTva = 'normal') {
  // TTC → TVA = round(ttc × taux / (1000 + taux)), HT = ttc − TVA (MD-43).
  const tva = Math.round((ttcCentimes * taux) / (1000 + taux));
  return {
    id: 'ligne-1',
    tenantId: 'tenant-a',
    documentId: DOCUMENT_ID,
    numeroOrdre: 1,
    typeLigne: 'forfait',
    designation: 'Forfait',
    regimeTva,
    tauxTvaPourmille: taux,
    quantiteMillieme: 1000,
    prixUnitaireCentimes: ttcCentimes,
    remisePourmille: null,
    remiseMontantCentimes: null,
    remiseGlobaleRepartieCentimes: 0,
    baseCentimes: ttcCentimes,
    htCentimes: ttcCentimes - tva,
    tvaCentimes: tva,
    ttcCentimes,
  };
}

function preparer(
  situation: { assujetti: boolean; numeroTva: string | null },
  type: LigneDocumentVente['typeDocument'],
  lignes: ReturnType<typeof ligneFixture>[],
) {
  vi.mocked(assujettissement.chargerSituationTva).mockResolvedValue(situation);
  vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(documentFixture(type));
  vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue(lignes as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(documentRequetes.sommerAvoirsEmisPourFacture).mockResolvedValue(0);
  vi.mocked(documentRequetes.chargerPlafondAvoirReceptionnaire).mockResolvedValue(null);
});

describe('ServiceEmissionDocument.emettre — garage NON assujetti à la TVA', () => {
  it.each(['devis', 'bon_commande', 'facture'] as const)(
    '%s avec une ligne à 8.1 % : refusé (TVA_NON_ASSUJETTI_TAUX_INTERDIT), aucun numéro, document_vente jamais écrit',
    async (type) => {
      preparer({ assujetti: false, numeroTva: null }, type, [ligneFixture(81, 10_000)]);
      const { tx, update } = txFactice();
      const { service, compteurs } = serviceFactice(tx);

      await expect(
        service.emettre(CTX, principal('direction'), DOCUMENT_ID, CLE_IDEMPOTENCE),
      ).rejects.toMatchObject({
        code: 'TVA_NON_ASSUJETTI_TAUX_INTERDIT',
        erreurs: [{ champ: 'lignes[1].tauxTvaPourmille', code: 'taux_tva_interdit_non_assujetti' }],
      });
      expect(compteurs.prochainNumero).not.toHaveBeenCalled();
      expect(update.mock.calls.some((appel) => appel[0] === documentVente)).toBe(false);
    },
  );

  it('devis à 0 ‰ : émis, CHF 100.00 HT = TTC, TVA 0, ligne et récapitulatif en régime « exclu »', async () => {
    preparer({ assujetti: false, numeroTva: null }, 'devis', [ligneFixture(0, 10_000)]);
    const { tx, setUpdate, valuesInsert } = txFactice();
    const { service, compteurs } = serviceFactice(tx);

    const r = await service.emettre(CTX, principal('direction'), DOCUMENT_ID, CLE_IDEMPOTENCE);

    expect(r.reponse.statutHttp).toBe(200);
    expect(compteurs.prochainNumero).toHaveBeenCalledTimes(1);
    const ecritures = setUpdate.mock.calls.map((a) => (a as unknown[])[0]) as Array<
      Record<string, unknown>
    >;
    // Ligne recalculée : régime ramené à « exclu », montants exacts.
    expect(ecritures).toContainEqual(
      expect.objectContaining({
        regimeTva: 'exclu',
        baseCentimes: 10_000,
        htCentimes: 10_000,
        tvaCentimes: 0,
        ttcCentimes: 10_000,
      }),
    );
    // Totaux du document figés.
    expect(ecritures).toContainEqual(
      expect.objectContaining({
        statut: 'emis',
        totalHtCentimes: 10_000n,
        totalTvaCentimes: 0n,
        totalTtcCentimes: 10_000n,
      }),
    );
    // Récapitulatif TVA : un seul groupe (exclu, 0 ‰).
    expect(valuesInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        regimeTva: 'exclu',
        tauxTvaPourmille: 0,
        baseCentimes: 10_000,
        tvaCentimes: 0,
      }),
    );
  });

  it('un avoir reprend les lignes de la facture corrigée (8.1 %) : jamais refusé pour son taux', async () => {
    preparer({ assujetti: false, numeroTva: null }, 'avoir', [ligneFixture(81, -10_000)]);
    const { tx } = txFactice();
    const { service } = serviceFactice(tx);

    const r = await service.emettre(CTX, principal('direction'), DOCUMENT_ID, CLE_IDEMPOTENCE);
    expect(r.reponse.statutHttp).toBe(200);
  });
});

describe('ServiceEmissionDocument.emettre — garage ASSUJETTI', () => {
  it.each(['facture', 'avoir'] as const)(
    '%s sans n° TVA : refusée (TVA_NUMERO_REQUIS), aucun numéro alloué',
    async (type) => {
      preparer({ assujetti: true, numeroTva: null }, type, [ligneFixture(81, 10_000)]);
      const { tx, update } = txFactice();
      const { service, compteurs } = serviceFactice(tx);

      await expect(
        service.emettre(CTX, principal('direction'), DOCUMENT_ID, CLE_IDEMPOTENCE),
      ).rejects.toMatchObject({ code: 'TVA_NUMERO_REQUIS' });
      expect(compteurs.prochainNumero).not.toHaveBeenCalled();
      expect(update.mock.calls.some((appel) => appel[0] === documentVente)).toBe(false);
    },
  );

  it('devis sans n° TVA : émis (ce n’est pas une facture), TVA 8.1 % extraite : 10000 → HT 9251, TVA 749', async () => {
    preparer({ assujetti: true, numeroTva: null }, 'devis', [ligneFixture(81, 10_000)]);
    const { tx, setUpdate } = txFactice();
    const { service } = serviceFactice(tx);

    const r = await service.emettre(CTX, principal('direction'), DOCUMENT_ID, CLE_IDEMPOTENCE);
    expect(r.reponse.statutHttp).toBe(200);
    const ecritures = setUpdate.mock.calls.map((a) => (a as unknown[])[0]) as Array<
      Record<string, unknown>
    >;
    expect(ecritures).toContainEqual(
      expect.objectContaining({
        totalHtCentimes: 9_251n,
        totalTvaCentimes: 749n,
        totalTtcCentimes: 10_000n,
      }),
    );
  });

  it('avec n° TVA : la ligne garde son régime « normal » (aucune réécriture)', async () => {
    preparer({ assujetti: true, numeroTva: NUMERO_TVA }, 'devis', [ligneFixture(81, 10_000)]);
    const { tx, setUpdate } = txFactice();
    const { service } = serviceFactice(tx);

    await service.emettre(CTX, principal('direction'), DOCUMENT_ID, CLE_IDEMPOTENCE);
    const ecritures = setUpdate.mock.calls.map((a) => (a as unknown[])[0]) as Array<
      Record<string, unknown>
    >;
    expect(ecritures).toContainEqual(expect.objectContaining({ regimeTva: 'normal' }));
    expect(ecritures.some((e) => e.regimeTva === 'exclu')).toBe(false);
  });
});
