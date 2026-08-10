import type { PeriodeResolueTableauBord } from './query';

/**
 * `GET /tableau-bord/financier` — indicateurs FINANCIERS agrégés sur l'ensemble du garage :
 * chiffre d'affaires, encaissements, encours clients. Réservé à `direction`/`comptable` via
 * l'action `tableau_bord.financier.lire` (`apps/api/src/auth/matrice-droits.ts`, RF-115 : `admin`
 * explicitement exclu), appliquée par `@ExigerDroit(...)` + `GardeDroit` dans
 * `apps/api/src/tableau-bord/financier.controller.ts`.
 *
 * DÉLIBÉRÉMENT ABSENT DE CE CONTRAT : toute notion de MARGE (pièces ou globale). Signalé plutôt
 * qu'inventé — voir le rapport de livraison de ce module pour le détail complet du raisonnement ;
 * en bref : `article.prixAchatCentimes` est documenté schéma comme « dernier prix connu »
 * (`db/schema/pieces/article.ts`, RP-29/RP-33/QP-04), jamais un coût historique figé à la vente, et
 * `parametre_pieces.methode_prix_achat` (moyenne pondérée vs dernier prix) reste `NULL` — @laupernoe ne
 * l'a pas tranché (`db/migrations/0028_pieces_parametrage.sql`). Aucune donnée de coût de
 * main-d'œuvre n'existe par ailleurs (`utilisateur` ne porte aucun taux horaire coûtant). Calculer
 * une marge aujourd'hui reviendrait à fabriquer un chiffre dont la base de coût est soit absente,
 * soit explicitement non normée — exactement le risque que la consigne de ce lot demandait d'éviter.
 */
export interface ChiffreAffairesPeriodeTableauBord {
  /** `Σ document_vente.total_ht_centimes` pour les factures ÉMISES et les avoirs ÉMIS de la
   *  période (`dateDocument` dans la période, bornes incluses) — les avoirs sont déjà stockés en
   *  montant NÉGATIF (`document_vente_devise_chk` d'origine, migration 0010 §9), donc cette somme
   *  est déjà NETTE d'annulation, sans retraitement applicatif. Brouillons exclus (jamais émis,
   *  jamais de numéro légal, jamais de revenu réel). */
  readonly totalHtCentimes: number;
  readonly totalTvaCentimes: number;
  readonly totalTtcCentimes: number;
  /** Nombre de documents (factures + avoirs) entrant dans la somme ci-dessus. */
  readonly nombreDocuments: number;
}

export interface ReponseFinancierTableauBord {
  readonly periode: PeriodeResolueTableauBord;
  readonly siteId: string | null;

  /** PÉRIODE. */
  readonly chiffreAffaires: ChiffreAffairesPeriodeTableauBord;

  /** PÉRIODE : `Σ paiement.montantCentimes` (`dateValeur` dans la période) — un remboursement est
   *  déjà négatif en base (MD-50), donc cette somme est déjà NETTE. C'est l'argent réellement
   *  encaissé, distinct du chiffre d'affaires FACTURÉ ci-dessus (deux notions différentes : une
   *  facture émise n'est pas forcément payée dans la même période). */
  readonly encaissementsCentimes: number;

  /** SNAPSHOT (maintenant, PAS borné par la période) : `Σ document_vente.soldeCentimes` pour les
   *  factures encore au statut `emis` (donc ni annulées par avoir, ni brouillon) — créances
   *  ouvertes à l'instant de l'appel. */
  readonly encoursClientsCentimes: number;
}
