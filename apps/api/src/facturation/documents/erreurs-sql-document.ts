import { ErreurMetier } from '../../common/erreurs/erreur-metier';

/**
 * Traduction des SQLSTATE `ZDFA1`/`ZDFA2`/`ZDFA5` levés par les triggers de `document_vente` et
 * `ligne_document` (`migrations/0010_facturation.sql` §6→§8) en `ErreurMetier` exploitables.
 *
 * PAS une réutilisation de `common/avertissements/traducteur-erreur-transition-sql.ts` : ce
 * traducteur commun attend un `detail` de la forme stricte `entite=<e>;depuis=<d>;vers=<v>` (posé
 * par `verifier_transition()`, 0003 §6) et une carte `TABLE_VERS_CODE_TRANSITION` fermée qui ne
 * connaît pas `document_vente`. Le trigger propre à la facturation
 * (`verifier_transition_document()`, 0010 §6) pose un `detail` de forme DIFFÉRENTE
 * (`entite=document_vente;entite_id=%s;type_document=%s;depuis=%s;vers=%s` — deux champs de plus),
 * qui ne matche pas `MOTIF_DETAIL` du traducteur commun. Réutiliser silencieusement aurait échoué à
 * chaque appel (retour `null`), pas à la compilation — plus sûr d'écrire un traducteur dédié que de
 * forcer un format qui n'est pas le sien.
 */

interface ErreurPgBrute {
  readonly code?: unknown;
  readonly table?: unknown;
  readonly detail?: unknown;
  readonly hint?: unknown;
}

function estErreurPg(erreur: unknown): erreur is ErreurPgBrute {
  return typeof erreur === 'object' && erreur !== null;
}

const MOTIF_HINT_TERMINAL = /^«[^»]*»\s+est un état terminal/;
const MOTIF_HINT_LISTE = /transitions autorisées\s*:\s*(.+?)\.?$/;

function transitionsPossibles(hint: string | null): readonly string[] {
  if (hint === null) return [];
  const correspondance = MOTIF_HINT_LISTE.exec(hint);
  const liste = correspondance?.[1];
  if (!liste) return [];
  return liste
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * `ZDFA1` sur `document_vente` (`verifier_transition_document`, 0010 §6) — transition de statut
 * interdite POUR CE `type_document`. Rend `null` si `erreur` n'est pas ce cas précis : l'appelant
 * retombe sur son traitement générique.
 */
export function traduireErreurTransitionDocument(
  erreur: unknown,
  documentId: string,
  numero: string | null,
): ErreurMetier | null {
  if (!estErreurPg(erreur) || erreur.code !== 'ZDFA1' || erreur.table !== 'document_vente')
    return null;
  if (typeof erreur.detail !== 'string') return null;

  const correspondance =
    /^entite=document_vente;entite_id=([^;]+);type_document=([^;]+);depuis=([^;]+);vers=([^;]+)$/.exec(
      erreur.detail,
    );
  if (!correspondance) return null;
  const [, , typeDocument, depuis, vers] = correspondance;

  const hint = typeof erreur.hint === 'string' ? erreur.hint : null;
  const estTerminal = hint !== null && MOTIF_HINT_TERMINAL.test(hint);

  return new ErreurMetier(
    'DOCUMENT_TRANSITION_INTERDITE',
    `Transition ${String(depuis)} → ${String(vers)} interdite pour un document « ${String(typeDocument)} ».`,
    {
      detail: `type_document=${String(typeDocument)};depuis=${String(depuis)};vers=${String(vers)}`,
      blocages: [
        {
          type: 'document_vente',
          id: documentId,
          libelle: numero ?? documentId,
          donnees: { statutActuel: depuis, statutDemande: vers, typeDocument },
        },
      ],
      actionsProposees: estTerminal ? [] : [{ code: 'RAFRAICHIR' }],
    },
  );
}

/**
 * `ZDFA2` sur `document_vente` ou `ligne_document` (verrouillage MD-20/MD-21 après émission) —
 * `DOCUMENT_VERROUILLE`. Rendre l'erreur COMPRÉHENSIBLE, jamais contourner le verrou lui-même
 * (consigne explicite de la tâche : le trigger fait foi).
 */
export function traduireErreurVerrouillage(
  erreur: unknown,
  documentId: string,
  numero: string | null,
): ErreurMetier | null {
  if (!estErreurPg(erreur) || erreur.code !== 'ZDFA2') return null;
  if (erreur.table !== 'document_vente' && erreur.table !== 'ligne_document') return null;
  if (typeof erreur.detail !== 'string' || !erreur.detail.includes('code=document_verrouille'))
    return null;

  return new ErreurMetier(
    'DOCUMENT_VERROUILLE',
    'Ce document est émis : il est verrouillé et ne peut plus être modifié (MD-20). Seul un avoir permet une correction.',
    {
      detail: erreur.detail,
      blocages: [{ type: 'document_vente', id: documentId, libelle: numero ?? documentId }],
      actionsProposees: [{ code: 'RAFRAICHIR' }],
    },
  );
}

/** `ZDFA5` (`document_vente_verifier_periode`, 0010 §7.3) — émission refusée, période comptable
 *  close pour `date_document` (`MD-34`). */
export function traduireErreurPeriodeClose(
  erreur: unknown,
  documentId: string,
  numero: string | null,
): ErreurMetier | null {
  if (!estErreurPg(erreur) || erreur.code !== 'ZDFA5' || erreur.table !== 'document_vente')
    return null;

  return new ErreurMetier(
    'DOCUMENT_PERIODE_CLOSE',
    'La période comptable de la date du document est close (MD-34) : émission refusée.',
    {
      detail: typeof erreur.detail === 'string' ? erreur.detail : undefined,
      blocages: [{ type: 'document_vente', id: documentId, libelle: numero ?? documentId }],
      actionsProposees: [{ code: 'RAFRAICHIR' }],
    },
  );
}

/** Essaie les trois traducteurs dans l'ordre ; rend `null` si aucun ne reconnaît l'erreur (relancer
 *  telle quelle est alors la bonne réponse). */
export function traduireErreurDocument(
  erreur: unknown,
  documentId: string,
  numero: string | null,
): ErreurMetier | null {
  return (
    traduireErreurTransitionDocument(erreur, documentId, numero) ??
    traduireErreurVerrouillage(erreur, documentId, numero) ??
    traduireErreurPeriodeClose(erreur, documentId, numero)
  );
}

// Exporté pour les tests unitaires qui veulent vérifier le parsing du hint isolément.
export { transitionsPossibles };
