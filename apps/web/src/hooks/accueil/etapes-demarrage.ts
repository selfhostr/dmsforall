import type { ModuleApp, ReponseEtatDemarrage } from '@dfa/shared';

import { moduleActif } from '@/composants/layout/navigation-modele';

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
  /** Une étape facultative (borne, n° TVA) ne retient pas la liste affichée une fois le reste réglé. */
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

/**
 * Module du garage dont dépend une étape (Réglages > Modules) : un module retiré retire son étape.
 * Absent : étape du socle (facturation, équipe), toujours proposée.
 */
const MODULE_PAR_ETAPE: Readonly<Partial<Record<IdEtapeDemarrage, ModuleApp>>> = {
  tauxHoraire: 'atelier',
  motifs: 'planning',
  borne: 'tablettes',
};

/**
 * `undefined` = l'appel n'a pas (ou pas encore) répondu : tout est « inconnu ». `modulesActifs`
 * `undefined` = liste inconnue : aucune étape n'est retirée.
 */
export function calculerEtapesDemarrage(
  etat: ReponseEtatDemarrage | undefined,
  modulesActifs?: readonly ModuleApp[],
): readonly EtapeDemarrage[] {
  return IDS_ETAPES_DEMARRAGE.filter((id) => moduleActif(MODULE_PAR_ETAPE[id], modulesActifs)).map(
    (id) => {
    const fait = etat?.etapes[CLE_SERVEUR[id]];
    return {
      id,
      etat: fait === undefined ? 'inconnu' : fait ? 'fait' : 'aFaire',
      // La borne et le n° TVA sont facultatifs : un garage non assujetti n'a pas de numéro.
      // (L'API n'expose aucun champ « assujetti » : `numeroTva` vide = non assujetti OU pas saisi.)
      facultative: id === 'borne' || id === 'tva',
    };
    },
  );
}

/** La liste disparaît d'elle-même quand toutes les étapes obligatoires sont faites. */
export function demarrageComplet(etapes: readonly EtapeDemarrage[]): boolean {
  return etapes.every((e) => e.facultative || e.etat === 'fait');
}
