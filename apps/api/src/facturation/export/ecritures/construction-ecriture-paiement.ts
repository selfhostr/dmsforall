/**
 * Cœur de la construction d'une `EcritureExport` (MD-84 §6.2) DEPUIS un `paiement` déjà enregistré
 * et ses `imputation_paiement` — fonction PURE, aucun accès base : reçoit le paiement, ses
 * imputations et une vue déjà résolue du plan comptable (`ComptesResolusADate`), rend une écriture
 * équilibrée, la liste de ce qui manque au mapping, ou la liste de ce que ce cœur ne sait pas
 * encore construire (voir « Ce qui n'est PAS construit ici » ci-dessous).
 *
 * --- Le même principe de signe unique que `construction-ecriture.ts` -----------------------------
 *
 * `MD-50` : un paiement (`paiement.montantCentimes`, SIGNÉ — positif = encaissement, négatif =
 * remboursement/contre-passation) et ce qu'il solde (`imputation_paiement`, une ligne par document
 * réglé) sont deux objets distincts. `MD-84 §6.2` donne QUATRE lignes différentes (encaissement,
 * encaissement espèces arrondi, escompte, perte) — mais, comme pour les documents, ce sont
 * EXACTEMENT la même construction une fois qu'on raisonne en deltas SIGNÉS par compte plutôt qu'en
 * cas :
 *
 *   - `financier` (compte caisse/banque, résolu par MOYEN DE PAIEMENT) a sa polarité naturelle au
 *     DÉBIT : un encaissement positif est un débit, un remboursement (montant négatif) est un
 *     crédit de sa valeur absolue. Son delta est TOUJOURS `paiement.montantCentimes` en entier,
 *     quelles que soient les imputations — c'est la définition même de MD-50 (« ce qui est
 *     réellement entré en caisse ou en banque »).
 *   - `creances_clients` a sa polarité naturelle au DÉBIT dans `construction-ecriture.ts` (on
 *     facture), mais ICI on SOLDE : chaque imputation qui règle un document (`reglement`,
 *     `arrondi`, `escompte`, `perte` — tout sauf `compensation`, voir plus bas) contribue son
 *     montant signé À L'INVERSE, `-montantCentimes`, à la créance du document visé. Un règlement
 *     positif crédite donc la créance (elle diminue) — c'est la bascule symétrique de MD-46 sur les
 *     avoirs, appliquée aux paiements plutôt qu'aux documents.
 *   - `acomptes_recus` (même compte que la facture d'acompte, `MD-84 §6.2` — réutilisé ici pour
 *     l'avance/le trop-perçu, `CF-11`) a sa polarité naturelle au CRÉDIT. Son delta est
 *     `paiement.montantCentimes − Σ(imputations 'reglement')` (MD-51 b : seul `reglement` est
 *     borné par le montant du paiement — « arrondi, escompte, perte et compensation soldent un
 *     document sans qu'aucun argent ne circule »). Cette SEULE formule couvre à la fois le
 *     trop-perçu (`CF-11` : delta positif → crédit « Avances de clients ») ET le remboursement
 *     (`MD-57` : paiement négatif, aucune imputation → delta négatif → débit, qui réduit l'avance
 *     tenue) — sans branche sur le sens du paiement.
 *   - `arrondi` a sa polarité naturelle au DÉBIT, delta = Σ(imputations 'arrondi', SIGNÉES telles
 *     quelles — `CF-05` : `+0.01` quand la caisse encaisse MOINS que la facture, `-0.02` quand elle
 *     encaisse PLUS). Positif → débit (une perte pour le garage) ; négatif → crédit (un gain).
 *   - `escompte`/`perte` ont leur polarité naturelle au DÉBIT (comptes de réduction de produit —
 *     `CF-14`), delta = Σ(part HT de chaque imputation, TOUJOURS positive par construction).
 *   - `tva_due` (même compte que la ventilation TVA du document, par taux) a sa polarité naturelle
 *     au CRÉDIT, delta = −Σ(part TVA de chaque imputation escompte/perte) : l'escompte/la perte
 *     RÉDUIT la TVA due, donc un delta négatif (`CF-14` : `D 2200 TVA due 5.18`).
 *
 * --- `financierNouveauCetExport` : le financier ne part JAMAIS deux fois (MD-91, migration 0019) --
 *
 * Trouvaille du lot précédent, tranchée côté produit et posée en base par la migration 0019 :
 * `imputation_paiement` porte désormais SA PROPRE paire `exporte_le`/`export_id` — le suivi
 * d'export a la granularité de l'IMPUTATION, pas du paiement, parce qu'un paiement peut recevoir de
 * NOUVELLES imputations APRÈS avoir déjà été exporté (avance client affectée plus tard à une
 * facture qui n'existait pas encore au premier export, `MD-57` issue 2). Mais `paiement.montant
 * Centimes` (l'entrée de caisse/banque elle-même) reste un ÉVÉNEMENT UNIQUE : il ne doit être
 * transmis QU'UNE FOIS, à la toute première fois qu'une imputation de ce paiement (ou le paiement
 * lui-même, s'il reste non imputé) part à l'export — jamais à chaque lot qui touche une imputation
 * ultérieure du même paiement, sous peine de compter deux fois le même encaissement en compte
 * financier.
 *
 * `financierNouveauCetExport` (calculé par l'appelant depuis `paiement.exporteLe` — `null` avant CE
 * lot) gouverne donc DEUX choses à la fois, avec la MÊME formule que documentée plus haut :
 *
 *   - `financier` n'apparaît QUE si `financierNouveauCetExport` — sinon la ligne est simplement
 *     absente (déjà transmise dans un lot antérieur).
 *   - `acomptes_recus` (résiduel) = `(financierNouveauCetExport ? paiement.montantCentimes : 0) −
 *     Σ(reglement)` : au premier export, le résiduel est « ce que le cash n'a pas encore couvert » ;
 *     à un export ultérieur (financier déjà transmis), il n'y a plus de cash à ajouter — un NOUVEAU
 *     `reglement` sur ce paiement ne peut alors venir que de l'avance déjà tenue, donc `acomptes_
 *     recus` est DÉBITÉ (la formule bascule seule au signe négatif, sans branche dédiée).
 *
 * `escompte`/`perte`/`arrondi` ne dépendent PAS de `financierNouveauCetExport` : ce sont des écarts
 * qui soldent un document SANS QU'AUCUN ARGENT NE CIRCULE (MD-51 b) — leur compte dédié (jamais
 * `financier` ni `acomptes_recus`) est débité/crédité identiquement, que le cash ait déjà été
 * transmis ou non.
 *
 * --- Ce qui n'est PAS construit ici, et pourquoi (signalé, jamais deviné) ------------------------
 *
 * 1. **`nature = 'compensation'`** : MD-84 §6.2 ne documente aucune ligne pour ce cas (les quatre
 *    lignes du tableau sont Encaissement / Encaissement espèces arrondi / Escompte / Perte), et
 *    aucun `CF-xx` ne le chiffre. Une construction est arithmétiquement dérivable par analogie avec
 *    `acomptes_recus` (la compensation puise dans une avance déjà tenue plutôt que dans du cash
 *    frais), mais ce serait une règle INVENTÉE, pas relue dans le modèle documentaire — exactement
 *    ce que la tâche interdit. Toute imputation `compensation` rencontrée est reportée en blocage
 *    (`type: 'compensation_non_supportee'`), jamais silencieusement absorbée dans une autre
 *    catégorie.
 * 2. **Document réglé à PLUSIEURS taux de TVA, pour une imputation `escompte`/`perte`** : `CF-14`
 *    ne chiffre que le cas mono-taux (« 2 % du TTC », TVA corrigée proportionnellement À CE TAUX
 *    UNIQUE). Répartir un escompte/une perte entre plusieurs taux exigerait une clé de répartition
 *    (au prorata de la base ? de la ligne la plus grande, comme `MD-60` pour la remise globale ?)
 *    qu'aucun `MD-xx` ne pose pour ce cas précis — deviner laquelle produirait une TVA fiscalement
 *    fausse, découverte des mois plus tard chez la fiduciaire. Reporté en blocage
 *    (`type: 'taux_multiples_non_supporte'`).
 *
 * --- Pourquoi l'équilibre tient PAR CONSTRUCTION ---------------------------------------------------
 *
 * `imputation_paiement_verifier_invariants` (MD-51) garantit que la somme de TOUTES les imputations
 * d'un document ne dépasse jamais son `total_ttc_centimes`, et que la somme des imputations
 * `reglement` d'un paiement ne dépasse jamais `|montant_centimes|`. Cette fonction ne s'appuie
 * PAS silencieusement sur ces invariants : `Σdébit = Σcrédit` est vérifié explicitement en `bigint`
 * avant de rendre l'écriture (même garde que `construction-ecriture.ts`, MD-85).
 */

import type {
  EcritureExport,
  LigneEcritureExport,
  MoyenPaiement,
  NatureImputation,
} from '@dfa/shared';

import { arrondiCommercial } from '../../documents/calcul-document';
import type {
  BesoinMappingManquant,
  ComptesResolusADate,
  UsageMappingCompte,
} from './comptes-resolus';

/** Ligne de TVA d'un document, telle qu'utile pour la correction proportionnelle d'un escompte ou
 *  d'une perte (`CF-14`) — juste (régime, taux), pas les montants (déjà les nôtres, pas ceux du
 *  document). */
export interface LigneTvaPourPaiement {
  readonly regimeTva: string;
  readonly tauxTvaPourmille: number;
}

/** Ce qu'il faut connaître d'UN document référencé par une imputation pour construire la part de
 *  l'écriture de paiement qui le concerne — numéro (libellé, traçabilité) et ventilation TVA
 *  (escompte/perte uniquement). */
export interface DocumentPourEcriturePaiement {
  readonly numero: string;
  readonly ventilationTva: readonly LigneTvaPourPaiement[];
}

export interface ImputationPourEcriturePaiement {
  readonly documentId: string;
  /** Signé — voir l'en-tête de fichier : positif pour `reglement`/`escompte`/`perte`/
   *  `compensation` (contrat gelé, toujours positif pour ces natures), signé dans les deux sens
   *  pour `arrondi` (`CF-05`). */
  readonly montantCentimes: bigint;
  readonly nature: NatureImputation;
}

export interface PaiementPourEcriture {
  readonly id: string;
  readonly dateValeur: string;
  readonly moyen: MoyenPaiement;
  /** Signé (MD-50) — négatif = remboursement/contre-passation. */
  readonly montantCentimes: bigint;
  readonly payeurLibelle: string;
}

/** Ce que ce cœur ne sait PAS construire — voir l'en-tête de fichier, section « Ce qui n'est pas
 *  construit ici ». Distinct de `BesoinMappingManquant` (mapping incomplet, rattrapable en
 *  paramétrant le tenant) : ceci est une limite du CODE, pas du PARAMÉTRAGE — `FONCTION_NON_
 *  DISPONIBLE`, pas `EXPORT_MAPPING_INCOMPLET`, côté orchestrateur. */
export type LimiteEcriturePaiement =
  | {
      readonly type: 'compensation_non_supportee';
      readonly paiementId: string;
      readonly documentId: string;
    }
  | {
      readonly type: 'taux_multiples_non_supporte';
      readonly paiementId: string;
      readonly documentId: string;
      readonly nature: 'escompte' | 'perte';
    };

export function decrireLimitePaiement(l: LimiteEcriturePaiement): string {
  if (l.type === 'compensation_non_supportee') {
    return `imputation 'compensation' sur le document ${l.documentId} (paiement ${l.paiementId}) — non couverte par MD-84 §6.2, arbitrage requis avant construction.`;
  }
  return `imputation '${l.nature}' sur le document ${l.documentId} (paiement ${l.paiementId}) porte plusieurs taux de TVA — répartition non documentée par CF-14, arbitrage requis.`;
}

export type ResultatConstructionEcriturePaiement =
  | {
      readonly succes: true;
      readonly ecriture: EcritureExport;
      readonly totalDebitCentimes: bigint;
      readonly totalCreditCentimes: bigint;
    }
  | {
      readonly succes: false;
      readonly manquants: readonly BesoinMappingManquant[];
      readonly limites: readonly LimiteEcriturePaiement[];
    };

/** Une ligne de regroupement AVANT résolution du compte et calcul du sens — même patron que
 *  `GroupeSigne` de `construction-ecriture.ts` (`estDebitPositif` y joue le rôle d'`estCreances` :
 *  polarité naturelle au débit pour un delta positif, sinon polarité naturelle au crédit). */
interface GroupeSignePaiement {
  readonly usage: UsageMappingCompte;
  readonly categorie: string;
  readonly montantSigneCentimes: bigint;
  readonly estDebitPositif: boolean;
  readonly codeTva: string | null;
  /** Régime de TVA d'origine — utile SEULEMENT pour nommer précisément un `code_tva` manquant
   *  (`decrireBesoinManquant`) sur un groupe `tva_due` ; `null` pour tout autre usage. */
  readonly regimeTvaPourManquant: string | null;
  readonly tauxPourmille: number | null;
  readonly baseTvaCentimes: number | null;
  readonly libelle: string;
}

const NATURES_SOLDANT_UN_DOCUMENT: ReadonlySet<NatureImputation> = new Set([
  'reglement',
  'arrondi',
  'escompte',
  'perte',
]);

export function construireEcriturePaiement(
  paiement: PaiementPourEcriture,
  imputations: readonly ImputationPourEcriturePaiement[],
  documents: ReadonlyMap<string, DocumentPourEcriturePaiement>,
  comptes: ComptesResolusADate,
  centreDeCharge: string | null,
  /** `true` si `paiement.exporteLe` était `null` avant CE lot — voir l'en-tête de fichier. Gouverne
   *  la présence de `financier` et le terme de base d'`acomptes_recus` (le résiduel), rien d'autre. */
  financierNouveauCetExport: boolean,
): ResultatConstructionEcriturePaiement {
  const limites: LimiteEcriturePaiement[] = [];

  const creancesParDocument = new Map<string, bigint>();
  let sommeReglementCentimes = 0n;
  let sommeArrondiCentimes = 0n;
  let sommeEscompteHtCentimes = 0n;
  let sommePerteHtCentimes = 0n;
  const tvaCorrigeeParTaux = new Map<
    string,
    { regimeTva: string; tauxPourmille: number; montantCentimes: bigint; baseCentimes: bigint }
  >();

  for (const imp of imputations) {
    if (imp.nature === 'compensation') {
      limites.push({
        type: 'compensation_non_supportee',
        paiementId: paiement.id,
        documentId: imp.documentId,
      });
      continue;
    }
    if (!NATURES_SOLDANT_UN_DOCUMENT.has(imp.nature)) continue; // garde de typage — les cinq natures sont exhaustivement traitées ci-dessus/dessous.

    // Toute nature qui solde un document (reglement/arrondi/escompte/perte) crédite la créance de
    // son montant plein, SIGNÉ À L'INVERSE (voir l'en-tête de fichier) — MD-51 a garantit que la
    // somme ne dépassera jamais le total du document.
    creancesParDocument.set(
      imp.documentId,
      (creancesParDocument.get(imp.documentId) ?? 0n) - imp.montantCentimes,
    );

    if (imp.nature === 'reglement') {
      sommeReglementCentimes += imp.montantCentimes;
      continue;
    }
    if (imp.nature === 'arrondi') {
      sommeArrondiCentimes += imp.montantCentimes;
      continue;
    }

    // escompte | perte : correction proportionnelle de TVA (MD-71, MD-72), démontrée mono-taux
    // par CF-14 — voir l'en-tête de fichier pour la limite explicite au-delà d'un taux.
    const infoDocument = documents.get(imp.documentId);
    const ventilation = infoDocument?.ventilationTva ?? [];
    if (ventilation.length > 1) {
      limites.push({
        type: 'taux_multiples_non_supporte',
        paiementId: paiement.id,
        documentId: imp.documentId,
        nature: imp.nature,
      });
      continue;
    }
    const ligneTva = ventilation[0];
    const taux = ligneTva?.tauxTvaPourmille ?? 0;
    const tvaPartCentimes =
      taux === 0 ? 0n : arrondiCommercial(imp.montantCentimes * BigInt(taux), BigInt(1000 + taux));
    const htPartCentimes = imp.montantCentimes - tvaPartCentimes;

    if (imp.nature === 'escompte') sommeEscompteHtCentimes += htPartCentimes;
    else sommePerteHtCentimes += htPartCentimes;

    if (ligneTva && tvaPartCentimes !== 0n) {
      const cle = String(taux);
      const existant = tvaCorrigeeParTaux.get(cle) ?? {
        regimeTva: ligneTva.regimeTva,
        tauxPourmille: taux,
        montantCentimes: 0n,
        baseCentimes: 0n,
      };
      tvaCorrigeeParTaux.set(cle, {
        ...existant,
        montantCentimes: existant.montantCentimes - tvaPartCentimes,
        baseCentimes: existant.baseCentimes + htPartCentimes,
      });
    }
  }

  if (limites.length > 0) return { succes: false, manquants: [], limites };

  // `financierNouveauCetExport = false` : le cash de ce paiement a déjà été transmis dans un lot
  // antérieur (MD-91, migration 0019 — voir l'en-tête de fichier). Cette écriture-ci ne fait
  // qu'AFFECTER une imputation tardive, jamais ré-encaisser — vocabulaire distinct pour que la
  // fiduciaire ne lise pas deux fois « Encaissement » pour le même argent.
  const verbe = !financierNouveauCetExport
    ? 'Affectation'
    : paiement.montantCentimes >= 0n
      ? 'Encaissement'
      : 'Remboursement';
  const groupes: GroupeSignePaiement[] = [];

  // --- financier (compte caisse/banque par moyen de paiement) — MD-50 : le delta est le montant
  // plein du paiement, mais SEULEMENT la toute première fois que ce paiement est exporté (voir
  // l'en-tête de fichier) — sinon la ligne est absente, le cash ayant déjà été transmis. ----------
  if (financierNouveauCetExport) {
    groupes.push({
      usage: 'financier',
      categorie: paiement.moyen,
      montantSigneCentimes: paiement.montantCentimes,
      estDebitPositif: true,
      codeTva: null,
      regimeTvaPourManquant: null,
      tauxPourmille: null,
      baseTvaCentimes: null,
      libelle: `${verbe} (${paiement.moyen}) — ${paiement.payeurLibelle}`,
    });
  }

  // --- créances clients, une ligne par document soldé (traçabilité, MD-90) -----------------------
  for (const [documentId, delta] of creancesParDocument) {
    const numero = documents.get(documentId)?.numero ?? documentId;
    groupes.push({
      usage: 'creances_clients',
      categorie: 'defaut',
      montantSigneCentimes: delta,
      estDebitPositif: true,
      codeTva: null,
      regimeTvaPourManquant: null,
      tauxPourmille: null,
      baseTvaCentimes: null,
      libelle: `${verbe} — ${numero}`,
    });
  }

  // --- acomptes reçus (avance/trop-perçu, MD-57, CF-11) — même compte que la facture d'acompte.
  // Terme de base = le cash de CE lot (0 si le financier a déjà été transmis avant), diminué des
  // règlements de CE lot : au premier export c'est le résiduel non encore couvert ; à un export
  // ultérieur, un nouveau règlement ne peut venir que de l'avance déjà tenue → le terme bascule
  // seul en débit (formule unique, voir l'en-tête de fichier). -------------------------------------
  const montantFinancierCetExport = financierNouveauCetExport ? paiement.montantCentimes : 0n;
  const nonImputeCentimes = montantFinancierCetExport - sommeReglementCentimes;
  groupes.push({
    usage: 'acomptes_recus',
    categorie: 'defaut',
    montantSigneCentimes: nonImputeCentimes,
    estDebitPositif: false,
    codeTva: null,
    regimeTvaPourManquant: null,
    tauxPourmille: null,
    baseTvaCentimes: null,
    libelle:
      nonImputeCentimes >= 0n
        ? `Avance non affectée — ${paiement.payeurLibelle}`
        : `Reprise d'avance — ${paiement.payeurLibelle}`,
  });

  // --- différence d'arrondi espèces (CF-05, MD-47→MD-49) — une seule ligne agrégée. -------------
  groupes.push({
    usage: 'arrondi',
    categorie: 'defaut',
    montantSigneCentimes: sommeArrondiCentimes,
    estDebitPositif: true,
    codeTva: null,
    regimeTvaPourManquant: null,
    tauxPourmille: null,
    baseTvaCentimes: null,
    libelle: `Différence d'arrondi espèces — ${paiement.payeurLibelle}`,
  });

  // --- escompte accordé (HT, MD-71, CF-14) --------------------------------------------------------
  groupes.push({
    usage: 'escompte',
    categorie: 'defaut',
    montantSigneCentimes: sommeEscompteHtCentimes,
    estDebitPositif: true,
    codeTva: null,
    regimeTvaPourManquant: null,
    tauxPourmille: null,
    baseTvaCentimes: null,
    libelle: `Escompte accordé — ${paiement.payeurLibelle}`,
  });

  // --- perte sur créance (HT, MD-72) ----------------------------------------------------------
  groupes.push({
    usage: 'perte',
    categorie: 'defaut',
    montantSigneCentimes: sommePerteHtCentimes,
    estDebitPositif: true,
    codeTva: null,
    regimeTvaPourManquant: null,
    tauxPourmille: null,
    baseTvaCentimes: null,
    libelle: `Perte sur créance — ${paiement.payeurLibelle}`,
  });

  // --- TVA corrigée (escompte + perte confondus, MÊME compte de TVA due que le document) --------
  for (const {
    regimeTva,
    tauxPourmille,
    montantCentimes,
    baseCentimes,
  } of tvaCorrigeeParTaux.values()) {
    if (montantCentimes === 0n) continue;
    const codeTva = comptes.resoudreCodeTva(regimeTva, tauxPourmille);
    groupes.push({
      usage: 'tva_due',
      categorie: String(tauxPourmille),
      montantSigneCentimes: montantCentimes,
      estDebitPositif: false,
      codeTva: codeTva ?? null,
      regimeTvaPourManquant: regimeTva,
      tauxPourmille,
      baseTvaCentimes: Number(baseCentimes < 0n ? -baseCentimes : baseCentimes),
      libelle: `TVA due ${(tauxPourmille / 10).toFixed(1)}% (correction escompte/perte) — ${paiement.payeurLibelle}`,
    });
  }

  const manquants: BesoinMappingManquant[] = [];
  for (const g of groupes) {
    if (g.montantSigneCentimes === 0n) continue;
    if (comptes.resoudreCompte(g.usage, g.categorie) === undefined) {
      manquants.push({
        type: 'compte',
        usage: g.usage,
        categorie: g.categorie,
        documentNumero: paiement.id,
      });
    }
    if (g.usage === 'tva_due' && g.codeTva === null) {
      manquants.push({
        type: 'code_tva',
        regimeTva: g.regimeTvaPourManquant ?? '',
        tauxPourmille: g.tauxPourmille ?? 0,
        documentNumero: paiement.id,
      });
    }
  }
  if (manquants.length > 0) return { succes: false, manquants, limites: [] };

  let totalDebitCentimes = 0n;
  let totalCreditCentimes = 0n;
  const lignesEcriture: LigneEcritureExport[] = [];

  for (const g of groupes) {
    if (g.montantSigneCentimes === 0n) continue;
    const compte = comptes.resoudreCompte(g.usage, g.categorie);
    // Ne peut pas être `undefined` ici : `manquants` aurait intercepté le cas ci-dessus.
    if (compte === undefined)
      throw new Error(
        `compte introuvable pour ${g.usage}/${g.categorie} — devrait avoir été signalé en manquants.`,
      );

    const positif = g.montantSigneCentimes > 0n;
    const sens: 'debit' | 'credit' = positif === g.estDebitPositif ? 'debit' : 'credit';
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

  // MD-85 : vérifié explicitement en bigint avant de rendre l'écriture — même garde que
  // `construction-ecriture.ts`.
  if (totalDebitCentimes !== totalCreditCentimes) {
    throw new Error(
      `Écriture déséquilibrée pour le paiement ${paiement.id} : débit=${totalDebitCentimes.toString()}, crédit=${totalCreditCentimes.toString()} — EXPORT_ECRITURES_DESEQUILIBREES.`,
    );
  }

  // `documentId` reste TOUJOURS `null` sur une écriture de PAIEMENT — jamais le document réglé,
  // même quand un seul document est concerné (le cas courant). PIÈGE VÉRIFIÉ EN EXÉCUTION :
  // `winbiz-serialiseur.ts::verifierAucunDoublon` refuse un `documentId` présent plus d'une fois
  // dans le même LOT (protection MD-92 contre le double export d'un document) — un document exporté
  // dans le MÊME appel que le règlement qui le solde (le cas le plus fréquent, `CF-08`) porterait
  // alors le même `documentId` sur DEUX écritures légitimes et ferait échouer tout le lot en
  // `ECRITURE_DOUBLON`. `reference` (l'identifiant du paiement) et le libellé de chaque ligne
  // créances (qui cite déjà le numéro du document, voir ci-dessus) portent la traçabilité retour
  // vers DFA pour une écriture de paiement — `documentId` reste la traçabilité PROPRE au document.
  const ecriture: EcritureExport = {
    reference: paiement.id,
    date: paiement.dateValeur,
    libelle: `${verbe} (${paiement.moyen}) — ${paiement.payeurLibelle}`,
    centreDeCharge,
    lignes: lignesEcriture,
    documentId: null,
  };

  return { succes: true, ecriture, totalDebitCentimes, totalCreditCentimes };
}
