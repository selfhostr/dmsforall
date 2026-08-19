/**
 * Orchestration du passage quotidien du job de clôture automatique de fin de journée du pointage
 * (RM-91/RM-119/CT-57) — MÊME PATRON que `vehicules/referentiel/job-mise-a-jour-referentiel-
 * vehicules-ch.ts::executerVerificationReferentielVehiculesCh` (modèle désigné par la consigne de
 * ce chantier) : fonction PURE d'orchestration qui reçoit CHAQUE collaborateur en paramètre —
 * jamais un import direct de `pg`/`AccesBase` à l'intérieur — testable sans réseau ni base (voir
 * le fichier de test colocalisé). `ServiceJobClotureAutomatiquePointage` (I/O) ne fait que la
 * brancher aux implémentations réelles.
 *
 * IDENTITÉ DE L'APPELANT SYSTÈME — DÉCISION tranchée par ce chantier (second point resté ouvert
 * par `service-cloture-automatique-pointage.ts`, § en-tête) : `ContexteTenant.utilisateurId` vaut
 * `null` (convention DÉJÀ DOCUMENTÉE par `db/db.types.ts`, commentaire du champ : « `null` = tâche
 * système (job BullMQ, migration de données, seed) ») — jamais un faux compte utilisateur créé
 * pour l'occasion (un « compte de service » qui n'existe dans AUCUN rôle autorisé aujourd'hui,
 * même trou que documenté par `relances/relances.controller.ts` : inventer un utilisateur pour
 * porter cette action serait une donnée FAUSSE, pas une donnée manquante). La distinction avec
 * une clôture faite par un humain (absence de donnée ≠ valeur, doctrine du dépôt) tient déjà,
 * SANS rien ajouter au schéma, par la COMBINAISON de deux faits déjà écrits par
 * `appliquerClotureAutomatique` (`pointage-requetes.ts`) :
 *   1. `pointage.cloture_automatique = true` (jamais posé par une correction manuelle, voir son
 *      commentaire) — visible sur CHAQUE lecture du pointage, pas seulement dans l'audit ;
 *   2. la ligne `audit_atelier` posée par le trigger générique `pointage_audit`
 *      (`auditer_atelier()`, migration 0004/0030 — AUCUNE écriture applicative supplémentaire,
 *      vérifié : ce fichier n'écrit jamais dans `audit_atelier`) porte `utilisateur_id = NULL`
 *      (lu depuis le GUC `app.utilisateur_id`, lui-même posé à NULL par `enTenant(ctx)`) — une
 *      correction manuelle (`POST /pointages/{id}/corriger`) porte TOUJOURS un `utilisateur_id`
 *      non nul (l'appelant authentifié). `utilisateur_id NULL` + `cloture_automatique = true` ne
 *      peut donc JAMAIS se confondre avec une correction humaine, et ne peut pas non plus se
 *      confondre avec une « absence » anodine : c'est un couple de valeurs POSITIVEMENT distinct,
 *      pas un trou.
 *   `requeteId` (`ContexteTenant.requeteId`, lui aussi capturé par le trigger via
 *   `app.requete_id`/`requete_courante()`) porte un préfixe RECONNAISSABLE
 *   (`job:pointage-cloture-automatique:<runId>`, `runId` commun à TOUS les tenants d'un même
 *   passage) — un lecteur d'`audit_atelier` distingue ainsi immédiatement ce passage-ci d'un autre
 *   (rejoué le lendemain) et d'un appel HTTP normal (dont le `requete_id` est un UUID de
 *   corrélation `X-Requete-Id`, jamais préfixé `job:`).
 *
 * ÉNUMÉRATION DES TENANTS — voir `enumerer-tenants-actifs-pointage.ts` pour la décision complète
 * (canal `dfa_migrator` déjà audité, policy `tenant_migrator` posée dès la migration 0001, jamais
 * une 7ᵉ fonction `amorcage.*`). Ce fichier-ci ne fait qu'itérer la liste rendue, UN TENANT À LA
 * FOIS, JAMAIS EN PARALLÈLE (`for` séquentiel, pas de `Promise.all`) — même doctrine que
 * `ServiceClotureAutomatiquePointage.executerPourTenant` : « jamais deux tenants dans le même
 * appel », étendue ici à « jamais deux tenants dans le même PASSAGE concurrent », pour ne pas
 * saturer `DATABASE_POOL_MAX` (partagé par tous les tenants) avec N transactions ouvertes à la
 * fois un job qui, par nature, n'a AUCUNE contrainte de latence utilisateur.
 *
 * ISOLATION D'ÉCHEC PAR TENANT : une exception levée pour UN tenant (ex. transaction en erreur,
 * contrainte violée) est capturée et n'interrompt PAS le passage des tenants suivants — un souci
 * chez un garage ne doit jamais empêcher la clôture des 199 autres. Le job Nest lève quand même à
 * la fin si au moins un tenant a échoué (voir `ResultatJobClotureAutomatiquePointage.
 * tenantsEnErreur`), pour que BullMQ marque le job en échec et le retente (l'opération entière est
 * idempotente, voir la doc de `ServiceClotureAutomatiquePointage` — un retry ne referme jamais un
 * pointage déjà refermé).
 *
 * LOT BORNÉ PAR TENANT, DRAINÉ EN BOUCLE : `ServiceClotureAutomatiquePointage.executerPourTenant`
 * traite au plus `LOT` (200) candidats par appel et signale `encoreATraiter`. Ce fichier rappelle
 * la méthode en boucle pour le MÊME tenant tant qu'il en reste, borné par
 * `MAX_PASSAGES_PAR_TENANT` (25, soit 5 000 pointages/tenant/passage — trois ordres de grandeur
 * au-dessus de ce qu'un seul garage peut accumuler entre deux passages quotidiens) : une garde,
 * pas une limite qu'on s'attend à jamais atteindre en production. Le dépassement est journalisé,
 * jamais silencieux — le prochain passage (le lendemain) reprendra là où celui-ci s'est arrêté,
 * même garantie d'idempotence.
 */

import type { ContexteTenant } from '../db';
import type { ResultatClotureAutomatiquePointage } from './service-cloture-automatique-pointage';

/** Voir § en-tête, « LOT BORNÉ PAR TENANT ». */
const MAX_PASSAGES_PAR_TENANT = 25;

export interface ResultatTenantClotureAutomatique {
  readonly tenantId: string;
  readonly clotures: number;
  readonly examines: number;
  readonly ignores: number;
  readonly passages: number;
  /** Présent uniquement si CE tenant a levé une exception — voir § en-tête, isolation d'échec. */
  readonly erreur?: string;
}

export interface ResultatJobClotureAutomatiquePointage {
  readonly runId: string;
  readonly tenantsTraites: number;
  readonly tenantsEnErreur: number;
  readonly resultats: readonly ResultatTenantClotureAutomatique[];
}

export interface CollaborateursJobClotureAutomatiquePointage {
  /** Identifiant unique de CE passage — commun à tous les tenants traités par cet appel, voir §
   *  en-tête « IDENTITÉ DE L'APPELANT SYSTÈME ». Résolu par l'appelant (`crypto.randomUUID()`,
   *  effet de bord), jamais généré ici : cette fonction reste pure. */
  readonly runId: string;
  readonly chargerTenantsActifs: () => Promise<readonly string[]>;
  readonly executerPourTenant: (ctx: ContexteTenant) => Promise<ResultatClotureAutomatiquePointage>;
  readonly journaliser: (message: string, donnees?: Record<string, unknown>) => void;
}

function motifErreur(erreur: unknown): string {
  const message = erreur instanceof Error ? erreur.message : String(erreur);
  return message.trim().length > 0 ? message : 'Erreur inconnue (aucun message).';
}

export async function executerJobClotureAutomatiquePointage(
  collaborateurs: CollaborateursJobClotureAutomatiquePointage,
): Promise<ResultatJobClotureAutomatiquePointage> {
  const { runId, chargerTenantsActifs, executerPourTenant, journaliser } = collaborateurs;

  const tenants = await chargerTenantsActifs();
  journaliser(`${String(tenants.length)} tenant(s) actif(s) à traiter.`, { runId });

  const resultats: ResultatTenantClotureAutomatique[] = [];

  for (const tenantId of tenants) {
    const ctx: ContexteTenant = {
      tenantId,
      // Voir § en-tête « IDENTITÉ DE L'APPELANT SYSTÈME » : convention déjà documentée par
      // `db/db.types.ts`, pas une invention de ce fichier.
      utilisateurId: null,
      requeteId: `job:pointage-cloture-automatique:${runId}`,
    };

    let clotures = 0;
    let examines = 0;
    let ignores = 0;
    let passages = 0;

    try {
      let encoreATraiter = true;
      while (encoreATraiter && passages < MAX_PASSAGES_PAR_TENANT) {
        const resultat = await executerPourTenant(ctx);
        clotures += resultat.clotures;
        examines += resultat.examines;
        ignores += resultat.ignores;
        passages += 1;
        encoreATraiter = resultat.encoreATraiter;
      }
      if (passages >= MAX_PASSAGES_PAR_TENANT) {
        journaliser(
          `Tenant ${tenantId} : plafond de ${String(MAX_PASSAGES_PAR_TENANT)} passages atteint, ` +
            'des candidats restent probablement à traiter — repris automatiquement au prochain passage (idempotent).',
          { runId, tenantId },
        );
      }
      resultats.push({ tenantId, clotures, examines, ignores, passages });
    } catch (erreur) {
      const motif = motifErreur(erreur);
      journaliser(`Tenant ${tenantId} : échec de la clôture automatique — ${motif}`, {
        runId,
        tenantId,
      });
      resultats.push({ tenantId, clotures, examines, ignores, passages, erreur: motif });
    }
  }

  const tenantsEnErreur = resultats.filter((r) => r.erreur !== undefined).length;
  journaliser(
    `Passage terminé : ${String(resultats.length)} tenant(s) traité(s), ` +
      `${String(tenantsEnErreur)} en erreur.`,
    { runId },
  );

  return { runId, tenantsTraites: resultats.length, tenantsEnErreur, resultats };
}
