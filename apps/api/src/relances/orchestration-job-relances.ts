/**
 * Orchestration du passage périodique du job de relances de facturation (rappel #2) — MÊME PATRON
 * que `pointage/orchestration-job-cloture-automatique-pointage.ts` (modèle) : fonction PURE
 * d'orchestration qui reçoit CHAQUE collaborateur en paramètre — jamais un import direct de
 * `pg`/`AccesBase`/`ServiceRelancesFacture` à l'intérieur — testable sans réseau ni base (voir le
 * fichier de test colocalisé). `ServiceJobRelancesFacture` (I/O) ne fait que la brancher aux
 * implémentations réelles.
 *
 * DEUX OPÉRATIONS, UN SEUL PASSAGE PAR TENANT — `planifier()` PUIS `envoyerPretes()`, dans cet
 * ordre : un palier qui vient tout juste de devenir dû est ainsi planifié ET envoyé dans le MÊME
 * passage horaire, plutôt que d'attendre le suivant (voir `config-job-relances.ts` pour la
 * justification de la cadence horaire, ce que résout ce couplage). Les deux opérations restent
 * chacune bornée (`LOT_PLANIFICATION`/`LOT_ENVOI`, `service-relances-facture.ts`) et drainées EN
 * BOUCLE pour le MÊME tenant, comme le modèle pointage — bornées par `MAX_PASSAGES_PAR_TENANT`
 * (25 passages, soit 5 000 candidats de planification ou 2 500 lignes d'envoi par tenant et par
 * passage — trois ordres de grandeur au-dessus de ce qu'un seul garage peut accumuler entre deux
 * passages horaires). Le dépassement est journalisé, jamais silencieux — le prochain passage
 * (l'heure suivante) reprend là où celui-ci s'est arrêté, même garantie d'idempotence que
 * `planifier`/`envoyerPretes` (RA-05, réclamation conditionnelle `WHERE statut = 'prete'`).
 *
 * IDENTITÉ DE L'APPELANT SYSTÈME — même décision, même raisonnement que l'orchestration pointage :
 * `ContexteTenant.utilisateurId` vaut `null` (convention documentée par `db/db.types.ts` : « `null`
 * = tâche système »), jamais un faux compte utilisateur — ni `direction` ni `comptable` (les deux
 * seuls rôles autorisés, `auth/matrice-droits.ts`) ne désignent un compte de service, et en
 * inventer un serait une donnée FAUSSE. `requeteId` porte le préfixe `job:relances-facture:<runId>`
 * (`runId` commun à TOUS les tenants d'un même passage) — un lecteur d'audit distingue ainsi ce
 * passage-ci d'un appel HTTP normal (`X-Requete-Id`, jamais préfixé `job:`).
 *
 * ISOLATION D'ÉCHEC PAR TENANT : une exception levée pour UN tenant (planification OU envoi) est
 * capturée et n'interrompt PAS le passage des tenants suivants — un souci chez un garage ne doit
 * jamais empêcher les relances des 199 autres. Une exception pendant `planifier()` interrompt les
 * DEUX opérations pour CE tenant (pas de tentative d'envoi sur un état de planification qu'on ne
 * peut plus garantir cohérent pour ce passage) — le job Nest lève quand même à la fin si au moins
 * un tenant a échoué (voir `ResultatJobRelancesFacture.tenantsEnErreur`), pour que BullMQ marque
 * le job en échec et le retente (l'opération entière est idempotente — RA-05, réclamation
 * conditionnelle — un retry ne planifie ni n'envoie jamais deux fois la même relance).
 */

import type { ReponseEnvoiRelances, ReponsePlanificationRelances } from '@dfa/shared';

import type { ContexteTenant } from '../db';

/** Voir § en-tête, « DEUX OPÉRATIONS, UN SEUL PASSAGE PAR TENANT ». */
const MAX_PASSAGES_PAR_TENANT = 25;

export interface ResultatTenantRelancesFacture {
  readonly tenantId: string;
  readonly planifCreees: number;
  readonly planifIgnorees: number;
  readonly passagesPlanification: number;
  readonly envoiEnvoyees: number;
  readonly envoiEchouees: number;
  readonly envoiAnnulees: number;
  readonly passagesEnvoi: number;
  /** Présent uniquement si CE tenant a levé une exception — voir § en-tête, isolation d'échec. */
  readonly erreur?: string;
}

export interface ResultatJobRelancesFacture {
  readonly runId: string;
  readonly tenantsTraites: number;
  readonly tenantsEnErreur: number;
  readonly resultats: readonly ResultatTenantRelancesFacture[];
}

export interface CollaborateursJobRelancesFacture {
  /** Identifiant unique de CE passage — commun à tous les tenants traités par cet appel, voir §
   *  en-tête « IDENTITÉ DE L'APPELANT SYSTÈME ». Résolu par l'appelant (`crypto.randomUUID()`,
   *  effet de bord), jamais généré ici : cette fonction reste pure. */
  readonly runId: string;
  readonly chargerTenantsActifs: () => Promise<readonly string[]>;
  readonly planifier: (ctx: ContexteTenant) => Promise<ReponsePlanificationRelances>;
  readonly envoyerPretes: (ctx: ContexteTenant) => Promise<ReponseEnvoiRelances>;
  readonly journaliser: (message: string, donnees?: Record<string, unknown>) => void;
}

function motifErreur(erreur: unknown): string {
  const message = erreur instanceof Error ? erreur.message : String(erreur);
  return message.trim().length > 0 ? message : 'Erreur inconnue (aucun message).';
}

export async function executerJobRelancesFacture(
  collaborateurs: CollaborateursJobRelancesFacture,
): Promise<ResultatJobRelancesFacture> {
  const { runId, chargerTenantsActifs, planifier, envoyerPretes, journaliser } = collaborateurs;

  const tenants = await chargerTenantsActifs();
  journaliser(`${String(tenants.length)} tenant(s) actif(s) à traiter.`, { runId });

  const resultats: ResultatTenantRelancesFacture[] = [];

  for (const tenantId of tenants) {
    const ctx: ContexteTenant = {
      tenantId,
      // Voir § en-tête « IDENTITÉ DE L'APPELANT SYSTÈME » : convention déjà documentée par
      // `db/db.types.ts`, pas une invention de ce fichier.
      utilisateurId: null,
      requeteId: `job:relances-facture:${runId}`,
    };

    let planifCreees = 0;
    let planifIgnorees = 0;
    let passagesPlanification = 0;
    let envoiEnvoyees = 0;
    let envoiEchouees = 0;
    let envoiAnnulees = 0;
    let passagesEnvoi = 0;

    try {
      let encoreATraiter = true;
      while (encoreATraiter && passagesPlanification < MAX_PASSAGES_PAR_TENANT) {
        const resultat = await planifier(ctx);
        planifCreees += resultat.creees;
        planifIgnorees += resultat.ignorees;
        passagesPlanification += 1;
        encoreATraiter = resultat.encoreATraiter;
      }
      if (passagesPlanification >= MAX_PASSAGES_PAR_TENANT) {
        journaliser(
          `Tenant ${tenantId} : plafond de ${String(MAX_PASSAGES_PAR_TENANT)} passages de ` +
            'planification atteint, des candidats restent probablement à traiter — repris ' +
            'automatiquement au prochain passage (idempotent).',
          { runId, tenantId },
        );
      }

      encoreATraiter = true;
      while (encoreATraiter && passagesEnvoi < MAX_PASSAGES_PAR_TENANT) {
        const resultat = await envoyerPretes(ctx);
        envoiEnvoyees += resultat.envoyees;
        envoiEchouees += resultat.echouees;
        envoiAnnulees += resultat.annulees;
        passagesEnvoi += 1;
        encoreATraiter = resultat.encoreATraiter;
      }
      if (passagesEnvoi >= MAX_PASSAGES_PAR_TENANT) {
        journaliser(
          `Tenant ${tenantId} : plafond de ${String(MAX_PASSAGES_PAR_TENANT)} passages d'envoi ` +
            'atteint, des lignes prêtes restent probablement à traiter — reprises ' +
            'automatiquement au prochain passage (idempotent).',
          { runId, tenantId },
        );
      }

      resultats.push({
        tenantId,
        planifCreees,
        planifIgnorees,
        passagesPlanification,
        envoiEnvoyees,
        envoiEchouees,
        envoiAnnulees,
        passagesEnvoi,
      });
    } catch (erreur) {
      const motif = motifErreur(erreur);
      journaliser(`Tenant ${tenantId} : échec des relances de facturation — ${motif}`, {
        runId,
        tenantId,
      });
      resultats.push({
        tenantId,
        planifCreees,
        planifIgnorees,
        passagesPlanification,
        envoiEnvoyees,
        envoiEchouees,
        envoiAnnulees,
        passagesEnvoi,
        erreur: motif,
      });
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
