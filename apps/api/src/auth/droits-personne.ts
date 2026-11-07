/**
 * Droits effectifs d'une PERSONNE — le seul endroit qui transforme (rôle, grille) en décisions.
 *
 * Trois entrées, du plus explicite au plus pratique :
 *  - `droitsDe(role, grille?)` : pur ; sans grille, le préréglage du rôle (comportement historique) ;
 *  - `droitsDuPrincipal(principal)` : la grille rechargée de la base pour cette requête ;
 *  - `droitsCourants(role)` : pour les fonctions pures qui ne reçoivent qu'un `role` (mappers de
 *    montants, aides des services). Si le principal de la requête en cours porte CE rôle, ce sont
 *    SES droits ; sinon (tâche de fond, test, rôle d'une autre personne) le préréglage du rôle.
 *    Ce chemin n'élargit jamais : il ne fait que préciser le préréglage par la grille réelle.
 *
 * Fail-closed : un rôle inconnu n'a aucune action ; la borne a son profil figé quelle que soit la
 * grille stockée.
 */
import {
  PREREGLAGES,
  capacitesDeLaGrille,
  type Capacite,
  type GrilleCapacites,
  type RoleUtilisateur,
} from '@dfa/shared';

import { ErreurMetier } from '../common/erreurs';
import { principalDeLaRequeteCourante } from '../common/contexte/contexte-requete.service';
import { ACTIONS_PROFIL_BORNE, actionsDeLaGrille, type Action } from './matrice-droits';

export interface DroitsPersonne {
  readonly actions: readonly Action[];
  readonly aLeDroit: (action: Action) => boolean;
  /** Capacités internes (vide pour la borne). */
  readonly capacites: ReadonlySet<Capacite>;
  /** Option « voit les montants » (prix de vente, totaux, marges de l'atelier). */
  readonly voitMontants: boolean;
  /** Option « voit les prix d'achat et marges » (pièces). */
  readonly voitPrixAchat: boolean;
}

const DROITS_BORNE: DroitsPersonne = construire(ACTIONS_PROFIL_BORNE, new Set(), false, false);
const DROITS_AUCUN: DroitsPersonne = construire([], new Set(), false, false);
const CACHE_PREREGLAGES = new Map<RoleUtilisateur, DroitsPersonne>();

function construire(
  actions: readonly Action[],
  capacites: ReadonlySet<Capacite>,
  voitMontants: boolean,
  voitPrixAchat: boolean,
): DroitsPersonne {
  const ensemble = new Set<Action>(actions);
  return {
    actions,
    aLeDroit: (action) => ensemble.has(action),
    capacites,
    voitMontants,
    voitPrixAchat,
  };
}

function depuisGrille(grille: GrilleCapacites): DroitsPersonne {
  return construire(
    actionsDeLaGrille(grille),
    capacitesDeLaGrille(grille),
    grille.options.voitMontants,
    grille.options.voitPrixAchat,
  );
}

/** Droits d'une personne. `grille` absente : préréglage du rôle. */
export function droitsDe(role: RoleUtilisateur, grille?: GrilleCapacites): DroitsPersonne {
  if (role === 'poste_atelier') return DROITS_BORNE;
  if (grille) return depuisGrille(grille);
  const connu = CACHE_PREREGLAGES.get(role);
  if (connu) return connu;
  const prereglage = (PREREGLAGES as Partial<Record<string, (typeof PREREGLAGES)['admin']>>)[role];
  const droits = prereglage ? depuisGrille(prereglage.grille) : DROITS_AUCUN;
  CACHE_PREREGLAGES.set(role, droits);
  return droits;
}

export function droitsDuPrincipal(principal: {
  readonly role: RoleUtilisateur;
  readonly capacites?: GrilleCapacites;
}): DroitsPersonne {
  return droitsDe(principal.role, principal.capacites);
}

/** Voir l'en-tête : droits de la requête en cours si elle porte ce rôle, sinon le préréglage. */
export function droitsCourants(role: RoleUtilisateur): DroitsPersonne {
  const principal = principalDeLaRequeteCourante();
  if (principal && principal.role === role) return droitsDuPrincipal(principal);
  return droitsDe(role);
}

/** Actions détenues — remplace `MATRICE_DROITS[role] ?? []` dans les services. */
export function actionsCourantes(role: RoleUtilisateur): readonly Action[] {
  return droitsCourants(role).actions;
}

/** `true` si le rôle (de la requête en cours) voit les montants de l'atelier. */
export function voitLesMontants(role: RoleUtilisateur): boolean {
  return droitsCourants(role).voitMontants;
}

/**
 * Montants de FACTURATION : l'option ET un niveau Facturation (au moins Voir). Le compte technique
 * `admin` lit la liste des documents (via Encadrer) mais n'a aucun niveau Facturation : ses
 * montants restent masqués (RF-115/RF-116).
 */
export function voitLesMontantsDeFacturation(role: RoleUtilisateur): boolean {
  return droitsCourants(role).capacites.has('facturation.montants');
}

/** `true` si le rôle (de la requête en cours) voit les prix d'achat et marges des pièces. */
export function voitLesPrixAchat(role: RoleUtilisateur): boolean {
  return droitsCourants(role).voitPrixAchat;
}

/** `true` si le rôle (de la requête en cours) détient la capacité interne `capacite`. */
export function aLaCapacite(role: RoleUtilisateur, capacite: Capacite): boolean {
  return droitsCourants(role).capacites.has(capacite);
}

/** Lève `403 DROIT_INSUFFISANT` si le rôle ne détient pas `capacite` (garde de service). */
export function exigerCapacite(role: RoleUtilisateur, capacite: Capacite, nomAction: string): void {
  if (!aLaCapacite(role, capacite)) {
    throw new ErreurMetier(
      'DROIT_INSUFFISANT',
      `Le rôle "${role}" n'a pas accès à "${nomAction}".`,
    );
  }
}
