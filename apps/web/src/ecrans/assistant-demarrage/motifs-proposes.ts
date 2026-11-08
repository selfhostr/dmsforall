import type { Langue } from '@dfa/shared';

/**
 * Motifs de rendez-vous proposés au garage neuf. Ce sont des DONNÉES de référence (enregistrées en
 * base, dans les trois langues), pas du texte d'interface : le garagiste les renomme ensuite dans
 * Réglages. Le `code` est immuable côté serveur (cité dans les documents).
 */
export interface MotifPropose {
  readonly code: string;
  readonly libelle: Readonly<Record<Langue, string>>;
  readonly dureeMinutes: number;
}

export const MOTIFS_PROPOSES: readonly MotifPropose[] = [
  {
    code: 'SERVICE',
    libelle: { fr: 'Service / entretien', de: 'Service / Wartung', it: 'Tagliando / manutenzione' },
    dureeMinutes: 120,
  },
  {
    code: 'EXPERTISE-MFK',
    libelle: { fr: 'Expertise (MFK)', de: 'Prüfung (MFK)', it: 'Collaudo (MFK)' },
    dureeMinutes: 60,
  },
  {
    code: 'PNEUS',
    libelle: { fr: 'Changement de pneus', de: 'Reifenwechsel', it: 'Cambio gomme' },
    dureeMinutes: 60,
  },
  {
    code: 'FREINS',
    libelle: { fr: 'Freins', de: 'Bremsen', it: 'Freni' },
    dureeMinutes: 120,
  },
  {
    code: 'DIAGNOSTIC',
    libelle: { fr: 'Diagnostic / panne', de: 'Diagnose / Panne', it: 'Diagnosi / guasto' },
    dureeMinutes: 60,
  },
  {
    code: 'CLIMATISATION',
    libelle: { fr: 'Climatisation', de: 'Klimaanlage', it: 'Climatizzazione' },
    dureeMinutes: 60,
  },
  {
    code: 'CARROSSERIE',
    libelle: { fr: 'Carrosserie', de: 'Karosserie', it: 'Carrozzeria' },
    dureeMinutes: 240,
  },
  {
    code: 'DEVIS',
    libelle: { fr: 'Devis', de: 'Offerte', it: 'Preventivo' },
    dureeMinutes: 30,
  },
];

/** Motifs à créer : cochés ET pas déjà en base (un code existant, actif ou non, n'est jamais recréé). */
export function motifsACreer(
  selection: ReadonlySet<string>,
  codesExistants: ReadonlySet<string>,
): readonly MotifPropose[] {
  return MOTIFS_PROPOSES.filter((m) => selection.has(m.code) && !codesExistants.has(m.code));
}
