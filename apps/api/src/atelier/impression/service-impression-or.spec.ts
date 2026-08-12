import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReponseOrdreReparation } from '@dfa/shared';

import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import type { AccesBase, ContexteTenant } from '../../db';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import type { ServiceOr } from '../service-or';

import { genererPdfOr } from './generation-pdf-or';
import { ServiceImpressionOr } from './service-impression-or';

vi.mock('./generation-pdf-or', () => ({ genererPdfOr: vi.fn() }));

const CTX: ContexteTenant = { tenantId: 't-1', utilisateurId: 'u-1', requeteId: 'req-1' };
const PRINCIPAL: PrincipalAuthentifie = {
  sessionId: 's-1',
  tenantId: 't-1',
  utilisateurId: 'u-1',
  role: 'chef_atelier',
  langue: 'fr',
};

function ordreReparationMinimal(
  overrides: Partial<ReponseOrdreReparation> = {},
): ReponseOrdreReparation {
  return {
    id: 'or-1',
    numero: 'OR-2026-042',
    siteId: 'site-1',
    type: 'reparation',
    statut: 'ouvert',
    client: {
      id: 'client-1',
      numeroClient: '2026-0001',
      nomAffiche: 'Jean Dupont',
      type: 'particulier',
      statut: 'actif',
      langueCorrespondance: 'fr',
      poObligatoire: false,
      telephone: null,
      localite: null,
      nombreVehicules: 1,
      dernierPassageLe: null,
    },
    vehicule: {
      id: 'vehicule-1',
      plaque: 'VS 123456',
      canton: 'VS',
      designation: 'VW Golf 8',
      vin: null,
      premiereMiseEnCirculationLe: null,
      identificationIncomplete: false,
      emplacementLibre: null,
    },
    figees: {
      clientDesignation: 'Jean Dupont',
      adresseFacturation: null,
      plaque: 'VS 123456',
      detenteurClientId: 'client-1',
    },
    conducteurPresentNom: null,
    kilometrageEntree: 84_500,
    kilometrageSortie: null,
    restitutionPromiseLe: null,
    restitutionInitialeLe: null,
    localisation: 'atelier',
    sousTraitantNom: null,
    ordreReparationParentId: null,
    motifLien: null,
    rendezVousId: null,
    numeroCommandeInterne: null,
    receptionnaireId: null,
    retentionInvoqueeLe: null,
    litigeOuvertLe: null,
    ouvertLe: '2026-07-28T07:00:00.000Z',
    termineLe: null,
    factureLe: null,
    restitueLe: null,
    clotureLe: null,
    annuleLe: null,
    motifAnnulation: null,
    demandes: [],
    lignes: [],
    nombreLignes: 0,
    lignesTronquees: false,
    devisComplementaires: [],
    controleQualite: null,
    signatures: [],
    pret: null,
    cumulsPointage: { totalCentiemes: 0, parTechnicien: [], pointagesOuverts: 0 },
    totauxParPayeur: [],
    attentes: { accord: false, pieces: false, externe: false },
    etatAffiche: 'ouvert',
    actionsDisponibles: [],
    version: 1,
    creeLe: '2026-07-28T07:00:00.000Z',
    modifieLe: '2026-07-28T07:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

function accesBaseAvecSite(nomSite: string | null): AccesBase {
  return {
    async enTenant<T>(_ctx: ContexteTenant, travail: (tx: unknown) => Promise<T>): Promise<T> {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => (nomSite === null ? [] : [{ nom: nomSite }]),
            }),
          }),
        }),
      };
      return travail(tx);
    },
    async verifierConnexion(): Promise<void> {},
  } as unknown as AccesBase;
}

describe('ServiceImpressionOr', () => {
  beforeEach(() => {
    vi.mocked(genererPdfOr).mockReset();
  });

  it('assemble le document via ServiceOr.obtenirComplet, résout le nom du site et régénère le PDF', async () => {
    vi.mocked(genererPdfOr).mockResolvedValue(Buffer.from('%PDF-feuille-atelier'));
    const serviceOr = {
      obtenirComplet: vi.fn().mockResolvedValue(ordreReparationMinimal()),
    } as unknown as ServiceOr;
    const service = new ServiceImpressionOr(accesBaseAvecSite('Garage Martin — Sion'), serviceOr);

    const resultat = await service.obtenirPdf(CTX, PRINCIPAL, 'or-1');

    expect(resultat.buffer.toString()).toBe('%PDF-feuille-atelier');
    expect(resultat.nomFichier).toBe('OR-OR-2026-042.pdf');
    expect(serviceOr.obtenirComplet).toHaveBeenCalledWith(CTX, PRINCIPAL, 'or-1');
    expect(genererPdfOr).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'or-1' }),
      'Garage Martin — Sion',
    );
  });

  it('ne met RIEN en cache et régénère à chaque appel — deux appels, deux générations', async () => {
    vi.mocked(genererPdfOr).mockResolvedValue(Buffer.from('%PDF-v1'));
    const serviceOr = {
      obtenirComplet: vi.fn().mockResolvedValue(ordreReparationMinimal()),
    } as unknown as ServiceOr;
    const service = new ServiceImpressionOr(accesBaseAvecSite('Garage Martin'), serviceOr);

    await service.obtenirPdf(CTX, PRINCIPAL, 'or-1');
    vi.mocked(genererPdfOr).mockResolvedValue(Buffer.from('%PDF-v2-apres-modif'));
    const second = await service.obtenirPdf(CTX, PRINCIPAL, 'or-1');

    expect(genererPdfOr).toHaveBeenCalledTimes(2);
    expect(second.buffer.toString()).toBe('%PDF-v2-apres-modif');
  });

  it('site introuvable (ne devrait jamais arriver) : retombe sur une chaîne vide, jamais l’uuid brut', async () => {
    vi.mocked(genererPdfOr).mockResolvedValue(Buffer.from('%PDF'));
    const serviceOr = {
      obtenirComplet: vi.fn().mockResolvedValue(ordreReparationMinimal()),
    } as unknown as ServiceOr;
    const service = new ServiceImpressionOr(accesBaseAvecSite(null), serviceOr);

    await service.obtenirPdf(CTX, PRINCIPAL, 'or-1');

    expect(genererPdfOr).toHaveBeenCalledWith(expect.objectContaining({ id: 'or-1' }), '');
  });

  it("propage RESSOURCE_INTROUVABLE (404) quand l'OR n'existe pas pour ce tenant, sans jamais appeler genererPdfOr", async () => {
    const serviceOr = {
      obtenirComplet: vi
        .fn()
        .mockRejectedValue(
          new ErreurMetier('RESSOURCE_INTROUVABLE', 'Ordre de réparation introuvable.'),
        ),
    } as unknown as ServiceOr;
    const service = new ServiceImpressionOr(accesBaseAvecSite('Garage Martin'), serviceOr);

    await expect(service.obtenirPdf(CTX, PRINCIPAL, 'inconnu')).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
    expect(genererPdfOr).not.toHaveBeenCalled();
  });
});
