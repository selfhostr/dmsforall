import { beforeEach, describe, expect, it, vi } from 'vitest';
import { schemaModificationLigneDocument } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../db';
import type { LigneDocumentVente, LigneLigneDocument } from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';

/**
 * DÉFAUT CRITIQUE (argent) : `schemaModificationLigneDocument` (`@dfa/shared`,
 * `contrats/facturation/ligne.ts`) est un `formeLigneDocument.partial()` — `.partial()` rend
 * `quantiteMillieme`/`regimeTva` OPTIONNELS, il n'annule PAS leurs `.default(1000)`/`.default('normal')`.
 * Même mécanisme que F-01-bis (`common/validation/champs-envoyes.ts`), sur un domaine où la
 * conséquence est directement facturée : un `PATCH { designation: '…' }` qui ne touche QUE le libellé
 * d'une ligne fait ressortir `quantiteMillieme: 1000` et `regimeTva: 'normal'` du `.parse()` zod même
 * quand la ligne réelle porte une autre quantité/régime — `ServiceDocumentsVente.fusionnerLigne`
 * (`entree.quantiteMillieme ?? actuelle.quantiteMillieme`) retient alors TOUJOURS la valeur
 * fantôme, jamais `undefined`, et les montants sont RECALCULÉS sur cette base erronée puis écrits en
 * base — voir `service-documents.ts::modifierLigne`.
 *
 * Ce fichier prouve la mécanique en isolation (test 1, toujours vrai, indépendant du correctif) PUIS
 * le résultat de bout en bout sur `ServiceDocumentsVente.modifierLigne` (test 2, le test décisif).
 */
vi.mock('./document-requetes', () => ({
  chargerDocumentPourEcriture: vi.fn(),
  chargerLignePourEcriture: vi.fn(),
  listerLignesDocument: vi.fn(),
}));

vi.mock('./assujettissement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./assujettissement')>()),
  chargerSituationTva: vi.fn(),
}));

import { ServiceDocumentsVente } from './service-documents';
import * as documentRequetes from './document-requetes';
import * as assujettissement from './assujettissement';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const DOCUMENT_ID = 'document-1';
const LIGNE_ID = 'ligne-existante-1';

function principal(): PrincipalAuthentifie {
  return {
    sessionId: 'session-1',
    tenantId: 'tenant-a',
    utilisateurId: 'user-1',
    role: 'vendeur',
    langue: 'fr',
  };
}

function docFixture(overrides: Partial<LigneDocumentVente> = {}): LigneDocumentVente {
  return {
    id: DOCUMENT_ID,
    tenantId: 'tenant-a',
    typeDocument: 'facture',
    statut: 'brouillon',
    numero: null,
    ...overrides,
  } as unknown as LigneDocumentVente;
}

/**
 * Ligne RÉELLE : 3 unités à 10.00 CHF TTC pièce (taux réduit 2.6%, RÉGIME 'reduit') —
 * délibérément NON celle des défauts zod (`quantiteMillieme: 1000`, `regimeTva: 'normal'`), pour que
 * toute fuite d'un défaut fantôme soit visible dans les montants recalculés.
 */
function ligneExistanteFixture(overrides: Partial<LigneLigneDocument> = {}): LigneLigneDocument {
  return {
    id: LIGNE_ID,
    tenantId: 'tenant-a',
    documentId: DOCUMENT_ID,
    numeroOrdre: 1,
    typeLigne: 'piece',
    designation: 'Plaquettes de frein avant (lot de 3)',
    referenceTexte: null,
    quantiteMillieme: 3000,
    prixUnitaireCentimes: 1000,
    regimeTva: 'reduit',
    tauxTvaPourmille: 26,
    datePrestation: '2026-08-04',
    remisePourmille: null,
    remiseMontantCentimes: null,
    documentAcompteId: null,
    ...overrides,
  } as unknown as LigneLigneDocument;
}

function txFactice() {
  const whereUpdate = vi.fn(async () => undefined);
  const setUpdate = vi.fn((_valeurs: Record<string, unknown>) => ({ where: whereUpdate }));
  const update = vi.fn((_table: unknown) => ({ set: setUpdate }));
  return { tx: { update } as unknown as TransactionDfa, update, setUpdate, whereUpdate };
}

function serviceFactice(tx: TransactionDfa) {
  const acces = {
    enTenant: vi.fn((_ctx: unknown, travail: (tx: TransactionDfa) => Promise<unknown>) =>
      travail(tx),
    ),
  };
  const serviceMouvement = { trouverMouvementParLigneDocumentTx: vi.fn(async () => null) };
  const service = new ServiceDocumentsVente(
    acces as never,
    {} as never, // idempotence : jamais exercé par modifierLigne.
    { pourEntite: vi.fn(async () => []) } as never,
    { maintenant: () => new Date('2026-08-04T09:00:00.000Z') } as never,
    serviceMouvement as never,
  );
  service.assemblerDocument = vi.fn(async () => ({ id: DOCUMENT_ID })) as never;
  return { service, acces, serviceMouvement };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assujettissement.chargerSituationTva).mockResolvedValue({
    assujetti: true,
    numeroTva: 'CHE-123.456.789 TVA',
  });
});

describe('schemaModificationLigneDocument — mécanique du défaut (toujours vraie, indépendante du correctif)', () => {
  it("le .parse() d'un corps qui ne porte QUE `designation` fait ressortir quantiteMillieme=1000 et regimeTva='normal', jamais `undefined`", () => {
    const entreeParsee = schemaModificationLigneDocument.parse({ designation: 'x' });

    expect(entreeParsee.quantiteMillieme).toBe(1000);
    expect(entreeParsee.regimeTva).toBe('normal');
  });
});

describe('ServiceDocumentsVente.modifierLigne — un PATCH { designation } seul ne doit ni changer la quantité/le régime, ni recalculer les montants dessus (défaut critique, argent)', () => {
  it('quantité, régime et montants recalculés restent CEUX DE LA LIGNE D’ORIGINE (3 unités, taux réduit) — pas les défauts zod (1 unité, taux normal)', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(docFixture());
    vi.mocked(documentRequetes.chargerLignePourEcriture).mockResolvedValue(ligneExistanteFixture());
    const { tx, setUpdate } = txFactice();
    const { service } = serviceFactice(tx);
    // Corps RÉELLEMENT envoyé par le client — `modifierLigne` le parse et le filtre lui-même
    // (`neGarderQueChampsEnvoyes`, même patron que `ServiceClientSousCollections.modifierAdresse`).
    // AVANT LE CORRECTIF, ce même appel passait par `@CorpsZod` dans le contrôleur, qui remplissait
    // `quantiteMillieme`/`regimeTva` avec leurs défauts zod (1000/'normal') avant même d'atteindre
    // le service — c'est CE test qui rougissait sur le défaut (voir le rapport de livraison).
    const corpsBrut = { designation: 'Plaquettes de frein avant (lot de 3, réf. mise à jour)' };

    await service.modifierLigne(CTX, principal(), DOCUMENT_ID, LIGNE_ID, corpsBrut);

    expect(setUpdate).toHaveBeenCalledTimes(1);
    const ecrit = setUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
    // Quantité et régime INCHANGÉS — jamais écrasés par les défauts zod (1000 / 'normal').
    expect(ecrit.quantiteMillieme).toBe(3000);
    expect(ecrit.regimeTva).toBe('reduit');
    expect(ecrit.tauxTvaPourmille).toBe(26);
    // Montants recalculés sur la VRAIE quantité (3 × 10.00 CHF TTC, TVA réduite 2.6%) — valeurs
    // exactes en centimes, arrondi commercial MD-40 (demi éloigné de zéro) :
    //   base = 1000 × 3000 / 1000               = 3000
    //   ttc   = base (aucune remise)              = 3000
    //   tva   = arrondi(3000 × 26 / 1026)         = 76   (78000/1026 = 76.02…)
    //   ht    = ttc − tva                          = 2924
    expect(ecrit.baseCentimes).toBe(3000);
    expect(ecrit.ttcCentimes).toBe(3000);
    expect(ecrit.tvaCentimes).toBe(76);
    expect(ecrit.htCentimes).toBe(2924);
  });

  it('corps vide {} : refuse VALIDATION_ECHOUEE avant toute écriture (même garde que modifierAdresse, F-01)', async () => {
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(docFixture());
    vi.mocked(documentRequetes.chargerLignePourEcriture).mockResolvedValue(ligneExistanteFixture());
    const { tx, setUpdate } = txFactice();
    const { service } = serviceFactice(tx);

    await expect(
      service.modifierLigne(CTX, principal(), DOCUMENT_ID, LIGNE_ID, {}),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });

    expect(setUpdate).not.toHaveBeenCalled();
  });
});

describe('ServiceDocumentsVente.modifierLigne — garage NON assujetti à la TVA', () => {
  beforeEach(() => {
    vi.mocked(assujettissement.chargerSituationTva).mockResolvedValue({
      assujetti: false,
      numeroTva: null,
    });
    vi.mocked(documentRequetes.chargerDocumentPourEcriture).mockResolvedValue(docFixture());
    vi.mocked(documentRequetes.chargerLignePourEcriture).mockResolvedValue(ligneExistanteFixture());
  });

  it('taux absent = 0 : une ligne héritée à 2.6 % passe à 0 ‰ / exclu, HT = TTC = 3000', async () => {
    const { tx, setUpdate } = txFactice();
    const { service } = serviceFactice(tx);

    await service.modifierLigne(CTX, principal(), DOCUMENT_ID, LIGNE_ID, { designation: 'Lot' });

    const ecrit = setUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(ecrit.tauxTvaPourmille).toBe(0);
    expect(ecrit.regimeTva).toBe('exclu');
    expect(ecrit.tvaCentimes).toBe(0);
    expect(ecrit.htCentimes).toBe(3000);
    expect(ecrit.ttcCentimes).toBe(3000);
  });

  it('taux > 0 refusé : TVA_NON_ASSUJETTI_TAUX_INTERDIT, rien écrit', async () => {
    const { tx, setUpdate } = txFactice();
    const { service } = serviceFactice(tx);

    await expect(
      service.modifierLigne(CTX, principal(), DOCUMENT_ID, LIGNE_ID, {
        tauxTvaPourmille: 81,
        regimeTva: 'normal',
      }),
    ).rejects.toMatchObject({ code: 'TVA_NON_ASSUJETTI_TAUX_INTERDIT' });
    expect(setUpdate).not.toHaveBeenCalled();
  });

  it('taux 0 explicite accepté, régime forcé à exclu même si « normal » envoyé', async () => {
    const { tx, setUpdate } = txFactice();
    const { service } = serviceFactice(tx);

    await service.modifierLigne(CTX, principal(), DOCUMENT_ID, LIGNE_ID, {
      tauxTvaPourmille: 0,
      regimeTva: 'normal',
    });

    const ecrit = setUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(ecrit.regimeTva).toBe('exclu');
    expect(ecrit.tauxTvaPourmille).toBe(0);
  });
});
