import type { DeviseFacturation } from '@dfa/shared';

/**
 * Formats suisses — TOUJOURS 'de-CH' quelle que soit la langue d'interface (FR/DE/IT) :
 * 1'234.50 et 27.07.2026 sont les formats attendus par un garagiste suisse quelle que soit
 * sa langue de travail. Ne jamais dériver ces formateurs de la langue i18n courante.
 */

/**
 * Fuseau UNIQUE du produit — décision de @laupernoe, 14.08.2026 (voir
 * `apps/api/src/common/temps/fuseau-suisse.ts`, qui a posé cette doctrine côté API). Un DMS
 * suisse affiche l'heure suisse parce que c'est un DMS suisse, JAMAIS parce que la machine qui
 * l'exécute se trouve réglée sur Zurich : `Intl.DateTimeFormat` SANS `timeZone` explicite retombe
 * sur le fuseau du PROCESSUS (celui de la CI, d'un conteneur Docker, du poste d'un dev à
 * l'étranger), pas celui du garage. Toujours poser `timeZone: FUSEAU_SUISSE` explicitement, ici et
 * dans toute conversion de ce fichier.
 *
 * Dupliqué (pas importé) depuis `apps/api/src/common/temps/fuseau-suisse.ts` : le web ne dépend
 * jamais du code serveur (API-first, aucun accès privilégié) — même MÉTHODE (Intl.DateTimeFormat
 * adossé à la base tzdata du moteur, point fixe pour le sens heure-murale -> UTC), pas de code
 * partagé possible entre les deux bundles.
 */
const FUSEAU_SUISSE = 'Europe/Zurich';

const FORMATEUR_MONTANT = new Intl.NumberFormat('de-CH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const FORMATEUR_DATE = new Intl.DateTimeFormat('de-CH', {
  timeZone: FUSEAU_SUISSE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const FORMATEUR_HEURE = new Intl.DateTimeFormat('de-CH', {
  timeZone: FUSEAU_SUISSE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Composantes murales suisses (année/mois/jour/heure/minute) d'un instant absolu — locale
 *  'en-US' choisie UNIQUEMENT parce qu'elle rend des champs numériques simples à relire via
 *  `formatToParts` (aucun rapport avec les États-Unis, même choix que `FORMATEUR_HORLOGE` dans
 *  `apps/api/src/common/temps/fuseau-suisse.ts`). `hourCycle: 'h23'` — jamais `'h24'`, qui rendrait
 *  minuit comme "24" au lieu de "00" et ferait déborder le parsing numérique d'un jour. */
const FORMATEUR_COMPOSANTES_SUISSE = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSEAU_SUISSE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

interface ComposantesSuisses {
  annee: number;
  mois: number; // 1-12
  jour: number;
  heure: number; // 0-23
  minute: number;
}

/** Lit les composantes murales SUISSES (Europe/Zurich) d'un instant absolu — jamais les
 *  composantes locales du PROCESSUS (`d.getFullYear()`/`d.getHours()`, qui lisent le fuseau de la
 *  machine). C'est le point de lecture UNIQUE de ce fichier pour aller d'un instant absolu vers
 *  une heure murale suisse. */
function composantesSuisses(instant: Date): ComposantesSuisses {
  const parties = Object.fromEntries(
    FORMATEUR_COMPOSANTES_SUISSE.formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return {
    annee: Number(parties.year),
    mois: Number(parties.month),
    jour: Number(parties.day),
    heure: Number(parties.hour),
    minute: Number(parties.minute),
  };
}

/** Décalage Europe/Zurich (en minutes, à l'EST d'UTC — +60 CET l'hiver, +120 CEST l'été) EN
 *  VIGUEUR à l'instant UTC donné. Même méthode que `decalageMinutesZurich` dans
 *  `apps/api/src/common/temps/fuseau-suisse.ts`. */
function decalageMinutesSuisse(instantUtc: Date): number {
  const { annee, mois, jour, heure, minute } = composantesSuisses(instantUtc);
  const relu = Date.UTC(annee, mois - 1, jour, heure, minute);
  return Math.round((relu - instantUtc.getTime()) / 60000);
}

/**
 * Instant UTC correspondant à l'heure MURALE SUISSE `heure:minute` du `jour/mois/annee` civils
 * donnés — sens INVERSE de `composantesSuisses`. MÉTHODE — point fixe par itération (même patron
 * qu'`instantLocalSuisse` dans `apps/api/src/common/temps/fuseau-suisse.ts`, qui documente en
 * détail pourquoi deux itérations suffisent TOUJOURS : le décalage CET/CEST ne prend que deux
 * valeurs, 60 ou 120 minutes, jamais davantage d'écart entre une estimation initiale et la
 * vraie réponse).
 */
function instantSuisseVersUtc(
  annee: number,
  mois: number,
  jour: number,
  heure: number,
  minute: number,
): Date {
  const cible = (): number => Date.UTC(annee, mois - 1, jour, heure, minute, 0, 0);
  let estimationUtc = cible();
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const decalage = decalageMinutesSuisse(new Date(estimationUtc));
    estimationUtc = cible() - decalage * 60000;
  }
  return new Date(estimationUtc);
}

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
 *  FUSEAU HORAIRE : reçoit un instant absolu (ISO, UTC) et le convertit en heure MURALE SUISSE
 *  (Europe/Zurich) — jamais l'heure locale du PROCESSUS qui exécute le code (CI en UTC, poste de
 *  dev à l'étranger, etc. n'affichent pas la même chose que Zurich). Voir `composantesSuisses`. */
export function datetimeVersFormatSuisse(datetime: Date | string | undefined): string {
  if (!datetime) return '';
  const d = typeof datetime === 'string' ? new Date(datetime) : datetime;
  if (Number.isNaN(d.getTime())) return '';

  const { annee, mois, jour, heure, minute } = composantesSuisses(d);
  const jourStr = String(jour).padStart(2, '0');
  const moisStr = String(mois).padStart(2, '0');
  const heureStr = String(heure).padStart(2, '0');
  const minuteStr = String(minute).padStart(2, '0');
  return `${jourStr}.${moisStr}.${annee} ${heureStr}:${minuteStr}`;
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

  // Valide que l'heure est structurellement possible AVANT la validation calendaire ci-dessous —
  // sinon un `24:00` déborderait sur le jour suivant côté `Date.UTC` sans être rejeté ici.
  if (heure < 0 || heure > 23 || minute < 0 || minute > 59) {
    return undefined;
  }

  // Valide que la date existe réellement — comparaison en UTC PUR (Date.UTC), jamais interprétée
  // dans un fuseau (ni celui du PROCESSUS ni celui de la Suisse) : seule la combinatoire
  // calendaire jj/mm/aaaa compte ici, pas un instant réel.
  const dValidation = new Date(Date.UTC(annee, mois - 1, jour, heure, minute));
  if (
    dValidation.getUTCFullYear() !== annee ||
    dValidation.getUTCMonth() !== mois - 1 ||
    dValidation.getUTCDate() !== jour
  ) {
    return undefined; // ex: 31.02.2026 échoue
  }

  // `jj.mm.aaaa HH:MM` est une heure MURALE SUISSE (Europe/Zurich) saisie par le garagiste —
  // JAMAIS l'heure locale du navigateur/PROCESSUS. Le décalage CET/CEST en vigueur CE jour-là
  // (pas celui d'aujourd'hui, pas celui de la machine) est déterminé par point fixe : voir
  // `instantSuisseVersUtc`, même méthode qu'`instantLocalSuisse` côté API.
  return instantSuisseVersUtc(annee, mois, jour, heure, minute).toISOString();
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
