import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContexteTenant, TransactionDfa } from '../../db';
import type { LigneDocumentVente, LigneLigneDocument } from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';

/**
 * Un garage neuf n'a pas encore de bloc créancier : l'émission d'une FACTURE ne doit pas échouer
 * pour autant (paiement espèces/carte au comptoir). Elle part sans QR-facture et l'API le dit par
 * l'avertissement `FACTURE_SANS_QR`. Toute AUTRE erreur de résolution du bloc reste fatale.
 * Même harnais que `service-emission-echeance.spec.ts`.
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

import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import { ServiceEmissionDocument } from './service-emission';
import * as documentRequetes from './document-requetes';
import * as qrEmission from './qr-emission';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const DOCUMENT_ID = 'document-1';
const CLE_IDEMPOTENCE = '44444444-4444-4444-8444-444444444444';

function principal(): PrincipalAuthentifie {
  return {
    sessionId: 'session-1',
    tenantId: 'tenant-a',
    utilisateurId: 'user-1',
    role: 'direction',
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
    dateDocument: '2026-07-01',
    clientId: 'client-1',
    clientDesignationFigee: 'Jean Dupont',
    langueFigee: 'fr',
    adresseFacturationFigee: {},
    conditionsPaiementFigees: { delaiPaiementJours: 30 },
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
    factureAnnuleeId: null,
    porteeAvoir: null,
    devise: 'CHF',
    dossierVenteId: null,
    ...overrides,
  } as unknown as LigneDocumentVente;
}

function ligneFixture(): LigneLigneDocument {
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
    prixUnitaireCentimes: 10_000,
    remisePourmille: null,
    remiseMontantCentimes: null,
    remiseGlobaleRepartieCentimes: 0,
    baseCentimes: 10_000,
    htCentimes: 10_000,
    tvaCentimes: 0,
    ttcCentimes: 10_000,
  } as unknown as LigneLigneDocument;
}

/**
 * `delaiTenantDefaut` : valeur rendue par `tenant.delai_paiement_jours_defaut` — `null` simule un
 * tenant introuvable dans la transaction (cas résiduel, voir `chargerDelaiPaiementJoursDefautTenant`),
 * jamais le chemin normal (la colonne est `not null default 30` en base).
 */
function txFactice(delaiTenantDefaut: number | null = 30) {
  const whereUpdate = vi.fn(async () => undefined);
  const setUpdate = vi.fn(() => ({ where: whereUpdate }));
  const update = vi.fn((_table: unknown) => ({ set: setUpdate }));
  const valuesInsert = vi.fn(async () => undefined);
  const insert = vi.fn((_table: unknown) => ({ values: valuesInsert }));
  const limitSelect = vi.fn(async () =>
    delaiTenantDefaut === null ? [] : [{ delaiPaiementJoursDefaut: delaiTenantDefaut }],
  );
  const whereSelect = vi.fn(() => ({ limit: limitSelect }));
  const fromSelect = vi.fn(() => ({ where: whereSelect }));
  const select = vi.fn((_colonnes: unknown) => ({ from: fromSelect }));
  return {
    tx: { update, insert, select } as unknown as TransactionDfa,
    update,
    setUpdate,
    insert,
    select,
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
  const evenements = { publier: vi.fn(async () => undefined) };
  const compteurs = { prochainNumero: vi.fn(async () => 42) };
  const horloge = { maintenant: () => new Date('2026-07-30T10:00:00.000Z') };
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
  return { service };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([ligneFixture()]);
  vi.mocked(documentRequetes.sommerAvoirsEmisPourFacture).mockResolvedValue(0);
  // Aucun bloc créancier configuré pour ce tenant de test — hors sujet ici (`qr-emission.spec.ts`
  // couvre le bulletin QR lui-même), la construction QR est donc sautée entièrement.
  vi.mocked(qrEmission.resoudreBlocCreancierPourEmission).mockResolvedValue(null as never);
  vi.mocked(qrEmission.construireBlocQrPourEmission).mockResolvedValue({} as never);
});

describe('ServiceEmissionDocument.emettre — bloc créancier incomplet (garage neuf)', () => {
  const incomplet = (): ErreurMetier =>
    new ErreurMetier('QR_CREANCIER_INCOMPLET', 'Coordonnées bancaires du garage non renseignées.');

  it('facture + bloc créancier incomplet : émise (statut emis), aucune colonne QR écrite, avertissement FACTURE_SANS_QR', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(documentFixture());
    vi.mocked(qrEmission.resoudreBlocCreancierPourEmission).mockRejectedValue(incomplet());
    const { tx, setUpdate } = txFactice();
    const { service } = serviceFactice(tx);

    const resultat = await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE);

    expect(resultat.reponse.statutHttp).toBe(200);
    expect(resultat.reponse.corps.avertissements).toEqual([
      expect.objectContaining({ code: 'FACTURE_SANS_QR', donnees: { documentId: DOCUMENT_ID } }),
    ]);
    const ecrit = (setUpdate.mock.calls as unknown as Array<[Record<string, unknown>]>)
      .map(([v]) => v)
      .find((v) => v.statut === 'emis');
    expect(ecrit).toBeDefined();
    if (!ecrit) return;
    expect(ecrit).not.toHaveProperty('qrPayload');
    expect(ecrit).not.toHaveProperty('qrIban');
    expect(qrEmission.construireBlocQrPourEmission).not.toHaveBeenCalled();
  });

  it('facture + bloc créancier complet : pas d’avertissement, le QR est construit', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(documentFixture());
    vi.mocked(qrEmission.resoudreBlocCreancierPourEmission).mockResolvedValue({} as never);
    vi.mocked(qrEmission.construireBlocQrPourEmission).mockResolvedValue({
      qrIban: 'CH4431999123000889012',
      creancierNom: 'Garage',
      creancierRue: 'Rue',
      creancierNumero: '1',
      creancierNpa: '1000',
      creancierLocalite: 'Lausanne',
      creancierPays: 'CH',
      typeReferenceQr: 'QRR',
      qrReference: '0',
      qrMontantCentimes: 10_000,
      qrDevise: 'CHF',
      qrDebiteurPresent: false,
      qrPayload: 'SPC',
      qrPayloadSha256: 'x',
    } as never);
    const { tx } = txFactice();
    const { service } = serviceFactice(tx);

    const resultat = await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE);

    expect(resultat.reponse.corps.avertissements).toEqual([]);
    expect(qrEmission.construireBlocQrPourEmission).toHaveBeenCalledTimes(1);
  });

  it('devis : bloc créancier jamais consulté, aucun avertissement', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(
      documentFixture({ typeDocument: 'devis' }),
    );
    const { tx } = txFactice();
    const { service } = serviceFactice(tx);

    const resultat = await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE);

    expect(resultat.reponse.corps.avertissements).toEqual([]);
    expect(qrEmission.resoudreBlocCreancierPourEmission).not.toHaveBeenCalled();
  });

  it('une autre erreur de résolution du bloc reste fatale (jamais avalée)', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(documentFixture());
    vi.mocked(qrEmission.resoudreBlocCreancierPourEmission).mockRejectedValue(
      new ErreurMetier('ERREUR_INTERNE', 'boom'),
    );
    const { tx, setUpdate } = txFactice();
    const { service } = serviceFactice(tx);

    await expect(
      service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE),
    ).rejects.toMatchObject({ code: 'ERREUR_INTERNE' });
    const emis = (setUpdate.mock.calls as unknown as Array<[Record<string, unknown>]>).some(
      ([v]) => v.statut === 'emis',
    );
    expect(emis).toBe(false);
  });
});
