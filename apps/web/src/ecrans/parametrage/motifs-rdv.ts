import {
  schemaCreationMotifRendezVous,
  schemaModificationMotifRendezVous,
  type EntreeCreationMotifRendezVous,
  type EntreeModificationMotifRendezVous,
} from '@dfa/shared';

/** Saisie brute du dialogue : tout est texte, la conversion se fait ici et nulle part ailleurs. */
export interface SaisieMotifRendezVous {
  readonly libelleFr: string;
  readonly libelleDe: string;
  readonly libelleIt: string;
  /** Minutes entières (« 60 »), vide = pas de durée par défaut. */
  readonly dureeMinutes: string;
  /** Heures décimales (« 1.5 » ou « 1,5 »), vide = aucune. Stocké en centièmes d'heure. */
  readonly heuresAtelier: string;
}

export type ChampMotifRendezVous = 'libelleFr' | 'dureeMinutes' | 'heuresAtelier';

export type ResultatMotif<T> =
  | { readonly ok: true; readonly entree: T }
  | { readonly ok: false; readonly champ: ChampMotifRendezVous };

/**
 * Code technique dérivé du libellé : le garagiste ne saisit jamais de « code » (jargon IT). Majuscules
 * sans accents, séparateurs en tirets, 40 caractères au plus (borne du contrat). Vide si le
 * libellé ne contient aucun caractère exploitable.
 */
export function codeDepuisLibelle(libelle: string): string {
  return libelle
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

function entierPositif(texte: string): number | null | 'invalide' {
  const t = texte.trim();
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return 'invalide';
  return Number(t);
}

function heuresVersCentiemes(texte: string): number | null | 'invalide' {
  const t = texte.trim().replace(',', '.');
  if (t === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'invalide';
  return Math.round(Number(t) * 100);
}

export function centiemesVersHeures(centiemes: number | null): string {
  return centiemes === null ? '' : String(centiemes / 100);
}

function texteOuNull(texte: string): string | null {
  const t = texte.trim();
  return t === '' ? null : t;
}

function champEnErreur(
  issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey> }>,
): ChampMotifRendezVous {
  const chemin = issues[0]?.path[0];
  if (chemin === 'dureeDefautMinutes') return 'dureeMinutes';
  if (chemin === 'heuresAtelierDefautCentiemes') return 'heuresAtelier';
  return 'libelleFr';
}

function convertirDurees(
  saisie: SaisieMotifRendezVous,
):
  | { dureeDefautMinutes: number | null; heuresAtelierDefautCentiemes: number | null }
  | ChampMotifRendezVous {
  const duree = entierPositif(saisie.dureeMinutes);
  if (duree === 'invalide') return 'dureeMinutes';
  const heures = heuresVersCentiemes(saisie.heuresAtelier);
  if (heures === 'invalide') return 'heuresAtelier';
  return { dureeDefautMinutes: duree, heuresAtelierDefautCentiemes: heures };
}

export function construireCreation(
  saisie: SaisieMotifRendezVous,
): ResultatMotif<EntreeCreationMotifRendezVous> {
  const durees = convertirDurees(saisie);
  if (typeof durees === 'string') return { ok: false, champ: durees };
  const resultat = schemaCreationMotifRendezVous.safeParse({
    code: codeDepuisLibelle(saisie.libelleFr),
    libelleFr: saisie.libelleFr,
    libelleDe: texteOuNull(saisie.libelleDe),
    libelleIt: texteOuNull(saisie.libelleIt),
    ...durees,
  });
  return resultat.success
    ? { ok: true, entree: resultat.data }
    : { ok: false, champ: champEnErreur(resultat.error.issues) };
}

export function construireModification(
  saisie: SaisieMotifRendezVous,
): ResultatMotif<EntreeModificationMotifRendezVous> {
  const durees = convertirDurees(saisie);
  if (typeof durees === 'string') return { ok: false, champ: durees };
  const resultat = schemaModificationMotifRendezVous.safeParse({
    libelleFr: saisie.libelleFr,
    libelleDe: texteOuNull(saisie.libelleDe),
    libelleIt: texteOuNull(saisie.libelleIt),
    ...durees,
  });
  return resultat.success
    ? { ok: true, entree: resultat.data }
    : { ok: false, champ: champEnErreur(resultat.error.issues) };
}
