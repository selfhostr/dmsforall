import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContexteTenant, TransactionDfa } from '../../db';
import { documentVente, type LigneDocumentVente, type LigneLigneDocument } from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';

/**
 * BUG CORRIGÉ (encours clients du tableau de bord, MD-53) : `document_vente.solde_centimes`
 * (défaut 0, migration 0010) n'était JAMAIS initialisé à l'émission — seule une imputation de
 * paiement ultérieure l'écrivait (`facturation/paiements/imputations.ts::
 * recalculerDocumentApresImputation`). Une facture émise puis jamais réglée restait donc à
 * `solde_centimes = 0`, et `tableau-bord/service-tableau-bord-financier.ts` (qui somme
 * `solde_centimes` des factures `emis` pour `encoursClientsCentimes`) sous-évaluait l'encours —
 * prouvé en ROUGE par `apps/api/test/integration/tableau-bord/financier-arithmetique.spec.ts`
 * (« une facture ÉMISE jamais payée augmente l'encours de tenant A d'EXACTEMENT son TTC »).
 *
 * `update` est un mock GÉNÉRIQUE partagé par TOUT `tx.update(<table>)` dans `emettre()` — pas
 * seulement `document_vente` : l'étape 2 (ventilation de la remise globale) appelle aussi
 * `tx.update(ligneDocument)`, une fois PAR LIGNE. `txFactice` ci-dessous capture donc CHAQUE appel
 * comme une paire `{ table, valeurs }`, et `argumentDocumentVente()` filtre par IDENTITÉ DE TABLE —
 * jamais par position (`calls[0]` capturerait la mise à jour d'une ligne, pas celle du document).
 *
 * Valeurs exactes uniquement — AUCUN `toBeCloseTo` sur de l'argent.
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
const CLE_IDEMPOTENCE = '55555555-5555-4555-8555-555555555555';

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
  // Issue #17/migration 0046 : une facture dont `conditionsPaiementFigees` n'a pas de délai
  // client (le cas de `documentFixture()` ci-dessus, `{}`) déclenche désormais un repli sur
  // `tenant.delai_paiement_jours_defaut` (`chargerDelaiPaiementJoursDefautTenant`, hors sujet
  // dans ce fichier qui teste `solde_centimes` — 30 est une valeur de repli neutre).
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

/** Retrouve les `valeurs` du (ou des) `.set()` posé(s) sur `document_vente` parmi tous les
 *  `tx.update(<table>)` capturés — voir la note d'en-tête sur `txFactice`. */
function argumentsDocumentVente(appelsUpdate: readonly AppelUpdate[]): Record<string, unknown>[] {
  return appelsUpdate.filter((a) => a.table === documentVente).map((a) => a.valeurs);
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
  return { service };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(documentRequetes.sommerAvoirsEmisPourFacture).mockResolvedValue(0);
  // Aucun bloc créancier configuré pour ce tenant de test — hors sujet ici, la construction QR est
  // donc sautée entièrement (même doctrine que service-emission-echeance.spec.ts).
  vi.mocked(qrEmission.resoudreBlocCreancierPourEmission).mockResolvedValue(null as never);
  vi.mocked(qrEmission.construireBlocQrPourEmission).mockResolvedValue({} as never);
});

describe("ServiceEmissionDocument.emettre — solde_centimes initialisé à l'émission (MD-53, correctif encours clients)", () => {
  it('facture de 7’000 c. TTC, jamais payée : solde_centimes = 7000 EXACTEMENT, écrit dans le MÊME update(document_vente) que statut=emis', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(documentFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      ligneFixture(7_000),
    ]);
    const { tx, appelsUpdate } = txFactice();
    const { service } = serviceFactice(tx);

    const resultat = await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE);

    expect(resultat.reponse.statutHttp).toBe(200);
    const [argument] = argumentsDocumentVente(appelsUpdate);
    expect(argument).toMatchObject({
      statut: 'emis',
      totalTtcCentimes: 7_000n,
      soldeCentimes: 7_000n,
    });
  });

  it('facture avec deux lignes (2’457’000 c. TTC) : solde_centimes = totalTtcCentimes EXACTEMENT, jamais une approximation', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(documentFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      ligneFixture(7_000),
      ligneFixture(24_500_00),
    ]);
    const { tx, appelsUpdate } = txFactice();
    const { service } = serviceFactice(tx);

    await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE);

    const [argument] = argumentsDocumentVente(appelsUpdate);
    expect(argument).toMatchObject({
      totalTtcCentimes: 2_457_000n,
      soldeCentimes: 2_457_000n,
    });
  });

  it('avoir de -3’500 c. TTC (total NÉGATIF par construction) : solde_centimes = 3500 — POSITIF (abs), même convention que recalculerDocumentApresImputation, jamais le signe brut du total', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(
      documentFixture({
        typeDocument: 'avoir',
        factureAnnuleeId: 'facture-annulee-1',
        porteeAvoir: 'partiel',
      }),
    );
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      ligneFixture(-3_500),
    ]);
    const { tx, appelsUpdate } = txFactice();
    const { service } = serviceFactice(tx);

    const resultat = await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE);

    expect(resultat.reponse.statutHttp).toBe(200);
    const [argument] = argumentsDocumentVente(appelsUpdate);
    expect(argument).toMatchObject({
      totalTtcCentimes: -3_500n,
      soldeCentimes: 3_500n,
    });
  });

  it.each(['devis', 'bon_commande'] as const)(
    '%s : solde_centimes JAMAIS posé par le update(document_vente) de l’émission (clé absente) — non payable, MD-50/RF-114',
    async (typeDocument) => {
      vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(
        documentFixture({ typeDocument }),
      );
      vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
        ligneFixture(7_000),
      ]);
      const { tx, appelsUpdate } = txFactice();
      const { service } = serviceFactice(tx);

      await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE);

      const [argument] = argumentsDocumentVente(appelsUpdate);
      expect(argument?.statut).toBe('emis');
      expect(argument ? Object.hasOwn(argument, 'soldeCentimes') : true).toBe(false);
    },
  );

  it("un SEUL update(document_vente) pour toute l'émission : solde_centimes et statut='emis' sont la MÊME écriture, jamais une opération à part qui pourrait échouer seule", async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(documentFixture());
    vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
      ligneFixture(7_000),
    ]);
    const { tx, appelsUpdate } = txFactice();
    const { service } = serviceFactice(tx);

    await service.emettre(CTX, principal(), DOCUMENT_ID, CLE_IDEMPOTENCE);

    expect(argumentsDocumentVente(appelsUpdate)).toHaveLength(1);
  });
});
