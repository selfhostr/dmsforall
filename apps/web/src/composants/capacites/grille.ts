import {
  DOMAINES_CAPACITE,
  OPTIONS_PERSONNE,
  incoherencesDeGrille,
  type DomaineCapacite,
  type EntreeModificationCapacites,
  type GrilleCapacites,
  type IdPrereglage,
  type NiveauAcces,
  type OptionPersonne,
  type PrereglageModele,
} from '@dfa/shared';

/** Extrait la grille (sans métadonnées) d'un objet qui la porte (`CapacitesPersonne`). */
export function grilleDe(source: GrilleCapacites): GrilleCapacites {
  return {
    niveaux: { ...source.niveaux },
    encadrer: source.encadrer,
    gererEmployes: source.gererEmployes,
    patron: source.patron,
    options: { ...source.options },
  };
}

/** Corps partiel de `PATCH …/capacites` : seulement ce qui diffère de `base`. `null` si rien. */
export function diffCapacites(
  base: GrilleCapacites,
  cible: GrilleCapacites,
): EntreeModificationCapacites | null {
  const niveaux: Partial<Record<DomaineCapacite, NiveauAcces>> = {};
  for (const d of DOMAINES_CAPACITE) {
    if (base.niveaux[d] !== cible.niveaux[d]) niveaux[d] = cible.niveaux[d];
  }
  const options: Partial<Record<OptionPersonne, boolean>> = {};
  for (const o of OPTIONS_PERSONNE) {
    if (base.options[o] !== cible.options[o]) options[o] = cible.options[o];
  }
  const entree: {
    niveaux?: typeof niveaux;
    encadrer?: boolean;
    options?: typeof options;
  } = {};
  if (Object.keys(niveaux).length > 0) entree.niveaux = niveaux;
  if (base.encadrer !== cible.encadrer) entree.encadrer = cible.encadrer;
  if (Object.keys(options).length > 0) entree.options = options;
  return Object.keys(entree).length > 0 ? entree : null;
}

/** Retire le préfixe `capacites.` d'une clé du modèle pour la lire dans le namespace `capacites`. */
export function cleDuModele(cle: string): string {
  return `capacites:${cle.startsWith('capacites.') ? cle.slice('capacites.'.length) : cle}`;
}

/** Préréglage par défaut d'un rôle (celui dont l'id est le rôle). */
export function prereglageDeBase(
  prereglages: readonly PrereglageModele[],
  id: IdPrereglage,
): PrereglageModele | undefined {
  return prereglages.find((p) => p.id === id);
}

/** Chemins incohérents de la grille (mêmes règles que le 400 du serveur), hors `patron`. */
export function incoherencesAffichables(grille: GrilleCapacites): string[] {
  return incoherencesDeGrille(grille).filter((c) => c !== 'patron');
}

/** Libellés d'un résumé d'accès : domaines à Faire, domaines à Voir, encadrement. */
export interface ResumeGrille {
  readonly faire: readonly DomaineCapacite[];
  readonly voir: readonly DomaineCapacite[];
  readonly encadre: boolean;
}

export function resumerGrille(grille: GrilleCapacites): ResumeGrille {
  return {
    faire: DOMAINES_CAPACITE.filter((d) => grille.niveaux[d] === 'faire'),
    voir: DOMAINES_CAPACITE.filter((d) => grille.niveaux[d] === 'voir'),
    encadre: grille.encadrer,
  };
}
