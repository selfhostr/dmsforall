/**
 * `GET /documents-vente/{id}/pdf` — génération PARESSEUSE, mise en cache, JAMAIS régénérée
 * (`document_vente.pdfCle`/`pdfSha256`, points d'ancrage déjà présents dans le schéma — voir
 * `docs/design-impression-facture-qr.md`, `DI-3`). Une facture émise est immuable ; son PDF aussi.
 *
 * Ce service NE FAIT PAS le contrôle de droit (`RF-116`) — c'est `@ExigerDroit(...)` sur la route
 * (`impression-facture.controller.ts`) qui en est responsable, un vrai portillon déclaratif, pas
 * un masquage d'affichage. Ce service ajoute une SECONDE ligne de défense, indépendante : il
 * s'appuie sur `ServiceDocumentsVente.obtenirComplet`, qui masque déjà `qr`/les montants pour un
 * rôle sans droit (`facturation/documents/mappeurs.ts::roleVoitLesMontants`) — si `document.qr`
 * est `null` pour CETTE raison, la génération est refusée exactement comme pour un devis/brouillon.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { ReponseDocumentVente } from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant } from '../../db';
import { documentVente, site, tenant, tenantBlocCreancier } from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';

import { ServiceDocumentsVente } from '../documents/service-documents';
import {
  genererPdfDevis,
  genererPdfFacture,
  type ExpediteurImpression,
} from './generation-pdf-facture';
import { JETON_STOCKAGE_PDF } from './impression.jetons';
import { lireLogoImprimable } from './logo/service-logo-entreprise';
import { cleePdfDocument, sha256Hex, type StockagePdf } from './stockage-pdf';

export interface PdfFactureResultat {
  readonly buffer: Buffer;
  readonly sha256: string;
  /** Nom de fichier suggéré au téléchargement — `Facture-<numero>.pdf`, `numero` figé. */
  readonly nomFichier: string;
}

function estEligibleImpression(document: ReponseDocumentVente): boolean {
  // Une FACTURE non brouillon s'imprime : avec bulletin QR quand le bloc est figé, SANS bulletin
  // (mention « coordonnées de paiement non renseignées ») quand `qr` est null — garage sans bloc
  // créancier complet à l'émission, ou devise hors CHF/EUR (RF-58). Un bon de commande ou un avoir
  // (il crédite le client) n'ont jamais de PDF ; un brouillon n'a ni numéro ni montants figés.
  return document.typeDocument === 'facture' && document.statut !== 'brouillon';
}

@Injectable()
export class ServiceImpressionFacture {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_STOCKAGE_PDF) private readonly stockage: StockagePdf,
    private readonly serviceDocuments: ServiceDocumentsVente,
  ) {}

  async obtenirPdf(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
  ): Promise<PdfFactureResultat> {
    const document = await this.serviceDocuments.obtenirComplet(ctx, principal, documentId);

    if (document.typeDocument === 'devis') {
      return this.obtenirPdfDevis(ctx, document);
    }

    if (!estEligibleImpression(document)) {
      throw new ErreurMetier(
        'DOCUMENT_PDF_INDISPONIBLE',
        `Le document ${documentId} n'a pas de PDF : seuls un devis et une FACTURE ÉMISE ` +
          "s'impriment (un bon de commande, un avoir ou un brouillon de facture, non).",
      );
    }

    const nomFichier = `Facture-${(document.numero ?? documentId).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;

    if (document.pdfCle) {
      const buffer = await this.stockage.lire(document.pdfCle);
      const sha256 = sha256Hex(buffer);
      if (document.pdfSha256 && sha256 !== document.pdfSha256) {
        // Le contenu lu ne correspond plus à l'empreinte figée en base — corruption ou altération
        // du stockage. Refuser plutôt que de rendre un PDF dont on ne peut plus garantir qu'il est
        // celui réellement émis (même doctrine que la vérification du payload QR).
        throw new ErreurMetier(
          'ERREUR_INTERNE',
          `Document ${documentId} : le PDF mis en cache (${document.pdfCle}) ne correspond plus à ` +
            'son empreinte SHA-256 figée en base — refus de le servir.',
        );
      }
      return { buffer, sha256, nomFichier };
    }

    // Première demande : génération paresseuse. `genererPdfFacture` vérifie elle-même
    // l'équivalence du payload QR (DI-3/MD-77) et refuse AVANT de rendre quoi que ce soit en cas
    // de divergence — cette fonction ne fait qu'orchestrer la mise en cache autour.
    const buffer = await genererPdfFacture(
      document,
      await this.lireExpediteur(ctx, document.siteId),
      await lireLogoImprimable(this.stockage, ctx.tenantId),
    );
    const sha256 = sha256Hex(buffer);
    const cle = cleePdfDocument(ctx.tenantId, documentId);

    await this.stockage.ecrire(cle, buffer);
    await this.persisterCleEtEmpreinte(ctx, documentId, cle, sha256);

    return { buffer, sha256, nomFichier };
  }

  /**
   * Devis : PDF sans bulletin QR ni numéro de facture, rendu à chaque demande (non mis en cache :
   * un devis brouillon reste modifiable). Tout statut de devis s'imprime, brouillon compris (titre
   * « Devis (brouillon) » sans numéro). Les montants sont exigés visibles (même garde RF-116 que
   * la facture, `exigerMontantsVisibles`). L'expéditeur vient du paramétrage du garage
   * (`tenant_bloc_creancier`, nom + adresse seulement — jamais l'IBAN).
   */
  private async obtenirPdfDevis(
    ctx: ContexteTenant,
    document: ReponseDocumentVente,
  ): Promise<PdfFactureResultat> {
    const expediteur = await this.lireExpediteur(ctx, document.siteId);
    const buffer = await genererPdfDevis(
      document,
      expediteur,
      await lireLogoImprimable(this.stockage, ctx.tenantId),
    );
    const sha256 = sha256Hex(buffer);
    const nomFichier = `Devis-${(document.numero ?? document.id).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
    return { buffer, sha256, nomFichier };
  }

  /**
   * Expéditeur imprimé. Nom/adresse : bloc créancier s'il est renseigné, sinon raison sociale du
   * tenant et adresse du site du document (un garage sans IBAN n'a pas de bloc créancier mais doit
   * quand même figurer en en-tête). N° TVA : `tenant.numero_tva` (réglages entreprise).
   */
  private async lireExpediteur(ctx: ContexteTenant, siteId: string): Promise<ExpediteurImpression> {
    return this.acces.enTenant(ctx, async (tx) => {
      const [bloc] = await tx
        .select({
          nom: tenantBlocCreancier.nom,
          rue: tenantBlocCreancier.rue,
          numero: tenantBlocCreancier.numero,
          npa: tenantBlocCreancier.npa,
          localite: tenantBlocCreancier.localite,
        })
        .from(tenantBlocCreancier)
        .where(eq(tenantBlocCreancier.tenantId, ctx.tenantId))
        .limit(1);
      const [ligneTenant] = await tx
        .select({ raisonSociale: tenant.raisonSociale, numeroTva: tenant.numeroTva })
        .from(tenant)
        .where(eq(tenant.id, ctx.tenantId))
        .limit(1);
      const [ligneSite] = await tx
        .select({ rue: site.rue, npa: site.npa, localite: site.localite })
        .from(site)
        .where(and(eq(site.tenantId, ctx.tenantId), eq(site.id, siteId)))
        .limit(1);

      const blocComplet = !!bloc?.nom?.trim();
      return {
        nom: bloc?.nom?.trim() || ligneTenant?.raisonSociale || '',
        rue: blocComplet ? (bloc?.rue ?? null) : (ligneSite?.rue ?? null),
        numero: blocComplet ? (bloc?.numero ?? null) : null,
        npa: blocComplet ? (bloc?.npa ?? null) : (ligneSite?.npa ?? null),
        localite: blocComplet ? (bloc?.localite ?? null) : (ligneSite?.localite ?? null),
        numeroTva: ligneTenant?.numeroTva ?? null,
      };
    });
  }

  /**
   * `WHERE pdf_cle IS NULL` : si deux premières requêtes concurrentes génèrent en parallèle (course
   * bénigne — `generation-pdf-facture.ts` produit des octets déterministes, `CreationDate` fixée à
   * `emisLe`), seule la PREMIÈRE écriture gagne la colonne ; les autres n'écrasent pas un `pdfCle`
   * déjà posé par une requête plus rapide. Le fichier physique de la « perdante » reste sur disque,
   * orphelin mais inoffensif (même clé de tenant/document, contenu identique).
   */
  private async persisterCleEtEmpreinte(
    ctx: ContexteTenant,
    documentId: string,
    cle: string,
    sha256: string,
  ): Promise<void> {
    await this.acces.enTenant(ctx, async (tx) => {
      await tx
        .update(documentVente)
        .set({ pdfCle: cle, pdfSha256: sha256 })
        .where(
          and(
            eq(documentVente.tenantId, ctx.tenantId),
            eq(documentVente.id, documentId),
            isNull(documentVente.pdfCle),
          ),
        );
    });
  }
}
