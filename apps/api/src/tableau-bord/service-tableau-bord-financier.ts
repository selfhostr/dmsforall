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

      // Les quatre indicateurs de chiffre d'affaires (HT, TVA, TTC, nombre de documents) partagent
      // EXACTEMENT le même filtre (`filtreDocumentsPeriode`) : un seul balayage de `document_vente`
      // suffit à les calculer tous, au lieu des quatre sous-requêtes corrélées d'origine (une par
      // colonne). Ce CTE est l'unique bénéficiaire de l'index partiel posé par la migration `0049`
      // (`document_vente_financier_periode_idx`, sur `(tenant_id, type_document, date_document) where
      // statut <> 'brouillon'`) : le prédicat n'est pas retouché ci-dessous, afin que l'index
      // s'applique tel quel. `encaissementsCentimes` (table `paiement`) et `encoursClientsCentimes`
      // (filtre différent : encours actuel, pas borné à la période) restent des sous-requêtes à part
      // — ni la même table+filtre, ni candidates à la fusion demandée par l'audit.
      const resultat = await tx.execute<LigneFinanciereBrute>(sql`
        with documents_periode as (
          select
            sum(d.total_ht_centimes) as total_ht_centimes,
            sum(d.total_tva_centimes) as total_tva_centimes,
            sum(d.total_ttc_centimes) as total_ttc_centimes,
            count(*)::int as nombre_documents
          from public.document_vente d
          where ${filtreDocumentsPeriode}
        )
        select
          coalesce(documents_periode.total_ht_centimes, 0) as "totalHtCentimes",
          coalesce(documents_periode.total_tva_centimes, 0) as "totalTvaCentimes",
          coalesce(documents_periode.total_ttc_centimes, 0) as "totalTtcCentimes",
          coalesce(documents_periode.nombre_documents, 0) as "nombreDocuments",
          coalesce((select sum(p.montant_centimes) from public.paiement p
             where p.tenant_id = ${ctx.tenantId} ${filtreSitePaiement}
               and p.date_valeur >= ${periode.du} and p.date_valeur <= ${periode.au}
          ), 0) as "encaissementsCentimes",
          coalesce((select sum(d.solde_centimes) from public.document_vente d
             where d.tenant_id = ${ctx.tenantId} ${filtreSiteDocument}
               and d.type_document = 'facture' and d.statut = 'emis'
          ), 0) as "encoursClientsCentimes"
        from documents_periode
      `);

      const ligne = resultat.rows[0];
      if (!ligne) {
        // Impossible en pratique : `documents_periode` est un agrégat sans `group by` (toujours
        // exactement une ligne, même sur zéro document — `count(*)` rend 0, jamais une absence de
        // ligne), et le `select` externe ne fait que croiser cette ligne unique avec deux
        // sous-requêtes scalaires (`coalesce(..., 0)` sur chacune). Mêmes garanties que
        // `ServiceTableauBordActivite.obtenir`.
        throw new Error(
          "tableau-bord/financier : l'agrégation n'a rendu aucune ligne (impossible — agrégat sans group by).",
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
