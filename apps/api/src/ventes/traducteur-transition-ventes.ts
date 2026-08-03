import type { CodeErreur } from '@dfa/shared';
import { ErreurMetier } from '../common/erreurs/erreur-metier';

/**
 * Interprète le SQLSTATE `ZDFA1` (transition d'état interdite, `public.verifier_transition()`,
 * `db/migrations/0003_prealables_etape1.sql` §6) pour les TROIS entités de ce module qui portent un
 * code `VENTE_*_TRANSITION_INTERDITE` dédié : `dossier_vente`, `reprise`, `financement_vente`.
 *
 * COPIE LOCALE VOLONTAIRE de `common/avertissements/traducteur-erreur-transition-sql.ts`, PAS un
 * appel à `interpreterErreurTransitionInterdite()` : cette fonction commune tient sa propre table
 * `TABLE_VERS_CODE_TRANSITION` en dur (`ordre_reparation`, `ligne_or`, `rendez_vous`, `pointage`),
 * hors du périmètre d'écriture de cet agent (`common/` n'est pas dans le périmètre exclusif de la
 * vague ventes). Y ajouter `dossier_vente`/`reprise`/`financement_vente` serait la solution la plus
 * propre — SIGNALÉ à l'orchestrateur, pas fait ici. Cette copie duplique ~30 lignes d'analyse du
 * SQLSTATE plutôt que d'écrire hors périmètre.
 *
 * `vehicule_stock` N'A PAS de code `VENTE_*_TRANSITION_INTERDITE` dédié (12 codes `VENTE_*` posés
 * par le binôme schéma, aucun pour cette entité — vérifié contre `probleme.ts`) : ses services
 * gardent chaque transition PAR UN CONTRÔLE D'ÉTAT EXPLICITE avant d'écrire (sous verrou
 * transactionnel), jamais en s'appuyant sur ce traducteur — le trigger reste un filet, pas le
 * mécanisme (même doctrine tenant/RLS du projet).
 */

const SQLSTATE_TRANSITION_INTERDITE = 'ZDFA1';

const TABLE_VERS_CODE_TRANSITION_VENTES: Readonly<Record<string, CodeErreur>> = {
  dossier_vente: 'VENTE_DOSSIER_TRANSITION_INTERDITE',
  reprise: 'VENTE_REPRISE_TRANSITION_INTERDITE',
  financement_vente: 'VENTE_FINANCEMENT_TRANSITION_INTERDITE',
};

interface ErreurPgBrute {
  readonly code?: unknown;
  readonly table?: unknown;
  readonly detail?: unknown;
}

const MOTIF_DETAIL = /^entite=([^;]+);depuis=([^;]+);vers=([^;]+)$/;

/**
 * Rend `null` si `erreur` n'est pas un `ZDFA1` exploitable pour une des trois entités ci-dessus —
 * l'appelant retombe alors sur son traitement générique (relance l'erreur telle quelle).
 *
 * GAP DE CONTRAT SIGNALÉ (`packages/shared/src/contrats/probleme.ts::TYPES_ELEMENT_BLOQUANT`, hors
 * périmètre d'écriture de cet agent) : ce type fermé ne porte NI `dossier_vente`, NI `reprise`, NI
 * `financement_vente`, NI `vehicule_stock` — seulement les valeurs de l'atelier/facturation
 * (`ordre_reparation`, `ligne_or`, `ligne_document`, `champ`…). `blocages` est donc omis ici plutôt
 * que peuplé avec un `type` qui ne compilerait pas (ou pire, un `as` forcé) : `detail` et
 * `actionsProposees: [{ code: 'RAFRAICHIR' }]` restent le signal exploitable pour l'appelant.
 * Idem, `entiteId`/`libelle` restent des paramètres de cette fonction pour le jour où le contrat
 * sera étendu — pas supprimés, juste inutilisés pour l'instant (voir le rapport de livraison).
 */
export function traduireErreurTransitionVente(erreur: unknown, _entiteId: string, _libelle: string): ErreurMetier | null {
  if (typeof erreur !== 'object' || erreur === null) return null;
  const brute = erreur as ErreurPgBrute;

  if (brute.code !== SQLSTATE_TRANSITION_INTERDITE) return null;
  if (typeof brute.table !== 'string') return null;
  const code = TABLE_VERS_CODE_TRANSITION_VENTES[brute.table];
  if (!code) return null;
  if (typeof brute.detail !== 'string') return null;

  const correspondance = MOTIF_DETAIL.exec(brute.detail);
  if (!correspondance) return null;
  const [, , statutDepuis, statutVers] = correspondance;
  if (!statutDepuis || !statutVers) return null;

  return new ErreurMetier(code, `Transition ${statutDepuis} → ${statutVers} interdite.`, {
    detail: `entite=${brute.table};depuis=${statutDepuis};vers=${statutVers}`,
    actionsProposees: [{ code: 'RAFRAICHIR' }],
  });
}
