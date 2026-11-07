/**
 * Données de départ d'un garage NEUF, posées par `creer-garage` (`cli/creer-garage.service.ts`) et
 * par la migration `0079_garage_neuf_defauts.sql` pour les garages déjà installés. Les valeurs de
 * la migration SQL doivent rester alignées avec celles-ci (une spec le vérifie).
 *
 * Tout est modifiable ensuite par le garage (Réglages) : ce sont des points de départ, pas des
 * règles. Les paramètres atelier (`parametre_atelier`, `parametre_site`) n'y figurent pas : toutes
 * leurs colonnes ont une valeur par défaut en base, la ligne est donc créée vide.
 */

export const CODE_TAUX_HORAIRE_ATELIER = 'ATELIER';

/** CHF 140.00 de l'heure, valable depuis le 01.01.2020 sans date de fin. */
export const TAUX_HORAIRE_ATELIER_DEFAUT = {
  code: CODE_TAUX_HORAIRE_ATELIER,
  libelle: 'Taux horaire atelier',
  montantCentimes: 14000,
  valideDu: '2020-01-01',
} as const;

export interface MotifRendezVousParDefaut {
  readonly code: string;
  readonly libelleFr: string;
  readonly libelleDe: string;
  readonly libelleIt: string;
  readonly dureeDefautMinutes: number;
}

/** Motifs courants d'un garage suisse, durées en minutes (créneau au comptoir). */
export const MOTIFS_RENDEZ_VOUS_PAR_DEFAUT: readonly MotifRendezVousParDefaut[] = [
  {
    code: 'SERVICE',
    libelleFr: 'Entretien / service courant',
    libelleDe: 'Service / Wartung',
    libelleIt: 'Tagliando / manutenzione',
    dureeDefautMinutes: 90,
  },
  {
    code: 'PNEUS',
    libelleFr: 'Changement de pneus saisonnier',
    libelleDe: 'Saisonaler Reifenwechsel',
    libelleIt: 'Cambio pneumatici stagionale',
    dureeDefautMinutes: 45,
  },
  {
    code: 'EXPERTISE-MFK',
    libelleFr: 'Préparation et passage à l’expertise (MFK)',
    libelleDe: 'MFK-Vorbereitung und Vorführung',
    libelleIt: 'Preparazione e passaggio al collaudo (MFK)',
    dureeDefautMinutes: 120,
  },
  {
    code: 'FREINS',
    libelleFr: 'Freins',
    libelleDe: 'Bremsen',
    libelleIt: 'Freni',
    dureeDefautMinutes: 120,
  },
  {
    code: 'DIAGNOSTIC',
    libelleFr: 'Diagnostic / recherche de panne',
    libelleDe: 'Diagnose / Fehlersuche',
    libelleIt: 'Diagnosi / ricerca guasto',
    dureeDefautMinutes: 60,
  },
  {
    code: 'CARROSSERIE',
    libelleFr: 'Carrosserie / devis',
    libelleDe: 'Karosserie / Offerte',
    libelleIt: 'Carrozzeria / preventivo',
    dureeDefautMinutes: 30,
  },
  {
    code: 'CLIMATISATION',
    libelleFr: 'Climatisation',
    libelleDe: 'Klimaanlage',
    libelleIt: 'Climatizzazione',
    dureeDefautMinutes: 60,
  },
  {
    code: 'AUTRE',
    libelleFr: 'Autre / à déterminer',
    libelleDe: 'Andere / zu bestimmen',
    libelleIt: 'Altro / da determinare',
    dureeDefautMinutes: 60,
  },
];

/** Code du site créé avec le garage : le nom du garage en majuscules, sans accents (≤ 24 car.). */
export function codeSiteParDefaut(slug: string): string {
  return slug.toUpperCase().slice(0, 24).replace(/-+$/g, '');
}
