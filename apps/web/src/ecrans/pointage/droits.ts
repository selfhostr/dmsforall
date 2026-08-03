import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance du module pointage — DUPLIQUÉE ici depuis `apps/api/src/auth/matrice-droits.ts`
 * (bloc `DROITS_POINTAGE_PAR_ROLE`), jamais importée depuis `apps/api` (frontière tenant/serveur,
 * jamais franchie — même règle que `ecrans/pieces/droits.ts`). Un défensif d'ERGONOMIE, pas la
 * seule ligne de défense : le serveur reste l'arbitre final (`403 DROIT_INSUFFISANT` normal sur
 * tout appel qui parviendrait quand même).
 *
 * Table lue le 2026-08-03 dans `matrice-droits.ts` (bloc `DROITS_POINTAGE_PAR_ROLE`, lignes
 * ~1260-1292), PAS déduite de la spécification (qui ne fige pas cette table elle-même) :
 *  - `atelier.pointage.lire` / `.demarrer` / `.arreter` : `chef_atelier`, `direction`, `admin`,
 *    `technicien`, `magasinier`. Ni `comptable`, ni `receptionnaire`, ni `vendeur` — le pointage
 *    n'est pas leur outil.
 *  - `atelier.pointage.corriger_autrui` / `.verrouiller_periode` / `.deverrouiller_periode` :
 *    `chef_atelier`, `direction`, `admin` SEULS — `comptable` explicitement écarté des deux
 *    dernières (arbitrage @laupernoe du 2026-08-03, documenté en tête de `DROITS_POINTAGE_PAR_ROLE` :
 *    clore/rouvrir une période de pointage est une décision d'ATELIER, pas un geste comptable).
 *
 * Pas de notion distincte « vue équipe » dans la matrice de droits : `atelier.pointage.lire_equipe`
 * n'est PAS une action exposée (voir l'en-tête de `pointage.api.ts` — c'est une liste serveur
 * LOCALE, `ROLES_AVEC_VUE_EQUIPE_POINTAGE`, appliquée dans `ServicePointage.lister`, jamais un
 * droit dans `matrice-droits.ts`). `peutVoirEquipePointage` ci-dessous EN INFÈRE le même
 * périmètre que la correction (`chef_atelier`/`direction`/`admin`) parce que la spécification ne
 * distingue pas non plus « voir les pointages d'autrui » de « les corriger » — à confirmer avec
 * expert-metier si un rôle devait un jour voir sans pouvoir corriger.
 */
const ROLES_LECTURE_POINTAGE: ReadonlySet<RoleUtilisateur> = new Set([
  'chef_atelier',
  'direction',
  'admin',
  'technicien',
  'magasinier',
]);

/** `demarrer`/`arreter` portent EXACTEMENT le même périmètre que `lire` dans la matrice — un rôle
 *  qui peut pointer peut nécessairement lire ses propres pointages, et réciproquement ici. */
const ROLES_ECRITURE_POINTAGE = ROLES_LECTURE_POINTAGE;

/** `corriger_autrui`, `verrouiller_periode`, `deverrouiller_periode` — encadrement seul. */
const ROLES_GOUVERNANCE_POINTAGE: ReadonlySet<RoleUtilisateur> = new Set(['chef_atelier', 'direction', 'admin']);

export function peutLirePointage(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_LECTURE_POINTAGE.has(role);
}

export function peutDemarrerPointage(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ECRITURE_POINTAGE.has(role);
}

export function peutArreterPointage(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ECRITURE_POINTAGE.has(role);
}

/** Voir INFÉRENCE ci-dessus : même périmètre que `peutCorrigerPointage`. */
export function peutVoirEquipePointage(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_GOUVERNANCE_POINTAGE.has(role);
}

export function peutCorrigerPointage(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_GOUVERNANCE_POINTAGE.has(role);
}

export function peutVerrouillerPeriode(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_GOUVERNANCE_POINTAGE.has(role);
}

export function peutDeverrouillerPeriode(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_GOUVERNANCE_POINTAGE.has(role);
}

/** Pour `RouteProtegee.rolesAutorises` (`routes/droits-routes.ts` — hors périmètre d'écriture de
 *  ce module, table transmise au coordinateur pour le câblage). Reflète une restriction RÉELLE de
 *  l'API (`atelier.pointage.lire` fermé à `comptable`/`receptionnaire`/`vendeur`), même patron que
 *  `ROLES_PIECES`. */
export const ROLES_POINTAGE: readonly RoleUtilisateur[] = ['chef_atelier', 'direction', 'admin', 'technicien', 'magasinier'];

/** Pour les routes réservées à l'encadrement (équipe, corrections, clôture de période). */
export const ROLES_POINTAGE_ENCADREMENT: readonly RoleUtilisateur[] = ['chef_atelier', 'direction', 'admin'];
