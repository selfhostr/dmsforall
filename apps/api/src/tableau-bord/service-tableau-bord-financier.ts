import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  FiltreTableauBord,
  MargeIndisponibleTableauBord,
  ReponseFinancierTableauBord,
} from '@dfa/shared';

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
  readonly margeVehiculesCentimes: string;
  readonly nombreVehiculesFactures: number;
  readonly stockValeurCentimes: string;
  readonly stockArticlesValeurInconnueNombre: number;
};

/** Clés i18n (namespace `tableauBord`, `financier.marges.indisponible.<clé>`) résolues côté client
 *  — voir la doc de `MargeIndisponibleTableauBord` (`@dfa/shared`) : jamais de texte figé émis par
 *  l'API. */
const RAISON_MARGE_PIECES_INDISPONIBLE = 'piecesCoutNonFiable';
const RAISON_MARGE_MAIN_OEUVRE_INDISPONIBLE = 'mainOeuvreCoutAbsent';

const MARGE_PIECES_INDISPONIBLE: MargeIndisponibleTableauBord = {
  disponible: false,
  raisonCle: RAISON_MARGE_PIECES_INDISPONIBLE,
};
const MARGE_MAIN_OEUVRE_INDISPONIBLE: MargeIndisponibleTableauBord = {
  disponible: false,
  raisonCle: RAISON_MARGE_MAIN_OEUVRE_INDISPONIBLE,
};

/**
 * `GET /tableau-bord/financier` — chiffre d'affaires, encaissements, encours clients, marge sur
 * ventes de véhicules, valorisation du stock pièces. Réservé `direction`/`comptable`
 * (`tableau_bord.financier.lire`, `auth/matrice-droits.ts` — RF-115 : `admin` explicitement
 * exclu) : LE domaine sensible de ce module.
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
      const filtreSiteStock = siteId ? sql`and s.site_id = ${siteId}` : sql``;

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
      //
      // `vehicules_periode` (14.08.2026) — marge véhicules — NE PEUT PAS rejoindre `documents_periode`
      // ci-dessus : filtre supplémentaire (`vehicule_id is not null` + jointure `vehicule_stock`),
      // un second balayage de `document_vente` est donc réel et attendu (voir
      // `service-tableau-bord-financier.spec.ts`, section « forme SQL », `scansDocumentVente = 3`
      // depuis ce lot). Coût attribué au véhicule = `vehicule_stock.prix_achat_centimes`, verrouillé
      // dès la vente (`ServiceVehiculeStock.modifier`) — fiable même pour une facture ancienne. Le
      // coût n'est ATTRIBUÉ QUE sur les FACTURES (`type_document = 'facture'`) : un avoir sur un
      // véhicule déjà facturé réduit le revenu de la période où il est ÉMIS (comme le CA ci-dessus)
      // sans ré-attribuer le coût, qui reste rattaché à la période de la facture d'origine —
      // approximation documentée (`contrats/tableau-bord/financier.ts`), cas rare (retour d'un
      // véhicule déjà livré).
      const resultat = await tx.execute<LigneFinanciereBrute>(sql`
        with documents_periode as (
          select
            sum(d.total_ht_centimes) as total_ht_centimes,
            sum(d.total_tva_centimes) as total_tva_centimes,
            sum(d.total_ttc_centimes) as total_ttc_centimes,
            count(*)::int as nombre_documents
          from public.document_vente d
          where ${filtreDocumentsPeriode}
        ),
        vehicules_periode as (
          select
            sum(d.total_ht_centimes) as revenu_ht_centimes,
            sum(vs.prix_achat_centimes) filter (where d.type_document = 'facture') as cout_centimes,
            count(*) filter (where d.type_document = 'facture')::int as nombre_factures
          from public.document_vente d
          join public.vehicule_stock vs on vs.tenant_id = d.tenant_id and vs.id = d.vehicule_id
          where d.tenant_id = ${ctx.tenantId} ${filtreSiteDocument}
            and d.type_document in ('facture', 'avoir')
            and d.statut <> 'brouillon'
            and d.vehicule_id is not null
            and d.date_document >= ${periode.du} and d.date_document <= ${periode.au}
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
          ), 0) as "encoursClientsCentimes",
          coalesce(vehicules_periode.revenu_ht_centimes, 0) - coalesce(vehicules_periode.cout_centimes, 0)
            as "margeVehiculesCentimes",
          coalesce(vehicules_periode.nombre_factures, 0) as "nombreVehiculesFactures",
          coalesce((
            select round(sum(s.quantite_physique_millieme::bigint * a.prix_achat_centimes::bigint)::numeric / 1000)
            from public.stock_article s
            join public.article a on a.tenant_id = s.tenant_id and a.id = s.article_id
            where s.tenant_id = ${ctx.tenantId} ${filtreSiteStock}
              and a.statut = 'actif' and a.prix_achat_centimes is not null
          ), 0) as "stockValeurCentimes",
          coalesce((
            select count(*)::int from public.stock_article s
            join public.article a on a.tenant_id = s.tenant_id and a.id = s.article_id
            where s.tenant_id = ${ctx.tenantId} ${filtreSiteStock}
              and a.statut = 'actif' and a.prix_achat_centimes is null
              and s.quantite_physique_millieme > 0
          ), 0) as "stockArticlesValeurInconnueNombre"
        from documents_periode
        cross join vehicules_periode
      `);

      const ligne = resultat.rows[0];
      if (!ligne) {
        // Impossible en pratique : `documents_periode`/`vehicules_periode` sont des agrégats sans
        // `group by` (toujours exactement une ligne chacun, même sur zéro document — `count(*)`
        // rend 0, jamais une absence de ligne), et leur `cross join` (1 ligne × 1 ligne = 1 ligne)
        // ne fait que croiser ce résultat unique avec des sous-requêtes scalaires (`coalesce(..., 0)`
        // sur chacune). Mêmes garanties que `ServiceTableauBordActivite.obtenir`.
        throw new Error(
          "tableau-bord/financier : l'agrégation n'a rendu aucune ligne (impossible — agrégats sans group by).",
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
        marges: {
          vehicules: {
            margeCentimes: Number(ligne.margeVehiculesCentimes),
            nombreVehiculesFactures: ligne.nombreVehiculesFactures,
          },
          pieces: MARGE_PIECES_INDISPONIBLE,
          mainOeuvre: MARGE_MAIN_OEUVRE_INDISPONIBLE,
        },
        stockPieces: {
          totalCentimes: Number(ligne.stockValeurCentimes),
          articlesValeurInconnueNombre: ligne.stockArticlesValeurInconnueNombre,
        },
      };
    });
  }
}
