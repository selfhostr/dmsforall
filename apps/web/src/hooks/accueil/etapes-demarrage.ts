import type { ReponseBlocCreancier, ReponseMotifRendezVous, UtilisateurResume } from '@dfa/shared';

/** Identifiants stables des étapes : servent de clés i18n (`accueil:demarrage.etapes.<id>`). */
export const IDS_ETAPES_DEMARRAGE = [
  'coordonnees',
  'compte',
  'tva',
  'tauxHoraire',
  'motifs',
  'collaborateur',
  'borne',
] as const;
export type IdEtapeDemarrage = (typeof IDS_ETAPES_DEMARRAGE)[number];

/**
 * `inconnu` n'est PAS `aFaire` : une source qui n'a pas répondu (refus de droit, erreur réseau)
 * ne prouve pas que l'étape manque — l'afficher « à faire » enverrait la patronne refaire un
 * réglage déjà fait.
 */
export type EtatEtapeDemarrage = 'fait' | 'aFaire' | 'inconnu';

export interface EtapeDemarrage {
  readonly id: IdEtapeDemarrage;
  readonly etat: EtatEtapeDemarrage;
  /** Une étape facultative ne retient pas la liste affichée une fois le reste réglé. */
  readonly facultative: boolean;
}

/** `undefined` = source pas (ou pas encore) lue. */
export interface DonneesDemarrage {
  readonly creancier: ReponseBlocCreancier | undefined;
  readonly numeroTva: string | null | undefined;
  readonly nbTauxHoraires: number | undefined;
  readonly motifs: readonly ReponseMotifRendezVous[] | undefined;
  readonly utilisateurs: readonly UtilisateurResume[] | undefined;
  readonly nbBornes: number | undefined;
  readonly utilisateurCourantId: string | undefined;
}

const rempli = (valeur: string | null | undefined): boolean =>
  valeur !== null && valeur !== undefined && valeur.trim() !== '';

function etat(fait: boolean | undefined): EtatEtapeDemarrage {
  if (fait === undefined) return 'inconnu';
  return fait ? 'fait' : 'aFaire';
}

export function calculerEtapesDemarrage(donnees: DonneesDemarrage): readonly EtapeDemarrage[] {
  const { creancier } = donnees;
  const coordonnees =
    creancier === undefined
      ? undefined
      : rempli(creancier.nom) &&
        rempli(creancier.rue) &&
        rempli(creancier.npa) &&
        rempli(creancier.localite);
  const compte =
    creancier === undefined ? undefined : rempli(creancier.iban) || rempli(creancier.qrIban);
  const collaborateur =
    donnees.utilisateurs === undefined
      ? undefined
      : donnees.utilisateurs.some((u) => u.id !== donnees.utilisateurCourantId);

  return [
    { id: 'coordonnees', etat: etat(coordonnees), facultative: false },
    { id: 'compte', etat: etat(compte), facultative: false },
    {
      id: 'tva',
      etat: etat(donnees.numeroTva === undefined ? undefined : rempli(donnees.numeroTva)),
      facultative: false,
    },
    {
      id: 'tauxHoraire',
      etat: etat(donnees.nbTauxHoraires === undefined ? undefined : donnees.nbTauxHoraires > 0),
      facultative: false,
    },
    {
      id: 'motifs',
      etat: etat(donnees.motifs === undefined ? undefined : donnees.motifs.some((m) => m.actif)),
      facultative: false,
    },
    { id: 'collaborateur', etat: etat(collaborateur), facultative: false },
    {
      id: 'borne',
      etat: etat(donnees.nbBornes === undefined ? undefined : donnees.nbBornes > 0),
      facultative: true,
    },
  ];
}

/** La liste disparaît d'elle-même quand toutes les étapes obligatoires sont faites. */
export function demarrageComplet(etapes: readonly EtapeDemarrage[]): boolean {
  return etapes.every((e) => e.facultative || e.etat === 'fait');
}
