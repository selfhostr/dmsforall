/**
 * Cœur de la construction d'une `EcritureExport` (MD-84) DEPUIS un `document_vente` déjà émis —
 * fonction PURE, aucun accès base : reçoit le document, ses lignes, sa ventilation TVA
 * (`document_vente_tva`, figée à l'émission MD-45) et une vue déjà résolue du plan comptable
 * (`ComptesResolusADate`), rend une écriture équilibrée ou la liste de ce qui manque.
 *
 * --- Le principe de signe unique (au lieu d'un `if (typeDocument === 'avoir')`) ------------------
 *
 * `MD-46` : une facture stocke ses lignes et totaux en TTC/HT/TVA POSITIFS ; un avoir les stocke
 * en NÉGATIFS (`total_ttc_centimes < 0`, etc.), symétriquement. `MD-84 §6.2` donne une table à DEUX
 * lignes différentes (facture : débit créances / crédit produits+TVA ; avoir : l'inverse) — mais
 * ces deux lignes sont EXACTEMENT la même règle une fois qu'on raisonne en montants SIGNÉS plutôt
 * qu'en type de document :
 *
 *   - Créances clients a sa polarité NATURELLE au DÉBIT (compte de bilan actif) : un delta positif
 *     est un débit, un delta négatif est — arithmétiquement — un crédit de sa valeur absolue.
 *   - Produits, TVA due, Acomptes reçus ont leur polarité naturelle au CRÉDIT (produits/passifs) :
 *     un delta positif est un crédit, un delta négatif est un débit de sa valeur absolue.
 *
 * Sur une facture, tous les deltas de lignes « produit » sont positifs (HT > 0) → crédit ; le
 * delta créances (TTC > 0) → débit. Sur un avoir, MD-46 rend tout négatif : mêmes deltas, mais
 * négatifs → chaque polarité naturelle bascule automatiquement côté opposé, ce qui reproduit
 * *exactement* la seconde ligne du tableau MD-84 §6.2 SANS bifurcation sur `typeDocument`. Même
 * mécanisme pour une ligne `acompte_deduit` (MD-55 : HT toujours négatif) au sein d'une facture
 * autrement positive — imputée sous `acomptes_recus`, elle bascule seule au débit pendant que le
 * reste de l'écriture reste au crédit, reproduisant la ligne « Facture finale avec acompte » du
 * même tableau sans code dédié.
 *
 * --- Pourquoi l'équilibre tient PAR CONSTRUCTION -------------------------------------------------
 *
 * `ligne_document_montant_coherent_chk` (migration 0010) impose `ttc = ht + tva` sur CHAQUE ligne ;
 * l'agrégation (`document_vente.total_ttc_centimes`, `document_vente_tva.base_centimes` +
 * `tva_centimes`) préserve cette identité par simple somme. En notant Σdébit la somme des deltas
 * signés convertis en magnitude-débit (créances : `+ttc` ; chaque groupe crédit-naturel : `-somme`
 * du groupe) : Σdébit = ttc − Σ(HT par catégorie) − Σ(TVA par taux) = ttc − ht − tva = 0. Cette
 * identité est vérifiée explicitement (`bigint`, MD-85) avant de rendre l'écriture — jamais
 * supposée silencieusement.
 */

import type { EcritureExport, LigneEcritureExport } from '@dfa/shared';

import type {
  LigneDocumentVente,
  LigneDocumentVenteTva,
  LigneLigneDocument,
} from '../../../db/schema';
import type { BesoinMappingManquant, ComptesResolusADate } from './comptes-resolus';

export type ResultatConstructionEcriture =
  | {
      readonly succes: true;
      readonly ecriture: EcritureExport;
      readonly totalDebitCentimes: bigint;
      readonly totalCreditCentimes: bigint;
    }
  | { readonly succes: false; readonly manquants: readonly BesoinMappingManquant[] };

/** `categorie` pour l'usage `produit` (MD-86 : « type de ligne, moyen de paiement, ou taux de TVA
 *  selon l'usage ») : `categorieComptable` (AC-09, surcharge exceptionnelle) prime sur `typeLigne`. */
function categorieProduit(ligne: LigneLigneDocument): string {
  return ligne.categorieComptable ?? ligne.typeLigne;
}

/** Une ligne de regroupement AVANT résolution du compte et calcul du sens — la somme des deltas
 *  signés (positif = polarité naturelle CRÉDIT, sauf `estCreances` = polarité naturelle DÉBIT). */
interface GroupeSigne {
  readonly usage: 'creances_clients' | 'produit' | 'tva_due' | 'acomptes_recus' | 'ecart_reprise';
  readonly categorie: string;
  readonly montantSigneCentimes: bigint;
  readonly estCreances: boolean;
  readonly codeTva: string | null;
  readonly tauxPourmille: number | null;
  readonly baseTvaCentimes: number | null;
  readonly libelle: string;
}

export function construireEcritureDocument(
  document: LigneDocumentVente,
  lignes: readonly LigneLigneDocument[],
  ventilationTva: readonly LigneDocumentVenteTva[],
  comptes: ComptesResolusADate,
  centreDeCharge: string | null,
): ResultatConstructionEcriture {
  if (document.numero === null) {
    // Garde défensive : `document_vente_numero_brouillon_chk` interdit un `numero` nul pour tout
    // statut ≠ brouillon — un document `emis`/`annule_par_avoir` (seuls statuts sélectionnés par
    // `service-export-comptable.ts`) en porte toujours un. Ne devrait jamais se produire.
    throw new Error(
      `document ${document.id} sans numéro alors que son statut (${document.statut}) l'exige.`,
    );
  }
  if (document.dateDocument === null) {
    throw new Error(
      `document ${document.id} sans date de document alors que son statut (${document.statut}) l'exige.`,
    );
  }
  const numero = document.numero;
  const dateDocument = document.dateDocument;
  const manquants: BesoinMappingManquant[] = [];
  const groupes: GroupeSigne[] = [];

  // --- Créances clients (une ligne, TTC, polarité DÉBIT naturelle) --------------------------------
  const compteCreances = comptes.resoudreCompte('creances_clients', 'defaut');
  if (compteCreances === undefined) {
    manquants.push({
      type: 'compte',
      usage: 'creances_clients',
      categorie: 'defaut',
      documentNumero: numero,
    });
  }
  groupes.push({
    usage: 'creances_clients',
    categorie: 'defaut',
    montantSigneCentimes: document.totalTtcCentimes,
    estCreances: true,
    codeTva: null,
    tauxPourmille: null,
    baseTvaCentimes: null,
    libelle: `Créances — ${document.clientDesignationFigee}`,
  });

  // --- Produits / acomptes reçus / écart de reprise, groupés par catégorie (polarité CRÉDIT) -----
  const sommesParCategorie = new Map<
    string,
    { usage: 'produit' | 'acomptes_recus' | 'ecart_reprise'; categorie: string; somme: bigint }
  >();
  for (const ligne of lignes) {
    const usage: 'produit' | 'acomptes_recus' | 'ecart_reprise' =
      ligne.typeLigne === 'ecart_reprise'
        ? 'ecart_reprise'
        : ligne.typeLigne === 'acompte_deduit'
          ? 'acomptes_recus'
          : 'produit';
    const categorie = usage === 'produit' ? categorieProduit(ligne) : 'defaut';
    const cle = `${usage}::${categorie}`;
    const existant = sommesParCategorie.get(cle);
    const delta = BigInt(ligne.htCentimes);
    sommesParCategorie.set(cle, { usage, categorie, somme: (existant?.somme ?? 0n) + delta });
  }
  for (const { usage, categorie, somme } of sommesParCategorie.values()) {
    if (somme === 0n) continue;
    const compte = comptes.resoudreCompte(usage, categorie);
    if (compte === undefined) {
      manquants.push({ type: 'compte', usage, categorie, documentNumero: numero });
    }
    groupes.push({
      usage,
      categorie,
      montantSigneCentimes: somme,
      estCreances: false,
      codeTva: null,
      tauxPourmille: null,
      baseTvaCentimes: null,
      libelle: libelleGroupe(usage, categorie, numero),
    });
  }

  // --- TVA due, une ligne par (régime, taux) — reprise TELLE QUELLE de `document_vente_tva`,
  // figée à l'émission (MD-45), jamais recalculée depuis les lignes (MD-84 : « aucun adaptateur ne
  // recalcule un montant » — vaut aussi pour ce cœur vis-à-vis de la ventilation déjà posée). -----
  for (const v of ventilationTva) {
    if (v.tvaCentimes === 0) continue; // régimes à 0‰ (exonéré, exclu) : aucune ligne TVA due à produire.
    const compte = comptes.resoudreCompte('tva_due', String(v.tauxTvaPourmille));
    const codeTva = comptes.resoudreCodeTva(v.regimeTva, v.tauxTvaPourmille);
    if (compte === undefined) {
      manquants.push({
        type: 'compte',
        usage: 'tva_due',
        categorie: String(v.tauxTvaPourmille),
        documentNumero: numero,
      });
    }
    if (codeTva === undefined) {
      manquants.push({
        type: 'code_tva',
        regimeTva: v.regimeTva,
        tauxPourmille: v.tauxTvaPourmille,
        documentNumero: numero,
      });
    }
    groupes.push({
      usage: 'tva_due',
      categorie: String(v.tauxTvaPourmille),
      montantSigneCentimes: BigInt(v.tvaCentimes),
      estCreances: false,
      codeTva: codeTva ?? null,
      tauxPourmille: v.tauxTvaPourmille,
      baseTvaCentimes: Math.abs(v.baseCentimes),
      libelle: `TVA due ${(v.tauxTvaPourmille / 10).toFixed(1)}% — ${numero}`,
    });
  }

  if (manquants.length > 0) return { succes: false, manquants };

  let totalDebitCentimes = 0n;
  let totalCreditCentimes = 0n;
  const lignesEcriture: LigneEcritureExport[] = [];

  for (const g of groupes) {
    const compte = comptes.resoudreCompte(g.usage, g.categorie);
    // Ne peut pas être `undefined` ici : `manquants` aurait intercepté le cas ci-dessus et la
    // fonction serait déjà sortie. Garde défensive pour le typage, jamais atteinte en pratique.
    if (compte === undefined)
      throw new Error(
        `compte introuvable pour ${g.usage}/${g.categorie} — devrait avoir été signalé en manquants.`,
      );

    if (g.montantSigneCentimes === 0n) continue;
    const positif = g.montantSigneCentimes > 0n;
    // positif === estCreances  → débit ; sinon → crédit (voir le principe de signe unique en tête
    // de fichier : créances a sa polarité naturelle au débit, tout le reste au crédit).
    const sens: 'debit' | 'credit' = positif === g.estCreances ? 'debit' : 'credit';
    const magnitude = positif ? g.montantSigneCentimes : -g.montantSigneCentimes;

    if (sens === 'debit') totalDebitCentimes += magnitude;
    else totalCreditCentimes += magnitude;

    lignesEcriture.push({
      compte,
      sens,
      montantCentimes: Number(magnitude),
      codeTva: g.codeTva,
      tauxPourmille: g.tauxPourmille,
      baseTvaCentimes: g.baseTvaCentimes,
      libelle: g.libelle,
    });
  }

  // MD-85 : vérifié explicitement en bigint avant de rendre l'écriture — jamais supposé depuis
  // l'identité arithmétique documentée en tête de fichier (une régression future dans le calcul du
  // document, un contournement de CHECK par migration destructive… doivent faire échouer LOUD,
  // pas produire un lot faux en silence).
  if (totalDebitCentimes !== totalCreditCentimes) {
    throw new Error(
      `Écriture déséquilibrée pour le document ${numero} : débit=${totalDebitCentimes.toString()}, crédit=${totalCreditCentimes.toString()} — EXPORT_ECRITURES_DESEQUILIBREES.`,
    );
  }

  const ecriture: EcritureExport = {
    reference: numero,
    date: dateDocument,
    libelle: `${libelleTypeDocument(document.typeDocument)} ${numero}`,
    centreDeCharge,
    lignes: lignesEcriture,
    documentId: document.id,
  };

  return { succes: true, ecriture, totalDebitCentimes, totalCreditCentimes };
}

function libelleGroupe(
  usage: 'produit' | 'acomptes_recus' | 'ecart_reprise',
  categorie: string,
  numero: string,
): string {
  if (usage === 'acomptes_recus') return `Déduction d'acompte — ${numero}`;
  if (usage === 'ecart_reprise') return `Écart de reprise — ${numero}`;
  return `${categorie} — ${numero}`;
}

function libelleTypeDocument(type: LigneDocumentVente['typeDocument']): string {
  if (type === 'avoir') return 'Avoir';
  if (type === 'facture') return 'Facture';
  return type;
}
