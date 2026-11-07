import { useSession } from '@/hooks/useSession';

/**
 * Droits côté web : UNE seule source, `session.actions` (liste des actions de la matrice que le
 * serveur accorde à CETTE personne, calculée depuis sa grille « Qui peut quoi »). Le web ne recopie
 * plus aucune matrice par rôle : il pose des questions du type « a-t-elle `facturation.paiement.
 * creer` ? ». Défensif d'ergonomie (cacher un bouton) ; le serveur re-vérifie chaque requête.
 *
 * `ACTIONS_CITEES` liste les actions que le web interroge : `droits.parite.spec.ts` prouve que
 * chacune existe dans `TOUTES_ACTIONS` de l'API (une action renommée côté serveur ne doit plus
 * masquer un bouton en silence).
 */
export const ACTIONS_CITEES = [
  'atelier.ligne.annuler',
  'atelier.ligne.creer',
  'atelier.ligne.marquer_realisee',
  'atelier.ligne.photo.ajouter',
  'atelier.ligne.refuser',
  'atelier.ligne.valider',
  'atelier.or.creer',
  'atelier.or.lire',
  'atelier.pointage.corriger_autrui',
  'atelier.pointage.demarrer',
  'atelier.pointage.gerer_pin',
  'atelier.pointage.identifier',
  'atelier.pointage.pointer_autrui',
  'atelier.pointage.verrouiller_periode',
  'courtoisie.parc.gerer',
  'courtoisie.preter',
  'facturation.document.corriger',
  'facturation.document.creer',
  'facturation.document.emettre_avoir',
  'facturation.document.emettre_devis_bc',
  'facturation.document.emettre_facture',
  'facturation.document.lire',
  'facturation.export.creer',
  'facturation.export.lire',
  'facturation.paiement.creer',
  'facturation.paiement.lire',
  'parametrage.atelier.modifier',
  'pieces.article.creer',
  'pieces.article.lire',
  'pieces.commande_fournisseur.creer',
  'pieces.commande_fournisseur.lire',
  'pieces.commande_fournisseur.reception',
  'pieces.consigne.lire',
  'pieces.consigne.retourner',
  'pieces.facture_fournisseur.deposer',
  'pieces.facture_fournisseur.lire',
  'pieces.facture_fournisseur.rejeter',
  'pieces.facture_fournisseur.valider',
  'pieces.fournisseur.creer',
  'pieces.fournisseur.lire',
  'pieces.mouvement.creer',
  'pieces.parametrage.lire',
  'pieces.parametrage.modifier',
  'pieces.reservation.liberer',
  'pieces.reservation.satisfaire',
  'pieces.stock.modifier',
  'pneus.depot.changer_saison',
  'pneus.depot.creer',
  'pneus.depot.lire',
  'pneus.depot.sortir',
  'relances.facturation.regle.lire',
  'rendez_vous.creer',
  'rendez_vous.lire',
  'rendez_vous.modifier',
  'socle.utilisateur.lire',
  'tableau_bord.activite.lire',
  'vehicule.creer',
  'vehicule.modifier',
  'vehicule.plaque.gerer',
  'vehicule.travail_reporte.gerer',
  'vehicule.travail_reporte.signaler',
  'ventes.dossier.creer',
  'ventes.dossier.lire',
  'ventes.financement.confirmer',
  'ventes.financement.creer',
  'ventes.financement.lire',
  'ventes.reprise.confirmer',
  'ventes.reprise.creer',
  'ventes.reprise.lire',
  'ventes.reprise.refuser',
  'ventes.vehicule_stock.corriger',
  'ventes.vehicule_stock.creer',
] as const;
export type ActionCitee = (typeof ACTIONS_CITEES)[number];

/** `session.actions` ; `undefined` tant que la session n'est pas chargée (aucun droit). */
export type ActionsSession = readonly string[] | undefined;

export function peut(actions: ActionsSession, action: ActionCitee): boolean {
  return actions?.includes(action) ?? false;
}

/** Vrai seulement si la personne détient TOUTES les actions citées. */
export function peutToutes(actions: ActionsSession, ...requises: readonly ActionCitee[]): boolean {
  return requises.every((action) => peut(actions, action));
}

/** Vrai si la personne détient AU MOINS UNE des actions citées. */
export function peutUne(actions: ActionsSession, ...possibles: readonly ActionCitee[]): boolean {
  return possibles.some((action) => peut(actions, action));
}

/** Hook : la personne connectée détient-elle cette action ? (faux pendant le chargement.) */
export function usePeut(action: ActionCitee): boolean {
  const session = useSession();
  return peut(session.data?.actions, action);
}
