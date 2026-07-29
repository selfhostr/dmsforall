/**
 * Blocs d'adresse du Swiss QR Code — créancier, Ultimate Creditor, débiteur.
 *
 * Un bloc d'adresse compte **{@link NOMBRE_CHAMPS_BLOC_ADRESSE} champs** : `AdrTp`, puis nom,
 * rue, numéro, NPA, localité, pays. C'est le décompte tranché dans `structure.ts` — le point
 * exact où le modèle documentaire se trompait en écrivant « 6 lignes ».
 *
 * ────────────────────────────────────────────────────────────────────────────────────────
 * Le cas du comptoir : client sans adresse complète (`RF-59`, `RF-60`, `MD-79`)
 * ────────────────────────────────────────────────────────────────────────────────────────
 *
 * La spécification métier **tranche** ce cas, et elle le tranche bien : le bloc débiteur est
 * omis **en entier**, jamais partiellement. Un bloc où le nom est rempli et l'adresse vide
 * produit une charge utile que la banque refuse ; sans bloc du tout, le payeur écrit son
 * adresse à la main et le paiement passe. Mieux vaut un QR valide et incomplet qu'un QR complet
 * et refusé au guichet.
 *
 * ⚠️  **Divergence à arbitrer, signalée plutôt que tranchée en silence.** `RF-60` exige les
 * cinq champs nom + rue + **numéro** + NPA + localité pour émettre le bloc débiteur. La
 * spécification SIX est plus permissive : dans une adresse structurée, seuls `Name`, `PstCd`,
 * `TwnNm` et `Ctry` sont obligatoires — `StrtNmOrAdrLine1` et `BldgNbOrAdrLine2` sont
 * facultatifs. Concrètement, `RF-60` fait tomber le bloc débiteur pour des adresses que les
 * banques accepteraient : case postale, lieu-dit, hameau sans numéro de rue — courants en
 * Suisse rurale, donc chez des clients de garage.
 *
 * Conséquence pratique : plus de bulletins sans destinataire pré-rempli que nécessaire. Ce
 * n'est jamais un paiement perdu (le QR reste valide), seulement un confort en moins. `RF-60`
 * est donc appliqué **tel quel** — c'est la spécification, et son coût est borné — mais le
 * choix est isolé dans {@link CHAMPS_REQUIS_BLOC_DEBITEUR} : passer à la règle SIX consiste à
 * retirer deux entrées de ce tableau, et rien d'autre.
 */

import { ErreurQrFacture } from './erreurs-qr';
import { LONGUEURS_MAX, NOMBRE_CHAMPS_BLOC_ADRESSE, TYPE_ADRESSE_STRUCTUREE } from './structure';

/**
 * Adresse structurée (type `S`). Depuis l'IG 2.3 (22.11.2025), c'est le seul type admis :
 * l'adresse combinée `K` a été supprimée de la spécification.
 */
export interface AdresseStructuree {
  readonly nom: string;
  readonly rue?: string | null;
  readonly numero?: string | null;
  readonly npa?: string | null;
  readonly localite?: string | null;
  /** Code ISO 3166-1 alpha-2. Défaut `CH` quand l'appelant ne le fournit pas. */
  readonly pays?: string | null;
}

export type ChampAdresse = 'nom' | 'rue' | 'numero' | 'npa' | 'localite' | 'pays';

/**
 * Champs exigés du bloc **créancier**. Le créancier est le garage : son adresse est saisie une
 * fois dans le paramétrage et vérifiée là-bas. Un créancier incomplet **bloque l'émission**
 * (`RF-54`, `PF-03`) — brutal à dessein : l'alternative, une facture sans QR, transforme trente
 * secondes de paramétrage en une créance non recouvrée.
 */
export const CHAMPS_REQUIS_BLOC_CREANCIER: readonly ChampAdresse[] = [
  'nom',
  'rue',
  'numero',
  'npa',
  'localite',
  'pays',
];

/**
 * Champs exigés du bloc **débiteur** pour qu'il soit émis (`RF-60`). Un seul manquant → aucun
 * bloc débiteur, jamais un bloc partiel. Contrôle mécanique, jamais laissé au jugement de
 * l'utilisateur.
 *
 * Voir la divergence documentée en tête de fichier : la spécification SIX se contenterait de
 * `['nom', 'npa', 'localite', 'pays']`.
 */
export const CHAMPS_REQUIS_BLOC_DEBITEUR: readonly ChampAdresse[] = [
  'nom',
  'rue',
  'numero',
  'npa',
  'localite',
];

/** Pays par défaut quand l'appelant ne le précise pas. */
export const PAYS_PAR_DEFAUT = 'CH';

/**
 * Bloc d'adresse absent : {@link NOMBRE_CHAMPS_BLOC_ADRESSE} champs vides. Utilisé pour le bloc
 * *Ultimate Creditor* (réservé, jamais rempli) et pour le bloc débiteur omis.
 */
export function blocAdresseVide(): string[] {
  return Array.from({ length: NOMBRE_CHAMPS_BLOC_ADRESSE }, () => '');
}

/** Vrai si la valeur est une chaîne non vide après trim. */
function estRenseigne(valeur: string | null | undefined): valeur is string {
  return typeof valeur === 'string' && valeur.trim().length > 0;
}

function lireChamp(adresse: AdresseStructuree, champ: ChampAdresse): string | null | undefined {
  switch (champ) {
    case 'nom':
      return adresse.nom;
    case 'rue':
      return adresse.rue;
    case 'numero':
      return adresse.numero;
    case 'npa':
      return adresse.npa;
    case 'localite':
      return adresse.localite;
    case 'pays':
      return adresse.pays ?? PAYS_PAR_DEFAUT;
  }
}

export interface CompletudeAdresse {
  readonly complete: boolean;
  readonly champsManquants: readonly ChampAdresse[];
  /**
   * Vrai si l'adresse est partiellement renseignée : au moins un champ requis présent, au moins
   * un absent. C'est exactement le cas « nom rempli, adresse vide » du comptoir, celui qui
   * produirait une charge utile invalide s'il était émis tel quel.
   */
  readonly partielle: boolean;
}

/** Évalue la complétude d'une adresse au regard d'une liste de champs requis. */
export function evaluerCompletudeAdresse(
  adresse: AdresseStructuree | null | undefined,
  champsRequis: readonly ChampAdresse[],
): CompletudeAdresse {
  if (adresse === null || adresse === undefined) {
    return { complete: false, champsManquants: [...champsRequis], partielle: false };
  }

  const champsManquants = champsRequis.filter((champ) => !estRenseigne(lireChamp(adresse, champ)));
  const complete = champsManquants.length === 0;

  return {
    complete,
    champsManquants,
    partielle: !complete && champsManquants.length < champsRequis.length,
  };
}

/**
 * Contrôle qu'une valeur de champ ne contient ni CR, ni LF, ni caractère de contrôle, et
 * qu'elle tient dans sa longueur maximale.
 *
 * Le refus de CR/LF n'est pas cosmétique : la charge utile est une liste d'éléments séparés par
 * CR+LF. Un `\r\n` glissé dans un nom de client **insère un élément** et décale tout ce qui
 * suit — c'est une injection de structure, qui rend le QR illisible dans le meilleur des cas et
 * le fait pointer ailleurs dans le pire.
 */
export function assainirChamp(valeur: string, nomChamp: string, longueurMax: number): string {
  const nettoye = valeur.trim();

  // eslint-disable-next-line no-control-regex -- c'est précisément la classe qu'on interdit.
  if (/[\u0000-\u001F\u007F]/.test(nettoye)) {
    throw new ErreurQrFacture(
      'CHAMP_CARACTERE_INTERDIT',
      `Le champ « ${nomChamp} » contient un caractère de contrôle ou un saut de ligne, ` +
        'interdits dans la charge utile QR.',
      nomChamp,
    );
  }

  if (nettoye.length > longueurMax) {
    throw new ErreurQrFacture(
      'CHAMP_TROP_LONG',
      `Le champ « ${nomChamp} » dépasse ${longueurMax} caractères (reçu ${nettoye.length}).`,
      nomChamp,
    );
  }

  return nettoye;
}

/**
 * Encode une adresse en ses {@link NOMBRE_CHAMPS_BLOC_ADRESSE} champs, dans l'ordre de la
 * spécification. L'adresse est supposée complète — la décision d'émettre ou d'omettre le bloc
 * appartient à l'appelant, via {@link evaluerCompletudeAdresse}.
 *
 * @param prefixeChamp préfixe des noms de champs dans les messages d'erreur (`creancier`,
 *        `debiteur`), pour que l'utilisateur sache quelle adresse corriger.
 */
export function encoderBlocAdresse(adresse: AdresseStructuree, prefixeChamp: string): string[] {
  const champs = [
    TYPE_ADRESSE_STRUCTUREE,
    assainirChamp(adresse.nom, `${prefixeChamp}.nom`, LONGUEURS_MAX.nom),
    assainirChamp(adresse.rue ?? '', `${prefixeChamp}.rue`, LONGUEURS_MAX.rue),
    assainirChamp(adresse.numero ?? '', `${prefixeChamp}.numero`, LONGUEURS_MAX.numero),
    assainirChamp(adresse.npa ?? '', `${prefixeChamp}.npa`, LONGUEURS_MAX.npa),
    assainirChamp(adresse.localite ?? '', `${prefixeChamp}.localite`, LONGUEURS_MAX.localite),
    assainirChamp(
      (adresse.pays ?? PAYS_PAR_DEFAUT).toUpperCase(),
      `${prefixeChamp}.pays`,
      LONGUEURS_MAX.pays,
    ),
  ];

  /* c8 ignore next 7 -- garde-fou de programmation : le tableau ci-dessus est littéral. */
  if (champs.length !== NOMBRE_CHAMPS_BLOC_ADRESSE) {
    throw new ErreurQrFacture(
      'DECOMPTE_ELEMENTS_INCOHERENT',
      `Bloc d’adresse « ${prefixeChamp} » : ${champs.length} champs au lieu de ` +
        `${NOMBRE_CHAMPS_BLOC_ADRESSE}.`,
    );
  }

  return champs;
}
