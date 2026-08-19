/**
 * Rapprochement + calcul des écarts — le CŒUR métier de la lecture automatique (§ « Le
 * rattachement et les écarts » de la tâche : « c'est là qu'un garage perd de l'argent sans le
 * voir »). Fonctions PURES, sans accès base ni tenant : reçoit des candidats déjà chargés par
 * `service-facture-fournisseur.ts`, rend un résultat déterministe — ENTIÈREMENT testable sans
 * PDF, sans OCR, sans base, avec des fixtures inventées (voir `service-rapprochement.spec.ts`).
 *
 * CORRESPONDANCE EXACTE UNIQUEMENT (décision @laupernoe, non négociable) : un rapprochement approximatif
 * qui se révèle faux est pire qu'aucun rapprochement. « Exact » veut dire : après la SEULE
 * normalisation tolérée (espaces superflus, casse) — jamais une distance de Levenshtein, jamais
 * un score de similarité, jamais un « meilleur candidat » choisi parmi plusieurs. Une AMBIGUÏTÉ
 * (plusieurs candidats also exacts) se traite EXACTEMENT comme une ABSENCE : `null`.
 *
 * Écarts en CENTIMES ENTIERS, jamais un flottant — `Math.round` UNE SEULE fois, au moment de
 * convertir un prix unitaire (centimes) × une quantité (millièmes) en un total (centimes), même
 * discipline que `atelier/calcul-ligne.ts`.
 */
import type { EcartLigneFactureFournisseur } from '@dfa/shared';

import type { DonneesFactureExtraites, LigneFactureExtraite } from './lecture/types';

/** Normalisation MINIMALE et RÉVERSIBLE dans son intention : espaces superflus + casse — jamais
 *  d'accents retirés, jamais de ponctuation retirée. « Correspondance exacte » se juge APRÈS
 *  cette seule normalisation, qui traite `"ACME  Sàrl"` et `"acme sàrl"` comme identiques (bruit
 *  de saisie/impression) sans jamais confondre deux noms réellement différents. */
export function normaliserPourComparaisonExacte(texte: string): string {
  return texte.trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface CandidatFournisseur {
  readonly id: string;
  readonly nom: string;
}

export interface CandidatLigneCommandeFournisseur {
  readonly id: string;
  readonly articleId: string;
  /** `article.reference` de l'article de cette ligne — comparée, normalisée, à
   *  `LigneFactureExtraite.referenceArticle`. */
  readonly referenceArticle: string;
  /** Reliquat DÉJÀ CALCULÉ par l'appelant (`calculerReliquatMillieme`, `pieces/mappers.ts`) — ce
   *  module reste sans dépendance à Drizzle/aux types de ligne de commande bruts. */
  readonly quantiteReliquatMillieme: number;
  readonly prixAchatAttenduCentimes: number | null;
}

export interface CandidatCommandeFournisseur {
  readonly id: string;
  readonly reference: string | null;
  readonly lignes: readonly CandidatLigneCommandeFournisseur[];
}

export interface LigneRapprochee {
  readonly extraite: LigneFactureExtraite;
  readonly articleId: string | null;
  readonly commandeFournisseurLigneId: string | null;
  readonly ecart: EcartLigneFactureFournisseur | null;
}

/**
 * Fournisseur : correspondance EXACTE sur le nom lu du créancier QR (`enTete.nomCreancier`) —
 * seule donnée de nom disponible dans la chaîne (le texte libre du PDF n'est pas fouillé pour un
 * nom : trop de faux positifs sur une raison sociale qui apparaît partout dans le document,
 * contrairement à une RÉFÉRENCE DE COMMANDE, plus rare et plus spécifique — voir
 * `trouverCommandeEtRapprocherLignes`). `null` si le QR est absent, si aucun fournisseur du
 * tenant ne correspond exactement, ou si PLUSIEURS correspondent (deux fiches fournisseur au même
 * nom — ambiguïté, jamais un choix arbitraire).
 */
export function trouverFournisseurExact(
  donnees: DonneesFactureExtraites,
  candidats: readonly CandidatFournisseur[],
): string | null {
  const nomCreancier = donnees.enTete.nomCreancier?.valeur;
  if (!nomCreancier) return null;

  const cible = normaliserPourComparaisonExacte(nomCreancier);
  const correspondances = candidats.filter((c) => normaliserPourComparaisonExacte(c.nom) === cible);
  return correspondances.length === 1 ? (correspondances[0]?.id ?? null) : null;
}

/**
 * Commande fournisseur, PARMI LES CANDIDATES D'UN FOURNISSEUR DÉJÀ IDENTIFIÉ (l'appelant filtre
 * en base — jamais de rapprochement cross-fournisseur) : la référence de commande
 * (`commande_fournisseur.reference`, texte libre saisi par le magasinier ou communiqué par le
 * fournisseur) doit apparaître, EXACTEMENT (sous-chaîne normalisée), dans le texte intégral du
 * document. `null` si aucune commande n'a de référence renseignée, si le texte est absent
 * (`texteIntegral`), si aucune référence ne s'y trouve, ou si PLUSIEURS s'y trouvent (ambiguïté).
 */
export function trouverCommandeExacte(
  donnees: DonneesFactureExtraites,
  candidats: readonly CandidatCommandeFournisseur[],
): string | null {
  const texte = donnees.texteIntegral;
  if (!texte) return null;
  const texteNormalise = normaliserPourComparaisonExacte(texte);

  const correspondances = candidats.filter((c) => {
    if (!c.reference || c.reference.trim().length === 0) return false;
    return texteNormalise.includes(normaliserPourComparaisonExacte(c.reference));
  });
  return correspondances.length === 1 ? (correspondances[0]?.id ?? null) : null;
}

/** = prix unitaire attendu (centimes) × quantité facturée (millièmes) / 1000, arrondi une seule
 *  fois — « ce qu'on aurait payé pour CETTE quantité facturée, au prix attendu ». */
function totalAttenduCentimes(
  prixAttenduCentimes: number,
  quantiteFactureeMillieme: number,
): number {
  return Math.round((prixAttenduCentimes * quantiteFactureeMillieme) / 1000);
}

function calculerEcart(
  ligne: LigneFactureExtraite,
  candidat: CandidatLigneCommandeFournisseur,
): EcartLigneFactureFournisseur | null {
  if (
    ligne.prixUnitaireCentimes === null ||
    ligne.totalLigneCentimes === null ||
    candidat.prixAchatAttenduCentimes === null
  ) {
    // Rien à comparer : soit la facture ne porte pas de prix ligne à ligne (lecture partielle),
    // soit la commande n'a jamais reçu de prix attendu (RP-33/QP-04, méthode encore non tranchée).
    return null;
  }

  return {
    prixUnitaireCentimes: ligne.prixUnitaireCentimes - candidat.prixAchatAttenduCentimes,
    quantiteMillieme: ligne.quantiteMillieme - candidat.quantiteReliquatMillieme,
    totalCentimes:
      ligne.totalLigneCentimes -
      totalAttenduCentimes(candidat.prixAchatAttenduCentimes, ligne.quantiteMillieme),
  };
}

/**
 * Rapproche chaque ligne extraite à une ligne de la commande CANDIDATE (déjà identifiée par
 * `trouverCommandeExacte`, ou `null` si aucune) par RÉFÉRENCE D'ARTICLE EXACTE. Une ligne sans
 * référence lue, une commande absente, ou une référence qui correspond à zéro OU PLUSIEURS lignes
 * de la commande (article commandé deux fois — rare mais possible) rendent une ligne NON
 * rapprochée (`articleId`/`commandeFournisseurLigneId` à `null`, `ecart` à `null`) — jamais un
 * choix arbitraire parmi plusieurs candidats.
 */
export function rapprocherLignes(
  lignesExtraites: readonly LigneFactureExtraite[],
  commande: CandidatCommandeFournisseur | null,
): readonly LigneRapprochee[] {
  return lignesExtraites.map((extraite) => {
    if (!commande || !extraite.referenceArticle) {
      return { extraite, articleId: null, commandeFournisseurLigneId: null, ecart: null };
    }

    const cible = normaliserPourComparaisonExacte(extraite.referenceArticle);
    const correspondances = commande.lignes.filter(
      (l) => normaliserPourComparaisonExacte(l.referenceArticle) === cible,
    );
    const candidat = correspondances.length === 1 ? correspondances[0] : undefined;
    if (!candidat) {
      return { extraite, articleId: null, commandeFournisseurLigneId: null, ecart: null };
    }

    return {
      extraite,
      articleId: candidat.articleId,
      commandeFournisseurLigneId: candidat.id,
      ecart: calculerEcart(extraite, candidat),
    };
  });
}

export interface ResultatRapprochement {
  readonly fournisseurId: string | null;
  readonly commandeFournisseurId: string | null;
  readonly lignes: readonly LigneRapprochee[];
}

/**
 * Assemble le rapprochement complet UNE FOIS que l'appelant a déjà :
 *  1. Appelé `trouverFournisseurExact` et, si un fournisseur est ressorti, chargé EN BASE les
 *     commandes candidates de CE fournisseur (statut `envoyee`/`partiellement_recue` — une
 *     commande déjà soldée n'a plus de reliquat à comparer) ;
 *  2. Appelé `trouverCommandeExacte` sur ces candidates.
 *
 * Ce découpage en trois appels (plutôt qu'une seule fonction qui ferait tout) est délibéré :
 * `service-facture-fournisseur.ts` a besoin du fournisseur AVANT de savoir QUELLES commandes
 * charger — un seul aller-retour base par étape, jamais toutes les commandes de tous les
 * fournisseurs du tenant chargées en mémoire pour n'en garder qu'une poignée.
 */
export function assemblerResultatRapprochement(
  donnees: DonneesFactureExtraites,
  fournisseurId: string | null,
  commande: CandidatCommandeFournisseur | null,
): ResultatRapprochement {
  return {
    fournisseurId,
    commandeFournisseurId: commande?.id ?? null,
    lignes: rapprocherLignes(donnees.lignes, commande),
  };
}
