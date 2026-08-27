import { describe, expect, it, vi } from 'vitest';
import type { ReponseDocumentVente } from '@dfa/shared';

import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import type { AccesBase, ContexteTenant } from '../../db';
import type { Config } from '../../config';
import type { MessageCourriel, ServiceCourriel } from '../../courriel/service-courriel';
import type { ResultatEnvoiCourriel } from '../../courriel/transport-courriel.interface';
import type { ServiceDocumentsVente } from '../documents/service-documents';

import { ServiceEnvoiFactureCourriel } from './service-envoi-facture-courriel';
import type { PdfFactureResultat, ServiceImpressionFacture } from './service-impression-facture';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u-1', requeteId: 'req-1' };
const PRINCIPAL: PrincipalAuthentifie = {
  sessionId: 's-1',
  tenantId: 'tid-1',
  utilisateurId: 'u-1',
  role: 'direction',
  langue: 'fr',
};

/** Trimmé au strict nécessaire pour ce service — même patron que `service-impression-
 *  facture.spec.ts::documentFacture`, dupliqué (pas d'utilitaire de fixture partagé dans ce
 *  dépôt à ce jour). */
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
    qr: null,
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

function pdfResultat(overrides: Partial<PdfFactureResultat> = {}): PdfFactureResultat {
  return {
    buffer: Buffer.from('%PDF-contenu'),
    sha256: 'peu-importe',
    nomFichier: 'Facture-2026-00042.pdf',
    ...overrides,
  };
}

function accesFactice(ligne: {
  readonly clientEmail: string | null;
  readonly raisonSociale?: string;
  readonly emailContactGarage?: string | null;
}): AccesBase {
  return {
    enTenant: vi.fn(async (_ctx: ContexteTenant, travail: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn(async () => ({
          rows: [
            {
              clientEmail: ligne.clientEmail,
              raisonSociale: ligne.raisonSociale ?? 'Garage Martin SA',
              emailContactGarage:
                ligne.emailContactGarage === undefined
                  ? 'direction@garage-martin.ch'
                  : ligne.emailContactGarage,
            },
          ],
        })),
      };
      return travail(tx);
    }),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  } as unknown as AccesBase;
}

function courrielFactice(
  resultat: ResultatEnvoiCourriel = { succes: true, idMessage: 'courriel-1' },
): ServiceCourriel & { readonly appels: MessageCourriel[] } {
  const appels: MessageCourriel[] = [];
  return {
    envoyer: vi.fn(async (message: MessageCourriel) => {
      appels.push(message);
      return resultat;
    }),
    appels,
  } as unknown as ServiceCourriel & { readonly appels: MessageCourriel[] };
}

function configFactice(): Config {
  return { SMTP_EXPEDITEUR: 'no-reply@dmsforall.example' } as Config;
}

describe('ServiceEnvoiFactureCourriel.envoyer', () => {
  it('chemin complet : PDF obtenu via ServiceImpressionFacture (droits + génération paresseuse), envoyé au client avec pièce jointe', async () => {
    const document = documentFacture();
    const serviceDocuments = {
      obtenirComplet: vi.fn().mockResolvedValue(document),
    } as unknown as ServiceDocumentsVente;
    const pdf = pdfResultat();
    const serviceImpression = {
      obtenirPdf: vi.fn().mockResolvedValue(pdf),
    } as unknown as ServiceImpressionFacture;
    const courriel = courrielFactice({ succes: true, idMessage: 'msg-xyz' });
    const acces = accesFactice({ clientEmail: 'client@example.ch' });

    const service = new ServiceEnvoiFactureCourriel(
      acces,
      serviceDocuments,
      serviceImpression,
      courriel,
      configFactice(),
    );

    const resultat = await service.envoyer(CTX, PRINCIPAL, 'doc-1');

    expect(resultat).toEqual({
      envoye: true,
      destinataire: 'client@example.ch',
      idMessage: 'msg-xyz',
    });
    expect(courriel.appels).toHaveLength(1);
    expect(courriel.appels[0]).toMatchObject({
      destinataires: ['client@example.ch'],
      nomGarage: 'Garage Martin SA',
      adresseReponseGarage: 'direction@garage-martin.ch',
      piecesJointes: [
        { nomFichier: pdf.nomFichier, contenu: pdf.buffer, typeMime: 'application/pdf' },
      ],
    });
    expect(serviceImpression.obtenirPdf).toHaveBeenCalledWith(CTX, PRINCIPAL, 'doc-1');
  });

  it("refuse AVANT tout envoi si la fiche client n'a aucune adresse courriel (FACTURE_DESTINATAIRE_COURRIEL_ABSENT)", async () => {
    const serviceDocuments = {
      obtenirComplet: vi.fn().mockResolvedValue(documentFacture()),
    } as unknown as ServiceDocumentsVente;
    const serviceImpression = {
      obtenirPdf: vi.fn().mockResolvedValue(pdfResultat()),
    } as unknown as ServiceImpressionFacture;
    const courriel = courrielFactice();
    const acces = accesFactice({ clientEmail: null });

    const service = new ServiceEnvoiFactureCourriel(
      acces,
      serviceDocuments,
      serviceImpression,
      courriel,
      configFactice(),
    );

    await expect(service.envoyer(CTX, PRINCIPAL, 'doc-1')).rejects.toMatchObject({
      code: 'FACTURE_DESTINATAIRE_COURRIEL_ABSENT',
    });
    expect(courriel.envoyer).not.toHaveBeenCalled();
  });

  it('propage DOCUMENT_PDF_INDISPONIBLE tel quel (document pas éligible — déjà couvert par ServiceImpressionFacture)', async () => {
    const serviceDocuments = {
      obtenirComplet: vi.fn().mockResolvedValue(documentFacture()),
    } as unknown as ServiceDocumentsVente;
    const erreur = Object.assign(new Error('pas éligible'), { code: 'DOCUMENT_PDF_INDISPONIBLE' });
    const serviceImpression = {
      obtenirPdf: vi.fn().mockRejectedValue(erreur),
    } as unknown as ServiceImpressionFacture;
    const courriel = courrielFactice();
    const acces = accesFactice({ clientEmail: 'client@example.ch' });

    const service = new ServiceEnvoiFactureCourriel(
      acces,
      serviceDocuments,
      serviceImpression,
      courriel,
      configFactice(),
    );

    await expect(service.envoyer(CTX, PRINCIPAL, 'doc-1')).rejects.toBe(erreur);
    expect(courriel.envoyer).not.toHaveBeenCalled();
  });

  it('refuse (ERREUR_INTERNE) si le transport échoue — action SYNCHRONE, jamais un succès silencieux', async () => {
    const serviceDocuments = {
      obtenirComplet: vi.fn().mockResolvedValue(documentFacture()),
    } as unknown as ServiceDocumentsVente;
    const serviceImpression = {
      obtenirPdf: vi.fn().mockResolvedValue(pdfResultat()),
    } as unknown as ServiceImpressionFacture;
    const courriel = courrielFactice({ succes: false, erreur: 'boîte pleine' });
    const acces = accesFactice({ clientEmail: 'client@example.ch' });

    const service = new ServiceEnvoiFactureCourriel(
      acces,
      serviceDocuments,
      serviceImpression,
      courriel,
      configFactice(),
    );

    await expect(service.envoyer(CTX, PRINCIPAL, 'doc-1')).rejects.toMatchObject({
      code: 'ERREUR_INTERNE',
    });
  });

  it('sans compte direction/comptable actif pour le tenant : repli sur SMTP_EXPEDITEUR pour le Reply-To (jamais un envoi bloqué)', async () => {
    const serviceDocuments = {
      obtenirComplet: vi.fn().mockResolvedValue(documentFacture()),
    } as unknown as ServiceDocumentsVente;
    const serviceImpression = {
      obtenirPdf: vi.fn().mockResolvedValue(pdfResultat()),
    } as unknown as ServiceImpressionFacture;
    const courriel = courrielFactice();
    const acces = accesFactice({ clientEmail: 'client@example.ch', emailContactGarage: null });

    const service = new ServiceEnvoiFactureCourriel(
      acces,
      serviceDocuments,
      serviceImpression,
      courriel,
      configFactice(),
    );

    await service.envoyer(CTX, PRINCIPAL, 'doc-1');

    expect(courriel.appels[0]?.adresseReponseGarage).toBe('no-reply@dmsforall.example');
  });
});
