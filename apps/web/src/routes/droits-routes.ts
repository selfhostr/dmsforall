import type { ActionCitee } from '@/droits';

/**
 * Atteinte des routes et visibilité du menu : une entrée est ouverte à la personne qui détient AU
 * MOINS UNE des actions listées dans `session.actions` (voir `@/droits`). Plus de liste de rôles :
 * une grille personnalisée ouvre exactement les écrans que ses actions justifient. Chaque liste
 * reprend l'ancien périmètre des 9 préréglages (l'action choisie est celle que le préréglage
 * détenait pour ce même périmètre). Défensif d'ergonomie : le serveur reste l'arbitre (403).
 */
export type Acces = readonly ActionCitee[];

export const ACCES_MENU_PARAMETRAGE_ATELIER: Acces = ['parametrage.atelier.modifier'];
export const ACCES_MENU_FINANCIER: Acces = ['facturation.export.lire'];
export const ACCES_PIECES: Acces = ['pieces.article.lire'];
export const ACCES_PARAMETRAGE_PIECES: Acces = ['pieces.parametrage.lire'];
export const ACCES_GESTION_UTILISATEURS: Acces = ['socle.utilisateur.lire'];
export const ACCES_VENTES: Acces = ['ventes.dossier.lire'];
export const ACCES_PNEUS: Acces = ['pneus.depot.lire'];
export const ACCES_TABLEAU_BORD_ACTIVITE: Acces = ['tableau_bord.activite.lire'];
export const ACCES_RELANCES: Acces = ['relances.facturation.regle.lire'];
/** Pointer (technicien, magasinier, encadrement) : suit « Faire » sur l'atelier. */
export const ACCES_POINTAGE: Acces = ['atelier.ligne.marquer_realisee'];
export const ACCES_POINTAGE_ENCADREMENT: Acces = ['atelier.pointage.pointer_autrui'];
/** Borne : l'appareil lui-même, ou qui gère les PIN de l'atelier. */
export const ACCES_BORNE_POINTAGE: Acces = [
  'atelier.pointage.identifier',
  'atelier.pointage.gerer_pin',
];
export const ACCES_MENU_FACTURATION: Acces = ['facturation.document.lire'];
export const ACCES_LECTURE_RENDEZ_VOUS: Acces = ['rendez_vous.lire'];
/** Scan de permis : créer un véhicule. */
export const ACCES_SCAN: Acces = ['vehicule.creer'];
export const ACCES_LECTURE_OR: Acces = ['atelier.or.lire'];
export const ACCES_LECTURE_FOURNISSEUR_PIECES: Acces = ['pieces.fournisseur.lire'];
export const ACCES_LECTURE_FACTURE_FOURNISSEUR_PIECES: Acces = ['pieces.facture_fournisseur.lire'];
export const ACCES_LECTURE_CONSIGNE_PIECES: Acces = ['pieces.consigne.lire'];
