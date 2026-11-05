import type { PeriodeResolueTableauBord } from './query';

/**
 * `GET /tableau-bord/financier` — indicateurs FINANCIERS agrégés sur l'ensemble du garage :
 * chiffre d'affaires, encaissements, encours clients, marge, valorisation du stock pièces. Réservé
 * à `direction`/`comptable` via l'action `tableau_bord.financier.lire`
 * (`apps/api/src/auth/matrice-droits.ts`, RF-115 : `admin` explicitement exclu), appliquée par
 * `@ExigerDroit(...)` + `GardeDroit` dans `apps/api/src/tableau-bord/financier.controller.ts` — LA
 * SEULE porte d'entrée réseau de ce contrat : un rôle sans ce droit n'atteint jamais le handler,
 * donc ne reçoit STRUCTURELLEMENT aucun de ces champs (pas seulement masqués côté client — voir
 * `apps/api/src/tableau-bord/financier.controller.spec.ts`).
 *
 * MARGE (14.08.2026, décision de ce lot — un précédent lot avait tranché « aucune marge », signal
 * repris et RÉOUVERT ici avec une base de coût vérifiée, voir `MargesTableauBord` pour le détail
 * champ par champ) : la SEULE composante fiable aujourd'hui est la marge sur VENTES DE VÉHICULES
 * (VN/VO) — `vehicule_stock.prixAchatCentimes` est un coût VERROUILLÉ dès la vente
 * (`ServiceVehiculeStock.modifier`, RV-24/RV-37), contrairement à `article.prixAchatCentimes`
 * (pièces, « dernier prix connu » mutable, `db/schema/pieces/article.ts`, RP-29/RP-33/QP-04) et à
 * l'absence totale de taux horaire coûtant pour la main-d'œuvre (`utilisateur` n'en porte aucun).
 * Les deux dernières restent `{ disponible: false }` plutôt qu'inventées.
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

/**
 * PÉRIODE : marge sur les ventes de véhicules (VN/VO) FACTURÉES sur la période — `Σ` HT des
 * documents ÉMIS (facture + avoir, référençant un véhicule, net d'avoir comme le chiffre d'affaires
 * ci-dessus) MOINS `Σ vehicule_stock.prixAchatCentimes` des véhicules vendus (FACTURES de la
 * période seulement — le coût d'une vente annulée par un avoir émis dans une période ULTÉRIEURE à
 * sa facture d'origine n'est pas ré-attribué : approximation documentée, assumée, cas rare — un
 * avoir sur un véhicule déjà livré redonne un client, pas un stock). `nombreVehiculesFactures` :
 * nombre de véhicules facturés entrant dans le calcul (pas le nombre de documents — un avoir ne
 * compte pas une seconde fois le même véhicule).
 *
 * Calculable même à `0` (aucun véhicule vendu sur la période = vraie donnée, pas une absence) —
 * distinct de `MargeIndisponibleTableauBord` (pièces/main-d'œuvre), qui elle ne s'affiche JAMAIS
 * comme un montant.
 */
export interface MargeVehiculesPeriodeTableauBord {
  readonly margeCentimes: number;
  readonly nombreVehiculesFactures: number;
}

/**
 * Composante de marge NON calculable avec les données actuelles du dépôt — `disponible: false`
 * plutôt qu'un montant à `0`, qui affirmerait à tort « aucune marge » là où la vraie réponse est
 * « impossible à calculer aujourd'hui » (CONTRIBUTING.md : « une marge qui ne peut pas être calculée ne
 * s'affiche jamais comme zéro »). `raisonCle` : clé i18n (namespace `tableauBord`) que le client
 * résout pour l'affichage — jamais un texte figé en français porté par l'API (i18n FR = source,
 * traduit DE/IT côté client), donc pas de champ `raison` en texte libre ici.
 */
export interface MargeIndisponibleTableauBord {
  readonly disponible: false;
  readonly raisonCle: string;
}

export interface MargesTableauBord {
  /** La seule composante calculable aujourd'hui — voir la doc de tête du fichier. */
  readonly vehicules: MargeVehiculesPeriodeTableauBord;
  /** Coût de revient des pièces vendues non fiable : `article.prixAchatCentimes` est un « dernier
   *  prix connu » mutable, jamais figé à la vente, et `parametre_pieces.methodePrixAchat` (moyenne
   *  pondérée vs dernier prix) n'est pas encore tranché côté produit — calculer une marge ici
   *  fabriquerait un chiffre sur une base de coût non normée. */
  readonly pieces: MargeIndisponibleTableauBord;
  /** Aucun taux horaire coûtant n'existe sur `utilisateur` — le coût de la main-d'œuvre facturée
   *  n'est pas modélisé dans ce dépôt aujourd'hui. */
  readonly mainOeuvre: MargeIndisponibleTableauBord;
}

/**
 * SNAPSHOT (maintenant, PAS borné par la période — une quantité en stock n'a pas de sens « sur une
 * période ») : valorisation du stock pièces au PRIX D'ACHAT COURANT (`article.prixAchatCentimes`,
 * « dernier prix connu », PAS un coût historique) — `Σ quantitePhysiqueMillieme × prixAchatCentimes
 * / 1000`, arrondi une seule fois sur la somme (jamais ligne à ligne, pour ne pas accumuler d'écart
 * d'arrondi). Articles ACTIFS seulement, mêmes filtres que
 * `ReponseActiviteTableauBord.articlesSousSeuilReapprovisionnement`.
 *
 * Les articles actifs SANS prix d'achat connu (`prixAchatCentimes` `null` — jamais reçus en stock)
 * sont EXCLUS du total plutôt que comptés à `0` : `articlesValeurInconnueNombre` recense combien,
 * pour que `totalCentimes` ne soit jamais lu comme « la valeur exacte et complète du stock » quand
 * une partie de l'inventaire manque à l'appel.
 */
export interface ValorisationStockPiecesTableauBord {
  readonly totalCentimes: number;
  readonly articlesValeurInconnueNombre: number;
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

  /** PÉRIODE (véhicules) / non applicable (pièces, main-d'œuvre) — voir `MargesTableauBord`. */
  readonly marges: MargesTableauBord;

  /** SNAPSHOT — voir `ValorisationStockPiecesTableauBord`. */
  readonly stockPieces: ValorisationStockPiecesTableauBord;
}
