import {
  DOMAINES_CAPACITE,
  IDS_PREREGLAGE,
  NIVEAUX_ACCES,
  OPTIONS_PERSONNE,
  PREREGLAGES,
  type CapacitesPersonne,
  type IdPrereglage,
  type ModeleCapacites,
} from '@dfa/shared';

/** Réponse de `GET /capacites/modele` pour les specs — même forme que le serveur
 *  (`apps/api/src/auth/modele-capacites.ts`), construite depuis les préréglages partagés. */
export function modeleCapacitesDeTest(): ModeleCapacites {
  return {
    domaines: DOMAINES_CAPACITE.map((id) => ({
      id,
      libelleCle: `capacites.domaines.${id}.libelle`,
      descriptionCle: `capacites.domaines.${id}.description`,
      exemplesCles: [1, 2, 3, 4].map((i) => `capacites.domaines.${id}.exemples.${String(i)}`),
    })),
    niveaux: NIVEAUX_ACCES.map((id) => ({ id, libelleCle: `capacites.niveaux.${id}` })),
    options: OPTIONS_PERSONNE.map((id) => ({
      id,
      libelleCle: `capacites.options.${id}.libelle`,
      descriptionCle: `capacites.options.${id}.description`,
    })),
    encadrer: {
      libelleCle: 'capacites.encadrer.libelle',
      descriptionCle: 'capacites.encadrer.description',
    },
    gererEmployes: {
      libelleCle: 'capacites.gererEmployes.libelle',
      descriptionCle: 'capacites.gererEmployes.description',
    },
    prereglages: IDS_PREREGLAGE.map((id) => ({
      id,
      roleOrigine: PREREGLAGES[id].roleOrigine,
      libelleCle: `capacites.prereglages.${id}.libelle`,
      descriptionCle: `capacites.prereglages.${id}.description`,
      grille: PREREGLAGES[id].grille,
    })),
  };
}

/** Capacités d'une personne qui suit exactement un préréglage. */
export function capacitesDuPrereglage(id: IdPrereglage): CapacitesPersonne {
  return { ...PREREGLAGES[id].grille, prereglage: id, personnalisee: false };
}
