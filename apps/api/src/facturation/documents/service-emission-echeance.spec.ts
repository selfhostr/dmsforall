import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContexteTenant, TransactionDfa } from '../../db';
import { documentVente, type LigneDocumentVente, type LigneLigneDocument } from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';

/**
 * RF-04/PF-04/MD-94 : `ServiceEmissionDocument.emettre()` FIGE `date_echeance` au moment où le
 * document devient verrouillé — même patron de mock que `service-emission-marquage-vendu.spec.ts`
 * (`document-requetes`/`qr-emission` moqués, transaction factice qui enregistre l'appel
 * `update(documentVente).set(...)`). Le calcul arithmétique lui-même (délai → date, jours de
 * retard) est couvert exhaustivement par `echeance.spec.ts` ; ce fichier prouve seulement le
 * CÂBLAGE : la bonne valeur, lue sur `conditions_paiement_figees` PUIS (issue #17, migration
 * 0046) sur le défaut du tenant en repli, atterrit dans le `.set()` qui transitionne
 * `brouillon → emis`, uniquement pour une FACTURE, jamais pour les trois autres types.
 *
 * `txFactice(delaiTenantDefaut)` mocke désormais aussi `tx.select(...)` — c'est le chemin que
 * `chargerDelaiPaiementJoursDefautTenant` (`references.ts`) emprunte pour lire
 * `tenant.delai_paiement_jours_defaut`, appelé UNIQUEMENT quand le client n'a lui-même aucun
 * délai figé (voir `service-emission.ts`, section 3.6).
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
  return { tx: { update, insert, select } as unknown as TransactionDfa, update, setUpdate, insert, select };
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

describe("ServiceEmissionDocument.emettre — date_echeance figée à l'émission (RF-04/PF-04/MD-94)", () => {
  it('facture avec délai de paiement figé (30 jours) : date_echeance = dateDocument + 30 jours, écrite dans le même UPDATE que statut=emis', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(documentFixture());
    const { tx, setUpdate } = txFactice();
    const { service } = serviceFactice(tx);

    const resultat = await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE);

    expect(resultat.reponse.statutHttp).toBe(200);
    expect(setUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ statut: 'emis', dateEcheance: '2026-07-31' }) as unknown,
    );
  });

  it("facture SANS délai de paiement connu (client sans conditions figées, {} d'origine) : bascule sur le défaut TENANT (issue #17, migration 0046) — n'est plus null", async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(
      documentFixture({ conditionsPaiementFigees: {} }),
    );
    // Défaut tenant = 30 jours (valeur par défaut réelle de tenant.delai_paiement_jours_defaut).
    const { tx, setUpdate, select } = txFactice(30);
    const { service } = serviceFactice(tx);

    await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE);

    // dateDocument = '2026-07-01' (documentFixture) + 30 jours = '2026-07-31'.
    expect(setUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ statut: 'emis', dateEcheance: '2026-07-31' }) as unknown,
    );
    // La requête tenant n'est posée QUE dans ce cas résiduel (client sans délai propre) — pas
    // dans le premier test de ce fichier (délai client déjà connu).
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('bascule sur un défaut tenant DIFFÉRENT de 30 quand il a été paramétré ainsi (paramétrable, pas codé en dur)', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(
      documentFixture({ conditionsPaiementFigees: {} }),
    );
    const { tx, setUpdate } = txFactice(45);
    const { service } = serviceFactice(tx);

    await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE);

    // '2026-07-01' + 45 jours = '2026-08-15'.
    expect(setUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ statut: 'emis', dateEcheance: '2026-08-15' }) as unknown,
    );
  });

  it('ne consulte JAMAIS le défaut tenant quand le client a déjà un délai propre (même 0, payable à réception)', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(
      documentFixture({ conditionsPaiementFigees: { delaiPaiementJours: 0 } }),
    );
    const { tx, setUpdate, select } = txFactice(30);
    const { service } = serviceFactice(tx);

    await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE);

    expect(setUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ statut: 'emis', dateEcheance: '2026-07-01' }) as unknown,
    );
    expect(select).not.toHaveBeenCalled();
  });

  it('tenant introuvable (cas résiduel) ET client sans délai propre : date_echeance reste null — jamais fabriquée', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(
      documentFixture({ conditionsPaiementFigees: {} }),
    );
    const { tx, setUpdate } = txFactice(null);
    const { service } = serviceFactice(tx);

    await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE);

    expect(setUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ statut: 'emis', dateEcheance: null }) as unknown,
    );
  });

  it.each(['devis', 'bon_commande'] as const)(
    '%s : date_echeance TOUJOURS null (aucune échéance de paiement pour ces types), même avec un délai de paiement figé',
    async (typeDocument) => {
      vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(
        documentFixture({ typeDocument }),
      );
      const { tx, setUpdate } = txFactice();
      const { service } = serviceFactice(tx);

      await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE);

      expect(setUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ statut: 'emis', dateEcheance: null }) as unknown,
      );
    },
  );

  it("aucune écriture document_vente ne cible date_echeance en dehors de CE UPDATE (verrouillage MD-20) : preuve indirecte — un seul appel update(documentVente) pour toute l'émission", async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(documentFixture());
    const { tx, update } = txFactice();
    const { service } = serviceFactice(tx);

    await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE);

    const appelsDocumentVente = update.mock.calls.filter((appel) => appel[0] === documentVente);
    expect(appelsDocumentVente).toHaveLength(1);
  });
});
