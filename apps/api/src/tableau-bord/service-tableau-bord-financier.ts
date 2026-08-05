import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { FiltreTableauBord, ReponseFinancierTableauBord } from '@dfa/shared';

import type { AccesBase, ContexteTenant } from '../db';
import { JETON_DB } from '../db';

import { resoudrePeriodeTableauBord } from './periode';

/**
 * Projection brute — les colonnes `bigint`/`numeric` reviennent en TEXTE depuis le pilote `pg`
 * (évite toute perte de précision en désérialisant automatiquement en `number` JS) : converties en
 * `number` ICI, au point unique de sortie du SQL, jamais plus loin. Sûr pour un chiffre d'affaires
 * de garage (bien en deçà de `Number.MAX_SAFE_INTEGER` centimes) — même limite acceptée partout
 * ailleurs dans ce dépôt où un montant agrégé quitte le SQL (`facturation/paiements/service-paiement.ts`).
 */
type LigneFinanciereBrute = {
  readonly totalHtCentimes: string;
  readonly totalTvaCentimes: string;
  readonly totalTtcCentimes: string;
  readonly nombreDocuments: number;
  readonly encaissementsCentimes: string;
  readonly encoursClientsCentimes: string;
};

/**
 * `GET /tableau-bord/financier` — chiffre d'affaires, encaissements, encours clients. Réservé
 * `direction`/`comptable` (`tableau_bord.financier.lire`, `auth/matrice-droits.ts` — RF-115 :
 * `admin` explicitement exclu) : LE domaine sensible de ce module.
 *
 * Ce service ne prend PLUS de rôle en paramètre : l'autorisation est désormais portée
 * EXCLUSIVEMENT par `@ExigerDroit('tableau_bord.financier.lire')` + `GardeDroit` sur
 * `TableauBordFinancierController`, qui refuse `403 DROIT_INSUFFISANT` en `canActivate()` — AVANT
 * que ce handler ne s'exécute, donc avant la moindre requête d'agrégation financière. Avant ce
 * module (palliatif `tableau-bord/droits-provisoires.ts`, retiré), ce service portait sa propre
 * vérification de rôle en l'absence de l'action dans la matrice ; ce n'est plus nécessaire, et une
 * double vérification romprait la doctrine du dépôt (« un seul mécanisme d'autorisation »,
 * `auth/matrice-droits.ts`, tête de fichier).
 */
@Injectable()
export class ServiceTableauBordFinancier {
  constructor(@Inject(JETON_DB) private readonly acces: AccesBase) {}

  async obtenir(
    ctx: ContexteTenant,
    filtre: FiltreTableauBord,
  ): Promise<ReponseFinancierTableauBord> {
    const periode = resoudrePeriodeTableauBord(filtre);
    const siteId = filtre.siteId ?? null;

    return this.acces.enTenant(ctx, async (tx) => {
      const filtreSiteDocument = siteId ? sql`and d.site_id = ${siteId}` : sql``;
      const filtreSitePaiement = siteId ? sql`and p.site_id = ${siteId}` : sql``;

      // Facture + avoir ÉMIS (statut <> brouillon) de la période — l'avoir est déjà stocké en
      // montant négatif (`document_vente_devise_chk`, migration 0010 §9), la somme est donc déjà
      // NETTE d'annulation, sans retraitement applicatif (voir la doc de `ChiffreAffairesPeriodeTableauBord`).
      const filtreDocumentsPeriode = sql`
        d.tenant_id = ${ctx.tenantId} ${filtreSiteDocument}
        and d.type_document in ('facture', 'avoir')
        and d.statut <> 'brouillon'
        and d.date_document >= ${periode.du} and d.date_document <= ${periode.au}
      `;

      const resultat = await tx.execute<LigneFinanciereBrute>(sql`
        select
          coalesce((select sum(d.total_ht_centimes) from public.document_vente d
             where ${filtreDocumentsPeriode}), 0) as "totalHtCentimes",
          coalesce((select sum(d.total_tva_centimes) from public.document_vente d
             where ${filtreDocumentsPeriode}), 0) as "totalTvaCentimes",
          coalesce((select sum(d.total_ttc_centimes) from public.document_vente d
             where ${filtreDocumentsPeriode}), 0) as "totalTtcCentimes",
          (select count(*)::int from public.document_vente d
             where ${filtreDocumentsPeriode}) as "nombreDocuments",
          coalesce((select sum(p.montant_centimes) from public.paiement p
             where p.tenant_id = ${ctx.tenantId} ${filtreSitePaiement}
               and p.date_valeur >= ${periode.du} and p.date_valeur <= ${periode.au}
          ), 0) as "encaissementsCentimes",
          coalesce((select sum(d.solde_centimes) from public.document_vente d
             where d.tenant_id = ${ctx.tenantId} ${filtreSiteDocument}
               and d.type_document = 'facture' and d.statut = 'emis'
          ), 0) as "encoursClientsCentimes"
      `);

      const ligne = resultat.rows[0];
      if (!ligne) {
        // Impossible en pratique — mêmes garanties que `ServiceTableauBordActivite.obtenir`
        // (six sous-requêtes scalaires, `coalesce(..., 0)` sur chaque somme).
        throw new Error(
          "tableau-bord/financier : l'agrégation n'a rendu aucune ligne (six sous-requêtes scalaires — impossible).",
        );
      }

      return {
        periode: { du: periode.du, au: periode.au },
        siteId,
        chiffreAffaires: {
          totalHtCentimes: Number(ligne.totalHtCentimes),
          totalTvaCentimes: Number(ligne.totalTvaCentimes),
          totalTtcCentimes: Number(ligne.totalTtcCentimes),
          nombreDocuments: ligne.nombreDocuments,
        },
        encaissementsCentimes: Number(ligne.encaissementsCentimes),
        encoursClientsCentimes: Number(ligne.encoursClientsCentimes),
      };
    });
  }
}
