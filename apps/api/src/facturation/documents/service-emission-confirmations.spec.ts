import { beforeEach, describe, expect, it, vi } from 'vitest';
import { schemaEmissionDocumentVente } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../db';
import { documentVente, type LigneDocumentVente, type LigneLigneDocument } from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';

/**
 * Câblage `@CorpsZod(schemaEmissionDocumentVente)` / `@CorpsZod(schemaAccepterDevis)` sur
 * `document-vente-transitions.controller.ts` (`emettre`, `accepter`) — voir le constat qui motive
 * ce fichier : AUCUNE condition confirmable n'existe aujourd'hui pour ces deux transitions
 * (`CODES_CONFIRMATION`, `@dfa/shared`, liste fermée de 6 valeurs, aucune applicable ici). Ce
 * fichier ne teste donc PAS un blocage par confirmation (il n'y en a pas), mais prouve ce qui est
 * réellement câblé :
 *  1. rétrocompatibilité de `emettre()` — `entree` absent se comporte EXACTEMENT comme avant ;
 *  2. `entree.confirmations` entre dans le `corps` passé à `ServiceIdempotence.executer` (c'est ce
 *     `corps` qui alimente l'empreinte SHA-256, `common/idempotence/empreinte.ts` —
 *     `calculerEmpreinte` lui-même est testé là-bas, hors périmètre de ce fichier) ;
 *  3. `schemaEmissionDocumentVente` rejette un code de confirmation hors de `CODES_CONFIRMATION` ;
 *  4. `accepter()` garde sa signature à 3 arguments, `entree` n'y est jamais transmise (le
 *     contrôleur la discard, calqué sur `atelier/ordre-reparation-transitions.controller.ts::demarrer`).
 */
vi.mock('./document-requetes', () => ({
  chargerDocumentPourEcriture: vi.fn(),
  listerLignesDocumentPourEcriture: vi.fn(),
  chargerPlafondAvoirReceptionnaire: vi.fn(),
  sommerAvoirsEmisPourFacture: vi.fn(),
}));
vi.mock('./qr-emission', () => ({
  resoudreBlocCreancierPourEmission: vi.fn(),
  construireBlocQrPourEmission: vi.fn(),
}));

import { ServiceEmissionDocument } from './service-emission';
import * as documentRequetes from './document-requetes';
import * as qrEmission from './qr-emission';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const DOCUMENT_ID = 'document-1';
const CLE_IDEMPOTENCE = '66666666-6666-4666-8666-666666666666';

function principal(role: PrincipalAuthentifie['role'] = 'direction'): PrincipalAuthentifie {
  return {
    sessionId: 'session-1',
    tenantId: 'tenant-a',
    utilisateurId: 'user-1',
    role,
    langue: 'fr',
  };
}

function documentFixture(overrides: Partial<LigneDocumentVente> = {}): LigneDocumentVente {
  return {
    id: DOCUMENT_ID,
    tenantId: 'tenant-a',
    siteId: 'site-1',
    typeDocument: 'facture',
    natureFacture: 'ordinaire',
    statut: 'brouillon',
    numero: null,
    numeroSequence: null,
    exercice: null,
    dateDocument: '2026-08-04',
    clientId: 'client-1',
    clientDesignationFigee: 'Jean Dupont',
    langueFigee: 'fr',
    adresseFacturationFigee: {},
    conditionsPaiementFigees: {},
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
    factureAnnuleeId: null,
    porteeAvoir: null,
    devise: 'CHF',
    dossierVenteId: null,
    ...overrides,
  } as unknown as LigneDocumentVente;
}

function ligneFixture(prixUnitaireCentimes: number): LigneLigneDocument {
  return {
    id: 'ligne-1',
    tenantId: 'tenant-a',
    documentId: DOCUMENT_ID,
    numeroOrdre: 1,
    typeLigne: 'forfait',
    designation: 'Prestation',
    regimeTva: 'normal',
    tauxTvaPourmille: 0,
    quantiteMillieme: 1000,
    prixUnitaireCentimes,
    remisePourmille: null,
    remiseMontantCentimes: null,
    remiseGlobaleRepartieCentimes: 0,
    baseCentimes: prixUnitaireCentimes,
    htCentimes: prixUnitaireCentimes,
    tvaCentimes: 0,
    ttcCentimes: prixUnitaireCentimes,
  } as unknown as LigneLigneDocument;
}

interface AppelUpdate {
  readonly table: unknown;
  readonly valeurs: Record<string, unknown>;
}

function txFactice() {
  const appelsUpdate: AppelUpdate[] = [];
  const update = vi.fn((table: unknown) => ({
    set: (valeurs: Record<string, unknown>) => {
      appelsUpdate.push({ table, valeurs });
      return { where: vi.fn(async () => undefined) };
    },
  }));
  const insert = vi.fn((_table: unknown) => ({ values: vi.fn(async () => undefined) }));
  const select = vi.fn((_colonnes: unknown) => ({
    from: () => ({ where: () => ({ limit: async () => [{ delaiPaiementJoursDefaut: 30 }] }) }),
  }));
  return {
    tx: { update, insert, select } as unknown as TransactionDfa,
    update,
    insert,
    appelsUpdate,
  };
}

function argumentsDocumentVente(appelsUpdate: readonly AppelUpdate[]): Record<string, unknown>[] {
  return appelsUpdate.filter((a) => a.table === documentVente).map((a) => a.valeurs);
}

/** Contrairement aux autres fixtures `serviceFactice` du dossier (qui exécutent `travail(tx)`
 *  directement sans jamais inspecter `requete`), ce fichier a explicitement besoin d'observer
 *  `requete.corps` REÇU par `idempotence.executer` pour prouver que `...entree` y entre — donc
 *  `executer` reste un mock nu (`vi.fn`), sans réimplémenter le calcul d'empreinte réel
 *  (`common/idempotence/empreinte.ts`, hors périmètre). */
function serviceFactice(tx: TransactionDfa) {
  const executer = vi.fn(
    async (
      _ctx: ContexteTenant,
      _requete: unknown,
      travail: (tx: TransactionDfa) => Promise<unknown>,
    ) => ({ reponse: await travail(tx), rejoue: false }),
  );
  const idempotence = { executer };
  const evenements = { publier: vi.fn(async () => undefined) };
  const compteurs = { prochainNumero: vi.fn(async () => 42) };
  const horloge = { maintenant: () => new Date('2026-08-04T10:00:00.000Z') };
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
  return { service, executer, compteurs, documents };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(documentRequetes.sommerAvoirsEmisPourFacture).mockResolvedValue(0);
  vi.mocked(qrEmission.resoudreBlocCreancierPourEmission).mockResolvedValue(null as never);
  vi.mocked(qrEmission.construireBlocQrPourEmission).mockResolvedValue({} as never);
});

describe('ServiceEmissionDocument.emettre — rétrocompatibilité du 5e paramètre `entree`', () => {
  it('appel à 4 arguments (entree absent) — comportement inchangé : numéro alloué, statut emis, un seul update(document_vente)', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(documentFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      ligneFixture(7_000),
    ]);
    const { tx, appelsUpdate } = txFactice();
    const { service, compteurs } = serviceFactice(tx);

    const resultat = await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE);

    expect(resultat.reponse.statutHttp).toBe(200);
    expect(compteurs.prochainNumero).toHaveBeenCalledTimes(1);
    const [argument] = argumentsDocumentVente(appelsUpdate);
    expect(argument).toMatchObject({ statut: 'emis', totalTtcCentimes: 7_000n });
  });

  it('appel à 5 arguments avec entree = {} — résultat STRICTEMENT identique à un appel à 4 arguments', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(documentFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      ligneFixture(7_000),
    ]);

    // Deux instances indépendantes (mêmes fixtures), l'une appelée à 4 arguments, l'autre à 5
    // avec un `entree` vide — la comparaison porte sur le résultat produit, pas sur le mock.
    const sansEntree = txFactice();
    const avecEntreeVide = txFactice();
    const { service: serviceSansEntree } = serviceFactice(sansEntree.tx);
    const { service: serviceAvecEntreeVide } = serviceFactice(avecEntreeVide.tx);

    const resultatSansEntree = await serviceSansEntree.emettre(
      CTX,
      principal(),
      DOCUMENT_ID,
      CLE_IDEMPOTENCE,
    );
    const resultatAvecEntreeVide = await serviceAvecEntreeVide.emettre(
      CTX,
      principal(),
      DOCUMENT_ID,
      CLE_IDEMPOTENCE,
      {},
    );

    expect(resultatAvecEntreeVide.reponse.statutHttp).toBe(resultatSansEntree.reponse.statutHttp);
    const [argSans] = argumentsDocumentVente(sansEntree.appelsUpdate);
    const [argAvec] = argumentsDocumentVente(avecEntreeVide.appelsUpdate);
    expect(argAvec).toEqual(argSans);
  });
});

describe("ServiceEmissionDocument.emettre — `entree.confirmations` entre dans l'empreinte d'idempotence", () => {
  it('le `corps` passé à ServiceIdempotence.executer contient `documentId` ET `...entree` (confirmations plié dedans)', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(documentFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      ligneFixture(7_000),
    ]);
    const { tx } = txFactice();
    const { service, executer } = serviceFactice(tx);

    await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE, {
      confirmations: ['CLIENT_BLOQUE'],
    });

    expect(executer).toHaveBeenCalledTimes(1);
    const appel = executer.mock.calls[0];
    expect(appel).toBeDefined();
    const requeteRecue = appel![1] as { corps: unknown };
    expect(requeteRecue.corps).toEqual({
      documentId: DOCUMENT_ID,
      confirmations: ['CLIENT_BLOQUE'],
    });
  });

  it('deux appels avec le MÊME `entree.confirmations` produisent le MÊME `corps` — un rejeu réel (ServiceIdempotence, hors périmètre ici) verrait donc la même empreinte', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(documentFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      ligneFixture(7_000),
    ]);
    const premier = txFactice();
    const second = txFactice();
    const { service: servicePremier, executer: executerPremier } = serviceFactice(premier.tx);
    const { service: serviceSecond, executer: executerSecond } = serviceFactice(second.tx);

    await servicePremier.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE, {
      confirmations: ['CLIENT_BLOQUE'],
    });
    await serviceSecond.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE, {
      confirmations: ['CLIENT_BLOQUE'],
    });

    expect(executerPremier).toHaveBeenCalledTimes(1);
    expect(executerSecond).toHaveBeenCalledTimes(1);
    const appelPremier = executerPremier.mock.calls[0];
    const appelSecond = executerSecond.mock.calls[0];
    expect(appelPremier).toBeDefined();
    expect(appelSecond).toBeDefined();
    const corpsPremier = (appelPremier![1] as { corps: unknown }).corps;
    const corpsSecond = (appelSecond![1] as { corps: unknown }).corps;
    expect(corpsSecond).toEqual(corpsPremier);
  });

  it("deux appels avec des `entree.confirmations` DIFFÉRENTS produisent des `corps` DIFFÉRENTS — sous la MÊME Idempotency-Key, un vrai ServiceIdempotence lèverait IDEMPOTENCE_CONFLIT au lieu d'un rejeu silencieux (calculerEmpreinte sur des corps distincts, testé dans common/idempotence/*.spec.ts)", async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(documentFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      ligneFixture(7_000),
    ]);
    const premier = txFactice();
    const second = txFactice();
    const { service: servicePremier, executer: executerPremier } = serviceFactice(premier.tx);
    const { service: serviceSecond, executer: executerSecond } = serviceFactice(second.tx);

    await servicePremier.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE, {});
    await serviceSecond.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE, {
      confirmations: ['CLIENT_BLOQUE'],
    });

    expect(executerPremier).toHaveBeenCalledTimes(1);
    expect(executerSecond).toHaveBeenCalledTimes(1);
    const appelPremier = executerPremier.mock.calls[0];
    const appelSecond = executerSecond.mock.calls[0];
    expect(appelPremier).toBeDefined();
    expect(appelSecond).toBeDefined();
    const corpsPremier = (appelPremier![1] as { corps: unknown }).corps;
    const corpsSecond = (appelSecond![1] as { corps: unknown }).corps;
    expect(corpsSecond).not.toEqual(corpsPremier);
  });

  it('AUCUN appel `verifierConfirmation` — aucune condition confirmable applicable à `emettre` aujourd’hui (CODES_CONFIRMATION ne couvre aucun cas d’émission) : un `entree.confirmations` rempli n’empêche ni ne modifie l’exécution', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(documentFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      ligneFixture(7_000),
    ]);
    const { tx, appelsUpdate } = txFactice();
    const { service, compteurs } = serviceFactice(tx);

    const resultat = await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE, {
      confirmations: ['CLIENT_BLOQUE'],
    });

    expect(resultat.reponse.statutHttp).toBe(200);
    expect(compteurs.prochainNumero).toHaveBeenCalledTimes(1);
    const [argument] = argumentsDocumentVente(appelsUpdate);
    expect(argument).toMatchObject({ statut: 'emis' });
  });
});

describe('schemaEmissionDocumentVente — validation du corps', () => {
  it('corps vide `{}` est valide (rétrocompatibilité : un POST sans corps doit continuer à passer)', () => {
    expect(schemaEmissionDocumentVente.safeParse({}).success).toBe(true);
  });

  it('confirmations connues (CODES_CONFIRMATION) sont acceptées', () => {
    const resultat = schemaEmissionDocumentVente.safeParse({
      confirmations: ['CLIENT_BLOQUE', 'OR_SANS_RDV'],
    });
    expect(resultat.success).toBe(true);
  });

  it("un code hors de CODES_CONFIRMATION (ex. 'CODE_INEXISTANT') est REJETÉ — c'est ce que PipeZod/CorpsZod traduit en 400 côté contrôleur (bootstrap Nest complet hors périmètre unitaire)", () => {
    const resultat = schemaEmissionDocumentVente.safeParse({
      confirmations: ['CODE_INEXISTANT'],
    });
    expect(resultat.success).toBe(false);
  });
});

describe('ServiceEmissionDocument.accepter — signature inchangée (3 arguments), `entree` du contrôleur reste discarded', () => {
  function devisFixture(overrides: Partial<LigneDocumentVente> = {}): LigneDocumentVente {
    return {
      id: DOCUMENT_ID,
      tenantId: 'tenant-a',
      siteId: 'site-1',
      typeDocument: 'devis',
      statut: 'emis',
      numero: 'DEV-2026-00001',
      ...overrides,
    } as unknown as LigneDocumentVente;
  }

  it('accepter(ctx, principal, documentId) — toujours 3 arguments, transitionne bien un devis en `accepte`', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(devisFixture());
    const acces = {
      enTenant: vi.fn(async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => unknown) => {
        const { tx } = txFactice();
        return travail(tx);
      }),
    };
    const documents = { assemblerDocument: vi.fn(async () => ({ id: DOCUMENT_ID })) };
    const service = new ServiceEmissionDocument(
      acces as never,
      { executer: vi.fn() } as never,
      { publier: vi.fn() } as never,
      { prochainNumero: vi.fn() } as never,
      { maintenant: () => new Date() } as never,
      documents as never,
      { marquerVendu: vi.fn() } as never,
    );

    const resultat = await service.accepter(CTX, principal(), DOCUMENT_ID);

    expect(resultat.donnees).toEqual({ id: DOCUMENT_ID });
    expect(documents.assemblerDocument).toHaveBeenCalledTimes(1);
  });
});
