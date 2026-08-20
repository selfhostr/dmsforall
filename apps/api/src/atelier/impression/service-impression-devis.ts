/**
 * `GET /ordres-reparation/{orId}/devis-complementaires/{devisId}/pdf` — génération du PDF d'un
 * devis complémentaire, RÉGÉNÉRÉ À CHAQUE APPEL, sans cache ni colonne de persistance — même
 * doctrine que `service-impression-or.ts` : un devis est immuable une fois RÉPONDU (RM-79), mais
 * PAS avant, et `statutDevis` (`donnees-impression-devis.ts`) doit refléter une réponse enregistrée
 * entre deux impressions.
 *
 * DROIT D'IMPRESSION — signalé, pas une évidence :
 *
 * La route porte `@ExigerDroit('atelier.or.lire')` (`impression-devis.controller.ts`), le même
 * droit que la lecture de l'OR et la collection des devis (`DevisComplementaireController.lister`).
 * Mais un devis complémentaire CHIFFRE un montant TTC en clair — c'est même tout son objet
 * (accord du client sur un dépassement de plafond). Exactement le raisonnement RF-116/
 * `facturation.document.imprimer` (voir `facturation/impression/impression-facture.controller.ts`,
 * tête de fichier) : un rôle sans droit aux montants ne doit jamais obtenir ce PDF.
 *
 * `auth/matrice-droits.ts` est HORS du périmètre d'écriture de cette tâche (`apps/api/src/
 * atelier/**` et `packages/shared/src/contrats/` uniquement) — impossible d'y créer un droit dédié
 * `atelier.devis.imprimer` calé exactement sur `!ROLES_SANS_MONTANT.includes(role)`, comme l'a fait
 * RF-116 pour la facturation. Aucun droit EXISTANT ne recouvre exactement le bon ensemble de rôles
 * (`direction`/`comptable`/`receptionnaire`/`chef_atelier`/`magasinier` — tous les rôles
 * `atelier.or.lire` SAUF `technicien`/`poste_atelier`) :
 *  - `atelier.or.lire` seul est TROP LARGE (inclut `technicien`/`poste_atelier`, `ROLES_SANS_
 *    MONTANT` — ils verraient le montant en clair) ;
 *  - `atelier.devis.creer`/`atelier.devis.repondre` sont TROP ÉTROITS (seulement `receptionnaire`/
 *    `chef_atelier`/`direction` — excluraient `comptable`/`magasinier`, qui VOIENT pourtant les
 *    montants ailleurs dans l'atelier).
 *
 * Solution retenue ICI, en défense en profondeur DANS LE SERVICE plutôt qu'un nouveau droit dans
 * la matrice : `garantirMontantsVisibles` refuse explicitement `DROIT_INSUFFISANT` (403) pour tout
 * rôle où `roleVoitLesMontants()` (`atelier/mappeurs.ts`, déjà la source de vérité du masquage des
 * montants ailleurs dans l'OR) est faux — AVANT même de charger l'OR, pour ne faire aucun travail
 * inutile pour un rôle définitivement refusé. Résultat fonctionnel identique à un droit dédié.
 * Signalé pour arbitrage avec expert-auth : un `atelier.devis.imprimer` propre dans la matrice
 * remplacerait proprement ce garde-fou applicatif le jour où ce fichier repasse en périmètre.
 */

import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { RoleUtilisateur } from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant } from '../../db';
import { site, tenant } from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';

import { roleVoitLesMontants } from '../mappeurs';
import { ServiceOr } from '../service-or';
import { genererPdfDevis } from './generation-pdf-devis';
import type { IdentiteGarage } from './donnees-impression-devis';

export interface PdfDevisResultat {
  readonly buffer: Buffer;
  /** Nom de fichier suggéré au téléchargement — `DEVIS-<numero OR>-<rang du devis>.pdf`. */
  readonly nomFichier: string;
}

@Injectable()
export class ServiceImpressionDevis {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    private readonly serviceOr: ServiceOr,
  ) {}

  async obtenirPdf(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    devisId: string,
  ): Promise<PdfDevisResultat> {
    this.garantirMontantsVisibles(principal.role);

    // `obtenirComplet` lève `RESSOURCE_INTROUVABLE` (404) si l'OR n'existe pas pour ce tenant, et
    // applique déjà le filtrage par rôle (`atelier/mappeurs.ts`) — `document.lignes[].montants`
    // et `document.devisComplementaires[].montantTtcCentimes` sont donc garantis présents ici,
    // le rôle ayant déjà passé `garantirMontantsVisibles` ci-dessus.
    const document = await this.serviceOr.obtenirComplet(ctx, principal, orId);
    const devis = document.devisComplementaires.find((d) => d.id === devisId);
    if (!devis) {
      throw new ErreurMetier(
        'RESSOURCE_INTROUVABLE',
        `Devis complémentaire ${devisId} introuvable sur l'ordre de réparation ${orId}.`,
      );
    }

    const identite = await this.chargerIdentiteGarage(ctx, document.siteId);
    const buffer = await genererPdfDevis(document, devis, identite);
    const nomFichier = `DEVIS-${document.numero}-${String(devis.numeroOrdre)}.pdf`.replace(
      /[^A-Za-z0-9._-]/g,
      '_',
    );

    return { buffer, nomFichier };
  }

  /** Voir la tête de fichier — deuxième ligne de défense, en plus de `@ExigerDroit('atelier.or.
   *  lire')` sur la route, faute d'un droit dédié dans un périmètre accessible à cette tâche. */
  private garantirMontantsVisibles(role: RoleUtilisateur): void {
    if (!roleVoitLesMontants(role)) {
      throw new ErreurMetier(
        'DROIT_INSUFFISANT',
        "Un devis complémentaire chiffre un montant TTC en clair : ce rôle n'a pas accès aux " +
          "montants de l'atelier (ROLES_SANS_MONTANT) et ne peut donc pas l'imprimer.",
      );
    }
  }

  /**
   * `ReponseOrdreReparation` ne porte que `siteId` (uuid) et aucune raison sociale — résolu ici par
   * deux lectures directes, EN LECTURE SEULE (`tenant`, `site`), plutôt que d'attendre une
   * évolution de contrat pour un simple en-tête. Retombe sur des chaînes vides si introuvable (ne
   * devrait jamais arriver, FK non nulles) — `generation-pdf-devis.ts` omet alors la ligne
   * correspondante, jamais un uuid brut ou un texte trompeur — même doctrine que
   * `service-impression-or.ts::chargerNomSite`.
   */
  private async chargerIdentiteGarage(
    ctx: ContexteTenant,
    siteId: string,
  ): Promise<IdentiteGarage> {
    return this.acces.enTenant(ctx, async (tx) => {
      const [ligneTenant] = await tx
        .select({ raisonSociale: tenant.raisonSociale })
        .from(tenant)
        .where(eq(tenant.id, ctx.tenantId))
        .limit(1);
      const [ligneSite] = await tx
        .select({ nom: site.nom, rue: site.rue, npa: site.npa, localite: site.localite })
        .from(site)
        .where(and(eq(site.tenantId, ctx.tenantId), eq(site.id, siteId)))
        .limit(1);

      return {
        raisonSociale: ligneTenant?.raisonSociale ?? '',
        siteNom: ligneSite?.nom ?? '',
        rue: ligneSite?.rue ?? null,
        npa: ligneSite?.npa ?? null,
        localite: ligneSite?.localite ?? null,
      };
    });
  }
}
