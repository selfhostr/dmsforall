import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReponseDocumentVente } from '@dfa/shared';

import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import type { AccesBase, ContexteTenant } from '../../db';
import { site, tenant } from '../../db/schema';
import type { ServiceDocumentsVente } from '../documents/service-documents';

import { genererPdfDevis, genererPdfFacture } from './generation-pdf-facture';
import { ServiceImpressionFacture } from './service-impression-facture';
import type { StockagePdf } from './stockage-pdf';

vi.mock('./generation-pdf-facture', () => ({
  genererPdfFacture: vi.fn(),
  genererPdfDevis: vi.fn(),
}));

const CTX: ContexteTenant = { tenantId: 't-1', utilisateurId: 'u-1', requeteId: 'req-1' };
const PRINCIPAL: PrincipalAuthentifie = {
  sessionId: 's-1',
  tenantId: 't-1',
  utilisateurId: 'u-1',
  role: 'direction',
  langue: 'fr',
};

function documentFacture(overrides: Partial<ReponseDocumentVente> = {}): ReponseDocumentVente {
  return {
    id: 'doc-1',
    typeDocument: 'facture',
    natureFacture: 'ordinaire',
    origine: 'dfa',
    numero: '2026-00042',
    numeroSequence: 42,
    numeroOrigine: null,
    exercice: 2026,
    statut: 'emis',
    statutReglement: 'non_regle',
    siteId: 'site-1',
    clientId: 'client-1',
    vehiculeId: null,
    ordreReparationId: null,
    dossierVenteId: null,
    documentSourceId: null,
    factureAnnuleeId: null,
    annuleParAvoirId: null,
    remplaceId: null,
    figees: {
      clientDesignation: 'Client Test',
      clientIde: null,
      clientLangue: 'fr',
      adresseFacturation: null,
      plaque: null,
    },
    dateDocument: '2026-07-29',
    devise: 'CHF',
    tvaNonVentilee: false,
    tauxTvaPourmilleDocument: null,
    mentionTvaInterdite: false,
    totalHtCentimes: 6475,
    totalTvaCentimes: 525,
    ecartRepriseCentimes: 0,
    totalTtcCentimes: 7000,
    ventilationTva: [],
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
    montantRegleCentimes: 0,
    soldeCentimes: 7000,
    relanceNiveau: 0,
    relanceLe: null,
    motifAvoir: null,
    motifAvoirAutre: null,
    porteeAvoir: null,
    qr: {
      qrPayload: 'peu importe',
      qrPayloadSha256: 'peu importe',
      typeReferenceQr: 'qrr',
      qrReference: '000000000020261000000000019',
      qrMontantCentimes: 7000,
      qrDevise: 'CHF',
      qrLangue: 'fr',
      creancier: {
        iban: 'CH4431999123000889012',
        estQrIban: true,
        nom: 'Garage Martin SA',
        adresse: {
          rue: 'Route de Riddes',
          numero: '42',
          npa: '1950',
          localite: 'Sion',
          pays: 'CH',
        },
      },
      debiteur: null,
    },
    pdfCle: null,
    pdfSha256: null,
    exporteLe: null,
    exportId: null,
    contentieux: false,
    lignes: [],
    nombreLignes: 0,
    lignesTronquees: false,
    version: 1,
    emisLe: '2026-07-29T10:00:00.000Z',
    emisPar: null,
    creeLe: '2026-07-29T09:00:00.000Z',
    modifieLe: '2026-07-29T10:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

class StockagePdfMemoire implements StockagePdf {
  readonly contenu = new Map<string, Buffer>();
  async ecrire(cle: string, buffer: Buffer): Promise<void> {
    this.contenu.set(cle, buffer);
  }
  async lire(cle: string): Promise<Buffer> {
    const b = this.contenu.get(cle);
    // Comme le disque : une clé absente est une ENOENT (le logo, optionnel, en dépend).
    if (!b) throw Object.assign(new Error(`clé absente : ${cle}`), { code: 'ENOENT' });
    return b;
  }
  async supprimer(cle: string): Promise<void> {
    this.contenu.delete(cle);
  }
  // Non exercée par ces tests (impression, pas résiliation) — voir
  // `exploitation/cycle-vie-tenant/service-cycle-vie-resiliation.spec.ts` pour la couverture réelle
  // de `purgerTenant` (correctif nLPD).
  async purgerTenant(tenantId: string): Promise<void> {
    for (const cle of [...this.contenu.keys()]) {
      if (cle.startsWith(`${tenantId}/`)) this.contenu.delete(cle);
    }
  }
}

function accesBaseFake(
  numeroTvaTenant: string | null = 'CHE-114.873.733 TVA',
  blocCreancier: readonly Record<string, string>[] = [
    {
      nom: 'Garage Martin SA',
      rue: 'Route de Riddes',
      numero: '42',
      npa: '1950',
      localite: 'Sion',
    },
  ],
  assujettiTva = true,
): AccesBase & { readonly misAJour: { cle: string; sha256: string }[] } {
  const misAJour: { cle: string; sha256: string }[] = [];
  return {
    misAJour,
    async enTenant<T>(_ctx: ContexteTenant, travail: (tx: unknown) => Promise<T>): Promise<T> {
      const tx = {
        select: () => ({
          from: (table: unknown) => ({
            where: () => ({
              limit: async () => {
                if (table === tenant)
                  return [
                    { raisonSociale: 'Garage Martin SA', numeroTva: numeroTvaTenant, assujettiTva },
                  ];
                if (table === site)
                  return [{ rue: 'Rue du Site', npa: '1000', localite: 'Lausanne' }];
                return blocCreancier;
              },
            }),
          }),
        }),
        update: () => ({
          set: (valeurs: { pdfCle: string; pdfSha256: string }) => ({
            where: async () => {
              misAJour.push({ cle: valeurs.pdfCle, sha256: valeurs.pdfSha256 });
            },
          }),
        }),
      };
      return travail(tx);
    },
    async verifierConnexion(): Promise<void> {},
  } as unknown as AccesBase & { readonly misAJour: { cle: string; sha256: string }[] };
}

describe('ServiceImpressionFacture', () => {
  beforeEach(() => {
    vi.mocked(genererPdfFacture).mockReset();
    vi.mocked(genererPdfDevis).mockReset();
  });

  it('imprime un devis (brouillon ou émis) sans passer par le cache ni le bulletin QR', async () => {
    const serviceDocuments = {
      obtenirComplet: vi
        .fn()
        .mockResolvedValue(documentFacture({ typeDocument: 'devis', qr: null, numero: 'DEV-1' })),
    } as unknown as ServiceDocumentsVente;
    vi.mocked(genererPdfDevis).mockResolvedValue(Buffer.from('%PDF-devis'));
    const stockage = new StockagePdfMemoire();
    const acces = accesBaseFake();
    const service = new ServiceImpressionFacture(acces, stockage, serviceDocuments);

    const resultat = await service.obtenirPdf(CTX, PRINCIPAL, 'doc-1');

    expect(resultat.nomFichier).toBe('Devis-DEV-1.pdf');
    expect(genererPdfDevis).toHaveBeenCalledWith(
      expect.objectContaining({ typeDocument: 'devis' }),
      {
        nom: 'Garage Martin SA',
        rue: 'Route de Riddes',
        numero: '42',
        npa: '1950',
        localite: 'Sion',
        numeroTva: 'CHE-114.873.733 TVA',
        nonAssujettiTva: false,
      },
      null, // pas de logo déposé
    );
    expect(genererPdfFacture).not.toHaveBeenCalled();
    expect(stockage.contenu.size).toBe(0);
    expect(acces.misAJour).toHaveLength(0);
  });

  it('imprime une facture émise sans bloc QR (expéditeur lu au paramétrage)', async () => {
    const serviceDocuments = {
      obtenirComplet: vi.fn().mockResolvedValue(documentFacture({ qr: null })),
    } as unknown as ServiceDocumentsVente;
    vi.mocked(genererPdfFacture).mockResolvedValue(Buffer.from('%PDF-f'));
    const service = new ServiceImpressionFacture(
      accesBaseFake(),
      new StockagePdfMemoire(),
      serviceDocuments,
    );
    await service.obtenirPdf(CTX, PRINCIPAL, 'doc-1');
    expect(genererPdfFacture).toHaveBeenCalledWith(
      expect.objectContaining({ qr: null }),
      expect.objectContaining({ nom: 'Garage Martin SA' }),
      null, // pas de logo déposé
    );
  });

  it('garage sans bloc créancier (sans IBAN) : expéditeur = raison sociale + adresse du site + n° TVA', async () => {
    const serviceDocuments = {
      obtenirComplet: vi.fn().mockResolvedValue(documentFacture({ qr: null })),
    } as unknown as ServiceDocumentsVente;
    vi.mocked(genererPdfFacture).mockResolvedValue(Buffer.from('%PDF-f'));
    const service = new ServiceImpressionFacture(
      accesBaseFake('CHE-114.873.733 TVA', []),
      new StockagePdfMemoire(),
      serviceDocuments,
    );
    await service.obtenirPdf(CTX, PRINCIPAL, 'doc-1');
    expect(vi.mocked(genererPdfFacture).mock.calls[0]?.[1]).toEqual({
      nom: 'Garage Martin SA',
      rue: 'Rue du Site',
      numero: null,
      npa: '1000',
      localite: 'Lausanne',
      numeroTva: 'CHE-114.873.733 TVA',
      nonAssujettiTva: false,
    });
  });

  describe('garage non assujetti à la TVA', () => {
    function ligne(tauxTvaPourmille: number): ReponseDocumentVente['lignes'][number] {
      return { tauxTvaPourmille } as unknown as ReponseDocumentVente['lignes'][number];
    }

    async function expediteurPour(
      assujettiTva: boolean,
      lignes: ReponseDocumentVente['lignes'],
    ): Promise<unknown> {
      const serviceDocuments = {
        obtenirComplet: vi.fn().mockResolvedValue(documentFacture({ qr: null, lignes })),
      } as unknown as ServiceDocumentsVente;
      vi.mocked(genererPdfFacture).mockResolvedValue(Buffer.from('%PDF-f'));
      const service = new ServiceImpressionFacture(
        accesBaseFake(null, [], assujettiTva),
        new StockagePdfMemoire(),
        serviceDocuments,
      );
      await service.obtenirPdf(CTX, PRINCIPAL, 'doc-1');
      return vi.mocked(genererPdfFacture).mock.calls.at(-1)?.[1];
    }

    it('non assujetti ET toutes les lignes à 0 ‰ : le PDF est rendu sans TVA', async () => {
      expect(await expediteurPour(false, [ligne(0), ligne(0)])).toMatchObject({
        nonAssujettiTva: true,
        numeroTva: null,
      });
    });

    it('non assujetti mais une ligne taxée (émise quand le garage était assujetti) : TVA conservée', async () => {
      expect(await expediteurPour(false, [ligne(0), ligne(81)])).toMatchObject({
        nonAssujettiTva: false,
      });
    });

    it('assujetti, lignes à 0 ‰ : jamais de mention « non assujetti »', async () => {
      expect(await expediteurPour(true, [ligne(0)])).toMatchObject({ nonAssujettiTva: false });
    });
  });

  it('passe le logo PNG déposé par le garage au rendu du devis (et ignore celui d’un autre tenant)', async () => {
    const serviceDocuments = {
      obtenirComplet: vi
        .fn()
        .mockResolvedValue(documentFacture({ typeDocument: 'devis', qr: null, numero: 'DEV-1' })),
    } as unknown as ServiceDocumentsVente;
    vi.mocked(genererPdfDevis).mockResolvedValue(Buffer.from('%PDF-devis'));
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(8),
    ]);
    const stockage = new StockagePdfMemoire();
    stockage.contenu.set('t-1/logo', png);
    stockage.contenu.set('t-2/logo', Buffer.from('autre'));
    const service = new ServiceImpressionFacture(accesBaseFake(), stockage, serviceDocuments);

    await service.obtenirPdf(CTX, PRINCIPAL, 'doc-1');

    expect(vi.mocked(genererPdfDevis).mock.calls[0]?.[2]).toEqual(png);
  });

  it('refuse un brouillon de facture', async () => {
    const serviceDocuments = {
      obtenirComplet: vi.fn().mockResolvedValue(documentFacture({ qr: null, statut: 'brouillon' })),
    } as unknown as ServiceDocumentsVente;
    const service = new ServiceImpressionFacture(
      accesBaseFake(),
      new StockagePdfMemoire(),
      serviceDocuments,
    );

    await expect(service.obtenirPdf(CTX, PRINCIPAL, 'doc-1')).rejects.toMatchObject({
      code: 'DOCUMENT_PDF_INDISPONIBLE',
    });
  });

  it('refuse un avoir (crédite le client, ne se paie pas)', async () => {
    const serviceDocuments = {
      obtenirComplet: vi
        .fn()
        .mockResolvedValue(documentFacture({ typeDocument: 'avoir', qr: null })),
    } as unknown as ServiceDocumentsVente;
    const service = new ServiceImpressionFacture(
      accesBaseFake(),
      new StockagePdfMemoire(),
      serviceDocuments,
    );

    await expect(service.obtenirPdf(CTX, PRINCIPAL, 'doc-1')).rejects.toMatchObject({
      code: 'DOCUMENT_PDF_INDISPONIBLE',
    });
  });

  it('première demande : génère, met en cache (stockage + pdfCle/pdfSha256), renvoie le buffer', async () => {
    vi.mocked(genererPdfFacture).mockResolvedValue(Buffer.from('%PDF-contenu-genere'));
    const serviceDocuments = {
      obtenirComplet: vi.fn().mockResolvedValue(documentFacture()),
    } as unknown as ServiceDocumentsVente;
    const stockage = new StockagePdfMemoire();
    const acces = accesBaseFake();
    const service = new ServiceImpressionFacture(acces, stockage, serviceDocuments);

    const resultat = await service.obtenirPdf(CTX, PRINCIPAL, 'doc-1');

    expect(resultat.buffer.toString()).toBe('%PDF-contenu-genere');
    expect(resultat.nomFichier).toBe('Facture-2026-00042.pdf');
    expect(stockage.contenu.get('t-1/doc-1.pdf')?.toString()).toBe('%PDF-contenu-genere');
    expect(acces.misAJour).toHaveLength(1);
    expect(acces.misAJour[0]?.cle).toBe('t-1/doc-1.pdf');
    expect(genererPdfFacture).toHaveBeenCalledTimes(1);
  });

  it('demande suivante (pdfCle déjà posé) : relit le cache, ne régénère jamais', async () => {
    const stockage = new StockagePdfMemoire();
    await stockage.ecrire('t-1/doc-1.pdf', Buffer.from('%PDF-deja-en-cache'));

    const serviceDocuments = {
      obtenirComplet: vi
        .fn()
        .mockResolvedValue(documentFacture({ pdfCle: 't-1/doc-1.pdf', pdfSha256: null })),
    } as unknown as ServiceDocumentsVente;
    const service = new ServiceImpressionFacture(accesBaseFake(), stockage, serviceDocuments);

    const resultat = await service.obtenirPdf(CTX, PRINCIPAL, 'doc-1');

    expect(resultat.buffer.toString()).toBe('%PDF-deja-en-cache');
    expect(genererPdfFacture).not.toHaveBeenCalled();
  });

  it("refuse de servir un PDF en cache dont l'empreinte SHA-256 ne correspond plus (corruption)", async () => {
    const stockage = new StockagePdfMemoire();
    await stockage.ecrire('t-1/doc-1.pdf', Buffer.from('contenu-altere'));

    const serviceDocuments = {
      obtenirComplet: vi.fn().mockResolvedValue(
        documentFacture({
          pdfCle: 't-1/doc-1.pdf',
          pdfSha256: 'empreinte-qui-ne-correspond-pas',
        }),
      ),
    } as unknown as ServiceDocumentsVente;
    const service = new ServiceImpressionFacture(accesBaseFake(), stockage, serviceDocuments);

    await expect(service.obtenirPdf(CTX, PRINCIPAL, 'doc-1')).rejects.toMatchObject({
      code: 'ERREUR_INTERNE',
    });
  });
});
