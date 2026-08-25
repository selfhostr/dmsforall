/**
 * Conversion d'une valeur SOURCE (texte libre, format hérité) vers un enum Postgres CIBLE — PUR,
 * sans accès base. « Les enums Postgres sont le premier mur » (brief) : une valeur non
 * convertible ne doit JAMAIS tenter l'INSERT (l'enum ferait échouer toute la ligne, pas un simple
 * CHECK assouplissable après coup) — elle doit produire une anomalie exploitable ET LAISSER
 * PASSER LE RESTE DU LOT. C'est la seule responsabilité de ce module.
 */

export interface TableCorrespondanceEnum<TCible extends string> {
  /** Clé = valeur SOURCE normalisée (trim + minuscule) -> valeur CIBLE. Explicite, jamais une
   *  coercition automatique (`as TCible`) : toute valeur absente de cette table est INCONNUE,
   *  point final. */
  readonly correspondances: Readonly<Record<string, TCible>>;
}

export interface ResultatConversionEnum<TCible extends string> {
  readonly valeur: TCible | null;
  /** `true` = valeur source non vide mais absente de la table de correspondance — LE cas que le
   *  brief demande de ne jamais laisser passer en silence ni faire planter le lot. */
  readonly inconnue: boolean;
  readonly valeurSourceBrute: string | null;
}

export function convertirVersEnum<TCible extends string>(
  valeurSource: string | null | undefined,
  table: TableCorrespondanceEnum<TCible>,
): ResultatConversionEnum<TCible> {
  if (valeurSource === null || valeurSource === undefined || valeurSource.trim() === '') {
    return { valeur: null, inconnue: false, valeurSourceBrute: null };
  }
  const cle = valeurSource.trim().toLowerCase();
  const trouvee = table.correspondances[cle];
  if (trouvee !== undefined) {
    return { valeur: trouvee, inconnue: false, valeurSourceBrute: valeurSource };
  }
  return { valeur: null, inconnue: true, valeurSourceBrute: valeurSource };
}

/** `public.type_client` (`particulier` | `entreprise`) — variantes FR/DE courantes vues dans les
 *  DMS suisses hérités (accents/casse déjà normalisés par `convertirVersEnum`). */
export const CORRESPONDANCE_TYPE_CLIENT: TableCorrespondanceEnum<'particulier' | 'entreprise'> = {
  correspondances: {
    particulier: 'particulier',
    privé: 'particulier',
    prive: 'particulier',
    privat: 'particulier',
    entreprise: 'entreprise',
    societe: 'entreprise',
    société: 'entreprise',
    firma: 'entreprise',
    geschaft: 'entreprise',
    geschäft: 'entreprise',
  },
};

/** `public.langue` (`fr` | `de` | `it`) — FR = langue source du produit, mais l'archive reprise
 *  peut porter n'importe laquelle des trois. */
export const CORRESPONDANCE_LANGUE: TableCorrespondanceEnum<'fr' | 'de' | 'it'> = {
  correspondances: {
    fr: 'fr',
    fra: 'fr',
    francais: 'fr',
    français: 'fr',
    de: 'de',
    ger: 'de',
    deu: 'de',
    deutsch: 'de',
    allemand: 'de',
    it: 'it',
    ita: 'it',
    italien: 'it',
    italiano: 'it',
  },
};
