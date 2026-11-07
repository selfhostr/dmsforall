import type { ReponseEtatDemarrage } from '@dfa/shared';

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
 * `inconnu` n'est PAS `aFaire` : l'appel qui n'a pas répondu (refus de droit, erreur réseau) ne
 * prouve pas que l'étape manque — l'afficher « à faire » enverrait la patronne refaire un réglage
 * déjà fait. Le serveur, lui, rend toujours des booléens définitifs.
 */
export type EtatEtapeDemarrage = 'fait' | 'aFaire' | 'inconnu';

export interface EtapeDemarrage {
  readonly id: IdEtapeDemarrage;
  readonly etat: EtatEtapeDemarrage;
  /** Une étape facultative ne retient pas la liste affichée une fois le reste réglé. */
  readonly facultative: boolean;
}

/** Clé de `GET /accueil/etat-demarrage` pour chaque étape de l'écran. */
const CLE_SERVEUR: Readonly<Record<IdEtapeDemarrage, keyof ReponseEtatDemarrage['etapes']>> = {
  coordonnees: 'coordonnees',
  compte: 'iban',
  tva: 'numeroTva',
  tauxHoraire: 'tauxHoraire',
  motifs: 'motifsRdv',
  collaborateur: 'premierCollaborateur',
  borne: 'borne',
};

/** `undefined` = l'appel n'a pas (ou pas encore) répondu : tout est « inconnu ». */
export function calculerEtapesDemarrage(
  etat: ReponseEtatDemarrage | undefined,
): readonly EtapeDemarrage[] {
  return IDS_ETAPES_DEMARRAGE.map((id) => {
    const fait = etat?.etapes[CLE_SERVEUR[id]];
    return {
      id,
      etat: fait === undefined ? 'inconnu' : fait ? 'fait' : 'aFaire',
      facultative: id === 'borne',
    };
  });
}

/** La liste disparaît d'elle-même quand toutes les étapes obligatoires sont faites. */
export function demarrageComplet(etapes: readonly EtapeDemarrage[]): boolean {
  return etapes.every((e) => e.facultative || e.etat === 'fait');
}
