/**
 * Modèle de la grille tel que le front l'affiche : domaines, niveaux, options, préréglages — avec
 * des CLÉS i18n (le serveur ne porte aucun texte). Construit à partir des mêmes données que
 * l'autorisation (`PREREGLAGES`), donc impossible à désynchroniser des droits réels.
 */
import {
  DOMAINES_CAPACITE,
  IDS_PREREGLAGE,
  NIVEAUX_ACCES,
  OPTIONS_PERSONNE,
  PREREGLAGES,
  type ModeleCapacites,
} from '@dfa/shared';

/** Nombre d'exemples de gestes par domaine (clés `…exemples.1` à `…exemples.N`). */
const NOMBRE_EXEMPLES = 4;

export function construireModeleCapacites(): ModeleCapacites {
  return {
    domaines: DOMAINES_CAPACITE.map((id) => ({
      id,
      libelleCle: `capacites.domaines.${id}.libelle`,
      descriptionCle: `capacites.domaines.${id}.description`,
      exemplesCles: Array.from(
        { length: NOMBRE_EXEMPLES },
        (_, i) => `capacites.domaines.${id}.exemples.${String(i + 1)}`,
      ),
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
