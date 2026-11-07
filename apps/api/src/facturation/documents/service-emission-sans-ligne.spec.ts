import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContexteTenant, TransactionDfa } from '../../db';
import { documentVente, type LigneDocumentVente } from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';

/**
 * ISSUE #125 (terrain, testeur novice) : un document de vente SANS AUCUNE LIGNE pouvait être émis
 * — donc verrouillé définitivement (MD-18/20) — à CHF 0.00, sans le moindre contenu commercial.
 * Prouve que `ServiceEmissionDocument.emettre()` refuse ce cas AVANT toute écriture, pour les
 * QUATRE types de document, quel que soit le rôle — même doctrine (mocks purs, sans base réelle)
 * que `service-emission.spec.ts` (RF-117) et `service-emission-solde.spec.ts`.
 */
vi.mock('./document-requetes', () => ({
  chargerDocumentPourEcriture: vi.fn(),
  listerLignesDocumentPourEcriture: vi.fn(),
  chargerPlafondAvoirReceptionnaire: vi.fn(),
  sommerAvoirsEmisPourFacture: vi.fn(),
}));

// Assujettissement du garage (migration 0090) : lu en base par l'émission ; ces tests ne couvrent
// pas ce sujet (voir `assujettissement.spec.ts`), le garage est donc « assujetti avec n° TVA ».
vi.mock('./assujettissement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./assujettissement')>()),
  chargerSituationTva: async () => ({ assujetti: true, numeroTva: 'CHE-116.281.710 TVA' }),
}));

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(documentRequetes.sommerAvoirsEmisPourFacture).mockResolvedValue(0);
  vi.mocked(documentRequetes.chargerPlafondAvoirReceptionnaire).mockResolvedValue(null);
});

describe('ServiceEmissionDocument.emettre — refus DOCUMENT SANS LIGNE (issue #125)', () => {
  it.each(['devis', 'bon_commande', 'facture', 'avoir'] as const)(
    "un %s sans aucune ligne est refusé à l'émission — VALIDATION_ECHOUEE avec un message explicite, aucun numéro alloué, document_vente jamais écrit",
    async (typeDocument) => {
      vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(
        documentFixture(typeDocument),
      );
      vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([]);

      const { tx, update } = txFactice();
      const { service, compteurs, documents, evenements } = serviceFactice(tx);

      await expect(
        service.emettre(CTX, principal('direction'), DOCUMENT_ID, CLE_IDEMPOTENCE),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ECHOUEE',
        status: 400,
        erreurs: [
          {
            champ: 'lignes',
            code: 'aucune_ligne',
            message:
              "Ce document n'a aucune ligne : ajoutez au moins une ligne avant de l'émettre.",
          },
        ],
      });

      // RF-23/24 : aucun numéro alloué, `document_vente` jamais mis à jour — le refus intervient
      // AVANT toute écriture, y compris le recalcul des lignes (il n'y en a de toute façon aucune).
      expect(compteurs.prochainNumero).not.toHaveBeenCalled();
      expect(update.mock.calls.some((appel) => appel[0] === documentVente)).toBe(false);
      expect(documents.assemblerDocument).not.toHaveBeenCalled();
      expect(evenements.publier).not.toHaveBeenCalled();
    },
  );

  it('un document AVEC au moins une ligne franchit ce garde (refusé ou accepté ensuite pour une tout autre raison, jamais celle-ci)', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(
      documentFixture('bon_commande'),
    );
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      {
        id: 'ligne-1',
        tenantId: 'tenant-a',
        documentId: DOCUMENT_ID,
        numeroOrdre: 1,
        typeLigne: 'forfait',
        designation: 'Forfait',
        regimeTva: 'normal',
        tauxTvaPourmille: 81,
        quantiteMillieme: 1000,
        prixUnitaireCentimes: 10_000,
        remisePourmille: null,
        remiseMontantCentimes: null,
        remiseGlobaleRepartieCentimes: 0,
        baseCentimes: 10_000,
        htCentimes: 9_251,
        tvaCentimes: 749,
        ttcCentimes: 10_000,
      },
    ] as never);

    const { tx } = txFactice();
    const { service, compteurs } = serviceFactice(tx);

    const resultat = await service.emettre(
      CTX,
      principal('direction'),
      DOCUMENT_ID,
      CLE_IDEMPOTENCE,
    );

    expect(resultat.reponse.statutHttp).toBe(200);
    expect(compteurs.prochainNumero).toHaveBeenCalledTimes(1);
  });
});
