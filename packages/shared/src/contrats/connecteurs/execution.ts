import { z } from 'zod';

import {
  OPERATIONS_CONNECTEUR,
  STATUTS_EXECUTION_CONNECTEUR,
  TYPES_DECLENCHEMENT_CONNECTEUR,
  type OperationConnecteur,
  type StatutExecutionConnecteur,
  type TypeDeclenchementConnecteur,
} from './enums';
import { schemaMotif, schemaIdentifiant } from '../atelier/primitives';
import { schemaBooleenQuery, schemaListeQuery } from '../filtres';
import { schemaParametresPage } from '../pagination';
import type { TypeEvenementMetier } from '../atelier/evenement';

/**
 * Le journal d'exécution (`RC-03`, `RC-04`) — une ligne par tentative LOGIQUE d'import ou d'export,
 * pas une ligne par requête HTTP entrante : `POST .../imports` ou `POST .../exports` CRÉE une
 * exécution, le worker asynchrone (`RC-02`, file BullMQ déjà en place) la fait progresser à travers
 * `STATUTS_EXECUTION_CONNECTEUR`. `tentative` s'incrémente sur reprise (`RC-04`, backoff croissant)
 * SANS créer une nouvelle ligne — l'historique des tentatives reste dans `erreurs` et
 * `prochaineTentativeLe` porte l'état courant, pas une collection de tentatives passées séparée
 * (choix délibéré : un connecteur qui échoue en boucle produit un journal utile à lire, pas cent
 * lignes identiques).
 */

/** Compteurs génériques d'un traitement — mêmes noms qu'un import et qu'un export pour rester
 *  lisibles côte à côte dans un même écran d'historique. */
export interface ResumeExecutionConnecteur {
  readonly lignesTotal: number;
  readonly lignesCreees: number;
  readonly lignesMajees: number;
  readonly lignesRejetees: number;
  readonly lignesIgnorees: number;
}

/** Une erreur nommée, bornée par `erreursTronquees` — même doctrine que `ElementBloquant`
 *  (`probleme.ts`, §3.5 règle 2) : au-delà de `SEUIL_ERREURS_EMBARQUEES_EXECUTION`, le compte réel
 *  vit dans `resume.lignesRejetees`, pas dans un tableau qui grossirait sans borne. */
export interface ErreurExecutionConnecteur {
  /** Numéro de ligne dans le fichier source, `null` pour une erreur qui ne porte pas sur une ligne
   *  précise (ex. fichier illisible, échec de connexion au tiers). */
  readonly ligne: number | null;
  readonly message: string;
}

export const SEUIL_ERREURS_EMBARQUEES_EXECUTION = 50;

export interface ReponseExecutionConnecteur {
  readonly id: string;
  readonly connecteurActivationId: string;
  readonly operation: OperationConnecteur;
  /**
   * Sous-catégorie extensible (`NatureImportConnecteur` de `import.ts` ou `NatureExportConnecteur`
   * de `export.ts`) — typée en `string` ICI pour que ce fichier reste indépendant du sens
   * import/export, même doctrine que `ElementBloquant.type` dans `probleme.ts`.
   */
  readonly nature: string;
  readonly declenchement: TypeDeclenchementConnecteur;
  /** Renseigné UNIQUEMENT si `declenchement = 'evenement'` (`declenchement.ts`). */
  readonly evenementDeclencheur: TypeEvenementMetier | null;
  readonly statut: StatutExecutionConnecteur;
  /** Commence à `1`. `RC-04` : incrémenté à chaque reprise automatique OU manuelle
   *  (`schemaRejouerExecutionConnecteur` ci-dessous). */
  readonly tentative: number;
  /** `RC-04` : espacement CROISSANT entre tentatives, paramétrable par connecteur
   *  (`ReponseConnecteurActivation.politiqueNouvellesTentatives`, `connecteur.ts`). `null` quand
   *  `statut` est terminal (`reussie`, `necessite_action`, `annulee`). */
  readonly prochaineTentativeLe: string | null;
  /** `RC-64`. Présent UNIQUEMENT pour un import fondé sur un fichier — `null` pour un export ou un
   *  import qui ne porte pas sur un fichier complet. */
  readonly empreinteFichier: string | null;
  /** `RC-46`. Présent UNIQUEMENT pour un export ciblé sur un objet métier unique (ex. une annonce
   *  véhicule) — `objetType` est une valeur libre côté serveur (`'vehicule_stock'`, …), jamais
   *  contrainte ici pour ne pas dupliquer un enum métier qui vit ailleurs (`ventes/enums.ts`). */
  readonly objetType: string | null;
  readonly objetId: string | null;
  readonly resume: ResumeExecutionConnecteur;
  readonly erreurs: readonly ErreurExecutionConnecteur[];
  readonly erreursTronquees: boolean;
  readonly demarreeLe: string | null;
  readonly termineeLe: string | null;
  readonly creeLe: string;
}

/* ------------------------------------------------------------------ */
/* Lecture — collection                                                */
/* ------------------------------------------------------------------ */

export const TRIS_EXECUTIONS_CONNECTEUR = ['creeLe:desc', 'creeLe:asc'] as const;
export const TRI_DEFAUT_EXECUTIONS_CONNECTEUR = 'creeLe:desc';

export const schemaFiltresExecutionsConnecteur = schemaParametresPage.extend({
  connecteurActivationId: schemaIdentifiant.optional(),
  operation: schemaListeQuery(z.enum(OPERATIONS_CONNECTEUR)).optional(),
  statut: schemaListeQuery(z.enum(STATUTS_EXECUTION_CONNECTEUR)).optional(),
  declenchement: schemaListeQuery(z.enum(TYPES_DECLENCHEMENT_CONNECTEUR)).optional(),
  /** `true` : exécutions qui attendent une action humaine (`RC-04`) — sucre équivalent à
   *  `statut: ['necessite_action']`, même doctrine que `avecReliquat`
   *  (`pieces/commande-fournisseur.ts`) : une vue reste reproductible par les filtres primitifs. */
  necessiteAction: schemaBooleenQuery().optional(),
  tri: z.enum(TRIS_EXECUTIONS_CONNECTEUR).default(TRI_DEFAUT_EXECUTIONS_CONNECTEUR),
});
export type FiltresExecutionsConnecteur = z.infer<typeof schemaFiltresExecutionsConnecteur>;

/* ------------------------------------------------------------------ */
/* Reprise après échec (item explicite du socle demandé)               */
/* ------------------------------------------------------------------ */

/**
 * `POST /connecteurs/executions/{id}/rejouer` — reprise MANUELLE après échec (`RC-04`), en plus
 * des reprises automatiques déjà comptées dans `tentative`. Autorisé UNIQUEMENT depuis
 * `necessite_action` — `409 CONNECTEUR_EXECUTION_TRANSITION_INTERDITE` sinon (ex. rejouer une
 * exécution déjà `reussie`). Pas d'`Idempotency-Key` : transition gardée par l'état de départ,
 * même patron que `pieces/commande-fournisseur.ts::schemaAnnulationReliquat` — rejouer deux fois de
 * suite la même exécution `necessite_action` fait échouer le second appel avec le même code, pas un
 * doublon d'exécution.
 */
export const schemaRejouerExecutionConnecteur = z.object({
  /** Facultatif : contexte pour le journal (« identifiants corrigés », « fichier redéposé ») —
   *  jamais requis, `RC-04` n'impose aucune justification pour relancer. */
  motif: schemaMotif.optional(),
});
export type EntreeRejouerExecutionConnecteur = z.infer<typeof schemaRejouerExecutionConnecteur>;

/**
 * `POST /connecteurs/executions/{id}/annuler` — solde une exécution devenue sans objet (ex. fichier
 * redéposé sous une autre forme, objet source supprimé entre-temps) SANS tentative supplémentaire.
 * Autorisé depuis `en_attente`, `echec_reprogramme` ou `necessite_action` uniquement — jamais depuis
 * `en_cours` (un traitement démarré se laisse terminer) ni un état déjà terminal.
 */
export const schemaAnnulationExecutionConnecteur = z.object({
  motif: schemaMotif,
});
export type EntreeAnnulationExecutionConnecteur = z.infer<
  typeof schemaAnnulationExecutionConnecteur
>;
