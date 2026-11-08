import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContexteTenant, TransactionDfa } from '../../db';
import {
  clientAdresse,
  documentVente,
  ligneDocument,
  reportReglementCorrection,
  type LigneDocumentVente,
} from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import type { ReponseDocumentVente } from '@dfa/shared';

/**
 * `ServiceCorrectionFacture.corriger` (`RF-12`→`RF-14`, blocage n°1 du 14.08.2026 — « Corriger
 * cette facture » sans endpoint). Preuve d'ORCHESTRATION (les deux collaborateurs réels —
 * `ServiceAvoir.construireAvoirTotalPourCorrectionTx` et `ServiceEmissionDocument.emettreCoeurTx`
 * — sont MOQUÉS, chacun déjà couvert par ses propres tests : `service-avoir-mouvement.spec.ts`,
 * `service-emission*.spec.ts`) + preuve ARITHMÉTIQUE CHIFFRÉE des lignes recopiées sur la facture
 * de remplacement (`calculerLigneDocument` RÉEL, non moqué — c'est la seule porte d'arrondi du
 * module, voir `calcul-document.ts`).
 */
vi.mock('./document-requetes', () => ({
  chargerDocumentPourEcriture: vi.fn(),
  listerLignesDocumentPourEcriture: vi.fn(),
}));
vi.mock('./references', () => ({
  chargerIdAdresseFacturationActive: vi.fn(),
}));

vi.mock('./assujettissement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./assujettissement')>()),
  chargerSituationTva: vi.fn(),
}));

import { ErreurMetier } from '../../common/erreurs/erreur-metier';

import { ServiceCorrectionFacture } from './service-correction';
import * as documentRequetes from './document-requetes';
import * as references from './references';
import * as assujettissement from './assujettissement';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const FACTURE_ID = 'facture-1';
const CLE_IDEMPOTENCE = '22222222-2222-4222-8222-222222222222';

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
    natureFacture: 'ordinaire',
    statut: 'emis',
    numero: 'F-2026-042',
    clientId: 'client-1',
    vehiculeId: null,
    ordreReparationId: null,
    dossierVenteId: null,
    clientDesignationFigee: 'Jean Dupont',
    clientIdeFige: null,
    langueFigee: 'fr',
    adresseFacturationFigee: {
      rue: 'Ancienne rue 1',
      numero: null,
      npa: '1000',
      localite: 'Lausanne',
      pays: 'CH',
    },
    conditionsPaiementFigees: {},
    devise: 'CHF',
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
    // Issue #154 : 0n par défaut — la plupart des tests de ce fichier ne concernent PAS le report
    // de règlement, ce défaut leur garde le comportement d'avant (aucune écriture supplémentaire).
    // Les tests dédiés au report (describe séparé, plus bas) le surchargent explicitement.
    montantRegleCentimes: 0n,
    totalTtcCentimes: 25_944n,
    ...overrides,
  } as unknown as LigneDocumentVente;
}

/** Deux lignes réelles — TVA normale (8.1 %) puis réduite (2.6 %), voir le calcul exact
 *  documenté ci-dessous (`calculerLigneDocument`, MD-40, arrondi commercial). */
const LIGNE_1 = {
  id: 'ligne-1',
  tenantId: 'tenant-a',
  documentId: FACTURE_ID,
  numeroOrdre: 1,
  typeLigne: 'forfait',
  designation: 'Révision',
  referenceTexte: null,
  ligneOrId: null,
  documentAcompteId: null,
  categorieComptable: null,
  regimeTva: 'normal',
  tauxTvaPourmille: 81,
  datePrestation: '2026-08-01',
  quantiteMillieme: 1000,
  prixUnitaireCentimes: 10_000, // CHF 100.00 TTC
  remisePourmille: null,
  remiseMontantCentimes: null,
  montantValoriseCentimes: null,
} as const;
const LIGNE_2 = {
  ...LIGNE_1,
  id: 'ligne-2',
  numeroOrdre: 2,
  typeLigne: 'piece',
  designation: 'Pièce détachée (TVA réduite)',
  regimeTva: 'reduit',
  tauxTvaPourmille: 26,
  prixUnitaireCentimes: 5_000, // CHF 50.00 TTC
} as const;

// Attendus MD-40 (arrondi commercial « demi éloigné de zéro », vérifiés à la main) :
//   L1 : base=10000, tva=arrondi(10000*81/1081)=749, ht=9251, ttc=10000
//   L2 : base=5000,  tva=arrondi(5000*26/1026)=127,  ht=4873, ttc=5000

function txFactice() {
  const lignesInserees: Record<string, unknown>[] = [];
  const facturesInserees: Record<string, unknown>[] = [];
  const adressesMisesAJour: { valeurs: Record<string, unknown>; where: unknown }[] = [];
  const documentsMisAJour: { valeurs: Record<string, unknown>; where: unknown }[] = [];
  const reportsInseres: Record<string, unknown>[] = [];
  let compteurFacture = 0;
  let compteurLigne = 0;
  let compteurReport = 0;

  const insert = vi.fn((table: unknown) => ({
    values: (val: Record<string, unknown>) => ({
      returning: vi.fn(async () => {
        if (table === documentVente) {
          const row = { id: `facture-remplacement-${++compteurFacture}`, ...val };
          facturesInserees.push(row);
          return [row];
        }
        if (table === ligneDocument) {
          const row = { id: `ligne-remplacement-${++compteurLigne}`, ...val };
          lignesInserees.push(row);
          return [row];
        }
        if (table === reportReglementCorrection) {
          const row = { id: `report-${++compteurReport}`, ...val };
          reportsInseres.push(row);
          return [row];
        }
        throw new Error('table insert inattendue dans le test');
      }),
    }),
  }));

  const update = vi.fn((table: unknown) => ({
    set: (valeurs: Record<string, unknown>) => ({
      where: vi.fn(async (condition: unknown) => {
        if (table === clientAdresse) adressesMisesAJour.push({ valeurs, where: condition });
        if (table === documentVente) documentsMisAJour.push({ valeurs, where: condition });
        return undefined;
      }),
    }),
  }));

  return {
    tx: { insert, update } as unknown as TransactionDfa,
    lignesInserees,
    facturesInserees,
    adressesMisesAJour,
    documentsMisAJour,
    reportsInseres,
  };
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
  const horloge = { maintenant: () => new Date('2026-08-17T09:00:00.000Z') };
  const avoirs = {
    validerFactureCreditable: vi.fn(),
    construireAvoirTotalPourCorrectionTx: vi.fn(async () => ({ avoirId: 'avoir-1' })),
  };
  const avoirEmis = { id: 'avoir-1', typeDocument: 'avoir' } as unknown as ReponseDocumentVente;
  const emission = {
    emettreCoeurTx: vi.fn(async (_tx: unknown, _ctx: unknown, _p: unknown, documentId: string) =>
      documentId === 'avoir-1'
        ? avoirEmis
        : ({
            id: documentId,
            typeDocument: 'facture',
            statut: 'emis',
            dateEcheance: null,
            // Issue #154 : valeurs « fraîches » posées par une émission normale — le report de
            // règlement (s'il a lieu) les PATCHE ensuite, voir les tests dédiés plus bas.
            montantRegleCentimes: 0,
            soldeCentimes: 0,
            statutReglement: 'non_regle',
          } as unknown as ReponseDocumentVente),
    ),
  };
  const brouillonAssemble = {
    id: 'facture-remplacement-1',
    typeDocument: 'facture',
    statut: 'brouillon',
    numero: null,
  } as unknown as ReponseDocumentVente;
  const documents = {
    assemblerDocument: vi.fn(async () => brouillonAssemble),
  };
  const service = new ServiceCorrectionFacture(
    {} as never, // acces (JETON_DB) : jamais exercé, seul idempotence.executer l'est (même convention que ServiceAvoir/ServiceEmissionDocument).
    idempotence as never,
    horloge as never,
    avoirs as never,
    emission as never,
    documents as never,
  );
  return {
    service,
    idempotence,
    horloge,
    avoirs,
    emission,
    avoirEmis,
    documents,
    brouillonAssemble,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assujettissement.chargerSituationTva).mockResolvedValue({
    assujetti: true,
    numeroTva: 'CHE-123.456.789 TVA',
  });
});

describe('ServiceCorrectionFacture.corriger — orchestration', () => {
  it('avoir puis facture de remplacement, dans cet ordre, avec le motif transmis tel quel', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(factureFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      LIGNE_1,
      LIGNE_2,
    ] as never);
    vi.mocked(references.chargerIdAdresseFacturationActive).mockResolvedValue(null);

    const { tx, facturesInserees } = txFactice();
    const { service, avoirs, emission } = serviceFactice(tx);

    const resultat = await service.corriger(
      CTX,
      principal('comptable'),
      FACTURE_ID,
      {
        motif: 'erreur_adresse',
        corrigerFicheClient: false,
        champsCorriges: {
          adresseFacturation: {
            rue: 'Nouvelle rue 5',
            numero: '5',
            npa: '1003',
            localite: 'Lausanne',
            pays: 'CH',
          },
        },
        confirmations: [],
      } as never,
      CLE_IDEMPOTENCE,
    );

    // Applicabilité vérifiée AVANT toute écriture — même contrôle qu'un avoir libre.
    expect(avoirs.validerFactureCreditable).toHaveBeenCalledWith(
      expect.objectContaining({ id: FACTURE_ID }),
    );

    // 1. Avoir TOTAL construit sans retour de stock, motif transmis tel quel.
    expect(avoirs.construireAvoirTotalPourCorrectionTx).toHaveBeenCalledWith(
      tx,
      CTX,
      expect.objectContaining({ role: 'comptable' }),
      FACTURE_ID,
      expect.objectContaining({ id: FACTURE_ID }),
      [LIGNE_1, LIGNE_2],
      'erreur_adresse',
      null,
      new Date('2026-08-17T09:00:00.000Z'),
    );

    // 2. L'avoir est émis EN PREMIER (bascule la facture d'origine à annule_par_avoir), la facture
    //    de remplacement en second — l'ordre des appels le prouve.
    expect(emission.emettreCoeurTx).toHaveBeenCalledTimes(2);
    expect(emission.emettreCoeurTx.mock.calls[0]?.[3]).toBe('avoir-1');
    const idFactureRemplacement = facturesInserees[0]?.id;
    expect(emission.emettreCoeurTx.mock.calls[1]?.[3]).toBe(idFactureRemplacement);

    // 3. Réponse : les DEUX documents émis, statut 201 (création).
    expect(resultat.reponse.statutHttp).toBe(201);
    expect(resultat.reponse.corps.donnees.avoir.id).toBe('avoir-1');
    expect(resultat.reponse.corps.donnees.factureRemplacement.id).toBe(idFactureRemplacement);
  });

  it("la facture de remplacement recopie l'en-tête (overlay champsCorriges) SANS remplace_id, AVEC factureCorrigeeId (issue #156) — clientDesignationFigee/adresse écrasées, tout le reste identique", async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(
      factureFixture({ natureFacture: 'acompte' as never, dossierVenteId: 'dossier-9' } as never),
    );
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      LIGNE_1,
    ] as never);
    vi.mocked(references.chargerIdAdresseFacturationActive).mockResolvedValue(null);

    const { tx, facturesInserees } = txFactice();
    const { service } = serviceFactice(tx);

    await service.corriger(
      CTX,
      principal('direction'),
      FACTURE_ID,
      {
        motif: 'erreur_destinataire',
        corrigerFicheClient: false,
        champsCorriges: { clientDesignation: 'Nouvelle Raison SA' },
        confirmations: [],
      } as never,
      CLE_IDEMPOTENCE,
    );

    expect(facturesInserees).toHaveLength(1);
    const facture = facturesInserees[0] as Record<string, unknown>;
    expect(facture['typeDocument']).toBe('facture');
    expect(facture['clientDesignationFigee']).toBe('Nouvelle Raison SA'); // overlay
    expect(facture['adresseFacturationFigee']).toEqual(factureFixture().adresseFacturationFigee); // non corrigé -> recopié tel quel
    expect(facture['natureFacture']).toBe('acompte'); // recopié
    expect(facture['dossierVenteId']).toBe('dossier-9'); // recopié
    expect(facture).not.toHaveProperty('remplaceId'); // MD-15 : remplace_id est réservé au devis (RF-8)
    expect(facture).not.toHaveProperty('documentSourceId');
    expect(facture['factureCorrigeeId']).toBe(FACTURE_ID); // issue #156 : traçabilité en base
  });

  it('lignes recopiées : montants TTC/HT/TVA EXACTS (arrondi commercial MD-40), remise globale à 0 (ventilée à l’émission)', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(factureFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      LIGNE_1,
      LIGNE_2,
    ] as never);
    vi.mocked(references.chargerIdAdresseFacturationActive).mockResolvedValue(null);

    const { tx, lignesInserees } = txFactice();
    const { service } = serviceFactice(tx);

    await service.corriger(
      CTX,
      principal('direction'),
      FACTURE_ID,
      {
        motif: 'erreur_adresse',
        corrigerFicheClient: false,
        champsCorriges: {},
        confirmations: [],
      } as never,
      CLE_IDEMPOTENCE,
    );

    expect(lignesInserees).toHaveLength(2);
    const [l1, l2] = lignesInserees as [Record<string, unknown>, Record<string, unknown>];

    expect(l1).toMatchObject({
      numeroOrdre: 1,
      ligneOrId: null,
      remiseGlobaleRepartieCentimes: 0,
      baseCentimes: 10_000,
      htCentimes: 9_251,
      tvaCentimes: 749,
      ttcCentimes: 10_000,
    });
    expect(l2).toMatchObject({
      numeroOrdre: 2,
      remiseGlobaleRepartieCentimes: 0,
      baseCentimes: 5_000,
      htCentimes: 4_873,
      tvaCentimes: 127,
      ttcCentimes: 5_000,
    });
    // ttc = ht + tva, exactement (même invariant que ligne_document_montant_coherent_chk).
    expect((l1['htCentimes'] as number) + (l1['tvaCentimes'] as number)).toBe(l1['ttcCentimes']);
    expect((l2['htCentimes'] as number) + (l2['tvaCentimes'] as number)).toBe(l2['ttcCentimes']);
  });

  it('garage devenu NON assujetti : lignes de remplacement recalculées à 0 ‰ / exclu, HT = TTC (100.00 et 50.00), total TTC inchangé', async () => {
    vi.mocked(assujettissement.chargerSituationTva).mockResolvedValue({
      assujetti: false,
      numeroTva: null,
    });
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(factureFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      LIGNE_1,
      LIGNE_2,
    ] as never);
    vi.mocked(references.chargerIdAdresseFacturationActive).mockResolvedValue(null);
    const { tx, lignesInserees } = txFactice();
    const { service } = serviceFactice(tx);

    await service.corriger(
      CTX,
      principal('direction'),
      FACTURE_ID,
      {
        motif: 'erreur_adresse',
        corrigerFicheClient: false,
        champsCorriges: {},
        confirmations: [],
      } as never,
      CLE_IDEMPOTENCE,
    );

    expect(lignesInserees).toHaveLength(2);
    expect(lignesInserees[0]).toMatchObject({
      regimeTva: 'exclu',
      tauxTvaPourmille: 0,
      htCentimes: 10_000,
      tvaCentimes: 0,
      ttcCentimes: 10_000,
    });
    expect(lignesInserees[1]).toMatchObject({
      regimeTva: 'exclu',
      tauxTvaPourmille: 0,
      htCentimes: 5_000,
      tvaCentimes: 0,
      ttcCentimes: 5_000,
    });
  });

  it('corrigerFicheClient=false — la fiche client (client_adresse) n’est JAMAIS écrite, même avec une adresse corrigée', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(factureFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      LIGNE_1,
    ] as never);

    const { tx, adressesMisesAJour } = txFactice();
    const { service } = serviceFactice(tx);

    await service.corriger(
      CTX,
      principal('direction'),
      FACTURE_ID,
      {
        motif: 'erreur_adresse',
        corrigerFicheClient: false,
        champsCorriges: {
          adresseFacturation: {
            rue: 'X',
            numero: null,
            npa: '1000',
            localite: 'Lausanne',
            pays: 'CH',
          },
        },
        confirmations: [],
      } as never,
      CLE_IDEMPOTENCE,
    );

    expect(references.chargerIdAdresseFacturationActive).not.toHaveBeenCalled();
    expect(adressesMisesAJour).toHaveLength(0);
  });

  it('corrigerFicheClient=true avec une adresse résolue — client_adresse écrasée avec EXACTEMENT les champs soumis', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(factureFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      LIGNE_1,
    ] as never);
    vi.mocked(references.chargerIdAdresseFacturationActive).mockResolvedValue('adresse-42');

    const { tx, adressesMisesAJour } = txFactice();
    const { service } = serviceFactice(tx);

    await service.corriger(
      CTX,
      principal('direction'),
      FACTURE_ID,
      {
        motif: 'erreur_adresse',
        corrigerFicheClient: true,
        champsCorriges: {
          adresseFacturation: {
            rue: 'Nouvelle rue 5',
            numero: '5',
            npa: '1003',
            localite: 'Lausanne',
            pays: 'CH',
          },
        },
        confirmations: [],
      } as never,
      CLE_IDEMPOTENCE,
    );

    expect(references.chargerIdAdresseFacturationActive).toHaveBeenCalledWith(tx, CTX, 'client-1');
    expect(adressesMisesAJour).toHaveLength(1);
    expect(adressesMisesAJour[0]?.valeurs).toEqual({
      rue: 'Nouvelle rue 5',
      numero: '5',
      npa: '1003',
      localite: 'Lausanne',
      pays: 'CH',
    });
  });

  it("corrigerFicheClient=true mais le client n'a AUCUNE adresse active — rien n'est écrit, rien ne lève", async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(factureFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      LIGNE_1,
    ] as never);
    vi.mocked(references.chargerIdAdresseFacturationActive).mockResolvedValue(null);

    const { tx, adressesMisesAJour } = txFactice();
    const { service } = serviceFactice(tx);

    await expect(
      service.corriger(
        CTX,
        principal('direction'),
        FACTURE_ID,
        {
          motif: 'erreur_adresse',
          corrigerFicheClient: true,
          champsCorriges: {
            adresseFacturation: {
              rue: 'X',
              numero: null,
              npa: '1000',
              localite: 'Lausanne',
              pays: 'CH',
            },
          },
          confirmations: [],
        } as never,
        CLE_IDEMPOTENCE,
      ),
    ).resolves.toBeDefined();

    expect(adressesMisesAJour).toHaveLength(0);
  });

  it('une facture non émise (brouillon) est refusée AVANT toute écriture — aucun avoir ni facture construits', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(
      factureFixture({ statut: 'brouillon' } as never),
    );
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([] as never);

    const { tx } = txFactice();
    const { service, avoirs, emission } = serviceFactice(tx);
    // Le vrai `ServiceAvoir.validerFactureCreditable` lève DOCUMENT_TRANSITION_INTERDITE pour un
    // statut non `emis` — reproduit ici pour prouver que `corriger()` PROPAGE ce refus sans le
    // masquer, plutôt que de re-décider seul.
    avoirs.validerFactureCreditable.mockImplementation(() => {
      throw new ErreurMetier('DOCUMENT_TRANSITION_INTERDITE', 'Facture non émise.');
    });

    await expect(
      service.corriger(
        CTX,
        principal('direction'),
        FACTURE_ID,
        {
          motif: 'erreur_adresse',
          corrigerFicheClient: false,
          champsCorriges: {},
          confirmations: [],
        } as never,
        CLE_IDEMPOTENCE,
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENT_TRANSITION_INTERDITE' });

    expect(avoirs.construireAvoirTotalPourCorrectionTx).not.toHaveBeenCalled();
    expect(emission.emettreCoeurTx).not.toHaveBeenCalled();
  });
});

/**
 * Issue #154 — « le paiement suit la facture de remplacement » (choix produit). Scénario mesuré
 * qui a ouvert l'issue : facture CHF 259.44 (25'944 ct), encaissement CHF 150.00 (15'000 ct),
 * correction → la facture de remplacement doit afficher exactement CHF 109.44 (10'944 ct) de
 * reste dû, pas CHF 259.44.
 *
 * `chargerDocumentPourEcriture` est appelée DEUX FOIS par `corriger()` dès qu'un règlement existe
 * (la facture d'origine, puis la facture de remplacement rechargée pour son total) — le mock
 * distingue les deux par `documentId` plutôt que par ordre d'appel, plus robuste.
 */
describe('ServiceCorrectionFacture.corriger — report du règlement (issue #154)', () => {
  const TOTAL_FACTURE_CENTIMES = 25_944n; // CHF 259.44

  function configurerChargement(montantRegleOrigineCentimes: bigint) {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockImplementation(
      async (_tx, _ctx, documentId) => {
        if (documentId === FACTURE_ID) {
          return factureFixture({
            montantRegleCentimes: montantRegleOrigineCentimes,
            totalTtcCentimes: TOTAL_FACTURE_CENTIMES,
          } as never);
        }
        // Rechargement de la facture de remplacement (`reporterReglementSiNecessaireTx`) : seul
        // `totalTtcCentimes` est lu par le service, le reste n'a pas besoin d'être réaliste.
        return {
          id: documentId,
          totalTtcCentimes: TOTAL_FACTURE_CENTIMES,
        } as unknown as LigneDocumentVente;
      },
    );
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      LIGNE_1,
    ] as never);
  }

  async function corriger(tx: TransactionDfa, service: ServiceCorrectionFacture) {
    return service.corriger(
      CTX,
      principal('comptable'),
      FACTURE_ID,
      {
        motif: 'erreur_adresse',
        corrigerFicheClient: false,
        champsCorriges: { clientDesignation: 'Nouvelle Raison SA' },
        confirmations: [],
      } as never,
      CLE_IDEMPOTENCE,
    );
  }

  it("aucun paiement encaissé — aucune ligne de report, aucun UPDATE document_vente au-delà de ce que l'émission fait déjà", async () => {
    configurerChargement(0n);
    const { tx, reportsInseres, documentsMisAJour } = txFactice();
    const { service } = serviceFactice(tx);

    await corriger(tx, service);

    expect(reportsInseres).toHaveLength(0);
    expect(documentsMisAJour).toHaveLength(0);
    // Une seule lecture (la facture d'origine) — aucun rechargement de la facture de remplacement
    // puisqu'il n'y a rien à reporter.
    expect(documentRequetes.chargerDocumentPourEcriture).toHaveBeenCalledTimes(1);
  });

  it('paiement PARTIEL (CHF 150.00 encaissés sur CHF 259.44) — la facture de remplacement porte exactement CHF 109.44 de solde, statut « partiel »', async () => {
    configurerChargement(15_000n); // CHF 150.00
    const { tx, reportsInseres, documentsMisAJour, facturesInserees } = txFactice();
    const { service } = serviceFactice(tx);

    const resultat = await corriger(tx, service);

    const idNouvelleFacture = facturesInserees[0]?.id as string;

    // 1. Le report est tracé, EXACTEMENT le montant encaissé, tenant/facture source/facture cible
    //    corrects.
    expect(reportsInseres).toHaveLength(1);
    expect(reportsInseres[0]).toMatchObject({
      tenantId: 'tenant-a',
      factureOrigineId: FACTURE_ID,
      factureRemplacementId: idNouvelleFacture,
      montantCentimes: 15_000n,
      creeParId: 'user-1',
    });

    // 2. Facture ANNULÉE : compteurs remis à zéro (sa dette réelle est nulle — voir la docstring
    //    du service).
    expect(documentsMisAJour).toHaveLength(2);
    expect(documentsMisAJour[0]?.valeurs).toEqual({
      montantRegleCentimes: 0n,
      soldeCentimes: 0n,
      statutReglement: 'non_regle',
    });

    // 3. Facture de REMPLACEMENT : CHF 150.00 réglés, CHF 109.44 de solde EXACT — le chiffre au
    //    cœur de l'issue #154.
    expect(documentsMisAJour[1]?.valeurs).toEqual({
      montantRegleCentimes: 15_000n,
      soldeCentimes: 10_944n, // CHF 109.44, EXACT
      statutReglement: 'partiel',
    });

    // 4. La réponse HTTP reflète déjà le bon reste à payer, sans relecture supplémentaire.
    expect(resultat.reponse.corps.donnees.factureRemplacement).toMatchObject({
      montantRegleCentimes: 15_000,
      soldeCentimes: 10_944,
      statutReglement: 'partiel',
    });
  });

  it('paiement INTÉGRAL (CHF 259.44) — la facture de remplacement est immédiatement soldée, statut « regle »', async () => {
    configurerChargement(TOTAL_FACTURE_CENTIMES);
    const { tx, documentsMisAJour } = txFactice();
    const { service } = serviceFactice(tx);

    const resultat = await corriger(tx, service);

    expect(documentsMisAJour[1]?.valeurs).toEqual({
      montantRegleCentimes: TOTAL_FACTURE_CENTIMES,
      soldeCentimes: 0n,
      statutReglement: 'regle',
    });
    expect(resultat.reponse.corps.donnees.factureRemplacement).toMatchObject({
      montantRegleCentimes: Number(TOTAL_FACTURE_CENTIMES),
      soldeCentimes: 0,
      statutReglement: 'regle',
    });
  });

  it('plusieurs paiements successifs (CHF 50 + CHF 40 + CHF 60 = CHF 150.00 agrégés) — reportés en UN SEUL mouvement, montant agrégé exact', async () => {
    // `document_vente.montant_regle_centimes` est déjà l'AGRÉGAT des imputations successives
    // (MD-53, maintenu par `paiements/imputations.ts` à chaque encaissement) — le service de
    // correction n'a connaissance que de cet agrégat, jamais des paiements individuels qui l'ont
    // constitué. Ce test documente explicitement que 3 encaissements de CHF 50/40/60 se
    // traduisent par UNE seule ligne de report de CHF 150.00, pas trois.
    const AGREGAT_TROIS_PAIEMENTS = 5_000n + 4_000n + 6_000n; // CHF 150.00
    configurerChargement(AGREGAT_TROIS_PAIEMENTS);
    const { tx, reportsInseres } = txFactice();
    const { service } = serviceFactice(tx);

    await corriger(tx, service);

    expect(reportsInseres).toHaveLength(1);
    expect(reportsInseres[0]?.['montantCentimes']).toBe(15_000n);
  });

  it('défensif : si la facture de remplacement avait un total INFÉRIEUR au montant réglé d’origine, le report est plafonné — jamais de solde négatif', async () => {
    // Cas structurellement inatteignable aujourd'hui (`schemaCorrectionFacture` ne permet de
    // corriger que `clientDesignation`/`adresseFacturation`, jamais les lignes — la facture de
    // remplacement a TOUJOURS le même total que l'origine, voir `creerFactureRemplacementTx`).
    // Test de RÉGRESSION pour le clamp défensif documenté dans le service : si ce contrat évoluait
    // un jour, le report ne doit jamais dépasser ce qui est réellement dû sur la nouvelle facture.
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockImplementation(
      async (_tx, _ctx, documentId) => {
        if (documentId === FACTURE_ID) {
          return factureFixture({
            montantRegleCentimes: 15_000n,
            totalTtcCentimes: TOTAL_FACTURE_CENTIMES,
          } as never);
        }
        return { id: documentId, totalTtcCentimes: 10_000n } as unknown as LigneDocumentVente; // CHF 100.00, < 150.00 réglés
      },
    );
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      LIGNE_1,
    ] as never);

    const { tx, reportsInseres, documentsMisAJour } = txFactice();
    const { service } = serviceFactice(tx);

    await corriger(tx, service);

    expect(reportsInseres[0]?.['montantCentimes']).toBe(10_000n); // plafonné, pas 15'000n
    expect(documentsMisAJour[1]?.valeurs).toEqual({
      montantRegleCentimes: 10_000n,
      soldeCentimes: 0n, // jamais négatif
      statutReglement: 'regle',
    });
  });
});

describe('ServiceCorrectionFacture.corriger — mode brouillon (avoir total + nouveau brouillon)', () => {
  const ENTREE_BROUILLON = {
    mode: 'brouillon',
    motif: 'erreur_montant',
    corrigerFicheClient: true,
    confirmations: [],
  } as never;

  function preparer(assujetti: boolean, factureSurcharge: Partial<LigneDocumentVente> = {}) {
    vi.mocked(assujettissement.chargerSituationTva).mockResolvedValue({
      assujetti,
      numeroTva: assujetti ? 'CHE-123.456.789 TVA' : null,
    });
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(
      factureFixture(factureSurcharge),
    );
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      LIGNE_1,
      LIGNE_2,
    ] as never);
    vi.mocked(references.chargerIdAdresseFacturationActive).mockResolvedValue('adresse-1');
  }

  it('assujetti : avoir total émis, UN SEUL brouillon (jamais émis), lié à l’originale, id du brouillon renvoyé', async () => {
    preparer(true);
    const { tx, facturesInserees, adressesMisesAJour, reportsInseres } = txFactice();
    const { service, avoirs, emission, documents, brouillonAssemble } = serviceFactice(tx);

    const resultat = await service.corriger(
      CTX,
      principal('direction'),
      FACTURE_ID,
      ENTREE_BROUILLON,
      CLE_IDEMPOTENCE,
    );

    expect(avoirs.construireAvoirTotalPourCorrectionTx).toHaveBeenCalledTimes(1);
    // Seul l'AVOIR est émis : le brouillon reste modifiable.
    expect(emission.emettreCoeurTx).toHaveBeenCalledTimes(1);
    expect(emission.emettreCoeurTx.mock.calls[0]?.[3]).toBe('avoir-1');

    expect(facturesInserees).toHaveLength(1);
    expect(facturesInserees[0]).toMatchObject({
      typeDocument: 'facture',
      factureCorrigeeId: FACTURE_ID,
      clientDesignationFigee: 'Jean Dupont',
    });
    expect(facturesInserees[0]).not.toHaveProperty('remplaceId');
    expect(facturesInserees[0]).not.toHaveProperty('documentSourceId');

    // Ni report de règlement, ni écriture de la fiche client.
    expect(reportsInseres).toHaveLength(0);
    expect(adressesMisesAJour).toHaveLength(0);

    expect(documents.assemblerDocument).toHaveBeenCalledWith(
      tx,
      CTX,
      'direction',
      facturesInserees[0]?.id,
    );
    expect(resultat.reponse.statutHttp).toBe(201);
    expect(resultat.reponse.corps.donnees.mode).toBe('brouillon');
    expect(resultat.reponse.corps.donnees.avoir.id).toBe('avoir-1');
    expect(resultat.reponse.corps.donnees.factureRemplacement).toBe(brouillonAssemble);
  });

  it('assujetti : lignes du brouillon aux montants EXACTS (100.00 à 8.1 % -> HT 92.51 / TVA 7.49 ; 50.00 à 2.6 % -> HT 48.73 / TVA 1.27)', async () => {
    preparer(true);
    const { tx, lignesInserees } = txFactice();
    const { service } = serviceFactice(tx);
    await service.corriger(CTX, principal(), FACTURE_ID, ENTREE_BROUILLON, CLE_IDEMPOTENCE);

    expect(lignesInserees).toHaveLength(2);
    expect(lignesInserees[0]).toMatchObject({
      regimeTva: 'normal',
      tauxTvaPourmille: 81,
      htCentimes: 9_251,
      tvaCentimes: 749,
      ttcCentimes: 10_000,
    });
    expect(lignesInserees[1]).toMatchObject({
      regimeTva: 'reduit',
      tauxTvaPourmille: 26,
      htCentimes: 4_873,
      tvaCentimes: 127,
      ttcCentimes: 5_000,
    });
  });

  it('NON assujetti : lignes recalculées à 0 ‰ / exclu, HT = TTC (10 000 et 5 000 centimes), TVA 0, total inchangé 15 000', async () => {
    preparer(false);
    const { tx, lignesInserees } = txFactice();
    const { service } = serviceFactice(tx);
    await service.corriger(CTX, principal(), FACTURE_ID, ENTREE_BROUILLON, CLE_IDEMPOTENCE);

    expect(lignesInserees).toHaveLength(2);
    for (const [i, ttc] of [10_000, 5_000].entries()) {
      expect(lignesInserees[i]).toMatchObject({
        regimeTva: 'exclu',
        tauxTvaPourmille: 0,
        htCentimes: ttc,
        tvaCentimes: 0,
        ttcCentimes: ttc,
      });
    }
    const total = lignesInserees.reduce((somme, l) => somme + (l['ttcCentimes'] as number), 0);
    expect(total).toBe(15_000);
  });

  it('facture déjà annulée par un avoir : FACTURE_DEJA_CORRIGEE nommant le document de correction, aucune écriture', async () => {
    preparer(true, { statut: 'annule_par_avoir' } as never);
    const { tx, facturesInserees } = txFactice();
    const select = vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: 'brouillon-existant', numero: null }],
        }),
      }),
    }));
    const { service, avoirs, emission } = serviceFactice({ ...tx, select } as never);

    const erreur = await service
      .corriger(CTX, principal(), FACTURE_ID, ENTREE_BROUILLON, CLE_IDEMPOTENCE)
      .catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ErreurMetier);
    expect((erreur as ErreurMetier).code).toBe('FACTURE_DEJA_CORRIGEE');
    expect((erreur as ErreurMetier).blocages?.[0]?.id).toBe('brouillon-existant');
    expect(avoirs.construireAvoirTotalPourCorrectionTx).not.toHaveBeenCalled();
    expect(emission.emettreCoeurTx).not.toHaveBeenCalled();
    expect(facturesInserees).toHaveLength(0);
  });

  it('facture déjà partiellement payée (15 000 sur 25 944) : FACTURE_CORRECTION_REGLEMENT_EXISTANT, aucune écriture', async () => {
    preparer(true, { montantRegleCentimes: 15_000n } as never);
    const { tx, facturesInserees } = txFactice();
    const { service, avoirs, emission } = serviceFactice(tx);

    const erreur = await service
      .corriger(CTX, principal(), FACTURE_ID, ENTREE_BROUILLON, CLE_IDEMPOTENCE)
      .catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ErreurMetier);
    expect((erreur as ErreurMetier).code).toBe('FACTURE_CORRECTION_REGLEMENT_EXISTANT');
    expect((erreur as ErreurMetier).blocages?.[0]?.donnees).toEqual({
      montantRegleCentimes: 15_000,
    });
    expect(avoirs.construireAvoirTotalPourCorrectionTx).not.toHaveBeenCalled();
    expect(emission.emettreCoeurTx).not.toHaveBeenCalled();
    expect(facturesInserees).toHaveLength(0);
  });
});
