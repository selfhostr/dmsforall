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
 * ⚠️  **`RF-60` ASSOUPLI VERS LA NORME SIX — décision prise sans choix produit (issue #22).**
 *
 * `RF-60`, tel qu'appliqué jusqu'ici, exigeait nom + rue + **numéro** + NPA + localité pour
 * émettre le bloc débiteur. Or le contrat d'adresse client (`schemaAdresseClientBase`,
 * `packages/shared/src/contrats/atelier/client.ts`) n'a JAMAIS exposé de champ `numero` — la
 * colonne existe en base (`client_adresse.numero`, migration 0014) mais aucun appelant ne peut
 * la renseigner. La condition était donc **structurellement insatisfiable** : le bloc débiteur
 * était omis sur **100 % des factures**, pas seulement « plus souvent que nécessaire » comme le
 * disait la version précédente de ce commentaire — vérifié en base sur `document_vente`, voir
 * l'issue #22 pour le détail (facture `2026-00002`, adresse client complète, bloc débiteur
 * omis quand même).
 *
 * La spécification SIX, elle, ne rend obligatoires que `Name`, `PstCd`, `TwnNm` et `Ctry` — dans
 * une adresse structurée, `StrtNmOrAdrLine1` et `BldgNbOrAdrLine2` sont FACULTATIFS, et les
 * banques les acceptent absents. {@link CHAMPS_REQUIS_BLOC_DEBITEUR} est donc désormais aligné
 * sur cette règle : `rue` et `numero` en sont retirés, ne laissant que `nom`, `npa`, `localite`
 * et `pays` (ce dernier lu `?? 'CH'`, donc en pratique toujours satisfait). C'est exactement les
 * « deux entrées à retirer de ce tableau, et rien d'autre » que l'ancienne version de ce
 * commentaire annonçait déjà comme le chemin de bascule.
 *
 * CE QUI NE CHANGE PAS : `rue`/`numero` restent ÉMIS dans le bloc débiteur quand ils sont
 * connus — {@link encoderBlocAdresse} les encode inconditionnellement (`?? ''` sinon).
 * L'assouplissement porte sur ce qui est REQUIS pour que le bloc soit émis DU TOUT, pas sur ce
 * qui est émis une fois qu'il l'est : un client dont l'adresse porte une rue verra cette rue
 * imprimée sur le bulletin, exactement comme avant.
 *
 * POUR REVENIR EN ARRIÈRE : remettre `'rue'` et `'numero'` dans
 * {@link CHAMPS_REQUIS_BLOC_DEBITEUR} restaure `RF-60` strict — mais recrée alors le bug de
 * l'issue #22 tant que le contrat d'adresse client n'expose pas `numero` (et que les adresses
 * existantes, saisies avant toute exposition du champ, ne portent pas de numéro séparé). La
 * correction alternative envisagée par l'issue — exposer `numero` dans le contrat ET rattraper
 * les adresses existantes — reste possible plus tard, mais n'a pas été retenue ici : elle ne
 * corrige rien pour les adresses déjà saisies sans reprise de données, alors que l'assouplissement
 * SIX corrige tout de suite, pour toutes les adresses, sans aucune migration de données.
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
 * Champs exigés du bloc **débiteur** pour qu'il soit émis. Un seul manquant → aucun bloc
 * débiteur, jamais un bloc partiel. Contrôle mécanique, jamais laissé au jugement de
 * l'utilisateur.
 *
 * `RF-60` ASSOUPLI VERS LA NORME SIX (issue #22, décision prise sans choix produit — voir
 * l'en-tête du fichier pour le raisonnement complet et le chemin de retour arrière) : `rue` et
 * `numero` ne sont plus requis. Sans cet assouplissement, `numero` n'étant exposé par AUCUN
 * contrat d'écriture d'adresse client, la condition était insatisfiable pour 100 % des clients —
 * le bloc débiteur ne s'émettait jamais.
 */
export const CHAMPS_REQUIS_BLOC_DEBITEUR: readonly ChampAdresse[] = [
  'nom',
  'npa',
  'localite',
  'pays',
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
