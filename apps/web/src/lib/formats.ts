import type { DeviseFacturation } from '@dfa/shared';

/**
 * Formats suisses — TOUJOURS 'de-CH' quelle que soit la langue d'interface (FR/DE/IT) :
 * 1'234.50 et 27.07.2026 sont les formats attendus par un garagiste suisse quelle que soit
 * sa langue de travail. Ne jamais dériver ces formateurs de la langue i18n courante.
 */

const FORMATEUR_MONTANT = new Intl.NumberFormat('de-CH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const FORMATEUR_DATE = new Intl.DateTimeFormat('de-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const FORMATEUR_HEURE = new Intl.DateTimeFormat('de-CH', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const FORMATEUR_ENTIER = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });

const FORMATEUR_POURCENTAGE = new Intl.NumberFormat('de-CH', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

// Intl.NumberFormat('de-CH') rend l'apostrophe typographique U+2019 (’) comme séparateur de
// milliers ; le rendu suisse standard utilise l'apostrophe droite U+0027 ('). Sans ce
// remplacement, un test d'égalité stricte sur "1'234.50" échoue silencieusement.
const APOSTROPHE_TYPOGRAPHIQUE = /’/g;

/** Neutralise l'apostrophe typographique (U+2019) que Intl.NumberFormat('de-CH') produit comme
 *  séparateur de milliers, au profit de l'apostrophe droite (U+0027) attendue en Suisse. À
 *  appliquer sur toute sortie de Intl.NumberFormat('de-CH', ...) qui peut grouper des milliers —
 *  réutilisé par lib/temps.ts pour rester cohérent avec ce fichier plutôt que de dupliquer la regex. */
export function corrigerApostropheMilliers(valeur: string): string {
  return valeur.replace(APOSTROPHE_TYPOGRAPHIQUE, "'");
}

/** Centimes (integer) -> "1'234.50". Ne jamais passer un montant en francs flottants. */
export function formaterMontant(centimes: number): string {
  if (!Number.isInteger(centimes)) {
    throw new TypeError(`formaterMontant attend un entier (centimes), reçu : ${centimes}`);
  }
  const francs = centimes / 100;
  return corrigerApostropheMilliers(FORMATEUR_MONTANT.format(francs));
}

/**
 * Centimes (integer) + devise (`CHF`/`EUR`, `document_vente.devise` depuis la migration `0015`)
 * -> "CHF 1'234.50" / "EUR 1'234.50". Un document dans une autre devise que CHF perdrait sa
 * section QR (`RF-58`), mais reste un document valide dont le montant doit se lire pour ce qu'il
 * est — jamais un chiffre nu qui laisserait croire, par défaut, à des francs suisses. Le front ne
 * CRÉE aujourd'hui qu'en CHF, mais un document repris d'un ancien DMS ou créé par l'API peut
 * porter `EUR` : centraliser le préfixe ICI (plutôt que `${devise} ${formaterMontant(...)}`
 * recopié dans chaque composant, comme l'ont fait par nécessité `EcranListeFactures.tsx` et
 * `BlocFinancierTableauBord.tsx` avant que ce fichier ne soit dans le périmètre du correctif) évite
 * qu'un futur écran choisisse un espacement ou un ordre différent. */
export function formaterMontantAvecDevise(centimes: number, devise: DeviseFacturation): string {
  return `${devise} ${formaterMontant(centimes)}`;
}

/** Date ISO ou objet Date -> "jj.mm.aaaa" (format suisse). */
export function formaterDate(date: Date | string): string {
  const valeur = typeof date === 'string' ? new Date(date) : date;
  return FORMATEUR_DATE.format(valeur);
}

/** Date ISO ou objet Date -> "HH:MM" (24 h, format suisse). */
export function formaterHeure(date: Date | string): string {
  const valeur = typeof date === 'string' ? new Date(date) : date;
  return FORMATEUR_HEURE.format(valeur);
}

/** Date ISO ou objet Date -> "jj.mm.aaaa HH:MM". */
export function formaterDateHeure(date: Date | string): string {
  const valeur = typeof date === 'string' ? new Date(date) : date;
  return `${formaterDate(valeur)} ${formaterHeure(valeur)}`;
}

/** Unité de distance — jamais déduite implicitement, toujours passée explicitement par
 *  l'appelant (référentiel véhicule) : un import US en miles ne doit jamais s'afficher en km. */
export type UniteDistance = 'km' | 'mi';

/** Kilométrage (integer) + unité -> "125'340 km". */
export function formaterKilometrage(valeur: number, unite: UniteDistance): string {
  if (!Number.isInteger(valeur)) {
    throw new TypeError(`formaterKilometrage attend un entier, reçu : ${valeur}`);
  }
  return `${corrigerApostropheMilliers(FORMATEUR_ENTIER.format(valeur))} ${unite}`;
}

/** Pour mille (integer, 0-1000, ex. taux TVA/rabais stockés en pourmille) -> "8.1 %". */
export function formaterPourmille(valeurPourmille: number): string {
  if (!Number.isInteger(valeurPourmille)) {
    throw new TypeError(
      `formaterPourmille attend un entier (pour mille), reçu : ${valeurPourmille}`,
    );
  }
  const pourcentage = valeurPourmille / 10;
  return `${corrigerApostropheMilliers(FORMATEUR_POURCENTAGE.format(pourcentage))} %`;
}

/** Convertit une date ISO ou objet Date en chaîne au format suisse jj.mm.aaaa pour saisie/affichage.
 *  Utilisé par les champs de saisie de date (DateInput) pour afficher le placeholder et la valeur. */
export function dateVersFormatSuisse(date: Date | string | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const jour = String(d.getDate()).padStart(2, '0');
  const mois = String(d.getMonth() + 1).padStart(2, '0');
  const annee = d.getFullYear();
  return `${jour}.${mois}.${annee}`;
}

/** Convertit une saisie au format suisse jj.mm.aaaa en chaîne ISO aaaa-mm-jj (pour react-hook-form).
 *  Tolère les espaces superflus ; retourne undefined si le format est invalide.
 *  Valide aussi que la date existe réellement (ex: rejet de 31.02.2026). */
export function formatSuisseVersISO(valeur: string | undefined): string | undefined {
  if (!valeur || !valeur.trim()) return undefined;

  // Tolère les espacements, extrait jj, mm, aaaa
  const trimmed = valeur.trim();
  const match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match || !match[1] || !match[2] || !match[3]) return undefined;

  const jour = parseInt(match[1], 10);
  const mois = parseInt(match[2], 10);
  const annee = parseInt(match[3], 10);

  // Valide que la date existe réellement
  const d = new Date(annee, mois - 1, jour);
  if (d.getFullYear() !== annee || d.getMonth() !== mois - 1 || d.getDate() !== jour) {
    return undefined; // ex: 31.02.2026 échoue
  }

  // Retourne au format ISO aaaa-mm-jj
  const moisISO = String(mois).padStart(2, '0');
  const jourISO = String(jour).padStart(2, '0');
  return `${annee}-${moisISO}-${jourISO}`;
}

/** Valide qu'une saisie est déjà une date ISO (aaaa-mm-jj) structurellement correcte ET
 *  réellement existante (même garde que `formatSuisseVersISO` : rejet de 2026-02-31). Utilisé par
 *  `DateInput` (`components/ui/date-input.tsx`) pour accepter, dans le même champ texte affiché en
 *  suisse, une valeur ISO collée ou déposée par le remplissage automatique du navigateur — sans
 *  ce second chemin de parsing, coller "2026-08-04" dans un champ qui n'affiche que du suisse
 *  serait rejeté comme invalide alors que la donnée est parfaitement exploitable. */
export function isoDirectValide(valeur: string): string | undefined {
  const trimmed = valeur.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || !match[1] || !match[2] || !match[3]) return undefined;

  const annee = parseInt(match[1], 10);
  const mois = parseInt(match[2], 10);
  const jour = parseInt(match[3], 10);

  const d = new Date(annee, mois - 1, jour);
  if (d.getFullYear() !== annee || d.getMonth() !== mois - 1 || d.getDate() !== jour) {
    return undefined; // ex: 2026-02-31 échoue
  }

  return trimmed;
}

/** Convertit un horodatage ISO ou objet Date en chaîne au format suisse jj.mm.aaaa HH:MM pour
 *  saisie/affichage. Utilisé par DatetimeInput pour afficher le placeholder et la valeur.
 *
 *  FUSEAU HORAIRE : reçoit une valeur ISO (UTC) du serveur et la convertit en heure locale
 *  du navigateur (CET/CEST). Le aller-retour formatSuisseVersISO_Datetime →
 *  datetimeVersFormatSuisse doit reproduire la même heure que celle tapée initialement. */
export function datetimeVersFormatSuisse(datetime: Date | string | undefined): string {
  if (!datetime) return '';
  const d = typeof datetime === 'string' ? new Date(datetime) : datetime;
  if (Number.isNaN(d.getTime())) return '';

  // `d` contient un horodatage UTC. Pour l'afficher en heure locale (de - CH), on soustrait
  // le décalage de fuseau horaire du navigateur. `getTimezoneOffset()` retourne le décalage
  // de la DATE ACTUELLE (changement heure d'été/hiver pris en compte), ce qui est correct.
  //
  // Exemple inverse : serveur stocke 2026-08-12T12:30:00.000Z (UTC).
  // Navigateur en CEST (UTC+2) doit afficher 14:30 (local).
  // `d.getTimezoneOffset()` retourne -120 (minutes).
  // `d.getTime() - (-120 * 60 * 1000)` ajoute 2h, produisant 14:30.
  const offsetMs = d.getTimezoneOffset() * 60 * 1000;
  const localDate = new Date(d.getTime() - offsetMs);

  const jour = String(localDate.getUTCDate()).padStart(2, '0');
  const mois = String(localDate.getUTCMonth() + 1).padStart(2, '0');
  const annee = localDate.getUTCFullYear();
  const heure = String(localDate.getUTCHours()).padStart(2, '0');
  const minute = String(localDate.getUTCMinutes()).padStart(2, '0');
  return `${jour}.${mois}.${annee} ${heure}:${minute}`;
}

/** Convertit une saisie au format suisse jj.mm.aaaa HH:MM en ISO datetime pour react-hook-form.
 *  Tolère les espaces superflus ; retourne undefined si le format est invalide.
 *  Valide aussi que la date existe réellement (ex: rejet de 31.02.2026) et que l'heure est valide. */
export function formatSuisseVersISO_Datetime(valeur: string | undefined): string | undefined {
  if (!valeur || !valeur.trim()) return undefined;

  const trimmed = valeur.trim();
  // Accepte "jj.mm.aaaa HH:MM" avec espaces flexibles autour de "HH:MM"
  const match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{1,2})$/);
  if (!match || !match[1] || !match[2] || !match[3] || !match[4] || !match[5]) return undefined;

  const jour = parseInt(match[1], 10);
  const mois = parseInt(match[2], 10);
  const annee = parseInt(match[3], 10);
  const heure = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);

  // Valide que la date existe réellement
  const d = new Date(annee, mois - 1, jour, heure, minute, 0, 0);
  if (d.getFullYear() !== annee || d.getMonth() !== mois - 1 || d.getDate() !== jour) {
    return undefined; // ex: 31.02.2026 échoue
  }

  // Valide que l'heure est valide
  if (heure < 0 || heure > 23 || minute < 0 || minute > 59) {
    return undefined;
  }

  // Convertit l'heure locale en UTC en appliquant le décalage de fuseau horaire.
  // `d` a été créée avec new Date(annee, mois, jour, heure, minute), ce qui l'interprète
  // comme heure locale du navigateur. `getTimezoneOffset()` retourne le décalage en minutes
  // (négatif pour UTC+, positif pour UTC-). Pour obtenir l'heure UTC équivalente, on ajoute
  // ce décalage au timestamp.
  //
  // Exemple : en CEST (UTC+2), un utilisateur qui tape "14:30" veut dire 14:30 local.
  // `new Date(2027, 6, 15, 14, 30)` crée une Date représentant 14:30 comme timestamp interne.
  // `getTimezoneOffset()` retourne -120 (minutes) pour UTC+2.
  // `d.getTime() + (-120 * 60 * 1000)` soustrait 2h, produisant 12:30 UTC.
  const offsetMs = d.getTimezoneOffset() * 60 * 1000;
  const utcDate = new Date(d.getTime() + offsetMs);
  return utcDate.toISOString();
}

/** Valide qu'une saisie est déjà un horodatage ISO structurellement correct ET réellement
 *  existant. Utilisé par `DatetimeInput` pour accepter une valeur ISO directe collée ou
 *  déposée par le remplissage automatique du navigateur. */
export function isoDatetimeDirectValide(valeur: string): string | undefined {
  const trimmed = valeur.trim();
  // Accepte les formats ISO datetime courants : aaaa-mm-jjThh:mm, aaaa-mm-jjThh:mm:ss, aaaa-mm-jjThh:mm:ss.sssZ
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d{3})?Z?$/);
  if (!match || !match[1] || !match[2] || !match[3] || !match[4] || !match[5]) return undefined;

  const annee = parseInt(match[1], 10);
  const mois = parseInt(match[2], 10);
  const jour = parseInt(match[3], 10);
  const heure = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);

  // Valide que la date existe réellement
  const d = new Date(annee, mois - 1, jour, heure, minute);
  if (d.getFullYear() !== annee || d.getMonth() !== mois - 1 || d.getDate() !== jour) {
    return undefined;
  }

  // Valide que l'heure est valide
  if (heure < 0 || heure > 23 || minute < 0 || minute > 59) {
    return undefined;
  }

  return trimmed;
}
