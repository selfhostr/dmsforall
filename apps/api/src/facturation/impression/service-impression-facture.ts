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
import { documentVente } from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';

import { ServiceDocumentsVente } from '../documents/service-documents';
import { genererPdfFacture } from './generation-pdf-facture';
import { JETON_STOCKAGE_PDF } from './impression.jetons';
import { cleePdfDocument, sha256Hex, type StockagePdf } from './stockage-pdf';

export interface PdfFactureResultat {
  readonly buffer: Buffer;
  readonly sha256: string;
  /** Nom de fichier suggéré au téléchargement — `Facture-<numero>.pdf`, `numero` figé. */
  readonly nomFichier: string;
}

function estEligibleImpression(document: ReponseDocumentVente): boolean {
  // Seule une FACTURE ÉMISE porte un bulletin QR (`RF-54`) : un devis, un bon de commande ou un
  // avoir (il crédite le client, il ne se paie pas) n'ont jamais de PDF. `document.qr === null`
  // couvre aussi le brouillon (bulletin construit seulement à l'émission, `qr-emission.ts`), la
  // devise hors CHF/EUR (`RF-58`, pas de bulletin QR alors) et — défense en profondeur — un rôle
  // sans droit aux montants dont la réponse a déjà `qr` masqué à `null`.
  return document.typeDocument === 'facture' && document.qr !== null;
}

@Injectable()
export class ServiceImpressionFacture {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_STOCKAGE_PDF) private readonly stockage: StockagePdf,
    private readonly serviceDocuments: ServiceDocumentsVente,
  ) {}

  async obtenirPdf(ctx: ContexteTenant, principal: PrincipalAuthentifie, documentId: string): Promise<PdfFactureResultat> {
    const document = await this.serviceDocuments.obtenirComplet(ctx, principal, documentId);

    if (!estEligibleImpression(document)) {
      throw new ErreurMetier(
        'DOCUMENT_PDF_INDISPONIBLE',
        `Le document ${documentId} n'a pas de bulletin QR-facture : seule une FACTURE ÉMISE en ` +
          'porte un (un devis, un bon de commande, un avoir ou un brouillon n\'en ont jamais).',
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
    const buffer = await genererPdfFacture(document);
    const sha256 = sha256Hex(buffer);
    const cle = cleePdfDocument(ctx.tenantId, documentId);

    await this.stockage.ecrire(cle, buffer);
    await this.persisterCleEtEmpreinte(ctx, documentId, cle, sha256);

    return { buffer, sha256, nomFichier };
  }

  /**
   * `WHERE pdf_cle IS NULL` : si deux premières requêtes concurrentes génèrent en parallèle (course
   * bénigne — `generation-pdf-facture.ts` produit des octets déterministes, `CreationDate` fixée à
   * `emisLe`), seule la PREMIÈRE écriture gagne la colonne ; les autres n'écrasent pas un `pdfCle`
   * déjà posé par une requête plus rapide. Le fichier physique de la « perdante » reste sur disque,
   * orphelin mais inoffensif (même clé de tenant/document, contenu identique).
   */
  private async persisterCleEtEmpreinte(ctx: ContexteTenant, documentId: string, cle: string, sha256: string): Promise<void> {
    await this.acces.enTenant(ctx, async (tx) => {
      await tx
        .update(documentVente)
        .set({ pdfCle: cle, pdfSha256: sha256 })
        .where(and(eq(documentVente.tenantId, ctx.tenantId), eq(documentVente.id, documentId), isNull(documentVente.pdfCle)));
    });
  }
}
