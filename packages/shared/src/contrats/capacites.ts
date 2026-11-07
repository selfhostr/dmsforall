import { z } from 'zod';

import type { RolePersonne, RoleUtilisateur } from './enums';

/**
 * Modèle de capacités par personne — phase 1 de la simplification des rôles.
 *
 * Un garage n'est plus enfermé dans un rôle exclusif : chaque personne porte UNE grille
 * « Rien / Voir / Faire » sur six domaines, plus « Encadrer », plus « Employés & réglages »
 * (réservé au patron), plus trois options. Les rôles historiques (`ROLES_UTILISATEUR`) ne sont
 * plus que des PRÉRÉGLAGES : un point de départ modifiable, jamais une limite.
 *
 * Les ~170 actions de la matrice (`apps/api/src/auth/matrice-droits.ts`) RESTENT les étiquettes
 * des routes (`@ExigerDroit('…')`). Ce qui change : au lieu d'une liste d'actions par rôle,
 * chaque action est rattachée à une ou deux CAPACITÉS internes (`apps/api/src/auth/capacites-
 * actions.ts`), et une personne détient l'action si sa grille lui accorde l'une d'elles.
 *
 * Ce fichier ne contient que des données et des fonctions pures : le front peut s'en servir pour
 * afficher la grille, jamais pour décider d'un droit (le serveur re-vérifie chaque requête).
 */

/** Les six domaines de la grille, dans l'ordre d'affichage. */
export const DOMAINES_CAPACITE = [
  'atelier',
  'accueil',
  'facturation',
  'pieces',
  'ventes',
  'finances',
] as const;
export type DomaineCapacite = (typeof DOMAINES_CAPACITE)[number];

/** `faire` inclut `voir`. `rien` : le domaine n'existe pas pour cette personne. */
export const NIVEAUX_ACCES = ['rien', 'voir', 'faire'] as const;
export type NiveauAcces = (typeof NIVEAUX_ACCES)[number];

/** Les trois options par personne. */
export const OPTIONS_PERSONNE = ['voitMontants', 'voitPrixAchat', 'avoirsPlafonnes'] as const;
export type OptionPersonne = (typeof OPTIONS_PERSONNE)[number];

/**
 * Capacités INTERNES — jamais affichées telles quelles. Une personne les obtient depuis sa grille
 * (`capacitesDeLaGrille`).
 *
 *  - `base`        : tout compte de personne (lire son tenant, ses sites, la recherche…).
 *  - `<domaine>.voir` / `<domaine>.faire` : issues de la grille.
 *  - `encadrer`    : corriger les heures des autres, rouvrir un OR, lever un blocage, réglages
 *                    de l'atelier.
 *  - `employes`    : comptes, bornes, conditions client, reprise de données (préparation).
 *  - `patron`      : gestes irréversibles ou engageant le garage (IBAN, lancement de la reprise).

 *  - `facturation.montants` : DÉRIVÉE — niveau Facturation au moins Voir ET option « voit les
 *                    montants ». Garde les gestes qui exposent un montant en clair (PDF avec
 *                    bulletin QR, liste des paiements) : RF-116, un rôle sans droit aux montants
 *                    ne peut pas les obtenir, même avec Facturation : Voir.
 *  - `atelier.controle`, `facturation.emettre_devis`, `facturation.emettre_facture`,
 *    `facturation.encaisser`, `pieces.magasin` : DÉRIVÉES, SÉPARATION DES TÂCHES — voir
 *    `capacitesDeLaGrille`. Elles empêchent qu'un simple niveau « Faire » cumule tout ce que le
 *    même niveau donnait à un poste de bureau (le magasinier n'émet pas de facture ; le chef
 *    d'atelier n'encaisse pas, ne tient pas le stock et ne valide pas les achats).
 *  - `borne`       : réservée au profil d'appareil (jamais obtenue par une grille).
 *  - `contrainte.avoir_plafonne` : n'est PAS un pouvoir mais une contrainte — l'option
 *                    « avoirs plafonnés ». Elle figure dans la table des actions pour que la
 *                    contrainte reste lisible par les services comme un droit (`MATRICE_DROITS`).
 */
export const CAPACITES = [
  'base',
  'atelier.voir',
  'atelier.faire',
  'accueil.voir',
  'accueil.faire',
  'facturation.voir',
  'facturation.faire',
  'facturation.montants',
  'facturation.encaisser',
  'facturation.emettre_devis',
  'facturation.emettre_facture',
  'atelier.controle',
  'pieces.magasin',
  'pieces.voir',
  'pieces.faire',
  'ventes.voir',
  'ventes.faire',
  'finances.voir',
  'finances.faire',
  'encadrer',
  'employes',
  'patron',
  'borne',
  'contrainte.avoir_plafonne',
] as const;
export type Capacite = (typeof CAPACITES)[number];

/**
 * Grille complète d'une personne. `gererEmployes` et `patron` ne se modifient JAMAIS par
 * `PATCH /utilisateurs/{id}/capacites` : ils suivent le préréglage (changement de rôle) — un
 * patron ne délègue pas ces deux cases par un simple clic.
 */
export interface GrilleCapacites {
  readonly niveaux: Readonly<Record<DomaineCapacite, NiveauAcces>>;
  readonly encadrer: boolean;
  readonly gererEmployes: boolean;
  readonly patron: boolean;
  readonly options: Readonly<Record<OptionPersonne, boolean>>;
}

const RANG_NIVEAU: Readonly<Record<NiveauAcces, number>> = { rien: 0, voir: 1, faire: 2 };

/** `true` si `niveau` atteint au moins `requis`. */
export function niveauAtteint(niveau: NiveauAcces, requis: NiveauAcces): boolean {
  return RANG_NIVEAU[niveau] >= RANG_NIVEAU[requis];
}

/** Capacités internes accordées par une grille. `base` est toujours présente. */
export function capacitesDeLaGrille(grille: GrilleCapacites): ReadonlySet<Capacite> {
  const capacites = new Set<Capacite>(['base']);
  for (const domaine of DOMAINES_CAPACITE) {
    const niveau = grille.niveaux[domaine];
    // Défense en profondeur : la Finance, c'est de l'argent. Sans l'option « voit les montants »,
    // le domaine ne donne rien, quelle que soit la grille stockée.
    if (domaine === 'finances' && !grille.options.voitMontants) continue;
    if (niveauAtteint(niveau, 'voir')) capacites.add(`${domaine}.voir`);
    if (niveauAtteint(niveau, 'faire')) capacites.add(`${domaine}.faire`);
  }
  if (niveauAtteint(grille.niveaux.facturation, 'voir') && grille.options.voitMontants) {
    capacites.add('facturation.montants');
  }
  // --- Séparation des tâches ----------------------------------------------------------------
  // `poste de stock` : gère les pièces (Faire) sans autorité commerciale (ni Ventes : Faire, ni
  // Finances : Faire). Ce profil — magasinier, chef d'atelier, mécanicien-magasinier — ne contrôle
  // pas le travail qu'il a fait (sauf s'il encadre), n'émet ni facture ni avoir, et un chef qui
  // encadre l'atelier n'encaisse pas et ne valide pas les factures fournisseur qu'il commande.
  const faireFactu = capacites.has('facturation.faire');
  const posteDeStock =
    capacites.has('pieces.faire') &&
    !capacites.has('finances.faire') &&
    !capacites.has('ventes.faire');
  if (capacites.has('atelier.faire') && (!posteDeStock || grille.encadrer)) {
    capacites.add('atelier.controle');
  }
  if (faireFactu && (!posteDeStock || grille.encadrer)) capacites.add('facturation.emettre_devis');
  if (faireFactu && !posteDeStock) capacites.add('facturation.emettre_facture');
  if (faireFactu && (!posteDeStock || !grille.encadrer)) capacites.add('facturation.encaisser');
  if (capacites.has('pieces.faire') && !(posteDeStock && grille.encadrer)) {
    capacites.add('pieces.magasin');
  }
  if (grille.encadrer) capacites.add('encadrer');
  if (grille.gererEmployes) capacites.add('employes');
  if (grille.patron) capacites.add('patron');
  if (grille.options.avoirsPlafonnes) capacites.add('contrainte.avoir_plafonne');
  return capacites;
}

/** Égalité structurelle de deux grilles. */
export function grillesEgales(a: GrilleCapacites, b: GrilleCapacites): boolean {
  return (
    a.encadrer === b.encadrer &&
    a.gererEmployes === b.gererEmployes &&
    a.patron === b.patron &&
    DOMAINES_CAPACITE.every((d) => a.niveaux[d] === b.niveaux[d]) &&
    OPTIONS_PERSONNE.every((o) => a.options[o] === b.options[o])
  );
}

/**
 * Ce que `acteur` n'a pas le droit d'accorder : liste (vide si tout est permis) des éléments de
 * `cible` qui dépassent `acteur`. Règle « on ne coche pas une case qu'on n'a pas soi-même » :
 * niveau par domaine, `encadrer`, `gererEmployes`, `patron` et chaque option activée.
 * `avoirsPlafonnes` se lit à l'envers (c'est une CONTRAINTE) : l'activer n'élève rien, mais la
 * LEVER pour quelqu'un alors qu'on est soi-même plafonné est un dépassement.
 */
export function depassementsDeGrille(acteur: GrilleCapacites, cible: GrilleCapacites): string[] {
  const depassements: string[] = [];
  for (const domaine of DOMAINES_CAPACITE) {
    if (!niveauAtteint(acteur.niveaux[domaine], cible.niveaux[domaine])) {
      depassements.push(`niveaux.${domaine}`);
    }
  }
  if (cible.encadrer && !acteur.encadrer) depassements.push('encadrer');
  if (cible.gererEmployes && !acteur.gererEmployes) depassements.push('gererEmployes');
  if (cible.patron && !acteur.patron) depassements.push('patron');
  for (const option of ['voitMontants', 'voitPrixAchat'] as const) {
    if (cible.options[option] && !acteur.options[option]) depassements.push(`options.${option}`);
  }
  if (!cible.options.avoirsPlafonnes && acteur.options.avoirsPlafonnes) {
    depassements.push('options.avoirsPlafonnes');
  }
  return depassements;
}

// =================================================================================================
// Préréglages
// =================================================================================================

/** Un préréglage est une DONNÉE (pas une valeur d'enum) : `fiduciaire` n'a pas de rôle propre. */
export const IDS_PREREGLAGE = [
  'admin',
  'direction',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'technicien',
  'magasinier',
  'comptable',
  'fiduciaire',
] as const;
export type IdPrereglage = (typeof IDS_PREREGLAGE)[number];

export interface Prereglage {
  readonly id: IdPrereglage;
  /** Valeur de la colonne `utilisateur.role` écrite quand on applique ce préréglage. */
  readonly roleOrigine: RolePersonne;
  readonly grille: GrilleCapacites;
}

const AUCUNE_OPTION = { voitMontants: false, voitPrixAchat: false, avoirsPlafonnes: false };

function grille(
  niveaux: Readonly<Record<DomaineCapacite, NiveauAcces>>,
  reste: {
    readonly encadrer?: boolean;
    readonly gererEmployes?: boolean;
    readonly patron?: boolean;
    readonly options?: Partial<Record<OptionPersonne, boolean>>;
  } = {},
): GrilleCapacites {
  return {
    niveaux,
    encadrer: reste.encadrer ?? false,
    gererEmployes: reste.gererEmployes ?? false,
    patron: reste.patron ?? false,
    options: { ...AUCUNE_OPTION, ...reste.options },
  };
}

/**
 * Préréglages. Chaque grille est la PLUS PETITE qui contienne tous les droits historiques du rôle
 * (`apps/api/src/auth/matrice-droits.spec.ts` prouve `droits(préréglage) ⊇ droits historiques`
 * pour chaque action et chaque rôle) : AUCUNE personne ne perd un droit à la migration.
 */
export const PREREGLAGES: Readonly<Record<IdPrereglage, Prereglage>> = {
  // `admin` : compte TECHNIQUE de l'intégrateur (RF-115, issue #21) — atelier, accueil et gestion
  // des comptes, AUCUN domaine financier ni pièces ni ventes. Ses montants d'atelier restent
  // visibles (comportement historique) ; en facturation ils restent masqués faute de niveau.
  admin: {
    id: 'admin',
    roleOrigine: 'admin',
    grille: grille(
      {
        atelier: 'faire',
        accueil: 'faire',
        facturation: 'rien',
        pieces: 'rien',
        ventes: 'rien',
        finances: 'rien',
      },
      { encadrer: true, gererEmployes: true, options: { voitMontants: true } },
    ),
  },
  // `direction` : le patron. Tout, y compris les gestes irréversibles (`patron`).
  direction: {
    id: 'direction',
    roleOrigine: 'direction',
    grille: grille(
      {
        atelier: 'faire',
        accueil: 'faire',
        facturation: 'faire',
        pieces: 'faire',
        ventes: 'faire',
        finances: 'faire',
      },
      {
        encadrer: true,
        gererEmployes: true,
        patron: true,
        options: { voitMontants: true, voitPrixAchat: true },
      },
    ),
  },
  vendeur: {
    id: 'vendeur',
    roleOrigine: 'vendeur',
    grille: grille(
      {
        atelier: 'rien',
        accueil: 'voir',
        facturation: 'faire',
        pieces: 'voir',
        ventes: 'faire',
        finances: 'rien',
      },
      { options: { voitMontants: true, avoirsPlafonnes: true } },
    ),
  },
  receptionnaire: {
    id: 'receptionnaire',
    roleOrigine: 'receptionnaire',
    grille: grille(
      {
        atelier: 'voir',
        accueil: 'faire',
        facturation: 'faire',
        pieces: 'voir',
        ventes: 'voir',
        finances: 'rien',
      },
      { options: { voitMontants: true, avoirsPlafonnes: true } },
    ),
  },
  chef_atelier: {
    id: 'chef_atelier',
    roleOrigine: 'chef_atelier',
    grille: grille(
      {
        atelier: 'faire',
        accueil: 'faire',
        facturation: 'faire',
        pieces: 'faire',
        ventes: 'rien',
        finances: 'rien',
      },
      {
        encadrer: true,
        options: { voitMontants: true, voitPrixAchat: true, avoirsPlafonnes: true },
      },
    ),
  },
  technicien: {
    id: 'technicien',
    roleOrigine: 'technicien',
    grille: grille({
      atelier: 'faire',
      accueil: 'voir',
      facturation: 'voir',
      pieces: 'voir',
      ventes: 'rien',
      finances: 'rien',
    }),
  },
  magasinier: {
    id: 'magasinier',
    roleOrigine: 'magasinier',
    grille: grille(
      {
        atelier: 'faire',
        accueil: 'voir',
        facturation: 'faire',
        pieces: 'faire',
        ventes: 'rien',
        finances: 'rien',
      },
      { options: { voitMontants: true, voitPrixAchat: true, avoirsPlafonnes: true } },
    ),
  },
  comptable: {
    id: 'comptable',
    roleOrigine: 'comptable',
    grille: grille(
      {
        atelier: 'voir',
        accueil: 'voir',
        facturation: 'faire',
        pieces: 'voir',
        ventes: 'voir',
        finances: 'faire',
      },
      { options: { voitMontants: true, voitPrixAchat: true } },
    ),
  },
  // Fiduciaire externe : lecture seule de la facturation et des finances, rien d'autre. Stockée
  // avec `role = 'comptable'` (pas de valeur d'enum dédiée) ; reconnue par sa grille.
  fiduciaire: {
    id: 'fiduciaire',
    roleOrigine: 'comptable',
    grille: grille(
      {
        atelier: 'rien',
        accueil: 'rien',
        facturation: 'voir',
        pieces: 'rien',
        ventes: 'rien',
        finances: 'voir',
      },
      { options: { voitMontants: true, voitPrixAchat: true } },
    ),
  },
};

/** Préréglage d'origine d'un rôle de personne (celui que reçoit une personne créée avec ce rôle). */
export function prereglageDuRole(role: RolePersonne): Prereglage {
  return PREREGLAGES[role];
}

/** Grille inerte : aucune capacité hors `base`. Sert de valeur sûre si une ligne est illisible. */
export const GRILLE_VIDE: GrilleCapacites = grille({
  atelier: 'rien',
  accueil: 'rien',
  facturation: 'rien',
  pieces: 'rien',
  ventes: 'rien',
  finances: 'rien',
});

/**
 * Préréglage reconnu pour une grille donnée : le préréglage de `role` s'il correspond exactement,
 * sinon un autre préréglage de même rôle d'origine (ex. `fiduciaire` pour `comptable`), sinon
 * `null` (« personnalisé »).
 */
export function prereglageCorrespondant(
  role: RoleUtilisateur,
  g: GrilleCapacites,
): IdPrereglage | null {
  const candidats = IDS_PREREGLAGE.filter((id) => PREREGLAGES[id].roleOrigine === role);
  const propre = candidats.find((id) => id === role);
  const ordre = propre === undefined ? candidats : [propre, ...candidats.filter((c) => c !== role)];
  return ordre.find((id) => grillesEgales(PREREGLAGES[id].grille, g)) ?? null;
}

// =================================================================================================
// Contrats d'API
// =================================================================================================

/** Grille et métadonnées d'une personne, telles que rendues par l'API. */
export interface CapacitesPersonne extends GrilleCapacites {
  /** Préréglage dont la grille est exactement celle de la personne, `null` si personnalisée. */
  readonly prereglage: IdPrereglage | null;
  /** `true` quand la grille diffère du préréglage du rôle (affichage « Technicien (personnalisé) »). */
  readonly personnalisee: boolean;
}

const schemaNiveauAcces = z.enum(NIVEAUX_ACCES);

/**
 * Corps de `PATCH /api/v1/utilisateurs/{id}/capacites`. `.strict()` : ni `tenantId`, ni
 * `gererEmployes`, ni `patron` (non modifiables ici). Les champs omis restent inchangés ; au moins
 * un champ est exigé.
 */
export const schemaModificationCapacites = z
  .object({
    niveaux: z
      .object({
        atelier: schemaNiveauAcces.optional(),
        accueil: schemaNiveauAcces.optional(),
        facturation: schemaNiveauAcces.optional(),
        pieces: schemaNiveauAcces.optional(),
        ventes: schemaNiveauAcces.optional(),
        finances: schemaNiveauAcces.optional(),
      })
      .strict()
      .optional(),
    encadrer: z.boolean().optional(),
    options: z
      .object({
        voitMontants: z.boolean().optional(),
        voitPrixAchat: z.boolean().optional(),
        avoirsPlafonnes: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      (v.niveaux !== undefined && Object.keys(v.niveaux).length > 0) ||
      v.encadrer !== undefined ||
      (v.options !== undefined && Object.keys(v.options).length > 0),
    { message: 'Au moins un champ de capacité doit être fourni.' },
  );
export type EntreeModificationCapacites = z.infer<typeof schemaModificationCapacites>;

/** Corps de `PUT`-like de création : grille complète optionnelle (partielle acceptée) ou préréglage. */
export const schemaCapacitesCreation = z
  .object({
    prereglage: z.enum(IDS_PREREGLAGE),
  })
  .strict();
export type EntreeCapacitesCreation = z.infer<typeof schemaCapacitesCreation>;

/** Libellé d'un domaine de la grille — `GET /api/v1/capacites/modele`. Clés i18n, jamais de texte. */
export interface DomaineModele {
  readonly id: DomaineCapacite;
  readonly libelleCle: string;
  readonly descriptionCle: string;
  /** Exemples de gestes autorisés (3 à 4), affichés sous la ligne. */
  readonly exemplesCles: readonly string[];
}

export interface OptionModele {
  readonly id: OptionPersonne;
  readonly libelleCle: string;
  readonly descriptionCle: string;
}

export interface NiveauModele {
  readonly id: NiveauAcces;
  readonly libelleCle: string;
}

export interface PrereglageModele {
  readonly id: IdPrereglage;
  readonly roleOrigine: RolePersonne;
  readonly libelleCle: string;
  readonly descriptionCle: string;
  readonly grille: GrilleCapacites;
}

/** Corps de `GET /api/v1/capacites/modele`. */
export interface ModeleCapacites {
  readonly domaines: readonly DomaineModele[];
  readonly niveaux: readonly NiveauModele[];
  readonly options: readonly OptionModele[];
  /** Clés des cases hors grille : encadrer, employés & réglages. */
  readonly encadrer: { readonly libelleCle: string; readonly descriptionCle: string };
  readonly gererEmployes: { readonly libelleCle: string; readonly descriptionCle: string };
  readonly prereglages: readonly PrereglageModele[];
}

/**
 * Incohérences internes d'une grille (liste vide = cohérente). Sans l'option « voit les montants »,
 * on ne peut ni facturer (Facturation : Faire), ni vendre (Ventes : Faire), ni toucher aux
 * Finances : ces gestes manipulent des montants que la personne ne verrait pas.
 */
export function incoherencesDeGrille(g: GrilleCapacites): string[] {
  const incoherences: string[] = [];
  if (!g.options.voitMontants) {
    if (g.niveaux.facturation === 'faire') incoherences.push('niveaux.facturation');
    if (g.niveaux.ventes === 'faire') incoherences.push('niveaux.ventes');
    if (g.niveaux.finances !== 'rien') incoherences.push('niveaux.finances');
  }
  if (g.patron && !g.gererEmployes) incoherences.push('patron');
  return incoherences;
}

/**
 * `true` si passer de `avant` à `apres` RETIRE un pouvoir ou ajoute une contrainte : une capacité
 * en moins, une option de visibilité retirée, ou les avoirs désormais plafonnés. Sert à décider
 * d'invalider les sessions de la personne (les droits étant relus à chaque requête, c'est une
 * ceinture en plus des bretelles).
 */
export function droitsBaissent(avant: GrilleCapacites, apres: GrilleCapacites): boolean {
  const a = capacitesDeLaGrille(avant);
  const b = capacitesDeLaGrille(apres);
  for (const c of a) {
    if (c !== 'contrainte.avoir_plafonne' && !b.has(c)) return true;
  }
  if (!avant.options.avoirsPlafonnes && apres.options.avoirsPlafonnes) return true;
  return (
    (avant.options.voitMontants && !apres.options.voitMontants) ||
    (avant.options.voitPrixAchat && !apres.options.voitPrixAchat)
  );
}
