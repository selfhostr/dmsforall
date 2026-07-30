import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntreeRefusLignes, ReponseOrdreReparation } from '@dfa/shared';
import type { ContexteTenant, TransactionDfa } from '../db';
import type { LigneLigneOr, LigneOrdreReparation } from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import type { CreationTravailReporte } from './atelier.jetons';

/**
 * RM-73 : quand un client refuse une ligne de devis, l'information ne doit plus disparaître —
 * `ServiceLigneOr.refuserLignes` doit alimenter les travaux reportés du véhicule via le port
 * `CreationTravailReporte` (`atelier.jetons.ts`), fourni par `VehiculesModule`
 * (`ServiceVehiculeTravailReporte`, `useExisting`).
 *
 * Fonctions de requête et transaction MOQUÉES — même doctrine que `service-or.spec.ts` : ce fichier
 * ne prouve pas que `vehicule_travail_reporte` est réellement écrit en base (ce serait un test
 * d'intégration, propriété de `vehicules/`), il prouve que `refuserLignes` APPELLE bien le port,
 * avec les bons champs, DANS LA MÊME TRANSACTION que le passage de la ligne à `refusee`.
 */
vi.mock('./or-requetes', () => ({
  chargerOrPourEcriture: vi.fn(),
  chargerLignesPourEcriture: vi.fn(),
}));

import { ServiceLigneOr } from './service-ligne-or';
import * as orRequetes from './or-requetes';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const OR_ID = 'or-1';
const LIGNE_ID = 'ligne-1';
const VEHICULE_ID = 'vehicule-1';

function principal(role: PrincipalAuthentifie['role']): PrincipalAuthentifie {
  return { sessionId: 'session-1', tenantId: 'tenant-a', utilisateurId: 'user-1', role, langue: 'fr' };
}

function orFixture(): LigneOrdreReparation {
  return {
    id: OR_ID,
    tenantId: 'tenant-a',
    numero: 'OR-2026-042',
    siteId: 'site-1',
    type: 'reparation',
    statut: 'ouvert',
    clientId: 'client-1',
    vehiculeId: VEHICULE_ID,
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
    termineLe: null,
    factureLe: null,
    restitueLe: null,
    clotureLe: null,
    annuleLe: null,
    motifAnnulation: null,
    attenteAccord: false,
    attentePieces: false,
    attenteExterne: false,
    totalValideCentimes: 0,
    version: 1,
    creeLe: new Date('2026-07-28T07:00:00.000Z'),
    modifieLe: new Date('2026-07-28T07:00:00.000Z'),
  } as LigneOrdreReparation;
}

function ligneFixture(overrides: Partial<LigneLigneOr> = {}): LigneLigneOr {
  return {
    id: LIGNE_ID,
    tenantId: 'tenant-a',
    ordreReparationId: OR_ID,
    numeroOrdre: 1,
    type: 'piece',
    origine: 'proposee',
    statut: 'a_valider',
    payeur: 'client',
    blocage: 'accord',
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

/** Fausse transaction : `update(...).set(...).where(...).returning()`, exercée par
 *  `transitionnerLigne` pour chaque ligne refusée. */
function txFactice(ligneRefusee: LigneLigneOr) {
  const returning = vi.fn(async () => [{ ...ligneRefusee, statut: 'refusee' }]);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { tx: { update } as unknown as TransactionDfa, update, set, where, returning };
}

function accesBaseFactice(tx: TransactionDfa) {
  return { enTenant: vi.fn(async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) => travail(tx)) };
}

function travailReporteFactice(): { creerDepuisRefus: ReturnType<typeof vi.fn> } {
  return { creerDepuisRefus: vi.fn(async () => undefined) };
}

/** Seuls `acces`, `travailReporte` et `serviceOr` sont exercés par `refuserLignes()` — les 3 autres
 *  dépendances du constructeur (idempotence, événements, calcul) n'interviennent QUE dans
 *  `creer()`/`modifier()`, jamais dans les actions groupées. */
function serviceFactice(
  acces: ReturnType<typeof accesBaseFactice>,
  travailReporte: ReturnType<typeof travailReporteFactice>,
  document: ReponseOrdreReparation,
): ServiceLigneOr {
  const serviceOr = { assemblerDocument: vi.fn(async () => document) };
  return new ServiceLigneOr(
    acces as never,
    {} as never,
    {} as never,
    {} as never,
    travailReporte as unknown as CreationTravailReporte,
    serviceOr as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ServiceLigneOr.refuserLignes — câblage du port CreationTravailReporte (RM-73)', () => {
  it('refuser une ligne appelle le port avec les bons champs (vehiculeId, ligneOrId, designation, urgence, montant, sécurité, motif)', async () => {
    const or = orFixture();
    const ligne = ligneFixture();
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLignesPourEcriture).mockResolvedValue([ligne]);
    const { tx } = txFactice(ligne);
    const acces = accesBaseFactice(tx);
    const travailReporte = travailReporteFactice();
    const service = serviceFactice(acces, travailReporte, {} as ReponseOrdreReparation);

    const entree: EntreeRefusLignes = { ligneIds: [LIGNE_ID], motif: 'Client refuse le devis, plaquettes reportées' };
    await service.refuserLignes(CTX, principal('receptionnaire'), OR_ID, entree);

    expect(travailReporte.creerDepuisRefus).toHaveBeenCalledTimes(1);
    const [txAppel, ctxAppel, entreeAppel, maintenantAppel] = travailReporte.creerDepuisRefus.mock.calls[0] as [
      TransactionDfa,
      ContexteTenant,
      unknown,
      Date,
    ];
    expect(ctxAppel).toBe(CTX);
    expect(entreeAppel).toEqual({
      vehiculeId: VEHICULE_ID,
      ordreReparationId: OR_ID,
      ligneOrId: LIGNE_ID,
      designation: 'Plaquettes de frein avant',
      urgence: 'a_surveiller',
      montantEstimeCentimes: 8_648,
      securite: false,
      motifRefus: 'Client refuse le devis, plaquettes reportées',
    });
    expect(maintenantAppel).toBeInstanceOf(Date);

    // Preuve d'atomicité : le port reçoit EXACTEMENT le même objet `tx` que celui utilisé pour
    // écrire `ligne_or.statut = 'refusee'` — pas une transaction séparée.
    expect(txAppel).toBe(tx);
  });

  it("motif absent de l'entrée -> motifRefus transmis à null, jamais `undefined`", async () => {
    const or = orFixture();
    const ligne = ligneFixture();
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLignesPourEcriture).mockResolvedValue([ligne]);
    const { tx } = txFactice(ligne);
    const acces = accesBaseFactice(tx);
    const travailReporte = travailReporteFactice();
    const service = serviceFactice(acces, travailReporte, {} as ReponseOrdreReparation);

    const entree: EntreeRefusLignes = { ligneIds: [LIGNE_ID] };
    await service.refuserLignes(CTX, principal('receptionnaire'), OR_ID, entree);

    expect(travailReporte.creerDepuisRefus).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ motifRefus: null }),
      expect.any(Date),
    );
  });

  it('désignation absente en base (`null`) -> transmise en chaîne vide, jamais `null`, au port (même coalescence défensive que mapperLigneOr)', async () => {
    const or = orFixture();
    const ligne = ligneFixture({ designation: null });
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLignesPourEcriture).mockResolvedValue([ligne]);
    const { tx } = txFactice(ligne);
    const acces = accesBaseFactice(tx);
    const travailReporte = travailReporteFactice();
    const service = serviceFactice(acces, travailReporte, {} as ReponseOrdreReparation);

    await service.refuserLignes(CTX, principal('receptionnaire'), OR_ID, { ligneIds: [LIGNE_ID] });

    expect(travailReporte.creerDepuisRefus).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ designation: '' }),
      expect.any(Date),
    );
  });

  it('refuser PLUSIEURS lignes appelle le port UNE FOIS PAR LIGNE, chacune avec son propre ligneOrId', async () => {
    const or = orFixture();
    const ligneA = ligneFixture({ id: 'ligne-a', designation: 'Plaquettes avant' });
    const ligneB = ligneFixture({ id: 'ligne-b', designation: 'Disques avant' });
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(or);
    vi.mocked(orRequetes.chargerLignesPourEcriture).mockResolvedValue([ligneA, ligneB]);
    const { tx } = txFactice(ligneA);
    const acces = accesBaseFactice(tx);
    const travailReporte = travailReporteFactice();
    const service = serviceFactice(acces, travailReporte, {} as ReponseOrdreReparation);

    await service.refuserLignes(CTX, principal('receptionnaire'), OR_ID, { ligneIds: ['ligne-a', 'ligne-b'] });

    expect(travailReporte.creerDepuisRefus).toHaveBeenCalledTimes(2);
    const ligneOrIds = travailReporte.creerDepuisRefus.mock.calls.map((appel) => (appel[2] as { ligneOrId: string }).ligneOrId);
    expect(ligneOrIds).toEqual(['ligne-a', 'ligne-b']);
  });
});
