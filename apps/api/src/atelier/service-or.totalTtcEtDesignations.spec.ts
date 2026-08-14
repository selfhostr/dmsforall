import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContexteTenant, TransactionDfa } from '../db';
import type { LigneClient, LigneLigneOr, LigneOrdreReparation, LigneVehicule } from '../db/schema';
import type { EntreeAudit, ServiceAudit } from '../common/audit';

/**
 * #76/#82 : `ServiceOr.assemblerDocument` (backing `GET /ordres-reparation` — voir sa doc de tête,
 * `pourListe = true` depuis `lister()`) ne rendait ni `totalTtcCentimes` ni `designationsApercu` —
 * confirmé en exécution réelle (`GET /ordres-reparation?statut=facture` sur un OR déjà facturé
 * rendait un objet sans ces deux clés). Ce fichier prouve les DEUX calculs, la garde par rôle du
 * premier, et le bornage du second — même patron de mock que `service-or.assemblerDocument.spec.ts`
 * (query builder sans pilote réel, `LigneLigneOr` fixture reprise de `service-ligne-or.spec.ts`).
 */
vi.mock('./or-requetes', () => ({
  chargerOr: vi.fn(),
  chargerControleQualite: vi.fn().mockResolvedValue(null),
  listerDemandesOr: vi.fn().mockResolvedValue([]),
  listerLignesOr: vi.fn(),
  listerDevisOr: vi.fn().mockResolvedValue([]),
  listerLignesDevis: vi.fn().mockResolvedValue([]),
}));
vi.mock('./references', () => ({
  chargerClientLigne: vi.fn(),
  chargerVehiculeLigne: vi.fn(),
  chargerPlaqueCourante: vi.fn().mockResolvedValue(null),
  construireVehiculeResume: vi.fn().mockReturnValue({ id: 'vehicule-1', designation: 'VW Golf' }),
  versClientResume: vi.fn().mockResolvedValue({ id: 'client-1', nomAffiche: 'Jean Dupont' }),
  chargerResumesUtilisateurs: vi.fn().mockResolvedValue(new Map()),
}));

import { ServiceOr } from './service-or';
import * as orRequetes from './or-requetes';
import * as references from './references';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const OR_ID = 'or-1';
const TX_FACTICE = {} as TransactionDfa;

function orFixture(): LigneOrdreReparation {
  return {
    id: OR_ID,
    tenantId: 'tenant-a',
    numero: 'OR-2026-042',
    siteId: 'site-1',
    type: 'reparation',
    statut: 'facture',
    clientId: 'client-1',
    vehiculeId: 'vehicule-1',
    clientDesignationFigee: 'Jean Dupont',
    adresseFacturationFigee: {},
    conditionsFigees: {},
    plaqueFigee: 'VD 123456',
    detenteurFigeClientId: null,
    conducteurPresentNom: null,
    kmEntree: 85_000,
    kmSortie: null,
    plafondCentimes: null,
    plafondAutorisePar: null,
    restitutionPromiseLe: null,
    restitutionInitialeLe: null,
    localisation: 'atelier',
    sousTraitantNom: null,
    ordreReparationParentId: null,
    motifLien: null,
    rendezVousId: null,
    numeroCommandeInterne: null,
    receptionnaireId: 'user-1',
    retentionInvoqueeLe: null,
    litigeOuvertLe: null,
    ouvertLe: new Date('2026-07-28T07:00:00.000Z'),
    termineLe: new Date('2026-07-28T08:00:00.000Z'),
    factureLe: new Date('2026-07-28T09:00:00.000Z'),
    restitueLe: null,
    clotureLe: null,
    annuleLe: null,
    motifAnnulation: null,
    attenteAccord: false,
    attentePieces: false,
    attenteExterne: false,
    totalValideCentimes: 21_648,
    version: 1,
    creeLe: new Date('2026-07-28T07:00:00.000Z'),
    modifieLe: new Date('2026-07-28T09:00:00.000Z'),
  } as LigneOrdreReparation;
}

function ligneFixture(id: string, overrides: Partial<LigneLigneOr> = {}): LigneLigneOr {
  return {
    id,
    tenantId: 'tenant-a',
    ordreReparationId: OR_ID,
    numeroOrdre: 1,
    type: 'piece',
    origine: 'proposee',
    statut: 'validee',
    payeur: 'client',
    blocage: 'aucun',
    designation: 'Plaquettes de frein avant',
    referenceTexte: null,
    articleId: null,
    quantiteMillieme: 1000,
    tempsBaremeCentiemes: null,
    tempsBaremeConstructeurCentiemes: null,
    tauxHoraireCentimes: null,
    prixUnitaireCentimes: 8_000,
    rabaisPourmille: 0,
    tauxTvaPourmille: 81,
    montantHtCentimes: 8_000,
    montantTvaCentimes: 648,
    montantTtcCentimes: 8_648,
    technicienId: null,
    codeOperation: null,
    codeDefaut: null,
    numeroSinistre: null,
    numeroAccord: null,
    urgence: 'a_surveiller',
    securite: false,
    fourniParClient: false,
    aRestituer: false,
    restituee: false,
    motifAnnulation: null,
    factureId: null,
    payeurClientId: null,
    creeLe: new Date('2026-07-28T07:00:00.000Z'),
    modifieLe: new Date('2026-07-28T07:00:00.000Z'),
    ...overrides,
  } as LigneLigneOr;
}

function auditFactice(): ServiceAudit {
  return {
    pourEntite: vi.fn(),
    pourEntiteTx: vi.fn().mockResolvedValue([] as readonly EntreeAudit[]),
    pourEntitesTx: vi.fn(),
  };
}

function pointageFactice() {
  return { pointagesOuvertsPourOr: vi.fn().mockResolvedValue([]) };
}

function horlogeFactice() {
  return { maintenant: () => new Date('2026-08-12T09:00:00.000Z') };
}

function serviceFactice() {
  return new ServiceOr(
    {} as never,
    {} as never,
    {} as never,
    auditFactice(),
    {} as never,
    pointageFactice() as never,
    {} as never,
    horlogeFactice() as never,
  );
}

beforeEach(() => {
  // `vitest.config.ts` pose `restoreMocks: true` (global) : les implémentations posées dans la
  // factory `vi.mock(...)` ci-dessus (ex. `listerDemandesOr: vi.fn().mockResolvedValue([])`) sont
  // RESTAURÉES (effacées) avant CHAQUE test, pas seulement `mock.calls` — même piège que
  // `service-or.assemblerDocument.spec.ts` a déjà rencontré, même remède : tout redéclarer ICI,
  // jamais compter sur le défaut de factory pour survivre au premier test.
  vi.clearAllMocks();
  vi.mocked(orRequetes.chargerOr).mockResolvedValue(orFixture());
  vi.mocked(orRequetes.chargerControleQualite).mockResolvedValue(null);
  vi.mocked(orRequetes.listerDemandesOr).mockResolvedValue([]);
  vi.mocked(orRequetes.listerDevisOr).mockResolvedValue([]);
  vi.mocked(orRequetes.listerLignesDevis).mockResolvedValue([]);
  vi.mocked(references.chargerClientLigne).mockResolvedValue({ id: 'client-1' } as LigneClient);
  vi.mocked(references.chargerVehiculeLigne).mockResolvedValue({
    id: 'vehicule-1',
  } as LigneVehicule);
  vi.mocked(references.chargerPlaqueCourante).mockResolvedValue(null);
  vi.mocked(references.versClientResume).mockResolvedValue({
    id: 'client-1',
    nomAffiche: 'Jean Dupont',
  } as never);
  vi.mocked(references.construireVehiculeResume).mockReturnValue({
    id: 'vehicule-1',
    designation: 'VW Golf',
  } as never);
  vi.mocked(references.chargerResumesUtilisateurs).mockResolvedValue(new Map());
});

describe('ServiceOr.assemblerDocument — totalTtcCentimes (#76)', () => {
  it('somme les montantTtcCentimes des lignes validee/proposee, exclut annulee/refusee, pour un rôle qui voit les montants', async () => {
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([
      ligneFixture('l-1', { statut: 'validee', montantTtcCentimes: 8_648 }),
      ligneFixture('l-2', { statut: 'a_valider', montantTtcCentimes: 13_000 }),
      ligneFixture('l-3', { statut: 'annulee', montantTtcCentimes: 999_999 }),
      ligneFixture('l-4', { statut: 'refusee', montantTtcCentimes: 999_999 }),
    ]);
    const service = serviceFactice();

    const document = await service.assemblerDocument(TX_FACTICE, CTX, 'direction', OR_ID, true);

    // 8_648 + 13_000 = 21_648 — les deux lignes exclues (999'999 chacune) ne doivent PEUT influer.
    expect(document.totalTtcCentimes).toBe(21_648);
  });

  it("un OR sans aucune ligne facturable rend 0, jamais absent — 0 n'est pas la même chose qu'une absence de droit", async () => {
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);
    const service = serviceFactice();

    const document = await service.assemblerDocument(TX_FACTICE, CTX, 'direction', OR_ID, true);

    expect(document.totalTtcCentimes).toBe(0);
  });

  it('reste ABSENT (jamais 0) pour un rôle sans droit aux montants (ROLES_SANS_MONTANT) — même garde que totalValideCentimes', async () => {
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([
      ligneFixture('l-1', { statut: 'validee', montantTtcCentimes: 8_648 }),
    ]);
    const service = serviceFactice();

    const document = await service.assemblerDocument(TX_FACTICE, CTX, 'technicien', OR_ID, true);

    expect(document.totalTtcCentimes).toBeUndefined();
    expect(document.totalValideCentimes).toBeUndefined();
  });
});

describe('ServiceOr.assemblerDocument — designationsApercu (#82)', () => {
  it('retient les désignations dans l’ordre des lignes (numeroOrdre déjà trié par listerLignesOr), bornées à 3', async () => {
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([
      ligneFixture('l-1', { numeroOrdre: 1, designation: 'Vidange huile + filtre' }),
      ligneFixture('l-2', { numeroOrdre: 2, designation: 'Plaquettes avant' }),
      ligneFixture('l-3', { numeroOrdre: 3, designation: 'Contrôle freins' }),
      ligneFixture('l-4', { numeroOrdre: 4, designation: 'Purge liquide de frein' }),
    ]);
    const service = serviceFactice();

    const document = await service.assemblerDocument(TX_FACTICE, CTX, 'technicien', OR_ID, true);

    expect(document.designationsApercu).toEqual([
      'Vidange huile + filtre',
      'Plaquettes avant',
      'Contrôle freins',
    ]);
  });

  it('exclut les lignes annulee/refusee (jamais faites) et les désignations vides/nulles', async () => {
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([
      ligneFixture('l-1', { numeroOrdre: 1, statut: 'annulee', designation: 'Ligne annulée' }),
      ligneFixture('l-2', { numeroOrdre: 2, statut: 'refusee', designation: 'Ligne refusée' }),
      ligneFixture('l-3', { numeroOrdre: 3, designation: null }),
      ligneFixture('l-4', { numeroOrdre: 4, designation: 'Vidange huile + filtre' }),
    ]);
    const service = serviceFactice();

    const document = await service.assemblerDocument(TX_FACTICE, CTX, 'technicien', OR_ID, true);

    expect(document.designationsApercu).toEqual(['Vidange huile + filtre']);
  });

  it("un OR sans ligne facturable rend un tableau VIDE, jamais absent — c'est un fait (rien de fait), pas une absence de donnée", async () => {
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);
    const service = serviceFactice();

    const document = await service.assemblerDocument(TX_FACTICE, CTX, 'technicien', OR_ID, true);

    expect(document.designationsApercu).toEqual([]);
  });

  it("n'est PAS gaté par le rôle (une désignation n'est pas un montant) — présent même sans droit aux montants", async () => {
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([
      ligneFixture('l-1', { designation: 'Vidange huile + filtre' }),
    ]);
    const service = serviceFactice();

    const document = await service.assemblerDocument(TX_FACTICE, CTX, 'technicien', OR_ID, true);

    expect(document.designationsApercu).toEqual(['Vidange huile + filtre']);
  });
});
