import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContexteTenant, TransactionDfa } from '../../db';
import { type LigneDocumentVente, type LigneLigneDocument } from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';

/**
 * RV-37/MD-70 : câblage `ServiceEmissionDocument.emettre()` → `ServiceVehiculeStock.marquerVendu`
 * pour une FACTURE rattachée à un dossier de vente (`document_vente.dossier_vente_id`) — le
 * bloqueur d'origine était `dossier.documents` toujours vide (colonne jamais écrite), qui rendait
 * `POST /dossiers-vente/{id}/engager` inutilisable et `livrer()` bloqué à jamais (voir
 * `ventes/service-vehicule-stock.ts::marquerVendu`, section « TROU COMBLÉ »).
 *
 * PAS la même transaction SQL que l'écriture de `document_vente` (limite technique DOCUMENTÉE dans
 * `marquerVehiculeVenduSiApplicable`, `service-emission.ts` — `ServiceVehiculeStock.marquerVendu`
 * ouvre sa PROPRE transaction via `AccesBase.enTenant`/`Pool.connect()`, jamais un `SAVEPOINT`
 * imbriqué dans le `tx` déjà ouvert de l'émission). Conséquence assumée et prouvée ici : la facture
 * est TOUJOURS émise (200, verrouillée, numéro consommé) que le marquage réussisse ou non — un échec
 * de marquage ne doit JAMAIS annuler une facture déjà commise (ce serait de toute façon interdit par
 * MD-20/MD-21 : seul un avoir corrige un document émis). Il dégrade en avertissement journalisé,
 * jamais en 500 ni en silence.
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
const FACTURE_ID = 'facture-1';
const DOSSIER_ID = 'dossier-1';
const VEHICULE_ID = 'vehicule-1';
const NUMERO = '2026-00318';
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
    statut: 'brouillon',
    numero: null,
    numeroSequence: null,
    exercice: null,
    dateDocument: null,
    clientId: 'client-1',
    clientDesignationFigee: 'Jean Dupont',
    langueFigee: 'fr',
    adresseFacturationFigee: {},
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
    factureAnnuleeId: null,
    porteeAvoir: null,
    devise: 'CHF',
    ...overrides,
  } as unknown as LigneDocumentVente;
}

/** Ligne unique, TVA à 0‰ pour que `ttcCentimes = prixUnitaireCentimes` exactement — la précision
 *  de l'arrondi TVA est hors sujet ici (déjà couverte par `calcul-document.spec.ts`). */
function ligneFixture(prixUnitaireCentimes: number): LigneLigneDocument {
  return {
    id: 'ligne-1',
    tenantId: 'tenant-a',
    documentId: FACTURE_ID,
    numeroOrdre: 1,
    typeLigne: 'forfait',
    designation: 'Véhicule Golf 2.0 TDI',
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

function txFactice() {
  const whereUpdate = vi.fn(async () => undefined);
  const setUpdate = vi.fn(() => ({ where: whereUpdate }));
  const update = vi.fn((_table: unknown) => ({ set: setUpdate }));
  const valuesInsert = vi.fn(async () => undefined);
  const insert = vi.fn((_table: unknown) => ({ values: valuesInsert }));
  // Issue #17/migration 0046 : `factureFixture()` ne porte pas de `conditionsPaiementFigees`, donc
  // `emettre()` bascule sur `tenant.delai_paiement_jours_defaut` (`chargerDelaiPaiementJoursDefaut
  // Tenant`) — hors sujet dans ce fichier (marquage vendu du véhicule), 30 est une valeur neutre.
  const select = vi.fn((_colonnes: unknown) => ({
    from: () => ({ where: () => ({ limit: async () => [{ delaiPaiementJoursDefaut: 30 }] }) }),
  }));
  return { tx: { update, insert, select } as unknown as TransactionDfa, update, insert };
}

/** Document assemblé rendu par `ServiceDocumentsVente.assemblerDocument` — c'est CE retour, pas la
 *  ligne brute de `chargerDocumentPourEcriture`, que `marquerVehiculeVenduSiApplicable` lit
 *  (`resultat.reponse.corps.donnees`), puisqu'il s'exécute APRÈS la fin de la transaction
 *  d'émission (voir la docstring de la méthode). */
function documentAssembleFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: FACTURE_ID,
    typeDocument: 'facture',
    numero: NUMERO,
    dossierVenteId: DOSSIER_ID,
    vehiculeId: VEHICULE_ID,
    ...overrides,
  };
}

function serviceFactice(tx: TransactionDfa, assemble: unknown) {
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
  const compteurs = { prochainNumero: vi.fn(async () => 318) };
  const horloge = { maintenant: () => new Date('2026-07-30T10:00:00.000Z') };
  const documents = { assemblerDocument: vi.fn(async () => assemble) };
  const vehiculeStock = { marquerVendu: vi.fn(async () => ({ donnees: {}, avertissements: [] })) };
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
  vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(factureFixture());
  vi.mocked(documentRequetes.listerLignesDocumentPourEcriture).mockResolvedValue([
    ligneFixture(3_500_000), // CHF 35'000.-
  ]);
  // `null` : aucun bloc créancier configuré pour ce tenant de test — `blocQr` reste alors `null`
  // lui aussi (`service-emission.ts` : `blocQr = blocCreancier ? await construireBlocQr... : null`),
  // ce qui saute la construction QR entièrement. Hors sujet ici (couvert par `qr-emission.spec.ts`
  // ailleurs) : seul le câblage RV-37 après l'émission est sous test dans ce fichier.
  vi.mocked(qrEmission.resoudreBlocCreancierPourEmission).mockResolvedValue(null as never);
  vi.mocked(qrEmission.construireBlocQrPourEmission).mockResolvedValue({} as never);
});

describe("ServiceEmissionDocument.emettre — marquage vendu du véhicule d'un dossier de vente (RV-37)", () => {
  it('facture rattachée à un dossier de vente : émission réussie ET véhicule marqué vendu, motif portant le numéro, aucun avertissement', async () => {
    const { tx } = txFactice();
    const { service, vehiculeStock } = serviceFactice(tx, documentAssembleFixture());

    const resultat = await service.emettre(
      CTX,
      principal('direction'),
      FACTURE_ID,
      CLE_IDEMPOTENCE,
    );

    expect(resultat.reponse.statutHttp).toBe(200);
    expect(resultat.reponse.corps.avertissements).toEqual([]);
    expect(vehiculeStock.marquerVendu).toHaveBeenCalledTimes(1);
    expect(vehiculeStock.marquerVendu).toHaveBeenCalledWith(CTX, 'direction', VEHICULE_ID, {
      motif: expect.stringContaining(NUMERO) as unknown as string,
    });
  });

  it('facture SANS dossier de vente : ServiceVehiculeStock.marquerVendu jamais appelé (comportement inchangé, non-régression étape 2)', async () => {
    const { tx } = txFactice();
    const { service, vehiculeStock } = serviceFactice(
      tx,
      documentAssembleFixture({ dossierVenteId: null, vehiculeId: null }),
    );

    const resultat = await service.emettre(
      CTX,
      principal('direction'),
      FACTURE_ID,
      CLE_IDEMPOTENCE,
    );

    expect(resultat.reponse.statutHttp).toBe(200);
    expect(resultat.reponse.corps.avertissements).toEqual([]);
    expect(vehiculeStock.marquerVendu).not.toHaveBeenCalled();
  });

  it('devis/bon de commande rattaché à un dossier de vente : jamais de marquage vendu (RV-37 ne concerne que la FACTURE)', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(
      factureFixture({ typeDocument: 'bon_commande' }),
    );
    const { tx } = txFactice();
    const { service, vehiculeStock } = serviceFactice(
      tx,
      documentAssembleFixture({ typeDocument: 'bon_commande' }),
    );

    const resultat = await service.emettre(
      CTX,
      principal('direction'),
      FACTURE_ID,
      CLE_IDEMPOTENCE,
    );

    expect(resultat.reponse.statutHttp).toBe(200);
    expect(vehiculeStock.marquerVendu).not.toHaveBeenCalled();
  });

  it(
    "le marquage vendu ÉCHOUE après l'émission (véhicule déjà repris entre-temps, ou toute autre cause) : " +
      'la facture reste ÉMISE (200, numéro consommé) — jamais annulée, jamais 500 — et un avertissement ' +
      'VENTE_VEHICULE_MARQUAGE_VENDU_ECHOUE porte le détail. Preuve directe que ce chemin ne peut PAS ' +
      "produire l'incohérence interdite « véhicule vendu sans facture » : ici c'est la facture qui est " +
      "déjà commise avant même la tentative de marquage, jamais l'inverse.",
    async () => {
      const { tx } = txFactice();
      const { service, vehiculeStock } = serviceFactice(tx, documentAssembleFixture());
      vehiculeStock.marquerVendu.mockRejectedValueOnce(
        new Error(
          "Marquage vendu impossible : le véhicule n'est pas réservé (statut actuel : disponible).",
        ),
      );

      const resultat = await service.emettre(
        CTX,
        principal('direction'),
        FACTURE_ID,
        CLE_IDEMPOTENCE,
      );

      expect(resultat.reponse.statutHttp).toBe(200);
      expect(resultat.reponse.corps.donnees).toMatchObject({ id: FACTURE_ID, numero: NUMERO });
      expect(resultat.reponse.corps.avertissements).toHaveLength(1);
      expect(resultat.reponse.corps.avertissements[0]).toMatchObject({
        code: 'VENTE_VEHICULE_MARQUAGE_VENDU_ECHOUE',
        donnees: { documentId: FACTURE_ID, dossierVenteId: DOSSIER_ID, vehiculeId: VEHICULE_ID },
      });
    },
  );

  it("facture rattachée à un dossier de vente mais SANS vehiculeId (donnée incohérente) : jamais appelé, avertissement explicite plutôt qu'un crash", async () => {
    const { tx } = txFactice();
    const { service, vehiculeStock } = serviceFactice(
      tx,
      documentAssembleFixture({ vehiculeId: null }),
    );

    const resultat = await service.emettre(
      CTX,
      principal('direction'),
      FACTURE_ID,
      CLE_IDEMPOTENCE,
    );

    expect(resultat.reponse.statutHttp).toBe(200);
    expect(vehiculeStock.marquerVendu).not.toHaveBeenCalled();
    expect(resultat.reponse.corps.avertissements).toEqual([
      expect.objectContaining({ code: 'VENTE_VEHICULE_MARQUAGE_VENDU_ECHOUE' }) as unknown,
    ]);
  });

  it(
    'DÉFAUT CORRIGÉ (RPP-06) : quand `ServiceVehiculeStock.marquerVendu` réussit ET produit un ' +
      "avertissement (dépôt de pneus encore ouvert), l'émission de la facture le remonte dans sa " +
      "propre réponse — jusqu'ici la méthode rendait `null` inconditionnellement sur un marquage " +
      'réussi, jetant en silence tout avertissement produit par `marquerVendu`.',
    async () => {
      const { tx } = txFactice();
      const { service, vehiculeStock } = serviceFactice(tx, documentAssembleFixture());
      vehiculeStock.marquerVendu.mockResolvedValueOnce({
        donnees: {},
        avertissements: [
          {
            code: 'VEHICULE_DEPOTS_PNEUS_OUVERTS',
            message: '1 dépôt(s) de pneus encore ouvert(s) pour ce véhicule vendu.',
            donnees: { depotsOuverts: [{ id: 'depot-1', saison: 'hiver', statut: 'en_depot' }] },
          },
        ],
      } as never);

      const resultat = await service.emettre(
        CTX,
        principal('direction'),
        FACTURE_ID,
        CLE_IDEMPOTENCE,
      );

      expect(resultat.reponse.statutHttp).toBe(200);
      expect(resultat.reponse.corps.avertissements).toEqual([
        expect.objectContaining({ code: 'VEHICULE_DEPOTS_PNEUS_OUVERTS' }) as unknown,
      ]);
    },
  );

  it('un REJEU idempotent (Idempotency-Key déjà traitée) ne retente JAMAIS le marquage — même doctrine que `evenements.publier`, jamais réémis au rejeu', async () => {
    const { tx } = txFactice();
    const { service, vehiculeStock, idempotence } = serviceFactice(tx, documentAssembleFixture());
    // Simule un rejeu : `idempotence.executer` rend `rejoue: true` sans jamais appeler `travail`
    // (donc sans jamais toucher `chargerDocumentPourEcriture`/le reste du flux d'émission).
    idempotence.executer.mockResolvedValueOnce({
      reponse: {
        statutHttp: 200,
        corps: { donnees: documentAssembleFixture(), avertissements: [] },
      },
      rejoue: true,
    });

    const resultat = await service.emettre(
      CTX,
      principal('direction'),
      FACTURE_ID,
      CLE_IDEMPOTENCE,
    );

    expect(resultat.rejoue).toBe(true);
    expect(vehiculeStock.marquerVendu).not.toHaveBeenCalled();
  });
});
