/**
 * `GET /ordres-reparation/{orId}/pdf` — génération de la feuille d'atelier, RÉGÉNÉRÉE À CHAQUE
 * APPEL, sans cache ni colonne de persistance (voir `generation-pdf-or.ts` pour la doctrine
 * complète : un OR est VIVANT, contrairement à une facture émise).
 *
 * Ce service NE FAIT PAS le contrôle de droit — c'est `@ExigerDroit('atelier.or.lire')` sur la
 * route (`impression-or.controller.ts`) qui en est responsable. Il s'appuie sur
 * `ServiceOr.obtenirComplet`, qui applique déjà le filtrage des montants par rôle
 * (`atelier/mappeurs.ts::roleVoitLesMontants`) — cette deuxième ligne de défense est portée par
 * `generation-pdf-or.ts` (présence de `document.totauxParPayeur`), pas ici.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { JETON_DB, type AccesBase, type ContexteTenant } from '../../db';
import { site, tenant } from '../../db/schema';
import type { IdentiteEmetteur } from '../../facturation/impression/en-tete-emetteur';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';

import { ServiceOr } from '../service-or';
import { genererPdfOr } from './generation-pdf-or';

export interface PdfOrResultat {
  readonly buffer: Buffer;
  /** Nom de fichier suggéré au téléchargement — `OR-<numero>.pdf`. */
  readonly nomFichier: string;
}

@Injectable()
export class ServiceImpressionOr {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly serviceOr: ServiceOr,
  ) {}

  async obtenirPdf(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
  ): Promise<PdfOrResultat> {
    // `obtenirComplet` lève `RESSOURCE_INTROUVABLE` (404) si l'OR n'existe pas pour ce tenant —
    // aucune vérification d'éligibilité supplémentaire ici : à la différence d'une facture, TOUT
    // OR est imprimable, quel que soit son statut (RM/§ « feuille d'atelier », doctrine du
    // chantier : c'est un document de travail, pas un document comptable verrouillé).
    const document = await this.serviceOr.obtenirComplet(ctx, principal, orId);
    const nomSite = await this.chargerNomSite(ctx, document.siteId);

    const emetteur = await this.chargerEmetteur(ctx, document.siteId);

    const buffer = await genererPdfOr(document, nomSite, emetteur);
    const nomFichier = `OR-${document.numero.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;

    return { buffer, nomFichier };
  }

  /**
   * `ReponseOrdreReparation` ne porte que `siteId` (uuid) — le nom du site n'est pas embarqué dans
   * ce contrat (§ hors périmètre : `packages/shared/**` en lecture seule pour cette tâche, voir
   * le rapport). Résolu ici par une requête directe, en LECTURE SEULE sur `site`, plutôt que
   * d'attendre une évolution de contrat pour un simple libellé d'en-tête. Retombe sur une chaîne
   * vide si le site est introuvable (ne devrait jamais arriver, FK `ordre_reparation.site_id` non
   * nulle) — `generation-pdf-or.ts` omet alors simplement la ligne « Site », jamais un texte
   * trompeur du genre l'uuid brut.
   */
  private async chargerNomSite(ctx: ContexteTenant, siteId: string): Promise<string> {
    return this.acces.enTenant(ctx, async (tx) => {
      const [ligne] = await tx
        .select({ nom: site.nom })
        .from(site)
        .where(and(eq(site.tenantId, ctx.tenantId), eq(site.id, siteId)))
        .limit(1);
      return ligne?.nom ?? '';
    });
  }

  /** En-tête garage : raison sociale + n° TVA du tenant, adresse du site de l'OR. */
  private async chargerEmetteur(ctx: ContexteTenant, siteId: string): Promise<IdentiteEmetteur> {
    return this.acces.enTenant(ctx, async (tx) => {
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
      return {
        nom: ligneTenant?.raisonSociale ?? '',
        rue: ligneSite?.rue ?? null,
        npa: ligneSite?.npa ?? null,
        localite: ligneSite?.localite ?? null,
        numeroTva: ligneTenant?.numeroTva ?? null,
      };
    });
  }
}
