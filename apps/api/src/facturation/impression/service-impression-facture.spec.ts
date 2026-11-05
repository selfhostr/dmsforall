import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReponseDocumentVente } from '@dfa/shared';

import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import type { AccesBase, ContexteTenant } from '../../db';
import type { ServiceDocumentsVente } from '../documents/service-documents';

import { genererPdfFacture } from './generation-pdf-facture';
import { ServiceImpressionFacture } from './service-impression-facture';
import type { StockagePdf } from './stockage-pdf';

vi.mock('./generation-pdf-facture', () => ({ genererPdfFacture: vi.fn() }));

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
    if (!b) throw new Error(`clé absente : ${cle}`);
    return b;
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

function accesBaseFake(): AccesBase & { readonly misAJour: { cle: string; sha256: string }[] } {
  const misAJour: { cle: string; sha256: string }[] = [];
  return {
    misAJour,
    async enTenant<T>(_ctx: ContexteTenant, travail: (tx: unknown) => Promise<T>): Promise<T> {
      const tx = {
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
  });

  it('refuse un devis (jamais de bulletin QR) avec DOCUMENT_PDF_INDISPONIBLE', async () => {
    const serviceDocuments = {
      obtenirComplet: vi
        .fn()
        .mockResolvedValue(documentFacture({ typeDocument: 'devis', qr: null })),
    } as unknown as ServiceDocumentsVente;
    const service = new ServiceImpressionFacture(
      accesBaseFake(),
      new StockagePdfMemoire(),
      serviceDocuments,
    );

    await expect(service.obtenirPdf(CTX, PRINCIPAL, 'doc-1')).rejects.toMatchObject({
      code: 'DOCUMENT_PDF_INDISPONIBLE',
    });
    expect(genererPdfFacture).not.toHaveBeenCalled();
  });

  it('refuse une facture sans bloc QR (brouillon, devise hors CHF/EUR, ou rôle sans droit aux montants)', async () => {
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
