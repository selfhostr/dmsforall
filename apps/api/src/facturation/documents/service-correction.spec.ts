import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContexteTenant, TransactionDfa } from '../../db';
import {
  clientAdresse,
  documentVente,
  ligneDocument,
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

import { ErreurMetier } from '../../common/erreurs/erreur-metier';

import { ServiceCorrectionFacture } from './service-correction';
import * as documentRequetes from './document-requetes';
import * as references from './references';

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
  let compteurFacture = 0;
  let compteurLigne = 0;

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
        throw new Error('table insert inattendue dans le test');
      }),
    }),
  }));

  const update = vi.fn((table: unknown) => ({
    set: (valeurs: Record<string, unknown>) => ({
      where: vi.fn(async (condition: unknown) => {
        if (table === clientAdresse) adressesMisesAJour.push({ valeurs, where: condition });
        return undefined;
      }),
    }),
  }));

  return {
    tx: { insert, update } as unknown as TransactionDfa,
    lignesInserees,
    facturesInserees,
    adressesMisesAJour,
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
        : ({ id: documentId, typeDocument: 'facture' } as unknown as ReponseDocumentVente),
    ),
  };
  const service = new ServiceCorrectionFacture(
    {} as never, // acces (JETON_DB) : jamais exercé, seul idempotence.executer l'est (même convention que ServiceAvoir/ServiceEmissionDocument).
    idempotence as never,
    horloge as never,
    avoirs as never,
    emission as never,
  );
  return { service, idempotence, horloge, avoirs, emission, avoirEmis };
}

beforeEach(() => {
  vi.clearAllMocks();
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

  it("la facture de remplacement recopie l'en-tête (overlay champsCorriges) SANS remplace_id — clientDesignationFigee/adresse écrasées, tout le reste identique", async () => {
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
