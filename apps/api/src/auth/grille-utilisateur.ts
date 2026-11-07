/**
 * Passage ligne `utilisateur` <-> `GrilleCapacites` / `CapacitesPersonne`. Un seul endroit : la
 * lecture de session, la fiche employé, `/auth/moi` et l'écriture (création, changement de
 * préréglage, PATCH capacités) partagent ainsi exactement les mêmes colonnes.
 */
import {
  GRILLE_VIDE,
  PREREGLAGES,
  prereglageCorrespondant,
  grillesEgales,
  type CapacitesPersonne,
  type GrilleCapacites,
  type IdPrereglage,
  type RoleUtilisateur,
} from '@dfa/shared';

import type { LigneUtilisateur } from '../db/schema';

type ColonnesGrille = Pick<
  LigneUtilisateur,
  | 'niveauAtelier'
  | 'niveauAccueil'
  | 'niveauFacturation'
  | 'niveauPieces'
  | 'niveauVentes'
  | 'niveauFinances'
  | 'peutEncadrer'
  | 'peutGererEmployes'
  | 'estPatron'
  | 'voitMontants'
  | 'voitPrixAchat'
  | 'avoirsPlafonnes'
>;

export function grilleDepuisLigne(ligne: ColonnesGrille): GrilleCapacites {
  return {
    niveaux: {
      atelier: ligne.niveauAtelier,
      accueil: ligne.niveauAccueil,
      facturation: ligne.niveauFacturation,
      pieces: ligne.niveauPieces,
      ventes: ligne.niveauVentes,
      finances: ligne.niveauFinances,
    },
    encadrer: ligne.peutEncadrer,
    gererEmployes: ligne.peutGererEmployes,
    patron: ligne.estPatron,
    options: {
      voitMontants: ligne.voitMontants,
      voitPrixAchat: ligne.voitPrixAchat,
      avoirsPlafonnes: ligne.avoirsPlafonnes,
    },
  };
}

export function colonnesDepuisGrille(grille: GrilleCapacites): ColonnesGrille {
  return {
    niveauAtelier: grille.niveaux.atelier,
    niveauAccueil: grille.niveaux.accueil,
    niveauFacturation: grille.niveaux.facturation,
    niveauPieces: grille.niveaux.pieces,
    niveauVentes: grille.niveaux.ventes,
    niveauFinances: grille.niveaux.finances,
    peutEncadrer: grille.encadrer,
    peutGererEmployes: grille.gererEmployes,
    estPatron: grille.patron,
    voitMontants: grille.options.voitMontants,
    voitPrixAchat: grille.options.voitPrixAchat,
    avoirsPlafonnes: grille.options.avoirsPlafonnes,
  };
}

/** Grille + métadonnées d'affichage. La borne (profil figé) rend une grille vide, non personnalisée. */
export function capacitesPersonneDe(
  role: RoleUtilisateur,
  grille: GrilleCapacites,
): CapacitesPersonne {
  if (role === 'poste_atelier') {
    return { ...GRILLE_VIDE, prereglage: null, personnalisee: false };
  }
  const prereglage: IdPrereglage | null = prereglageCorrespondant(role, grille);
  const defaut = PREREGLAGES[role];
  return {
    ...grille,
    prereglage,
    personnalisee: !grillesEgales(defaut.grille, grille),
  };
}
