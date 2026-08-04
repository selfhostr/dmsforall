import type {
  ActionOrdreReparation,
  AttentesOr,
  EtatAfficheOrdreReparation,
  RoleUtilisateur,
  StatutOrdreReparation,
} from '@dfa/shared';

import { MATRICE_DROITS, type Action } from '../auth/matrice-droits';

/**
 * `etatAffiche` (contrats-api-etape-1.md §8.3) : le plus bloquant des trois drapeaux d'attente
 * (`accord > pieces > externe`), sinon le statut lui-même. Calculé UNE FOIS ici, côté serveur :
 * sans ce calcul unique, chaque client réimplémenterait la priorité et deux clients finiraient
 * par afficher deux états différents pour le même OR.
 *
 * Pure, sans I/O : les trois drapeaux d'attente ne sont significatifs que sur un OR encore
 * « vivant » (§A-03) — un OR `termine`/`facture`/`restitue`/`cloture`/`annule` ne doit jamais
 * afficher une attente résiduelle si les triggers de recalcul n'ont pas encore tourné sur cette
 * même transaction (ils tournent AFTER sur `ligne_or`/`devis_complementaire`, donc l'ordre est
 * garanti dans la même transaction, mais cette fonction reste défensive : elle n'affiche une
 * attente que sur les statuts où elle a un sens opérationnel).
 */
const STATUTS_SUSCEPTIBLES_ATTENTE: ReadonlySet<StatutOrdreReparation> = new Set([
  'ouvert',
  'en_cours',
  'controle',
]);

export function calculerEtatAffiche(
  statut: StatutOrdreReparation,
  attentes: AttentesOr,
): EtatAfficheOrdreReparation {
  if (STATUTS_SUSCEPTIBLES_ATTENTE.has(statut)) {
    if (attentes.accord) return 'attente_accord';
    if (attentes.pieces) return 'attente_pieces';
    if (attentes.externe) return 'attente_externe';
  }
  return statut;
}

/**
 * `actionsDisponibles` (contrats-api-etape-1.md §2.2, §8.3) : les actions STRUCTURELLEMENT
 * possibles depuis le statut courant (miroir TypeScript de `transition_autorisee`, restreint aux
 * actions exposées au lot 1 — §6.5 du plan d'exécution), éventuellement restreintes par le droit
 * de l'appelant.
 *
 * Ne remplace PAS la vérification serveur (§2.2) : les gardes coûteuses (pointages ouverts,
 * lignes à valider, plafond) ne sont pas rejouées ici — une action listée peut donc être refusée
 * à l'exécution, avec `blocages` et `actionsProposees` à l'appui. C'est l'approximation
 * explicitement acceptée par le contrat.
 *
 * Table dérivée de `transition_autorisee` (0003_prealables_etape1.sql §5.1) : voir
 * `atelier/service-transitions.ts` pour le mapping inverse (action -> transitions DB).
 */
const ACTIONS_DEPUIS_STATUT: Readonly<
  Record<StatutOrdreReparation, readonly ActionOrdreReparation[]>
> = {
  planifie: ['receptionner', 'annuler'],
  ouvert: ['demarrer', 'passer-en-controle', 'terminer', 'annuler', 'reprendre-travaux'],
  en_cours: ['passer-en-controle', 'terminer', 'reprendre-travaux'],
  controle: ['refuser-controle', 'valider-controle'],
  // `facturer` (RF-81) : rejouable tant que l'OR reste `termine` (RF-83/RF-84, facturation
  // partielle assumée) — la garde réelle (au moins un groupe payeur encore facturable) reste
  // côté service (`OR_FACTURATION_AUCUNE_LIGNE`), même doctrine que le reste de cette table.
  termine: ['rouvrir', 'restituer', 'facturer'],
  facture: ['restituer'],
  restitue: ['cloturer'],
  cloture: [],
  annule: [],
};

/** Actions groupées de ligne (§7.7) : candidates seulement à partir de la réception (une ligne
 *  n'existe qu'une fois l'OR réceptionné), jamais sur un OR encore `planifie` ni sur un OR
 *  verrouillé (I-15) — la garde réelle (existence de lignes éligibles) reste côté service. */
const STATUTS_LIGNES_MODIFIABLES: ReadonlySet<StatutOrdreReparation> = new Set([
  'ouvert',
  'en_cours',
  'controle',
  'termine',
]);

const ACTIONS_LIGNES_GROUPEES: readonly ActionOrdreReparation[] = [
  'valider-lignes',
  'refuser-lignes',
  'annuler-lignes',
  'soumettre-lignes-a-devis',
];

export function calculerActionsDisponibles(
  statut: StatutOrdreReparation,
): readonly ActionOrdreReparation[] {
  const actionsOr = ACTIONS_DEPUIS_STATUT[statut];
  const actionsLignes = STATUTS_LIGNES_MODIFIABLES.has(statut) ? ACTIONS_LIGNES_GROUPEES : [];
  return [...actionsOr, ...actionsLignes];
}

/**
 * Droit `@ExigerDroit` requis pour chaque action de la machine à états (§6.4 du plan
 * d'exécution) — sert à restreindre `actionsDisponibles` à ce que l'appelant COURANT peut
 * effectivement déclencher (§2.2 : « statut + droits + paramètres »). `reprendre-travaux` n'a pas
 * de droit dédié dans `auth/matrice-droits.ts` (Action) : rattaché à `atelier.or.modifier`, le
 * plus proche par nature (lever un blocage de ligne est une modification de l'OR, pas une
 * transition de statut) — signalé comme une interprétation, faute d'entrée `§10` dédiée.
 *
 * `facturer` (`RF-81`, `POST /ordres-reparation/{orId}/facturer`) est rattaché à
 * `facturation.document.creer` — PAS `facturation.document.emettre_facture`. `RF-115` réserve
 * l'ÉMISSION à direction/comptable/vendeur/réceptionniste ; cette action ne fait que créer des
 * BROUILLONS, donc suit la règle de la création (même droit que toute création de document,
 * `ECRITURE_BROUILLON`), qui inclut déjà `chef_atelier` sans lui donner `EMISSION_FACTURE` —
 * exactement la distinction que `RF-81` demande. Décision figée par le contrat
 * `packages/shared/src/contrats/facturation/facturer-or.ts`, reprise ici telle quelle.
 */
const DROIT_PAR_ACTION: Readonly<Record<ActionOrdreReparation, Action>> = {
  receptionner: 'atelier.or.receptionner',
  demarrer: 'atelier.or.demarrer',
  'reprendre-travaux': 'atelier.or.modifier',
  facturer: 'facturation.document.creer',
  'passer-en-controle': 'atelier.or.passer_en_controle',
  'refuser-controle': 'atelier.or.controler',
  'valider-controle': 'atelier.or.controler',
  terminer: 'atelier.or.terminer',
  rouvrir: 'atelier.or.rouvrir',
  restituer: 'atelier.or.restituer',
  cloturer: 'atelier.or.cloturer',
  annuler: 'atelier.or.annuler',
  'valider-lignes': 'atelier.ligne.valider',
  'refuser-lignes': 'atelier.ligne.refuser',
  'annuler-lignes': 'atelier.ligne.annuler',
  'soumettre-lignes-a-devis': 'atelier.devis.creer',
};

/** `actionsDisponibles` restreint aux actions structurellement possibles ET permises au rôle de
 *  l'appelant courant (§2.2, §8.3). C'est la fonction que `service-or.ts` appelle réellement. */
export function calculerActionsDisponiblesPourRole(
  statut: StatutOrdreReparation,
  role: RoleUtilisateur,
): readonly ActionOrdreReparation[] {
  const droitsDuRole: readonly Action[] = MATRICE_DROITS[role] ?? [];
  return calculerActionsDisponibles(statut).filter((action) =>
    droitsDuRole.includes(DROIT_PAR_ACTION[action]),
  );
}
