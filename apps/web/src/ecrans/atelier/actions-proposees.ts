import type {
  ActionOrdreReparation,
  ActionProposee,
  CodeActionProposee,
  CodeConfirmation,
  ElementBloquant,
} from '@dfa/shared';

/**
 * Ce que le panneau d'actions d'un OR FAIT quand l'utilisateur clique une action proposée par un
 * refus (invariant n°8 : « aucun refus sans chemin de sortie » — un bouton proposé qui ne fait rien
 * est pire que pas de bouton). Pur et exhaustif : `Record<CodeActionProposee, …>` casse la
 * compilation dès qu'un code est ajouté au contrat sans être traité ici.
 *
 * Chaque code produit TOUJOURS un effet (jamais `null`) : une requête, une ouverture de dialogue,
 * une navigation ou, quand l'action n'a pas d'écran applicatif (signature d'une réserve de
 * sécurité, demande d'habilitation), une consigne visible qui dit quoi faire.
 */
export type ConsigneActionProposee =
  | 'fournirMotif'
  | 'signerReserveSecurite'
  | 'demanderHabilitation'
  | 'controleQualite'
  | 'receptionnerIndisponible';

export type EffetActionProposee =
  /** Demander l'accord du client (nom + comment) pour ces lignes, puis rejouer l'action. */
  | { readonly type: 'accord_client'; readonly ligneIds: readonly string[] }
  /** Arrêter ces pointages (après confirmation), puis rejouer l'action. */
  | { readonly type: 'arreter_pointages'; readonly pointageIds: readonly string[] }
  /** Marquer ces lignes réalisées, puis rejouer l'action. */
  | { readonly type: 'marquer_realisees'; readonly ligneIds: readonly string[] }
  /** Saisir le n° de commande du client sur l'OR, puis rejouer l'action. */
  | { readonly type: 'renseigner_po' }
  /** Ouvrir le dialogue d'une autre action de l'OR (réceptionner, passer en contrôle…). */
  | { readonly type: 'ouvrir_action'; readonly action: ActionOrdreReparation }
  /** Ouvrir le formulaire d'un nouvel OR (retouche ou nouveau passage), client/véhicule repris. */
  | { readonly type: 'nouvel_or' }
  /** Relire l'OR puis reprendre la saisie sur l'état à jour. */
  | { readonly type: 'rafraichir' }
  /** Rejouer l'action initiale avec les confirmations que le serveur a demandées. */
  | { readonly type: 'rejouer_confirme'; readonly confirmations: readonly CodeConfirmation[] }
  /** Pas d'écran applicatif : afficher la consigne (avec ses données utiles) à la place. */
  | {
      readonly type: 'consigne';
      readonly consigne: ConsigneActionProposee;
      readonly donnees?: Readonly<Record<string, unknown>>;
    };

export interface ContexteActionProposee {
  readonly blocages: readonly ElementBloquant[];
  /** `or.actionsDisponibles` : ce que le SERVEUR propose à l'appelant maintenant. */
  readonly actionsDisponibles: readonly ActionOrdreReparation[];
  readonly confirmationsRequises: readonly CodeConfirmation[];
}

function idsDe(blocages: readonly ElementBloquant[], type: ElementBloquant['type']): string[] {
  return blocages.filter((blocage) => blocage.type === type).map((blocage) => blocage.id);
}

function idsDeParametres(action: ActionProposee): string[] {
  const valeur = action.parametres?.ligneIds;
  return Array.isArray(valeur) ? valeur.filter((id): id is string => typeof id === 'string') : [];
}

function accordClient(
  action: ActionProposee,
  contexte: ContexteActionProposee,
): EffetActionProposee {
  const ligneIds = [
    ...new Set([...idsDe(contexte.blocages, 'ligne_or'), ...idsDeParametres(action)]),
  ];
  return { type: 'accord_client', ligneIds };
}

function ouvrirSiDisponible(
  contexte: ContexteActionProposee,
  candidates: readonly ActionOrdreReparation[],
  repli: EffetActionProposee,
): EffetActionProposee {
  const action = candidates.find((candidate) => contexte.actionsDisponibles.includes(candidate));
  return action ? { type: 'ouvrir_action', action } : repli;
}

const PLANIFICATEURS: Readonly<
  Record<
    CodeActionProposee,
    (action: ActionProposee, contexte: ContexteActionProposee) => EffetActionProposee
  >
> = {
  CREER_DEVIS_COMPLEMENTAIRE: accordClient,
  VALIDER_LIGNES: accordClient,
  ARRETER_POINTAGES: (_action, contexte) => ({
    type: 'arreter_pointages',
    pointageIds: idsDe(contexte.blocages, 'pointage'),
  }),
  MARQUER_LIGNES_REALISEES: (_action, contexte) => ({
    type: 'marquer_realisees',
    ligneIds: idsDe(contexte.blocages, 'ligne_or'),
  }),
  COMPLETER_CONTROLE_QUALITE: (_action, contexte) =>
    ouvrirSiDisponible(contexte, ['passer-en-controle', 'valider-controle'], {
      type: 'consigne',
      consigne: 'controleQualite',
    }),
  CREER_OR_RETOUCHE: () => ({ type: 'nouvel_or' }),
  CREER_NOUVEL_OR: () => ({ type: 'nouvel_or' }),
  RENSEIGNER_PO: () => ({ type: 'renseigner_po' }),
  SIGNER_RESERVE_SECURITE: () => ({ type: 'consigne', consigne: 'signerReserveSecurite' }),
  FOURNIR_MOTIF: (_action, contexte) => ({
    type: 'consigne',
    consigne: 'fournirMotif',
    donnees: contexte.blocages.find((blocage) => blocage.donnees?.dernierConnuKm !== undefined)
      ?.donnees,
  }),
  REJOUER_AVEC_CONFIRMATION: (_action, contexte) =>
    contexte.confirmationsRequises.length > 0
      ? { type: 'rejouer_confirme', confirmations: contexte.confirmationsRequises }
      : { type: 'rafraichir' },
  DEMANDER_HABILITATION: () => ({ type: 'consigne', consigne: 'demanderHabilitation' }),
  RECEPTIONNER_VEHICULE: (_action, contexte) =>
    ouvrirSiDisponible(contexte, ['receptionner'], {
      type: 'consigne',
      consigne: 'receptionnerIndisponible',
    }),
  RAFRAICHIR: () => ({ type: 'rafraichir' }),
};

export function planifierActionProposee(
  action: ActionProposee,
  contexte: ContexteActionProposee,
): EffetActionProposee {
  return PLANIFICATEURS[action.code](action, contexte);
}
