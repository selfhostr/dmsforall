/**
 * Constantes de l'adaptateur WinBIZ — import d'écritures (canal 20 colonnes, `EF-11` → `EF-19`
 * de `docs/exports-fiduciaires.md`).
 *
 * Toutes les valeurs ci-dessous sont **sourcées** (documentation publique de l'éditeur + fichier
 * d'exemple officiel `ecr_standardv6.csv`, voir `EF-12`/`EF-13`/`EF-15`), à UNE exception marquée
 * explicitement : `WINBIZ_TVA_METH` (§ ci-dessous), qui reste une question ouverte (`EF-19` point
 * 1, `Q10`) tranchée ici par une constante isolée, pas par une déduction.
 */

/** `;` — `EF-12`. Pas de virgule, pas de tabulation. */
export const SEPARATEUR_CHAMP_WINBIZ = ';';

/** CRLF, pas LF seul — `EF-12`, piège identifié explicitement dans la doc source. */
export const FIN_DE_LIGNE_WINBIZ = '\r\n';

/**
 * Longueurs déclarées par la documentation pour les colonnes texte du canal écritures
 * (`EF-13`). Les colonnes non listées ici (`Journal` = 1, contrôlé séparément) ou non
 * pertinentes pour cet adaptateur ne sont pas reprises.
 */
export const LONGUEURS_CHAMPS_WINBIZ = {
  /** Colonne 2 `Pièce` — 10 caractères. C'est là que voyage le numéro DFA (`RF-108`) : un
   *  numéro de plus de 10 caractères (le contrat `document.ts` autorise jusqu'à 20) DOIT être
   *  tronqué pour rentrer dans ce canal — voir `formaterPieceWinbiz` et l'avertissement produit
   *  à cette occasion. C'est une limite structurelle du canal, pas un choix de cet adaptateur. */
  piece: 10,
  /** Colonne 3 `Libellé` — 100 caractères. */
  libelle: 100,
  /** Colonnes 4/5 `Cpt_debit`/`Cpt_credit` — 12 caractères. Un compte du plan comptable du
   *  tenant plus long que 12 caractères indique un mapping mal saisi, pas un cas à tronquer
   *  silencieusement : voir `winbiz-serialiseur.ts`, qui refuse plutôt que de couper un numéro
   *  de compte (couper un numéro de COMPTE, contrairement à une pièce, changerait de compte). */
  compte: 12,
  /** Colonne 19 `Ecr_ana` — 20 caractères (`centreDeCharge`, code de site). */
  ecrAna: 20,
} as const;

/**
 * En-tête, reprise VERBATIM de l'exemple officiel `ecr_standardv6.csv` (`EF-15`) — la
 * documentation précise que **l'ordre fait foi, pas le nom des colonnes** (`EF-13`), mais une
 * ligne d'en-tête reste attendue par les exemples (`EF-12`) et l'option « importation du premier
 * enregistrement » doit alors rester décochée côté WinBIZ.
 */
export const ENTETE_COLONNES_WINBIZ = [
  'date',
  'pièce',
  'libellé',
  'cpt_débit',
  'cpt_crédit',
  'montant',
  'journal',
  'me_cours',
  'me_mnt',
  'tva_taux',
  'tva_mnt',
  'tva_cpt',
  'tva_typ',
  'tva_meth',
  'tva_soum',
  'Ecr_monnai',
  'Ecr_monqte ',
  'Comment ',
  'Ecr_ana',
  'Ecr_vtcode',
] as const;

/**
 * Codes `Journal` énumérés par la documentation (`EF-13`). `v` (Ventes) est le journal du garage
 * pour la facturation client — c'est le seul utilisé par cet adaptateur pour le pilote ; les
 * autres valeurs sont documentées ici pour mémoire, pas câblées.
 */
export const JOURNAUX_WINBIZ = {
  divers: 'd',
  salaires: 's',
  achats: 'a',
  ventes: 'v',
  inventaires: 'i',
  amortissements: 'm',
  soldesInitiaux: 'o',
  bouclement: 'b',
  aExtourner: 'x',
} as const;

/** Journal par défaut de cet adaptateur — `RF-108`/`EF-13` : le garage n'a qu'un seul journal de
 *  ventes pour le pilote. Isolé ici pour rester un point de configuration facile à revoir si un
 *  futur tenant a plusieurs journaux (encaissements en `d` Divers, par exemple). */
export const JOURNAL_PAR_DEFAUT_WINBIZ = JOURNAUX_WINBIZ.ventes;

/** `TVA_cpt` (colonne 12) — `EF-13` : le compte TVA de la ligne WinBIZ produite est-il du côté
 *  débit ou crédit de CETTE ligne ? Dans cet adaptateur, c'est directement le `sens` de la ligne
 *  du cœur qui porte la TVA (voir `winbiz-decomposition.ts`) — aucune ambiguïté à isoler ici. */
export const TVA_CPT_WINBIZ = { debit: 'd', credit: 'c' } as const;

/**
 * `TVA_typ` (colonne 13) — `EF-13` : 1 Pas de TVA, 2 TVA due, 3 Impôt préalable, 4 Hors taxe.
 * Une facture de vente au client encaisse de la TVA que le garage DOIT à l'AFC — c'est
 * systématiquement `2` (TVA due) pour toute ligne qui porte un `codeTva` dans ce lot de vente.
 * Aucune ligne d'achat (qui utiliserait `3`) ne transite par cet adaptateur — la facturation DFA
 * ne produit que des écritures de vente.
 */
export const TVA_TYP_DUE_WINBIZ = '2';

/**
 * `Ecr_vtcode` (colonne 20) — méthode RECOMMANDÉE par la documentation WinBIZ (`EF-17`,
 * verbatim : « 1ère méthode : recommandée »), par opposition à la méthode numérique 1-4
 * dépréciée. `codeTva` (contrat partagé, `mapping_code_tva.code_externe`) EST ce code — le
 * mapping par tenant en est la seule source, jamais une valeur en dur ici (`EF-17`,
 * `MD-86`).
 */
export function baliseVtCodeWinbiz(codeTva: string): string {
  return `<vt_code=${codeTva}>`;
}

/**
 * ⚠️ `WINBIZ_TVA_METH` — POINT NON TRANCHÉ, ISOLÉ ICI EXPRÈS (`EF-19` point 1, `Q10` de
 * `docs/exports-fiduciaires.md` §6).
 *
 * La documentation WinBIZ ne dit NULLE PART si le champ `Montant` d'une ligne qui porte un bloc
 * TVA est TTC (`TVA_meth = 1`, Brut) ou HT (`TVA_meth = 2`, Net) — seul l'exemple officiel laisse
 * supposer un TTC (`montant=108.1` avec `tva_mnt=8.1`, `tva_meth=2`), sans qu'aucune page ne
 * l'énonce. **Se tromper inverse le sens de chaque écriture TVA à l'import.**
 *
 * Dans CET adaptateur, la question ne se pose que sur les lignes qui REPRÉSENTENT directement le
 * compte TVA (`winbiz-decomposition.ts` : `ligneTva` non nul) — le `Montant` de cette ligne est
 * alors, PAR CONSTRUCTION, le montant de TVA lui-même (`LigneEcritureExport.montantCentimes` de
 * la ligne TVA du cœur, jamais recalculé ici, `EF-03`) : il n'y a donc pas de compound TTC/HT à
 * faire éclater par WinBIZ pour NOS lignes. On choisit néanmoins une valeur, parce que le champ
 * est obligatoire dès qu'un bloc TVA est présent (`EF-13`) :
 *
 * **Valeur retenue : `'2'` (Net)** — lecture : « le montant donné est la figure finale, WinBIZ
 * n'a rien à recalculer ». C'est la lecture la plus prudente compte tenu de `EF-03`
 * (l'adaptateur ne recalcule ni ne délègue de recalcul de montant) : `'1'` (Brut) suggérerait à
 * WinBIZ qu'il doit lui-même dériver une part TVA à partir d'un montant composé, ce que cet
 * adaptateur ne lui demande jamais de faire (chaque compte déjà touché a déjà sa propre ligne
 * WinBIZ, `EF-14`).
 *
 * **À vérifier sur un dossier réel avant le premier export en production (`EF-19` point 1) — ne
 * pas construire de logique métier qui suppose cette valeur correcte tant que ce n'est pas fait.**
 */
export const WINBIZ_TVA_METH: '1' | '2' = '2';

/**
 * Limite documentée de l'API `ENTRIESIMPORT` (`EF-18`) : **100 Ko par fichier**. Contrainte de
 * conception (`EF-18` a), pas un détail — un export complet de garage la dépasse. Utilisée par
 * `decouperEnLots` (`winbiz-exporteur.service.ts`) pour ne jamais produire un lot que WinBIZ
 * refuserait faute de taille.
 */
export const TAILLE_MAX_LOT_OCTETS_WINBIZ = 100 * 1024;

/**
 * Bornes défensives sur un montant en centimes admis par une ligne WinBIZ (`Numérique 15,2`,
 * `EF-13` colonne 6) : 13 chiffres entiers + 2 décimales. Très large par rapport aux montants
 * réels (`ligne_document` plafonne à ± CHF 1'000'000 par ligne) — ce garde-fou existe pour
 * détecter une valeur aberrante en amont (bug de calcul), pas pour contraindre un usage normal.
 */
export const MONTANT_MAX_CENTIMES_WINBIZ = 10 ** 15 - 1;
