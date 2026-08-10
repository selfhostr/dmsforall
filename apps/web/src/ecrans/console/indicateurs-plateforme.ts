import {
  AlertOctagon,
  BellOff,
  Lock,
  Receipt,
  ShieldAlert,
  Timer,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { GarageConsole } from '@dfa/shared';

/**
 * Un indicateur retenu par `docs/conception-console-exploitation-ecrans.md` §2.1, RECALÉ sur ce
 * que le contrat réel (`GarageConsole`, `@dfa/shared`) permet effectivement de calculer. Chacun
 * appelle un geste (filtrer la table), aucun n'est un chiffre décoratif (§0 : « un indicateur qu'on
 * regarde et qu'on oublie n'a rien à faire ici »).
 *
 * Trois indicateurs de la conception ont disparu d'ici, PAS remplacés par un zéro : `erreurs24h`,
 * `jobsEnEchec` et `disjoncteursOuverts` ne sont pas des mesures PAR GARAGE dans ce contrat (rien,
 * dans aucune table, ne rattache une erreur serveur ou un disjoncteur à un tenant) — ils vivent au
 * niveau plateforme dans `resume.indicateursIndisponibles` (`IndicateurIndisponibleConsole`,
 * `@dfa/shared`) et sont affichés à part, comme « non mesuré », par `IndicateursPlateformeConsole`.
 * Un quatrième, `documentsEnSilence` (devis jamais transformés + OR jamais clôturés + factures
 * jamais relancées), n'a AUCUN équivalent dans le contrat, ni comme champ ni comme indicateur
 * indisponible déclaré : cette notion n'existe pas encore côté API, elle a donc été retirée plutôt
 * que devinée depuis des champs voisins (`ordresReparationActifs`, `facturesEmisesImpayees`
 * mesurent autre chose : un compte d'actifs/impayées, pas un silence anormal).
 */
export const IDS_INDICATEURS_CONSOLE = [
  'garagesCritiques',
  'garageSuspendu',
  'comptesVerrouilles',
  'aucuneConnexion',
  'exportComptableEnEchec',
  'relancesEnRetard',
  'relancesEnvoisEchoues',
  'moduleInactif',
] as const;

export type IdIndicateurConsole = (typeof IDS_INDICATEURS_CONSOLE)[number];

export interface DefinitionIndicateurConsole {
  readonly id: IdIndicateurConsole;
  readonly icone: LucideIcon;
  /**
   * Une seule fonction sert trois usages : la carte affiche `somme(mesure(garage))` sur
   * l'ensemble des garages (total plateforme — pour `comptesVerrouilles`/`relancesEnRetard`/
   * `relancesEnvoisEchoues`/`moduleInactif`, une vraie somme d'occurrences ; pour les autres,
   * `mesure` ne rend que 0 ou 1, donc la somme EST le compte de garages concernés) ; le filtre de
   * table retient les garages où `mesure(garage) > 0` ; le badge « Statut : Critique » du
   * sélecteur toolbar est indépendant (colonne `niveau`, pas un indicateur de cette liste). Une
   * seule source de vérité plutôt que deux implémentations (carte + filtre) qui pourraient
   * diverger.
   */
  readonly mesure: (garage: GarageConsole) => number;
}

function possedeAlerte(garage: GarageConsole, code: GarageConsole['alertes'][number]['code']) {
  return garage.alertes.some((alerte) => alerte.code === code);
}

/** Ordre = ordre d'affichage des cartes, repris de la conception §2.1 (santé technique d'abord,
 *  santé d'usage ensuite), dans la limite de ce qui est mesurable par garage (voir le commentaire
 *  d'en-tête). */
export const DEFINITIONS_INDICATEURS_CONSOLE: readonly DefinitionIndicateurConsole[] = [
  {
    id: 'garagesCritiques',
    icone: ShieldAlert,
    mesure: (garage) => (garage.niveau === 'critique' ? 1 : 0),
  },
  {
    id: 'garageSuspendu',
    icone: AlertOctagon,
    // Même définition que l'alerte serveur `garage_suspendu` (§ enums.ts, CODES_ALERTE_GARAGE) :
    // un tenant `suspendu` OU `resilie`, jamais `actif`.
    mesure: (garage) => (garage.statut !== 'actif' ? 1 : 0),
  },
  {
    id: 'comptesVerrouilles',
    icone: Lock,
    mesure: (garage) => garage.comptesVerrouilles,
  },
  {
    id: 'aucuneConnexion',
    icone: Timer,
    mesure: (garage) =>
      possedeAlerte(garage, 'aucune_connexion_recente') ||
      possedeAlerte(garage, 'aucune_connexion_jamais')
        ? 1
        : 0,
  },
  {
    id: 'exportComptableEnEchec',
    icone: Receipt,
    mesure: (garage) => (garage.dernierExportComptableStatut === 'rejete' ? 1 : 0),
  },
  {
    id: 'relancesEnRetard',
    icone: BellOff,
    // Relances planifiées dont l'échéance est passée et toujours pas parties — mode de panne réel
    // du produit : aucun ordonnanceur n'existe, l'envoi est manuel (voir le contrat partagé).
    mesure: (garage) => garage.relancesPlanifieesEnRetard,
  },
  {
    id: 'relancesEnvoisEchoues',
    icone: BellOff,
    mesure: (garage) => garage.relancesEnvoisEchoues7j,
  },
  {
    id: 'moduleInactif',
    icone: Wrench,
    mesure: (garage) =>
      garage.alertes.filter((alerte) => alerte.code === 'module_silencieux').length,
  },
];

export interface ValeurIndicateurConsole extends DefinitionIndicateurConsole {
  readonly total: number;
}

/** Total plateforme par indicateur, calculé sur la liste COMPLÈTE (jamais sur une liste déjà
 *  filtrée) — les cartes restent des compteurs stables pendant qu'on filtre la table en dessous,
 *  exactement comme le mockup de la conception (§2) les montre figées. */
export function calculerIndicateursConsole(
  garages: readonly GarageConsole[],
): readonly ValeurIndicateurConsole[] {
  return DEFINITIONS_INDICATEURS_CONSOLE.map((definition) => ({
    ...definition,
    total: garages.reduce((somme, garage) => somme + definition.mesure(garage), 0),
  }));
}

/** Un garage « correspond » à un indicateur quand sa mesure est strictement positive — un module
 *  silencieux compte une fois, quatre modules silencieux comptent toujours comme UN garage à
 *  traiter, pas quatre : cohérent avec le geste que l'indicateur appelle (« aller voir ce garage »),
 *  pas avec le compte brut d'occurrences (déjà affiché tel quel dans la carte via `total`). */
export function garageCorrespondAIndicateur(
  garage: GarageConsole,
  id: IdIndicateurConsole,
): boolean {
  const definition = DEFINITIONS_INDICATEURS_CONSOLE.find((candidat) => candidat.id === id);
  return definition !== undefined && definition.mesure(garage) > 0;
}
