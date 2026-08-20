import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLES_UTILISATEUR, type ReponseOrdreReparation, type RoleUtilisateur } from '@dfa/shared';

import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import type { AccesBase, ContexteTenant } from '../../db';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import { roleVoitLesMontants } from '../mappeurs';
import type { ServiceOr } from '../service-or';

import { genererPdfDevis } from './generation-pdf-devis';
import { ServiceImpressionDevis } from './service-impression-devis';

vi.mock('./generation-pdf-devis', () => ({ genererPdfDevis: vi.fn() }));

const CTX: ContexteTenant = { tenantId: 't-1', utilisateurId: 'u-1', requeteId: 'req-1' };

function principal(role: RoleUtilisateur): PrincipalAuthentifie {
  return { sessionId: 's-1', tenantId: 't-1', utilisateurId: 'u-1', role, langue: 'fr' };
}

function ordreReparationAvecDevis(): ReponseOrdreReparation {
  return {
    id: 'or-1',
    numero: 'OR-2026-042',
    siteId: 'site-1',
    type: 'reparation',
    statut: 'en_cours',
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
    devisComplementaires: [
      {
        id: 'devis-2',
        ordreReparationId: 'or-1',
        numeroOrdre: 2,
        lignes: [],
        montantTtcCentimes: 15_940,
        nouveauPlafondCentimes: 90_000,
        impactRestitutionLe: null,
        canal: 'telephone',
        destinataireContactId: null,
        envoyeLe: '2026-08-04T10:00:00.000Z',
        emetteur: { utilisateurId: 'u-1', nomAffiche: 'Marie Réception' },
        interlocuteurNom: null,
        repondueLe: null,
        decision: null,
        retranscription: null,
      },
    ],
    controleQualite: null,
    signatures: [],
    pret: null,
    cumulsPointage: { totalCentiemes: 0, parTechnicien: [], pointagesOuverts: 0 },
    totauxParPayeur: [],
    attentes: { accord: true, pieces: false, externe: false },
    etatAffiche: 'attente_accord',
    actionsDisponibles: [],
    version: 1,
    creeLe: '2026-07-28T07:00:00.000Z',
    modifieLe: '2026-07-28T07:00:00.000Z',
    modifiePar: null,
  };
}

/**
 * Mock minimal d'`AccesBase.enTenant` pour `chargerIdentiteGarage` : DEUX lectures séquentielles
 * dans la MÊME transaction (`tenant` puis `site`, dans cet ordre — voir l'implémentation). Comptée
 * par appel plutôt que par table ciblée, comme `service-impression-or.spec.ts::accesBaseAvecSite`.
 */
function accesBaseAvecIdentite(
  tenantRow: { raisonSociale: string } | null,
  siteRow: { nom: string; rue: string | null; npa: string | null; localite: string | null } | null,
): AccesBase {
  let appel = 0;
  return {
    async enTenant<T>(_ctx: ContexteTenant, travail: (tx: unknown) => Promise<T>): Promise<T> {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                appel += 1;
                if (appel === 1) return tenantRow === null ? [] : [tenantRow];
                return siteRow === null ? [] : [siteRow];
              },
            }),
          }),
        }),
      };
      return travail(tx);
    },
    async verifierConnexion(): Promise<void> {},
  } as unknown as AccesBase;
}

const IDENTITE_ROWS = {
  tenant: { raisonSociale: 'Garage Martin SA' },
  site: { nom: 'Sion', rue: 'Route de Lausanne 12', npa: '1950', localite: 'Sion' },
};

describe('ServiceImpressionDevis', () => {
  beforeEach(() => {
    vi.mocked(genererPdfDevis).mockReset();
  });

  it('assemble le document via ServiceOr.obtenirComplet, résout l’identité du garage et régénère le PDF', async () => {
    vi.mocked(genererPdfDevis).mockResolvedValue(Buffer.from('%PDF-devis'));
    const document = ordreReparationAvecDevis();
    const serviceOr = {
      obtenirComplet: vi.fn().mockResolvedValue(document),
    } as unknown as ServiceOr;
    const service = new ServiceImpressionDevis(
      accesBaseAvecIdentite(IDENTITE_ROWS.tenant, IDENTITE_ROWS.site),
      serviceOr,
    );

    const resultat = await service.obtenirPdf(CTX, principal('chef_atelier'), 'or-1', 'devis-2');

    expect(resultat.buffer.toString()).toBe('%PDF-devis');
    expect(resultat.nomFichier).toBe('DEVIS-OR-2026-042-2.pdf');
    expect(serviceOr.obtenirComplet).toHaveBeenCalledWith(CTX, principal('chef_atelier'), 'or-1');
    expect(genererPdfDevis).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'or-1' }),
      expect.objectContaining({ id: 'devis-2' }),
      {
        raisonSociale: 'Garage Martin SA',
        siteNom: 'Sion',
        rue: 'Route de Lausanne 12',
        npa: '1950',
        localite: 'Sion',
      },
    );
  });

  it("devis introuvable sur l'OR -> RESSOURCE_INTROUVABLE, sans jamais appeler genererPdfDevis", async () => {
    const serviceOr = {
      obtenirComplet: vi.fn().mockResolvedValue(ordreReparationAvecDevis()),
    } as unknown as ServiceOr;
    const service = new ServiceImpressionDevis(
      accesBaseAvecIdentite(IDENTITE_ROWS.tenant, IDENTITE_ROWS.site),
      serviceOr,
    );

    await expect(
      service.obtenirPdf(CTX, principal('chef_atelier'), 'or-1', 'devis-inexistant'),
    ).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE' });
    expect(genererPdfDevis).not.toHaveBeenCalled();
  });

  it('OR introuvable -> propage RESSOURCE_INTROUVABLE (404), sans jamais appeler genererPdfDevis', async () => {
    const serviceOr = {
      obtenirComplet: vi
        .fn()
        .mockRejectedValue(
          new ErreurMetier('RESSOURCE_INTROUVABLE', 'Ordre de réparation introuvable.'),
        ),
    } as unknown as ServiceOr;
    const service = new ServiceImpressionDevis(
      accesBaseAvecIdentite(IDENTITE_ROWS.tenant, IDENTITE_ROWS.site),
      serviceOr,
    );

    await expect(
      service.obtenirPdf(CTX, principal('chef_atelier'), 'inconnu', 'devis-2'),
    ).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE' });
    expect(genererPdfDevis).not.toHaveBeenCalled();
  });

  it('ne met RIEN en cache et régénère à chaque appel — deux appels, deux générations', async () => {
    vi.mocked(genererPdfDevis).mockResolvedValue(Buffer.from('%PDF-v1'));
    const serviceOr = {
      obtenirComplet: vi.fn().mockResolvedValue(ordreReparationAvecDevis()),
    } as unknown as ServiceOr;
    const service = new ServiceImpressionDevis(
      accesBaseAvecIdentite(IDENTITE_ROWS.tenant, IDENTITE_ROWS.site),
      serviceOr,
    );

    await service.obtenirPdf(CTX, principal('direction'), 'or-1', 'devis-2');
    vi.mocked(genererPdfDevis).mockResolvedValue(Buffer.from('%PDF-v2-apres-reponse'));
    const second = await service.obtenirPdf(CTX, principal('direction'), 'or-1', 'devis-2');

    expect(genererPdfDevis).toHaveBeenCalledTimes(2);
    expect(second.buffer.toString()).toBe('%PDF-v2-apres-reponse');
  });

  // Matrice rôle × droit d'impression — même patron que `matrice-droits.spec.ts` pour
  // `facturation.document.imprimer` (RF-116) : comparé à `roleVoitLesMontants()`, la source de
  // vérité du masquage des montants dans l'atelier, PAS à une liste de rôles recopiée à la main.
  // Un devis complémentaire chiffre un montant TTC en clair — voir la tête de fichier du service.
  describe.each(ROLES_UTILISATEUR)('rôle %s', (role) => {
    const devraitVoir = roleVoitLesMontants(role);

    it(`${devraitVoir ? 'obtient' : 'se voit refuser'} le PDF, conformément à roleVoitLesMontants`, async () => {
      vi.mocked(genererPdfDevis).mockResolvedValue(Buffer.from('%PDF-devis'));
      const serviceOr = {
        obtenirComplet: vi.fn().mockResolvedValue(ordreReparationAvecDevis()),
      } as unknown as ServiceOr;
      const service = new ServiceImpressionDevis(
        accesBaseAvecIdentite(IDENTITE_ROWS.tenant, IDENTITE_ROWS.site),
        serviceOr,
      );

      if (devraitVoir) {
        await expect(
          service.obtenirPdf(CTX, principal(role), 'or-1', 'devis-2'),
        ).resolves.toMatchObject({ nomFichier: 'DEVIS-OR-2026-042-2.pdf' });
      } else {
        await expect(
          service.obtenirPdf(CTX, principal(role), 'or-1', 'devis-2'),
        ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT', status: 403 });
        // Refusé AVANT toute charge de travail : ni lecture de l'OR, ni génération du PDF.
        expect(serviceOr.obtenirComplet).not.toHaveBeenCalled();
        expect(genererPdfDevis).not.toHaveBeenCalled();
      }
    });
  });
});
