import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContexteTenant, TransactionDfa } from '../db';
import type {
  LigneClient,
  LigneDevisComplementaire,
  LigneOrdreReparation,
  LigneOrdreReparationDemande,
  LigneVehicule,
} from '../db/schema';
import type { EntreeAudit, ServiceAudit } from '../common/audit';

/**
 * Correctif N+1 sur `ServiceOr.assemblerDocument()` (`GET /ordres-reparation/{id}`, mais aussi
 * appelée UNE FOIS PAR OR par `ServiceOr.lister()` — voir sa doc de tête, `pourListe = true`).
 * La version précédente appelait `chargerResumeUtilisateur` séparément pour CHAQUE demande, CHAQUE
 * devis, PUIS une fois de plus pour l'auteur du dernier événement de journal (`modifiePar`) — un
 * document à N demandes et M devis ouvrait 1+N+M requêtes sur `utilisateur`. Comme cette méthode
 * est rejouée par OR dans `lister()`, une page de P OR démultipliait ce coût par P. Ce fichier
 * prouve que la version corrigée fusionne les TROIS besoins (auteurs des demandes, émetteurs des
 * devis, auteur du dernier événement) en UN SEUL appel à `chargerResumesUtilisateurs`.
 */
vi.mock('./or-requetes', () => ({
  chargerOr: vi.fn(),
  chargerControleQualite: vi.fn().mockResolvedValue(null),
  listerDemandesOr: vi.fn(),
  listerLignesOr: vi.fn().mockResolvedValue([]),
  listerDevisOr: vi.fn(),
  listerLignesDevis: vi.fn().mockResolvedValue([]),
}));
vi.mock('./references', () => ({
  chargerClientLigne: vi.fn(),
  chargerVehiculeLigne: vi.fn(),
  chargerPlaqueCourante: vi.fn().mockResolvedValue(null),
  construireVehiculeResume: vi.fn().mockReturnValue({
    id: 'vehicule-1',
    designation: 'VW Golf',
  }),
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
    statut: 'ouvert',
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

function demandeFixture(id: string, saisiParId: string | null): LigneOrdreReparationDemande {
  return {
    id,
    tenantId: 'tenant-a',
    ordreReparationId: OR_ID,
    ordre: 1,
    verbatim: 'Bruit au freinage',
    saisiLe: new Date('2026-07-28T07:00:00.000Z'),
    saisiParId,
    creeLe: new Date('2026-07-28T07:00:00.000Z'),
  } as LigneOrdreReparationDemande;
}

function devisFixture(id: string, emetteurId: string | null): LigneDevisComplementaire {
  return {
    id,
    tenantId: 'tenant-a',
    ordreReparationId: OR_ID,
    numeroOrdre: 1,
    montantTtcCentimes: 10_000,
    nouveauPlafondCentimes: null,
    impactRestitutionLe: null,
    envoyeLe: new Date('2026-07-28T07:00:00.000Z'),
    canal: 'comptoir',
    emetteurId,
    interlocuteurNom: null,
    reponduLe: null,
    decision: null,
    retranscription: null,
    preuve: null,
    creeLe: new Date('2026-07-28T07:00:00.000Z'),
    modifieLe: new Date('2026-07-28T07:00:00.000Z'),
  } as LigneDevisComplementaire;
}

function auditFactice(entrees: readonly EntreeAudit[]): ServiceAudit {
  return {
    pourEntite: vi.fn(),
    pourEntiteTx: vi.fn().mockResolvedValue(entrees),
    pourEntitesTx: vi.fn(),
  };
}

function pointageFactice() {
  return { pointagesOuvertsPourOr: vi.fn().mockResolvedValue([]) };
}

/** `ServiceOr.assemblerDocument` calcule désormais `enRetard` (voir `restitution-retard.ts`) via
 *  `this.horloge.maintenant()` — un `{} as never` ne suffit plus, il faut une horloge factice qui
 *  répond réellement à `maintenant()`. */
function horlogeFactice() {
  return { maintenant: () => new Date('2026-08-12T09:00:00.000Z') };
}

function serviceFactice(audit: ServiceAudit, pointage: ReturnType<typeof pointageFactice>) {
  return new ServiceOr(
    {} as never,
    {} as never,
    {} as never,
    audit,
    {} as never,
    pointage as never,
    {} as never,
    horlogeFactice() as never,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(references.chargerPlaqueCourante).mockResolvedValue(null);
  vi.mocked(references.versClientResume).mockResolvedValue({
    id: 'client-1',
    nomAffiche: 'Jean Dupont',
  } as never);
  vi.mocked(references.construireVehiculeResume).mockReturnValue({
    id: 'vehicule-1',
    designation: 'VW Golf',
  } as never);
  vi.mocked(orRequetes.chargerControleQualite).mockResolvedValue(null);
  vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);
  vi.mocked(orRequetes.listerLignesDevis).mockResolvedValue([]);
});

describe('ServiceOr.assemblerDocument — résumés utilisateur par lot (correctif N+1)', () => {
  it('2 demandes + 2 devis + 1 événement de journal (5 résolutions, 3 auteurs distincts) ne déclenchent qu’UN SEUL appel à chargerResumesUtilisateurs', async () => {
    vi.mocked(orRequetes.chargerOr).mockResolvedValue(orFixture());
    vi.mocked(references.chargerClientLigne).mockResolvedValue({ id: 'client-1' } as LigneClient);
    vi.mocked(references.chargerVehiculeLigne).mockResolvedValue({
      id: 'vehicule-1',
    } as LigneVehicule);
    vi.mocked(orRequetes.listerDemandesOr).mockResolvedValue([
      demandeFixture('d-1', 'user-a'),
      demandeFixture('d-2', 'user-a'),
    ]);
    vi.mocked(orRequetes.listerDevisOr).mockResolvedValue([
      devisFixture('devis-1', 'user-b'),
      devisFixture('devis-2', null),
    ]);
    const audit = auditFactice([
      {
        id: 'audit-1',
        entite: 'ordre_reparation',
        entiteId: OR_ID,
        action: 'modification',
        champ: null,
        valeurAvant: null,
        valeurApres: null,
        utilisateurId: 'user-c',
        requeteId: null,
        creeLe: new Date('2026-07-28T09:00:00.000Z'),
      },
    ]);
    vi.mocked(references.chargerResumesUtilisateurs).mockResolvedValue(
      new Map([
        ['user-a', { utilisateurId: 'user-a', nomAffiche: 'Alice Un' }],
        ['user-b', { utilisateurId: 'user-b', nomAffiche: 'Bruno Deux' }],
        ['user-c', { utilisateurId: 'user-c', nomAffiche: 'Chloé Trois' }],
      ]),
    );
    const service = serviceFactice(audit, pointageFactice());

    const document = await service.assemblerDocument(TX_FACTICE, CTX, 'technicien', OR_ID, false);

    // Le cœur du correctif : UN SEUL appel, malgré 2 demandes + 2 devis + 1 événement de journal
    // (5 résolutions potentielles, 3 auteurs distincts) — un test qui ne vérifierait que le
    // contenu du document resterait vert même si la boucle était réintroduite ailleurs sous la
    // même API (`chargerResumesUtilisateurs` appelé N fois avec un seul id à chaque fois).
    expect(references.chargerResumesUtilisateurs).toHaveBeenCalledTimes(1);

    expect(document.demandes.find((d) => d.id === 'd-1')?.saisiPar).toEqual({
      utilisateurId: 'user-a',
      nomAffiche: 'Alice Un',
    });
    expect(document.demandes.find((d) => d.id === 'd-2')?.saisiPar).toEqual({
      utilisateurId: 'user-a',
      nomAffiche: 'Alice Un',
    });
    expect(document.devisComplementaires.find((d) => d.id === 'devis-1')?.emetteur).toEqual({
      utilisateurId: 'user-b',
      nomAffiche: 'Bruno Deux',
    });
    expect(document.devisComplementaires.find((d) => d.id === 'devis-2')?.emetteur).toBeNull();
    expect(document.modifiePar).toEqual({ utilisateurId: 'user-c', nomAffiche: 'Chloé Trois' });
  });

  it("un utilisateurId renseigné mais ABSENT du lot rendu (utilisateur supprimé, ou d'un autre tenant) retombe sur null partout — jamais un nom vide, jamais la demande/le devis écarté", async () => {
    vi.mocked(orRequetes.chargerOr).mockResolvedValue(orFixture());
    vi.mocked(references.chargerClientLigne).mockResolvedValue({ id: 'client-1' } as LigneClient);
    vi.mocked(references.chargerVehiculeLigne).mockResolvedValue({
      id: 'vehicule-1',
    } as LigneVehicule);
    vi.mocked(orRequetes.listerDemandesOr).mockResolvedValue([
      demandeFixture('d-1', 'user-introuvable'),
    ]);
    vi.mocked(orRequetes.listerDevisOr).mockResolvedValue([]);
    const audit = auditFactice([]);
    // Le lot rendu ne contient PAS 'user-introuvable' (supprimé, ou d'un autre tenant).
    vi.mocked(references.chargerResumesUtilisateurs).mockResolvedValue(new Map());
    const service = serviceFactice(audit, pointageFactice());

    const document = await service.assemblerDocument(TX_FACTICE, CTX, 'technicien', OR_ID, false);

    expect(document.demandes).toHaveLength(1);
    expect(document.demandes[0]?.saisiPar).toBeNull();
    expect(document.modifiePar).toBeNull();
  });
});
