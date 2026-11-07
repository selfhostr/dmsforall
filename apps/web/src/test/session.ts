import {
  PREREGLAGES,
  type CapacitesPersonne,
  type IdPrereglage,
  type RoleUtilisateur,
  type SessionCourante,
} from '@dfa/shared';

// Import relatif vers `apps/api` : réservé aux fixtures de test (jamais au bundle livré).
import { MATRICE_DROITS } from '../../../api/src/auth/matrice-droits';

/** Grille vide d'une borne (profil d'appareil figé, hors grille). */
const CAPACITES_BORNE: CapacitesPersonne = {
  niveaux: {
    atelier: 'rien',
    accueil: 'rien',
    facturation: 'rien',
    pieces: 'rien',
    ventes: 'rien',
    finances: 'rien',
  },
  encadrer: false,
  gererEmployes: false,
  patron: false,
  options: { voitMontants: false, voitPrixAchat: false, avoirsPlafonnes: false },
  prereglage: null,
  personnalisee: false,
};

/** Capacités du préréglage d'un rôle (ce que rend l'API pour une personne non personnalisée). */
export function capacitesDuRole(role: RoleUtilisateur): CapacitesPersonne {
  if (role === 'poste_atelier') return CAPACITES_BORNE;
  const prereglage = PREREGLAGES[role];
  return { ...prereglage.grille, prereglage: prereglage.id as IdPrereglage, personnalisee: false };
}

/** Actions détenues par le préréglage d'un rôle. */
export function actionsDuRole(role: RoleUtilisateur): readonly string[] {
  return [...MATRICE_DROITS[role]].sort();
}

/**
 * Fabrique UNIQUE de session de test : `actions` et `capacites` sont dérivées du préréglage du
 * rôle, jamais écrites à la main. `surcharges` écrase des champs de premier niveau.
 */
export function creerSessionTest(
  role: RoleUtilisateur = 'chef_atelier',
  surcharges: Partial<SessionCourante> = {},
): SessionCourante {
  return {
    utilisateur: {
      id: 'utilisateur-1',
      email: 'jean.dupont@garage.ch',
      prenom: 'Jean',
      nom: 'Dupont',
      role,
      langue: 'fr',
    },
    tenant: {
      id: 'tenant-1',
      slug: 'garage-test',
      raisonSociale: 'Garage Test SA',
      langueDefaut: 'fr',
    },
    sites: [{ id: 'site-1', code: 'PRINCIPAL', nom: 'Site principal', actif: true }],
    siteRattachementId: role === 'poste_atelier' ? 'site-1' : null,
    actions: actionsDuRole(role),
    capacites: capacitesDuRole(role),
    expireLe: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ...surcharges,
  };
}

/**
 * Filet pour les specs qui dérivent une session de `SESSION_TEST` en changeant seulement le rôle
 * (`{ ...SESSION_TEST, utilisateur: { ..., role: 'technicien' } }`) : les `actions` copiées sont
 * celles du rôle de départ. Si elles sont celles d'un AUTRE préréglage (ou vides), on les
 * recalcule pour le rôle annoncé. Des actions sur mesure (aucun préréglage) restent intactes.
 */
export function normaliserSessionDeTest(corps: unknown): unknown {
  if (typeof corps !== 'object' || corps === null) return corps;
  const c = corps as Partial<SessionCourante>;
  const role = c.utilisateur?.role;
  if (role === undefined || !(role in MATRICE_DROITS) || !Array.isArray(c.actions)) return corps;
  const cle = JSON.stringify([...c.actions].sort());
  const estPreset = (Object.keys(MATRICE_DROITS) as RoleUtilisateur[]).some(
    (r) => JSON.stringify(actionsDuRole(r)) === cle,
  );
  if (c.actions.length > 0 && !estPreset) return corps;
  return { ...c, actions: actionsDuRole(role), capacites: capacitesDuRole(role) };
}
