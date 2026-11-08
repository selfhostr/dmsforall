/**
 * Catalogue des postes du plan comptable à régler pour exporter (`mapping_compte` /
 * `mapping_code_tva`, MD-86), avec les suggestions du plan comptable PME suisse (Käfer).
 *
 * Les suggestions ne sont données QUE là où le numéro est sans ambiguïté dans le plan PME ; un
 * poste sans suggestion sûre reste `null` plutôt qu'un numéro plausible mais faux. Elles sont à
 * valider avec la fiduciaire du garage : son plan peut diverger. Le front ne les applique jamais
 * sans geste explicite de l'utilisateur.
 *
 * `requis` : nécessaire à un export courant d'un garage (factures atelier/vente, encaissements
 * usuels). Les autres postes ne servent que si le cas se présente (acompte, écart de reprise,
 * escompte…) ; l'aperçu (`GET /exports-fiduciaires/apercu`) dit, lui, ce qui manque réellement
 * pour UNE période donnée.
 */

import {
  type CibleExport,
  type MoyenPaiement,
  type RegimeTva,
  type TypeLigneDocumentVente,
  type UsageMappingCompte,
} from '@dfa/shared';

export interface DefinitionPosteCompte {
  readonly usage: UsageMappingCompte;
  readonly categorie: string;
  readonly libelle: string;
  readonly requis: boolean;
  readonly defaut: string | null;
}

export interface DefinitionPosteCodeTva {
  readonly regimeTva: RegimeTva;
  readonly tauxPourmille: number;
  readonly libelle: string;
  readonly requis: boolean;
}

const produit = (
  type: TypeLigneDocumentVente,
  libelle: string,
  requis: boolean,
  defaut: string | null,
): DefinitionPosteCompte => ({
  usage: 'produit',
  categorie: type,
  libelle: `Produit — ${libelle}`,
  requis,
  defaut,
});

const financier = (
  moyen: MoyenPaiement,
  libelle: string,
  requis: boolean,
  defaut: string | null,
): DefinitionPosteCompte => ({
  usage: 'financier',
  categorie: moyen,
  libelle: `Encaissement — ${libelle}`,
  requis,
  defaut,
});

export const POSTES_COMPTES: readonly DefinitionPosteCompte[] = [
  {
    usage: 'creances_clients',
    categorie: 'defaut',
    libelle: 'Débiteurs (créances clients)',
    requis: true,
    defaut: '1100',
  },
  produit('main_oeuvre_bareme', "Main-d'œuvre au barème", true, '3400'),
  produit('main_oeuvre_temps_reel', "Main-d'œuvre au temps réel", true, '3400'),
  produit('forfait', 'Forfaits', true, '3400'),
  produit('piece', 'Pièces', true, '3200'),
  produit('fourniture', 'Fournitures', true, '3200'),
  produit('sous_traitance', 'Sous-traitance', true, '3400'),
  produit('produit_atelier', "Produits d'atelier", true, '3200'),
  produit('taxe', 'Taxes et émoluments', false, null),
  produit('consigne', 'Consignes', false, null),
  produit('repartition', 'Franchise / part du tiers', false, null),
  { usage: 'tva_due', categorie: '81', libelle: 'TVA due 8.1 %', requis: true, defaut: '2200' },
  { usage: 'tva_due', categorie: '26', libelle: 'TVA due 2.6 %', requis: true, defaut: '2200' },
  { usage: 'tva_due', categorie: '38', libelle: 'TVA due 3.8 %', requis: true, defaut: '2200' },
  financier('especes', 'Espèces (caisse)', true, '1000'),
  financier('carte', 'Carte', true, null),
  financier('virement', 'Virement (banque)', true, '1020'),
  financier('qr', 'QR-facture (banque)', true, '1020'),
  financier('twint', 'TWINT', true, null),
  financier('leasing', 'Leasing', false, null),
  {
    usage: 'acomptes_recus',
    categorie: 'defaut',
    libelle: 'Acomptes reçus',
    requis: false,
    defaut: '2030',
  },
  {
    usage: 'arrondi',
    categorie: 'defaut',
    libelle: "Écart d'arrondi (5 centimes)",
    requis: false,
    defaut: '3809',
  },
  {
    usage: 'escompte',
    categorie: 'defaut',
    libelle: 'Escomptes accordés',
    requis: false,
    defaut: '3801',
  },
  {
    usage: 'perte',
    categorie: 'defaut',
    libelle: 'Pertes sur débiteurs',
    requis: false,
    defaut: '3805',
  },
  {
    usage: 'ecart_reprise',
    categorie: 'defaut',
    libelle: 'Écart de reprise',
    requis: false,
    defaut: null,
  },
];

export const POSTES_CODES_TVA: readonly DefinitionPosteCodeTva[] = [
  { regimeTva: 'normal', tauxPourmille: 81, libelle: 'Taux normal 8.1 %', requis: true },
  { regimeTva: 'reduit', tauxPourmille: 26, libelle: 'Taux réduit 2.6 %', requis: true },
  { regimeTva: 'hebergement', tauxPourmille: 38, libelle: 'Taux hébergement 3.8 %', requis: true },
];

/**
 * Codes TVA WinBIZ proposés par défaut : N81 (normal 8.1 %), R26 (réduit 2.6 %), H38
 * (hébergement 3.8 %). L'aide WinBIZ ne publie PAS de liste de codes par défaut : le champ
 * `Ecr_vtcode` (`<vt_code=xxx>`) référence un type de TVA défini dans le dossier du garage, et le
 * taux exporté (`TVA_taux`) est de toute façon porté par la ligne. Ces codes sont donc une
 * convention (initiale du taux + taux), modifiable par le garage/la fiduciaire dans le mapping.
 * La ligne exportée est toujours de la TVA due (`TVA_typ = 2`, vente), jamais de l'impôt préalable.
 * Sources (consultées le 08.11.2026) :
 * https://helpcenter.winbiz.ch/hc/fr/articles/115002136793 (import d'écritures, champs 20/TVA_typ),
 * https://helpcentre.winbiz.ch/hc/fr/articles/360005844694 (taux 2024 : 8.1 / 2.6 / 3.8).
 */
const CODES_TVA_WINBIZ_PAR_DEFAUT: Readonly<Record<string, string>> = {
  'normal:81': 'N81',
  'reduit:26': 'R26',
  'hebergement:38': 'H38',
};

/**
 * Suggestion de code TVA : la cible `csv` est libre (le taux lui-même est un code lisible) ;
 * WinBIZ reçoit `N81`/`R26`/`H38`. Bexio/Abacus/Banana : codes du logiciel du garage, non
 * inventés.
 */
export function codeTvaParDefaut(cible: CibleExport, poste: DefinitionPosteCodeTva): string | null {
  if (cible === 'winbiz') {
    return CODES_TVA_WINBIZ_PAR_DEFAUT[`${poste.regimeTva}:${String(poste.tauxPourmille)}`] ?? null;
  }
  if (cible !== 'csv') return null;
  return `${String(Math.floor(poste.tauxPourmille / 10))}.${String(poste.tauxPourmille % 10)}`;
}
