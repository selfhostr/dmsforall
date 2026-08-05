import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntreeCreationAvoir } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../db';
import type { LigneDocumentVente, LigneLigneDocument } from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';

/**
 * RP-46 — le pont retour client ↔ pièces, côté `ServiceAvoir.creer` (symétrique de RP-43, prouvé
 * dans `service-documents-mouvement.spec.ts`). `ServiceMouvement` MOQUÉ, même doctrine que le
 * fichier sibling : ce fichier prouve le CÂBLAGE (quand le pont se déclenche, avec quels
 * paramètres, et ce qui se passe s'il échoue), pas le comportement interne de `ServiceMouvement`.
 *
 * Trois garanties demandées par la tâche + le cas intermédiaire (crédit partiel) qui délimite
 * volontairement le pont :
 *  1. Rattachement NOMINAL : un avoir `portee = 'total'` qui crédite une ligne `piece` déjà liée à
 *     un mouvement `sortie_comptoir` déclenche `retourClientPourLigneTx` avec l'article/le site/la
 *     quantité DU MOUVEMENT D'ORIGINE et l'id de la ligne d'avoir QUI VIENT D'ÊTRE INSÉRÉE.
 *  2. Crédit PARTIEL sur une ligne liée : AUCUN mouvement automatique (montant < TTC original),
 *     avertissement `AVOIR_RETOUR_STOCK_NON_DECLENCHE` à la place — jamais bloquant.
 *  3. Ligne SANS mouvement lié (ligne `forfait` ordinaire) : aucun appel, aucun avertissement —
 *     non-régression du comportement d'avant ce lot.
 *  4. ATOMICITÉ : un échec du pont fait échouer `creer()` TOUT ENTIER.
 */
vi.mock('./document-requetes', () => ({
  chargerDocumentPourEcriture: vi.fn(),
  listerLignesDocument: vi.fn(),
}));

import { ServiceAvoir } from './service-avoir';
import * as documentRequetes from './document-requetes';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const FACTURE_ID = 'facture-1';
const LIGNE_PIECE_ID = 'ligne-piece-1';
const LIGNE_FORFAIT_ID = 'ligne-forfait-1';
const CLE_IDEMPOTENCE = '44444444-4444-4444-8444-444444444444';

function principal(role: PrincipalAuthentifie['role'] = 'direction'): PrincipalAuthentifie {
  return {
    sessionId: 'session-1',
    tenantId: 'tenant-a',
    utilisateurId: 'user-1',
    role,
    langue: 'fr',
  };
}

function factureFixture(overrides: Partial<LigneDocumentVente> = {}): LigneDocumentVente {
  return {
    id: FACTURE_ID,
    tenantId: 'tenant-a',
    siteId: 'site-1',
    typeDocument: 'facture',
    statut: 'emis',
    numero: '2026-00042',
    clientId: 'client-1',
    vehiculeId: null,
    ordreReparationId: null,
    clientDesignationFigee: 'Jean Dupont',
    clientIdeFige: null,
    langueFigee: 'fr',
    adresseFacturationFigee: {},
    conditionsPaiementFigees: {},
    devise: 'CHF',
    ...overrides,
  } as unknown as LigneDocumentVente;
}

function lignePieceFixture(overrides: Partial<LigneLigneDocument> = {}): LigneLigneDocument {
  return {
    id: LIGNE_PIECE_ID,
    tenantId: 'tenant-a',
    documentId: FACTURE_ID,
    numeroOrdre: 1,
    typeLigne: 'piece',
    designation: 'Plaquettes de frein avant',
    referenceTexte: null,
    regimeTva: 'normal',
    tauxTvaPourmille: 81,
    datePrestation: '2026-08-01',
    ttcCentimes: 8900,
    ...overrides,
  } as unknown as LigneLigneDocument;
}

function ligneForfaitFixture(overrides: Partial<LigneLigneDocument> = {}): LigneLigneDocument {
  return {
    id: LIGNE_FORFAIT_ID,
    tenantId: 'tenant-a',
    documentId: FACTURE_ID,
    numeroOrdre: 2,
    typeLigne: 'forfait',
    designation: 'Forfait diagnostic',
    referenceTexte: null,
    regimeTva: 'normal',
    tauxTvaPourmille: 81,
    datePrestation: '2026-08-01',
    ttcCentimes: 7000,
    ...overrides,
  } as unknown as LigneLigneDocument;
}

function entreeAvoirTotal(): EntreeCreationAvoir {
  return {
    portee: 'total',
    motif: 'erreur_facturation',
    motifAutre: undefined,
    lignes: [],
  } as never;
}

/** File d'attente `.returning()` — chaque `insert(...).values(...).returning()` consomme la
 *  PROCHAINE entrée, dans l'ordre d'appel : d'abord `documentVente` (l'avoir), puis une par ligne
 *  d'avoir insérée. */
function txFactice(retoursInsertion: readonly unknown[][]) {
  const file = [...retoursInsertion];
  const insert = vi.fn((_table: unknown) => ({
    values: (_v: unknown) => ({ returning: () => Promise.resolve(file.shift() ?? []) }),
  }));
  return { tx: { insert } as unknown as TransactionDfa, insert };
}

function serviceFactice(tx: TransactionDfa) {
  const idempotence = {
    executer: vi.fn(
      async (
        _ctx: ContexteTenant,
        _requete: unknown,
        travail: (tx: TransactionDfa) => Promise<unknown>,
      ) => ({ reponse: await travail(tx), rejoue: false }),
    ),
  };
  const horloge = { maintenant: () => new Date('2026-08-04T09:00:00.000Z') };
  const documents = { assemblerDocument: vi.fn(async () => ({ id: 'avoir-1' })) };
  const serviceMouvement = {
    retourClientPourLigneTx: vi.fn(async () => ({
      id: 'mouvement-retour-1',
      type: 'retour_client',
    })),
    trouverMouvementParLigneDocumentTx: vi.fn(async () => null),
  };
  const service = new ServiceAvoir(
    {} as never,
    idempotence as never,
    horloge as never,
    documents as never,
    serviceMouvement as never,
  );
  return { service, documents, serviceMouvement };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(factureFixture());
});

describe('ServiceAvoir.creer — pont retour client (RP-46)', () => {
  it('rattachement NOMINAL : crédit intégral d’une ligne piece liée à un mouvement sortie_comptoir déclenche retourClientPourLigneTx avec article/site/quantité du mouvement d’ORIGINE et l’id de la ligne d’avoir NOUVELLE', async () => {
    vi.mocked(documentRequetes.listerLignesDocument).mockResolvedValue([lignePieceFixture()]);
    const { tx } = txFactice([
      [{ id: 'avoir-1' }], // insert document_vente (avoir)
      [{ id: 'ligne-avoir-1' }], // insert ligne_document (crédit de la ligne piece)
    ]);
    const { service, serviceMouvement } = serviceFactice(tx);
    vi.mocked(serviceMouvement.trouverMouvementParLigneDocumentTx).mockResolvedValue({
      id: 'mouvement-origine-1',
      type: 'sortie_comptoir',
      articleId: 'article-42',
      siteId: 'site-7',
      quantiteMillieme: -1000,
    } as never);

    const resultat = await service.creer(
      CTX,
      principal('direction'),
      FACTURE_ID,
      entreeAvoirTotal(),
      CLE_IDEMPOTENCE,
    );

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(resultat.reponse.corps.avertissements).toEqual([]);
    expect(serviceMouvement.retourClientPourLigneTx).toHaveBeenCalledTimes(1);
    expect(serviceMouvement.retourClientPourLigneTx).toHaveBeenCalledWith(tx, CTX, 'direction', {
      articleId: 'article-42',
      siteId: 'site-7',
      quantiteMillieme: 1000, // POSITIF — abs(-1000), jamais le signe du mouvement de sortie.
      documentVenteLigneId: 'ligne-avoir-1',
      motif: expect.stringContaining('2026-00042') as unknown as string,
    });
  });

  it('crédit PARTIEL (montant < TTC original) sur une ligne liée : AUCUN mouvement automatique, avertissement AVOIR_RETOUR_STOCK_NON_DECLENCHE — jamais bloquant', async () => {
    vi.mocked(documentRequetes.listerLignesDocument).mockResolvedValue([lignePieceFixture()]);
    const { tx } = txFactice([[{ id: 'avoir-1' }], [{ id: 'ligne-avoir-1' }]]);
    const { service, serviceMouvement } = serviceFactice(tx);
    vi.mocked(serviceMouvement.trouverMouvementParLigneDocumentTx).mockResolvedValue({
      id: 'mouvement-origine-1',
      type: 'sortie_comptoir',
      articleId: 'article-42',
      siteId: 'site-7',
      quantiteMillieme: -1000,
    } as never);

    const resultat = await service.creer(
      CTX,
      principal('direction'),
      FACTURE_ID,
      {
        portee: 'partiel',
        motif: 'erreur_facturation',
        motifAutre: undefined,
        lignes: [{ ligneDocumentId: LIGNE_PIECE_ID, montantTtcCentimes: 4000 }], // < 8900 ttcCentimes
      } as never,
      CLE_IDEMPOTENCE,
    );

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(serviceMouvement.retourClientPourLigneTx).not.toHaveBeenCalled();
    expect(resultat.reponse.corps.avertissements).toEqual([
      expect.objectContaining({ code: 'AVOIR_RETOUR_STOCK_NON_DECLENCHE' }) as unknown,
    ]);
  });

  it('ligne SANS mouvement lié (forfait ordinaire) : aucun appel au pont, aucun avertissement — non-régression', async () => {
    vi.mocked(documentRequetes.listerLignesDocument).mockResolvedValue([ligneForfaitFixture()]);
    const { tx } = txFactice([[{ id: 'avoir-1' }], [{ id: 'ligne-avoir-1' }]]);
    const { service, serviceMouvement } = serviceFactice(tx);
    // `trouverMouvementParLigneDocumentTx` → `null` par défaut (`serviceFactice`).

    const resultat = await service.creer(
      CTX,
      principal('direction'),
      FACTURE_ID,
      entreeAvoirTotal(),
      CLE_IDEMPOTENCE,
    );

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(resultat.reponse.corps.avertissements).toEqual([]);
    expect(serviceMouvement.retourClientPourLigneTx).not.toHaveBeenCalled();
  });

  it("ATOMICITÉ : un échec du pont fait échouer creer() TOUT ENTIER — l'avoir et sa ligne ne seraient jamais committés sans lui (même tx, même callback idempotence.executer)", async () => {
    vi.mocked(documentRequetes.listerLignesDocument).mockResolvedValue([lignePieceFixture()]);
    const { tx } = txFactice([[{ id: 'avoir-1' }], [{ id: 'ligne-avoir-1' }]]);
    const { service, serviceMouvement } = serviceFactice(tx);
    vi.mocked(serviceMouvement.trouverMouvementParLigneDocumentTx).mockResolvedValue({
      id: 'mouvement-origine-1',
      type: 'sortie_comptoir',
      articleId: 'article-42',
      siteId: 'site-7',
      quantiteMillieme: -1000,
    } as never);
    vi.mocked(serviceMouvement.retourClientPourLigneTx).mockRejectedValueOnce(
      new Error('Échec de création du mouvement de retour client.'),
    );

    await expect(
      service.creer(CTX, principal('direction'), FACTURE_ID, entreeAvoirTotal(), CLE_IDEMPOTENCE),
    ).rejects.toThrow('Échec de création du mouvement de retour client.');
  });
});
