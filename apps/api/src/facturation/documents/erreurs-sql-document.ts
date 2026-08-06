import { remonterCausePg } from '../../common/erreurs-pg';
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
 *
 * IMPORTANT : le pilote `pg` lève bien l'erreur brute avec `code`/`table`/`detail`/`hint`
 * directement sur l'objet, mais Drizzle (`pg-core/session.js`) l'enveloppe systématiquement dans
 * une `DrizzleQueryError` qui porte la brute sous `.cause` — jamais `code`/`table`/`detail`/`hint`
 * en surface. Sans déballer `.cause`, aucun des trois traducteurs ci-dessous ne reconnaît jamais
 * rien et tout retombe en `ERREUR_INTERNE`/500 (constaté : modifier une facture émise, ou émettre
 * sur une période close, ressortaient en 500 avant ce correctif). Le déballage lui-même est
 * factorisé dans `common/erreurs-pg/remonter-cause-pg.ts::remonterCausePg` (même patron que
 * `vehicules/erreurs-contraintes.ts::remonterCause`) — ce fichier ne fait qu'étendre localement la
 * forme rendue (`table`, `hint`, en plus de `code`/`detail`) via un cast, la structure réelle de
 * l'objet `pg` portant bien ces champs au runtime même si le type partagé ne les déclare pas.
 */

interface ErreurPgBrute {
  readonly code?: unknown;
  readonly table?: unknown;
  readonly detail?: unknown;
  readonly hint?: unknown;
  readonly cause?: unknown;
}

/**
 * Rend la première erreur de la chaîne `.cause` (elle-même incluse) qui porte un `code` (SQLSTATE)
 * en chaîne de caractères, ou `null` si aucune n'en porte un — que la chaîne soit vide (erreur
 * brute du pilote `pg`, jamais enveloppée, cas des tests unitaires qui construisent déjà le bon
 * objet) ou qu'elle contienne une `DrizzleQueryError` (cas réel en production).
 */
function remonterCauseErreurPg(erreur: unknown): ErreurPgBrute | null {
  return remonterCausePg(erreur) as ErreurPgBrute | null;
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
  const brute = remonterCauseErreurPg(erreur);
  if (!brute || brute.code !== 'ZDFA1' || brute.table !== 'document_vente') return null;
  if (typeof brute.detail !== 'string') return null;

  const correspondance =
    /^entite=document_vente;entite_id=([^;]+);type_document=([^;]+);depuis=([^;]+);vers=([^;]+)$/.exec(
      brute.detail,
    );
  if (!correspondance) return null;
  const [, , typeDocument, depuis, vers] = correspondance;

  const hint = typeof brute.hint === 'string' ? brute.hint : null;
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
  const brute = remonterCauseErreurPg(erreur);
  if (!brute || brute.code !== 'ZDFA2') return null;
  if (brute.table !== 'document_vente' && brute.table !== 'ligne_document') return null;
  if (typeof brute.detail !== 'string' || !brute.detail.includes('code=document_verrouille'))
    return null;

  return new ErreurMetier(
    'DOCUMENT_VERROUILLE',
    'Ce document est émis : il est verrouillé et ne peut plus être modifié (MD-20). Seul un avoir permet une correction.',
    {
      detail: brute.detail,
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
  const brute = remonterCauseErreurPg(erreur);
  if (!brute || brute.code !== 'ZDFA5' || brute.table !== 'document_vente') return null;

  return new ErreurMetier(
    'DOCUMENT_PERIODE_CLOSE',
    'La période comptable de la date du document est close (MD-34) : émission refusée.',
    {
      detail: typeof brute.detail === 'string' ? brute.detail : undefined,
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
